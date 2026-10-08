# 上线后维护手册

本文用于记录生产环境的发布与数据库迁移规范，确保任意维护者在无额外上下文时也能独立执行。

## 1. 日常改动是否需要迁移数据库

### 只改前端/接口逻辑（不改表结构）

- 可以直接 `push`，Cloudflare 会自动构建和部署。
- 不需要执行 `npm run db:migrate:remote`。

常见场景：

- 页面样式、文案、交互调整。
- 新增接口逻辑但不新增/修改 D1 表结构。
- 变量、绑定、路由、权限文案调整。

### 改了数据库结构（新增表/字段/索引）

- 仅 `push` 不够，必须额外执行一次远程迁移：

```bash
npm run db:migrate:remote
```

常见场景：

- `drizzle/*.sql` 新增了 migration 文件。
- 表结构发生变化（例如新增字段、索引、约束）。

> ⚠️ **不要用 `npm run db:generate` 生成迁移。**
> 本仓库的 `drizzle/meta/_journal.json` 只登记了 `0000`，`0001`~`0024` 是手写的、
> 从未进入 drizzle-kit 的元数据。因此 `db:generate` 会把历史变更**整个重放**一遍
> （重复 `CREATE TABLE` / `ADD COLUMN`），在已有数据的线上库上会直接失败。
> 正确做法：**在 `drizzle/` 下手写 `00NN_描述.sql`**，与既有 24 个迁移的做法一致，
> 索引类语句建议写成 `CREATE INDEX IF NOT EXISTS`。

## 2. 标准发布流程（建议固定执行）

1. 本地改代码并提交，推送到 `main`。
2. 等 Cloudflare 自动部署成功。
3. 若本次包含数据库结构改动，执行 `npm run db:migrate:remote`。
4. 手动验证核心链路：后台登录、文章读写、媒体上传、友链申请。
5. **跑一次冒烟测试**（见下）。

### 部署后的冒烟测试

```bash
# 打线上
npm run smoke -- https://你的域名

# 或先本地起服务再打本地
npx wrangler dev --port 8787      # 另开一个终端
npm run smoke                     # 默认 http://127.0.0.1:8787
```

`scripts/smoke-test.mjs` 覆盖 17 项检查，全部是**只有把服务跑起来才能发现**的那类问题：

- 关键路由可用性（首页 / 归档 / 友链 / 搜索 / 说说 / RSS / Sitemap / robots）
- **归档缓存键不变量**：`/blog?category=<合法但不存在的 slug>` 渲染出的空态
  只会写进它自己的缓存键，不会污染 `/blog`
- 非法 `page` 参数渲染第 1 页，而不是空归档
- 边缘缓存命中（`X-Edge-Cache: HIT`）
- HTML 带 CSP、`/api/*` 不带 CSP、`X-Content-Type-Options`
- **`public/_headers` 是否被平台真正接受**（脚本与静态资源是否拿到 86400 的缓存头）

最后一项尤其重要：`_headers` 的格式错误（多个路径共享一个缩进块）会让规则被
**静默丢弃**，文件却看起来完全正常，单测也发现不了。退出码非 0 即表示有检查失败，
可以直接当作部署门禁。


### 迁移之后：必要时刷新查询统计

`drizzle/0025_public_query_indexes.sql` 建立的部分索引（以 `published_at DESC` 打头）
**只有在数据库存在统计信息时才会被查询规划器采用**，否则等于不存在
（实测：归档列表 0.15ms → 3.9ms，搜索 0.67ms → 25.9ms）。

该迁移末尾自带 `ANALYZE`，但它执行时表往往还是空的（先迁移、后灌数据），
那种统计没有意义。因此以下情况请手动补跑一次：

```bash
npx wrangler d1 execute blog --remote --command "ANALYZE"
```

- 全新部署、首次导入内容之后
- 通过 `npm run sync:posts` 批量导入文章之后
- 通过后台/MCP 批量导入之后

判断是否退化：`npm test` 里的 `tests/unit/query-plans.test.ts` 会在本地内存库上
检查这些查询的计划，出现全表扫描或全量排序就会失败。

（`ANALYZE` 在 D1 上是被接受的：本地 `wrangler d1 migrations apply --local` 已实测
通过，6 条语句建索引 + `ANALYZE` 共 8 条命令全部成功。）

## 3. 运行时配置要点

以下内容必须配置在 Cloudflare 项目的运行时环境（Production/Preview）：

- `ADMIN_GITHUB_LOGIN`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `JWT_SECRET`
- `SITE_URL`
- `TURNSTILE_SITE_KEY`（若启用 Turnstile）
- `TURNSTILE_SECRET_KEY`（若启用 Turnstile）

资源绑定名必须保持一致：

- D1: `DB`
- KV: `SESSION`
- R2: `MEDIA_BUCKET`

## 4. 常见问题排查

### 登录页显示“允许访问账号：未配置”

- 优先检查 `ADMIN_GITHUB_LOGIN` 是否配置在运行时环境。
- 检查变量名是否有前后空白字符。

### 友链申请页提示“未配置 Turnstile Site Key”

- 检查 `TURNSTILE_SITE_KEY` 是否已配置。
- 如果仓库 `wrangler.jsonc` 里把该值写成空字符串，部署时会覆盖线上值。

## 5. 说明

- D1 的业务数据不会因为普通代码部署被清空。
- 仅在执行 migration 时才会发生结构变更。

## 6. 文章生命周期（来源与回收站）

- `blog_posts` 表有 `source`（`file` / `admin` / `mcp`）与 `deleted_at` 两个字段（迁移 `0023_post_lifecycle.sql`）。
- 后台「删除」是软删除（移入回收站），「彻底删除」才是物理删除。
- `sync:posts` 只管理 `source='file'` 的文章：删除仓库里的 `.md` 文件会在下次部署时把对应文章移入回收站；重新编辑文件则恢复。
- 上线本次改动后，需执行一次 `npm run db:migrate:remote` 应用 `0023` 迁移。
