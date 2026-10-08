# 接手优化与性能方案

> 面向 `cf-astro-blog` 新维护者的体检报告 + 优化路线 + 交接清单。
> 全部结论基于本机实测(构建产物、线上响应)与静态审计,证据均带 `文件:行号`。
>
> 审计环境:Astro **7.3.6** / `@astrojs/cloudflare` **14.3.4** / wrangler **4.147.0** / Node **26.10.0** / npm 12.2.0

---

## 执行进度

> 本表随改动更新。"实测"列来自本机 `npm run build:analyze` 与线上 `curl`。

### 已完成并验证

| 计划项 | 内容 | 实测结果 |
| --- | --- | --- |
| **P0-1** | 边缘缓存键污染修复:`/blog` 不再清空查询串,`page` 与 `category` 按白名单归一化 | `/blog?category=X` 与 `/blog` 不再共用缓存键 |
| **P0-2** | 补 6 个公开查询索引(迁移 `0025`) | 9 条热点查询全部消除全表扫描与全量排序,见下表 |
| — | 缓存键逻辑抽成**零依赖纯模块**,补行为级单测 | 新增 `src/lib/edge-cache-key.ts` + `tests/unit/edge-cache-key.test.ts`(15 个测试) |
| — | `public/_headers` 一致性测试(新增脚本漏登记 / 死规则残留) | 新增 `tests/unit/static-headers.test.ts`(3 个测试,已验证非空转) |
| — | **查询计划回归测试**(索引退化的唯一发现手段) | 新增 `tests/unit/query-plans.test.ts`(3 个测试,已验证非空转) |
| — | 零依赖文本工具抽离(计划 **D1** 第 1 步) | 新增 `src/lib/text.ts`;中间件不再进入 katex/marked 模块图 |
| **B1** | 移除 Shippori Mincho(字体栈第 3 位、CJK 上不可达) | `@font-face` **480 → 216** |
| **B1** | KaTeX CSS 从全站包移到文章页专属布局 | 从共享 `Base.css` 拆到 `_slug_.css` |
| **B1** | 共享 CSS 体积 | **521.7 KB → 230.9 KB(−55.7%)** |
| **B1** | 构建产物总大小 | **30.32 MB → 14.29 MB(−52.9%)**,文件数 814 → 350 |
| **B2** | `<head>` 解析阻塞脚本 | 5 个中 4 个加 `defer`;`theme.js` 保持同步(防主题闪烁) |
| **B3** | prefetch 收敛 | `prefetchAll: true` → `defaultStrategy: "hover"` |
| **A2** | 删除对 Worker 无效的 `manualChunks` | 已用构建验证:包体不变(3.26 → 3.24 MB) |
| **A3** | 删除 Pages 遗留文件 | `public/_routes.json`、`public/.assetsignore` |
| **A4** | 修 `public/_headers` | 删掉 4 条指向不存在目录的规则;public/ 脚本逐条显式声明缓存(避免 `/*.js` 与 `/_astro/*` 重叠)+ 测试守住一致性 |
| **A6** | handoff 阻塞项 | 声明 `sharp`;补 `engines: node >= 22`;`.dsh/` 进 `.gitignore` |
| **C4** | 长尾工作移出请求关键路径(`waitUntil`) | 新增 `src/lib/background.ts` + 3 处接入,见下 |
| **D1-2** | Markdown 渲染栈改为**延迟加载** | `security` chunk **1.33 MB → 35.2 KB**,见下 |
| **P2** | 文档纠偏 | README 的 7 处过期描述、`RELEASE.md` 的约 700 行重复内容、`MEDIA-OPTIMIZATION.md` 关于 `_headers` 的错误结论,均已修正 |
| **P2** | CI 部署门禁 | 部署前跑 `check` + `test`;Node 统一到 24;去掉有陈旧风险的 `dist` 缓存 |
| **D4** | 补上"零行为测试"的安全代码 | 登录锁定 8 个行为测试;CSP 白名单 4 个字节级断言 |
| **验证** | **端到端跑通本地 workerd 并逐项核对** | P0-1 得到行为级证明;并抓出 `_headers` 的格式 bug,见下 |
| — | 修 `public/_headers` 的**格式错误** | 此前 14/17 条规则被平台静默丢弃,现已全部生效 |
| **调研** | 官方 `cache`/`routeRules` 迁移**做完完整实验** | 缓存部分实测可行;**失效卡在本地无法验证**,见 §4.7 |
| **B1** | **量化每页字体下载量**(此前一直是空白) | 新增 `scripts/analyze-font-payload.mjs`;实测每页 **460-775 KB**,见 §4.6 |
| **B1** | **去掉粗体 CJK 字体** | 每页 **−122.1 KB**;构建产物 **14.30 → 9.81 MB(−4.49 MB)** |
| **B1** | **改用系统 CJK 字体**(站长决策) | 每页字体下载 **653 → 37 KB**;构建产物 **9.81 → 5.29 MB** |
| **工具** | 端到端核查固化为可重复脚本 | 新增 `scripts/smoke-test.mjs`(`npm run smoke`),17 项检查,已接入维护手册的发布流程 |
| — | 修 `scripts/analyze-build.mjs` 自身缺陷 | `formatSize` 传负数返回 NaN;不再把**整站**体积当 Worker 体积报警 |
| — | 同步 lockfile | `npm install` 移除 `@fontsource/shippori-mincho`,避免 `npm ci` 失败 |
| **P0-3** | **在途工作与本轮全部改动已提交** | 分 6 个逻辑提交,工作区干净 |

### 提交记录

本次接手的改动已按主题分成 6 个提交(接手前那批未提交的在途工作也一并落地,
消除了 P0-3 的丢失风险):

| 提交 | 内容 |
| --- | --- |
| `2f9c6b2` | `feat(media)`:接手时在途的媒体图片优化流程 |
| `4c7e3fc` | `perf(assets)`:字体重建与静态资源缓存(构建 −82.6%,每页字体 −95%) |
| `c646b2e` | `perf(assets)`:`<head>` 脚本去阻塞 + KaTeX 样式移出全站包 |
| `fd32f48` | `fix(cache)+perf(runtime)`:缓存键污染、冷启动、长尾任务与 CSP |
| `e078131` | `perf(db)`:公开查询索引 + 查询计划回归测试 |
| `09d49dc` | `test+docs+ci`:行为测试、冒烟脚本、交接文档与 CI 门禁 |

> 说明:少数文件(尤其 `tests/unit/public-content.test.ts`)同时承载了多个主题的断言,
> 按 hunk 拆分的风险高于收益,因此并入其主体所在的提交。**中间的单个提交未逐个验证
> 通过 check/test**——最后一个提交之后的完整验证是:0 error / 266 tests / 构建通过 /
> 冒烟 17/17。


### 当前门禁

| 门禁 | 结果 |
| --- | --- |
| `npm run check` | ✅ **0 error**(34 warning 全部是既有的 CSS 选择器特异性提示) |
| `npm test` | ✅ **266 tests / 266 pass**(基线 229,本次新增 37 个行为测试) |
| `npm run build` | ✅ 通过 |

### 端到端验证(本机 workerd)

此前所有验证都是分项的单元测试与静态检查,**从未把整个系统跑起来**。本轮补上了:
`npm run db:migrate:local` → 灌数据 → `npx wrangler dev`,然后逐项 curl。

**P0-1(缓存键污染)的行为级证明:**

| 请求 | 实测 | 结论 |
| --- | --- | --- |
| `/blog` | 200,MISS,58 526 B,有内容 | 正常归档 |
| `/blog?category=cloudflare` | 200,19 782 B | 筛选结果**独立缓存**,与 `/blog` 不同键 |
| `/blog?category=nonexistent-xyz` | 200,11 274 B,空态 | 空态只写进它自己的键 |
| **再访 `/blog`** | **200,HIT,58 526 B,有内容** | ✅ **没有被空态污染**——修复前这里会返回空归档 |
| `/blog?page=abc` | 200,HIT,58 526 B | 非法页码正确归一化到第 1 页 |
| 二次请求 `/` | HIT,字节数一致 | 边缘缓存命中链路正常 |
| `/api/health` | 200,无 CSP | 与中间件"`/api/*` 不加 CSP"的设计一致 |
| `/rss.xml`、`/sitemap.xml`、`/robots.txt` | 200,有 CSP,无 `X-Edge-Cache` | 与 TTL=0 的设计一致 |

**同时验证了 `0025` 迁移能在 D1 上真实执行**:`wrangler d1 migrations apply --local` 输出
`8 commands executed successfully`,6 个索引全部建立,`sqlite_stat1` 有数据。
也就是说**此前标记为"待确认"的 `ANALYZE` 在 D1 上是被接受的**(remote 仍是同一 SQLite 引擎,
但首次远程迁移时建议顺带确认一次)。

### `public/_headers` 的格式 bug(只有跑起来才会发现)

把 15 个脚本路径写成一组、下面共享一个缩进头块 —— 文件看起来完全正常,
之前的静态测试也通过,但 `wrangler dev` 启动时打印:

```
✨ Parsed 3 valid header rules.
[wrangler:warn] Found 14 invalid header rules:
▶︎ No headers specified   at dist\client\_headers:28 | /admin.js
...
```

**平台的 `_headers` 格式要求每个路径行后面紧跟它自己的缩进头块**,多路径共享一个块时
只有最后一个生效,其余被静默丢弃。修复后同一命令输出 `Parsed 17 valid header rules`、
零无效规则,并且 curl 确认 `/theme.js`、`/admin.js`、`/local-time.js`、`/favicon.svg`
都拿到了 `public, max-age=86400, stale-while-revalidate=604800`。

已把格式校验加进 `tests/unit/static-headers.test.ts`(第 4 条断言),并验证过非空转:
把两个路径合并回共享块,测试立刻指出 `/local-time.js` 违规。

> 教训记录在这里:**"文件写对了"不等于"平台接受了"**。涉及平台专用文件格式
> (尤其是 `_headers` / `_routes.json` 这类)的改动,必须用 `wrangler dev` 的启动输出核对。

### `sync:posts` 对子目录静默无操作

`scripts/sync-local-posts.mjs:111` 用的是**非递归**的 `readdirSync(POSTS_DIR)`,
只扫描 `content/posts/` 顶层。而 `content/posts/` 下实际有 49 个 `.md` 分布在
`光纤/`、`随笔/`、`Python/` 等子目录里 —— 于是脚本打印"没有需要同步的文章",
看起来像"同步成功且无变化",实际是一篇都没同步。

已改为**显式告警**:顶层没有文件但子目录有时,打印子目录文件数量、示例路径,
并说明"本脚本只扫描顶层,不递归"以及两种处理方式。**没有**擅自改成递归 ——
那会让一次 `sync:posts` 突然向生产写入 49 篇文章,语义变化太大,应由维护者决定。


### 补上的行为测试(此前是"零行为测试"的安全代码)

审计把两处列为"风险最高却完全没有行为测试"的代码,现已补上,**并逐条验证过非空转**
(故意改坏实现,测试必须失败):

| 测试 | 覆盖内容 |
| --- | --- |
| `tests/unit/rate-limit.test.ts`(8 个) | 锁定阈值(第 5 次失败才锁)、锁定时长≈15 分钟、过期后自动清除并放行、**KV 故障时返回 503 而不是放行**、失败计数带 24h TTL、按 IP 隔离 |
| `tests/unit/csp.test.ts`(4 个) | 公共页面与 `/auth` 的 `img-src` **逐字节**锁定;两处共用同一份图床白名单;`/auth` 不得出现 `https:` 通配 |

顺带消除了一处真实的漂移隐患:5 个图床域名原先在 `src/middleware.ts` 与
`src/admin/app.ts` 里各写了一份字面量,新增图床时只改一处就会导致"正文图正常、
登录页图裂开"。现统一到 `src/lib/csp.ts` 的 `CONTENT_IMAGE_HOSTS`。

> 三个 CSP 的差异是**有意保留**的(公共页允许任意 https 图源;`/auth` 更严;
> `/admin` 的 `img-src` 只放行一个域名)。收敛的是"同一张表写两遍",不是把策略拉平。
> 代码里已加注释,避免后来者"顺手统一"。

### CI 部署门禁

`.github/workflows/auto-deploy-from-admin.yml` 此前**直接跑 `npm run deploy`,没有任何
门禁**——而 `ci.yml` 与它是两条独立触发路径,所以 CI 变红照样会部署。已修正:

| 项 | 前 | 后 |
| --- | --- | --- |
| 质量门禁 | 无 | 部署前执行 `npm run check` + `npm test` |
| Node | 22.12.0(与 CI 的 24 不一致) | **24**(也让 `node:sqlite` 免 flag 可用) |
| 构建缓存 | 缓存 `dist`,且 `restore-keys: astro-build-` 会兜底恢复**任意历史** dist | 只缓存 `.astro` 与 `node_modules/.vite`;去掉过宽的兜底键 |

> `astro build` 会完整重建输出目录,缓存 `dist` 没有收益;而过宽的 `restore-keys`
> 会把某次历史构建的 dist 恢复进来,一旦构建没有完整覆盖输出目录就可能部署陈旧产物。


### C4 长尾工作移出关键路径

新增 `src/lib/background.ts`,`runInBackground(task)` 用 `cloudflare:workers` 的
`waitUntil()` 把「响应已决定之后才需要完成的工作」交给运行时。三处接入:

| 位置 | 原先 | 现在 |
| --- | --- | --- |
| `posts.ts` 发布/更新/删除/恢复 | `await` 部署钩子(**最长 6 秒超时**) | 钩子转后台;版本号递增仍 `await` |
| `public-analytics.ts` 埋点(**每次页面浏览都打**) | `await` 保留清理(KV 读 + 最多 3 条 DELETE) | 清理转后台 |
| `middleware.ts` 边缘缓存写入 | `await edgeCache.put` | 转后台(失败仅导致下次重新渲染) |

**两个刻意的取舍:**

- **版本号递增留在关键路径上。** 它决定新内容对访客何时可见,属于正确性的一部分,
  而且只是一次 KV 写入。把"让内容立刻可见"交给后台任务是拿正确性换几十毫秒。
- **降级路径是"就地等待"而不是丢弃。** 拿不到 `waitUntil` 时(单元测试、`astro build`
  预渲染)会 `await` 任务完成。宁可慢,也不要静默丢任务。

`src/lib/background.ts` 必须用**动态** `import("cloudflare:workers")`:
`tests/integration/api.test.ts:3` 直接 import 了 `src/admin/app`,静态引入会让整个测试
套件在 Node 下加载失败。这也意味着测试套件真实覆盖了降级路径。

### D1-2 Markdown 渲染栈延迟加载

`src/lib/security.ts` 原先在模块顶层 import `katex` / `marked` / `sanitize-html` /
`node-emoji`。关键在于:**`src/admin/app.ts` 把所有后台路由静态引入同一个 Hono 应用**,
所以只要还有一个路由需要渲染正文,**每一个** `/api/*` 请求(包括每次浏览都会打的埋点
接口)都要解析并执行这 ~900 KB 依赖。因此"只把少数引用方改到零依赖模块"是无效的,
必须从 `security.ts` 内部切断。

改为动态 `import()` 后的实测(构建产物引用图,不只是体积):

| 指标 | 前 | 后 |
| --- | --- | --- |
| `server/chunks/security_*.mjs` | 1.33 MB(全部内联) | **35.2 KB** |
| `katex_*.mjs` | (内联在 security 里) | 488 KB,**仅被 `import()` 引用** |
| `sanitize-html_*.mjs` | (内联) | 392 KB,**仅被 `import()` 引用** |
| `marked.esm_*.mjs` | (内联) | 56 KB |

> ⚠️ **总分包体积几乎不变**(14.29 → 14.30 MB)。拆 chunk 不减少上传字节数,
> 减少的是**热路径上被求值的代码量**。所以验证这类改动必须看引用图
> (谁用 `from` 静态引入、谁用 `import()` 动态引入),只看体积会得出"没有收益"的错误结论。

失败模式已处理:内部函数若在加载完成前被调用,`getMarkdownRuntime()` 抛出明确错误,
而不是以 `undefined` 静默出错。


### P0-2 索引实测(4000 行合成数据,`EXPLAIN QUERY PLAN` + 计时)

| 查询 | 加索引前 | 加索引后 | 变化 |
| --- | --- | --- | --- |
| 归档列表 `blog/index.astro` | 3.90 ms | **0.15 ms** | 26x |
| 归档深分页 | 11.32 ms | **0.16 ms** | 71x |
| 搜索关键词 `search.astro` | 25.89 ms | **0.67 ms** | 39x |
| RSS `rss.xml.ts` | 3.56 ms | **0.07 ms** | 51x |
| Sitemap `sitemap.xml.ts` | 5.45 ms | **3.55 ms** | 1.5x(无 LIMIT,须输出全部行) |
| 首页置顶 / 首页最新 | 1.46 / 3.65 ms | **0.09 / 0.09 ms** | 16x / 40x |
| 搜索按标签 | 0.58 ms | 0.36 ms | 1.6x(消除 `blog_post_tags` 全表扫描) |
| 说说列表 | 0.06 ms | 0.01 ms | 4.5x |

**零退步。** 9 条查询全部消除了 `USE TEMP B-TREE FOR ORDER BY`。

> ⚠️ **这些索引依赖 ANALYZE 统计。** 以 `published_at DESC` 打头的部分索引只有在
> `sqlite_stat1` 有数据时才会被规划器选中;没有统计时它们**完全不生效**,查询退回
> 原来的"排序全结果集"(归档列表 3.9ms、搜索 25.9ms,与加索引前一致)。
> 因此迁移 `0025` 末尾带 `ANALYZE`,并由 `tests/unit/query-plans.test.ts` 守住这一点。
> 注意迁移里的 `ANALYZE` 执行时表**还是空的**(部署顺序是先迁移后有数据),它只对
> **已有数据**的库有效;全新部署或大量导入内容后应手动再跑一次:
>
> ```bash
> npx wrangler d1 execute blog --remote --command "ANALYZE"
> ```
>
> ✅ **已在本地 D1 上验证 `ANALYZE` 被接受**:`wrangler d1 migrations apply --local`
> 输出 `8 commands executed successfully`,`sqlite_stat1` 有数据。此前"ANALYZE 可能
> 不被 D1 允许"的担心可以排除(remote 走同一 SQLite 引擎)。

### 待办(建议顺序)

| 优先级 | 项 | 状态 / 备注 |
| --- | --- | --- |
| **P0** | **执行索引迁移**(文件已提交,远程需你执行) | `npm run db:migrate:remote`;随后按需 `ANALYZE` |
| **P0** | 重指向你自己的账号值 + 配置 Worker secrets | `wrangler.jsonc:20,27,33,39`;清单见 §5.1 |
| — | 官方 `cache` + `routeRules` 迁移 | **已搁置(站长决定)**,验证配方见 §4.7;§4.6 记录了可用的配置形状 |
| — | 原生 Rate Limiting binding | 需先在 `wrangler.jsonc` 配 `ratelimits` 绑定;**在配置之前不宜改代码**,否则限流会静默失效 |
| P1 | `src/layouts/Post.astro` body 内 5 个脚本迁到 Astro 打包 | 涉及 `article-reveal` 的显示时序,**必须先在浏览器里验证**;当前 head 的 4 个已加 `defer` |
| P1 | Markdown **渲染一次化**(发文时渲染并落库) | 优先级下调:文章页已有 300s 边缘缓存,渲染只发生在未命中时;加反规范化列会引入一类新的"HTML 与 Markdown 不一致"缺陷 |
| P2 | `admin.js` 纳入 Vite 构建 | 优先级下调:长缓存已由 `public/_headers` 覆盖;它由 `.ts` 字符串拼 HTML,接 Vite 产物清单需要自建机制 |
| P3 | `vitest` + `@cloudflare/vitest-pool-workers` 测试迁移 | 见 §4 阶段 D4;会**减少**测试数量而提高真实覆盖率,应作为独立项目立项 |

---

## 0. 一页结论

**项目本身是健康的**,不要被"接手"两个字吓到:

| 门禁 | 实测结果 |
| --- | --- |
| `astro build` | ✅ 通过,11.8 s,814 文件 / 30.32 MB |
| `astro check` | ✅ 无错误 |
| `biome check` | ✅ 0 error,34 warning(均为 CSS 选择器特异性提示) |
| `npm test` | ✅ 229 tests / 27 suites 全绿,2.8 s |

**但有 1 个正在线上生效的正确性缺陷**,必须最先修:

> `src/middleware.ts:97-103` 在构造边缘缓存键时**清空了 `/blog` 的全部查询串,只保留整数 `page`**;
> 而 `src/pages/blog/index.astro:12` 会依据 `?category=` 渲染不同内容。
> 于是 `GET /blog?category=不存在的分类`(命中 0 篇 → 渲染"还没有已发布文章")
> 会被**存进 `/blog` 这个键**,之后所有访问 `/blog` 的人在 300 秒内看到空归档。

**性能上的真正瓶颈不是 Astro,而是三件"自研替代了官方"的事:**

1. **字体**:480 条 `@font-face` 被打进**唯一一个渲染阻塞 CSS**——`dist/client/_astro/Base.CCcrgPD5.css`,原始 **534 KB**、brotli 后 **125 KB**;构建产物里字体占 **27.05 MB / 743 个文件**(全站 30.32 MB 的 89%)。
2. **客户端脚本**:`src/layouts/Base.astro:95-99` 用 `<script is:inline src=…>` 在 `<head>` 放了 **5 个无 `defer` 的解析阻塞脚本**,`Post.astro:173-177` 再放 5 个。因为 `is:inline`,**Vite 完全不处理它们**——不压缩、不加哈希、无长缓存(实测 `/theme.js` 返回 `Cache-Control: public, max-age=0, must-revalidate`,9.4 KB 未压缩;`/admin.js` 60.8 KB 未压缩)。
3. **图片**:**`src/` 中 0 处使用 `astro:assets`**(`<Image>` / `<Picture>` / `getImage` 全无)。所有图都是裸 `<img>`,无 `width/height`(CLS)、无 `srcset`、无格式协商,靠 `scripts/optimize-media.mjs` 离线用 `sharp` 手工压图。

**好消息**:Astro 7 与 `@astrojs/cloudflare` 14 已经把这些全做成了官方能力,**而且这个项目已经在吃其中一部分红利**——构建日志明确输出:

```
[@astrojs/cloudflare] Enabling image processing with Cloudflare Images for production with the "IMAGES" Images binding.
[@astrojs/cloudflare] Enabling sessions with Cloudflare KV with the "SESSION" KV binding.
```

也就是说:适配器已经自动挂上了 **Images binding** 和 **KV 会话驱动**,而项目代码**完全没有使用**,反而在同一个 `SESSION` KV 上自研了一套 JWT+CSRF 会话。第 3 节给出完整的"自研 → 官方"映射表。

---

## 1. 实测基线

> ⚠️ 本节数字是**优化前**的基线,用来说明问题的规模、并作为收益的对照。
> 当前状态请看上面的「执行进度」。

### 1.1 构建产物(`npm run build:analyze`,本机)

```
总大小：    30.32 MB (+25.69 KB, +0.08%)
总文件数：  814
```

| 类型 | 体积 | 占比 | 文件数 |
| --- | --- | --- | --- |
| `.woff2` | 16.65 MB | 54.9% | 463 |
| `.woff` | 9.01 MB | 29.7% | 260 |
| `.mjs`(Worker) | 3.26 MB | 10.8% | 42 |
| `.css` | 577.7 KB | 1.9% | 5 |
| `.ttf` | 501.6 KB | 1.6% | 20 |
| `.js`(public) | 339.5 KB | 1.1% | 18 |

**字体家族明细:**

| 家族 | 文件数 | 合计 | 单文件均值 |
| --- | --- | --- | --- |
| `shippori-mincho` | 456 | **15.64 MB** | 35.1 KB |
| `lxgwwenkai-regular-subset` | 97 | 4.42 MB | 46.6 KB |
| `lxgwwenkai-bold-subset` | 97 | 4.40 MB | 46.5 KB |

**Worker 侧最大的 5 个 chunk**(3.26 MB,免费计划上限 1 MB,付费 10 MB):

| 体积 | 文件 | 说明 |
| --- | --- | --- |
| 888.8 KB | `server/chunks/_.._jRJGY-LY.mjs` | 根 chunk |
| 815.6 KB | `server/chunks/security_*.mjs` | marked + sanitize-html + node-emoji |
| 487.6 KB | `server/chunks/katex_*.mjs` | KaTeX |
| 332.3 KB | `server/chunks/console_*.mjs` | — |
| 265.1 KB | `server/chunks/entrypoints_*.mjs` | — |

> ⚠️ `astro.config.mjs:27-45` 的 `manualChunks`(把 katex/marked/drizzle/hono 拆包)**对 Worker 无效**——Workers 是一个整体 bundle,拆 chunk 不减少上传体积、也不减少解析量。这是纯粹的维护负担,可直接删除。

### 1.2 线上实测(`https://ffaff.fun`,本机 curl)

| 指标 | 实测值 |
| --- | --- |
| 首页 HTML | 71,929 B 原始 / **7,226 B 压缩**(br) |
| `Base.CCcrgPD5.css` | 534,251 B 原始 / **125,015 B(br)** |
| 首页 CSS 请求数 | **3 个**(`PostCard.css` + `Base.css` + `index.css`),全部渲染阻塞 |
| `<head>` 内脚本 | 5 个,`is:inline`、无 `defer` → **解析阻塞** |
| 首页缓存 | `CF-Cache-Status: HIT`,`X-Edge-Cache: HIT`(自研边缘缓存生效) |
| `/_astro/*` 缓存 | `public, max-age=31536000, immutable` ✅ |
| `/theme.js` 缓存 | `public, max-age=0, must-revalidate` ❌(每次导航都回源校验) |
| `/_routes.json` | **HTTP 200 / 547 B / application/json** —— Pages 专用死文件被公开服务 |
| `/client/_astro/…`、`/server/…` | **404** ✅(服务端 chunk 未被暴露) |

**两个线上过期项(在途未提交的修改已经修掉,但尚未部署):**

`src/components/BaseHead.astro` 的线上版本仍在输出两个**不存在的**字体预加载:

```html
<link rel="preload" href="https://ffaff.fun/fonts/lora-variable.woff2" as="font" ...>
<link rel="preload" href="https://ffaff.fun/fonts/lxgw-wenkai-regular.woff2" as="font" ...>
```

`/fonts/*` 目录根本不存在(字体实际在 `/_astro/*.woff2`),所以**每次首屏都白白发起 2 个 404 请求**。工作区里这条已被删除(见 `git diff src/components/BaseHead.astro`),**属于必须尽快提交部署的修复**。

### 1.3 一个被文档写反的事实

`MEDIA-OPTIMIZATION.md:190-192` 声称:

> **`public/_headers` 与 `public/_routes.json` 是 Cloudflare Pages 专用文件,在本项目的 Workers 部署下不生效**

实测结论是**一半对一半错**,必须纠正:

- `public/_routes.json`:**确实是 Pages 专用,在 Workers 资源模式下无效**——但它会被原样复制到 `dist/client/` 并**被公开访问**(实测 200)。属于死配置 + 无意义信息暴露,**应删除**。
- `public/_headers`:**实际是生效的**。证据:`/_headers` 本身返回 404(被平台消费而非当静态文件),而 `/_astro/*` 返回的正是该文件第 24-25 行声明的 `public, max-age=31536000, immutable`。适配器自己也会在构建时读取并补写它(`node_modules/@astrojs/cloudflare/dist/index.js:510-536`)。

另外 `wrangler.jsonc:11` 写的 `"directory": "./dist"` **并不生效**:适配器在 `astro:build:done` 阶段生成 `dist/server/wrangler.json`,其中把资源目录改写为 `"directory": "../client"`(实测生成文件内容)。所以实际生效的是 `dist/client`,与线上探测一致(`/client/...` 404、`/_astro/...` 200)。**这个值误导性强,建议按官方模板对齐或加注释说明。**

---

## 2. P0 缺陷(先修正确性,再谈性能)

### P0-1 边缘缓存键丢弃查询串 → `/blog` 缓存污染

**证据:**

- `src/middleware.ts:97-103` —— `/blog` 只保留整数 `page`(2..500),`category`/`tags`/`q` 全部丢弃
- `src/pages/blog/index.astro:12` —— `const categorySlug = Astro.url.searchParams.get("category") || null`
- `src/pages/blog/index.astro:50-71` —— 分类参与 `where` 条件,决定 `count(*)` 与列表
- `src/pages/blog/index.astro:109-111` —— 空 `catch`,任何 D1 异常都静默变成空列表(而空列表**是可被缓存的**)
- `src/middleware.ts:241-247` —— 仅要求 `status === 200` 且无 `Set-Cookie`,空归档页满足条件

**后果:** 冷缓存下先命中 `/blog?category=xxx` 或 `/blog?page=abc`(`page` 未校验,`Number("abc")` → NaN → offset NaN → 走空 `catch`),该响应被写入 `/blog` 键,300 秒内所有访客看到错误/空归档。

**修法(二选一,推荐前者):**

1. **白名单化**:在 `buildEdgeCacheKeyUrl` 中按路由显式列出参与缓存的参数,而不是"清空 + 挑几个放回"。`/blog` 保留 `page`(校验后)与 `category`;`/blog/[slug]` 保持清空。
2. **彻底移除自研缓存**,走第 3 节 Astro 7 官方 `cache` / `routeRules`。

**同时必须补:** `blog/index.astro:11` 的 `page` 需要真正校验(整数、≥1、上限),否则 NaN 会一路传到 SQL OFFSET。

### P0-2 缺失索引(每次搜索 / sitemap 命中都全表扫描)

`src/db/schema.ts:69-75` 现有索引与实际 `WHERE`/`ORDER BY` 不匹配:

| 现状 | 问题 | 建议 |
| --- | --- | --- |
| `posts_status_publish_idx (status, publish_at)` | 列表是 `ORDER BY published_at DESC`(`blog/index.astro:88`),索引用不上 | `blog_posts(published_at DESC) WHERE deleted_at IS NULL AND status='published'`(部分索引) |
| `posts_deleted_idx` | 近乎单值,选择性极差 | 可并入上面的部分索引条件 |
| sitemap 按 `updated_at` 排序(`sitemap.xml.ts:19-26`) | **无任何索引** | 补 `blog_posts(updated_at)` |
| `blog_post_tags` 仅有 PK `(post_id, tag_id)` | 搜索按 `tag_id` 过滤(`search.astro:114-125`) | 补 `blog_post_tags(tag_id)` |
| `shuoshuo_posts`(`schema.ts:95-101`) | `status` + `created_at DESC` 查询无索引 | 补 `shuoshuo_posts(status, created_at DESC)` |

工作量约 1 小时 + 一次 `drizzle-kit generate` + `npm run db:migrate:remote`。

### P0-3 未提交的在途工作有丢失风险

`git status` 显示 6 个已跟踪文件被修改、4 个路径未跟踪,而 `MEDIA-OPTIMIZATION.md` 里的媒体缓存结论**无法从 git 复现**:

```
 M README.md  package.json  src/components/BaseHead.astro
 M src/lib/media.ts  src/middleware.ts  src/pages/media/[...key].ts
?? .dsh/  MEDIA-OPTIMIZATION.md  media/  scripts/optimize-media.mjs
```

**动作:** 先审阅并提交这批改动(尤其 `BaseHead.astro` 的字体 preload 404 修复与 `media.ts` 的 `s-maxage` 修复),再开始任何重构。`media/`(7 个 webp,0.36 MB)与 `.dsh/`(会话回滚快照)**都不在 `.gitignore` 里**——按文档意图 `media/` 应提交,`.dsh/` 应加入 `.gitignore`。

### P0-4 首次部署阻塞项

| 项 | 位置 | 说明 |
| --- | --- | --- |
| D1 `database_id` 指向原账号 | `wrangler.jsonc:20` | 必须换成你自己的 |
| KV `SESSION` id | `wrangler.jsonc:33` | 同上 |
| R2 桶名 `blog-media` | `wrangler.jsonc:27` | 同上 |
| Turnstile site key | `wrangler.jsonc:39` | 原账号站点 key |
| `SITE_NAME` / `SITE_URL` | `wrangler.jsonc:37-38` | 当前 `My Blog` / `https://ffaff.fun` |
| `sharp` 未声明 | `scripts/optimize-media.mjs:51` | `import sharp from "sharp"`,但**不在 dependencies 也不在 devDependencies** → 干净检出跑 `npm run media:optimize` 直接崩 |
| `engines` 缺失 | `package.json` | README 说 Node ≥18,CI 用 24,部署工作流用 22.12,本机 26 |
| `GH_ADMIN_TOKEN` | `.github/workflows/auto-deploy-from-admin.yml:98-105` | 缺失时**硬失败**;而缺 CF 凭据时只**静默跳过**(`:64-68,125-128`)→ 新手会看到绿色的"成功"却没有任何部署 |

---

## 3. 官方替代映射(本次方案的核心)

原则:**凡是平台已经做成声明式配置的,就不要留在命令式代码里。**

| # | 现在的自研实现 | 官方机制(Astro 7 / Cloudflare) | 收益 | 风险/成本 |
| --- | --- | --- | --- | --- |
| **1** | `src/middleware.ts:82-138,220-268` 手写 Cache API(271 行)+ `src/lib/content-version.ts` KV 版本号做缓存键失效 | **`cache: { provider: cloudflareCache() }` + `routeRules`**。官方 provider 在 `@astrojs/cloudflare/cache/provider`,输出 `Cloudflare-CDN-Cache-Control` + `Cache-Tag`,并提供**按标签 purge**(`cache.purge({ tags })`);适配器检测到 `provider.name === "cloudflare"` 时会自动在 wrangler 配置里打开 `cache: { enabled: true }` | 删掉 271 行中间件与整条"版本号进缓存键"的旁路;编辑文章时**主动 purge**而不是等 TTL;附带 ETag/Last-Modified → 304 支持 | 中。需同时迁移 wrangler 配置与发文钩子 |
| **2** | `src/styles/global.css:1-8` 的 8 条 `@import`(`@fontsource/*` × 6 + `lxgw-wenkai-webfont` × 2)+ `katex/dist/katex.min.css`,产出 **480 条 `@font-face` / 534 KB CSS** | **`fonts: [...]` 配置 + `fontProviders`**(实测可用:`fontsource` / `npm` / `local` / `google` / `bunny` / `adobe` / `fontshare` / `googleicons`)。Astro 在构建期抓取自托管、生成 **优化后的回退字体度量**(消除字体切换 CLS)、按需注入 preload | 这一个文件就是首页唯一的渲染阻塞 CSS,是**首屏最大单点**;同时消掉 27 MB 构建产物的大头 | 收益最高。需重新定义字体族与子集策略,并实测确认 |
| **3** | `src/layouts/Base.astro:95-99`、`Post.astro:173-177` 的 `<script is:inline src="/xxx.js">` + `public/` 下 15 个手写 JS | **Astro 的 `<script>` 处理**:非 `is:inline` 的脚本由 Vite 打包、压缩、内容哈希、输出到 `/_astro/` 并自动 `type="module"`(天然 defer);ClientRouter 下模块脚本只执行一次 | 去掉 9 个解析阻塞请求;文件压缩 + 永久缓存;跨页导航不再重复注册监听 | 低。逐个迁移即可,先迁纯增强类,`theme.js` 必须保持内联阻塞(见第 4 节) |
| **4** | `src/lib/env.ts:126-183` 手写环境变量校验(`ValidatedEnv` 是无校验断言 `:178`,首次失败会被永久缓存 `:131-137`) | **`astro:env`**:`env: { schema: { JWT_SECRET: envField.string({ context: "server", access: "secret" }) } }`(实测导出 `envField`) | 密钥缺失在**构建期**报错,而不是登录时 503;获得真实类型 | 低,约 3 小时 |
| **5** | `src/admin/middleware/auth.ts:6-202` 自研 JWT(`jose`)+ KV 会话 + 手写 CSRF | **Astro Sessions API + Cloudflare KV 驱动**。**适配器已经自动启用**(构建日志:`Enabling sessions with Cloudflare KV with the "SESSION" KV binding`),且复用的正是同一个 `SESSION` 绑定 | 删掉 `jose` 依赖与约 120 行;存储层不变 | 中(1-2 天)。注意:JWT 同时是 7 个路由的 `requireAuth` 契约与 CSRF 载体,`tests/integration/api.test.ts:1281-1319` 需要改写。**每请求那次 KV 读不会消失**,所以这是可维护性收益,不是延迟收益 |
| **6** | 所有裸 `<img>`(`Base.astro:118-125`、`PostCard.astro:85,134`、`Header.astro:38-43`、`WebmentionPanel.astro:149,168`、`friends.astro:70`、`security.ts:1015`) | **`astro:assets` 的 `<Image>` / `<Picture>`**,配合适配器已开启的 Cloudflare Images binding(`IMAGES`);或对 R2 走 `/cdn-cgi/image/` 变换 | `srcset`/`sizes`/`width`+`height`(消 CLS)/格式协商/lazy 全部白拿 | 中-高(2-4 天)。**注意**:`MEDIA-OPTIMIZATION.md:4-5` 记录当前套餐**未开通 Image Resizing**(`/cdn-cgi/image/` 返回 404),所以先用 `<Image>` 的布局与 `srcset` 能力 + 已有的离线 WebP,transformation 作为可选升级 |
| **7** | `public/rss.xml` 手写路由(`src/pages/rss.xml.ts`) | **`@astrojs/rss`**:在 SSR 下可用,自带转义、`customData`(content:encoded)、`enclosure` 与正确响应头 | 修复 `lastBuildDate` 每次请求都变(`:83,107`)、guid 用 slug 导致改名后订阅者看到重复(`:92`)、缺 `content:encoded`/`enclosure`/`category` | 低,2-3 小时 |
| **8** | `src/lib/content-version.ts` + 版本号缓存键实现"发文免部署" | 同 #1:官方 `routeRules` 的 `tags` + `cache.purge()`;发文钩子在 `src/admin/routes/posts.ts:44-50` 已有天然挂载点 | 语义从"等 TTL/换键"变成"显式失效",并且能覆盖 `/shuoshuo`、`/search` 等目前**完全不缓存**的路由 | 与 #1 同一批工作 |
| **9** | 安全头在两处重复维护:`src/middleware.ts:140-201` 与 `src/admin/app.ts:19-45`;且 `public/*.js` 由资源层直接返回,**根本不经过 Worker,因此拿不到任何 CSP/X-Frame-Options** | **`public/_headers`**(已证实生效)或 `wrangler.jsonc` 的 `assets.headers` 内联;Static Assets 支持 `_headers` | 静态资源终于有安全头;删掉一份重复的 CSP | 低。顺带清掉 `public/_headers:5-21` 里 `/assets/*`、`/fonts/*`、`/images/*`、`/pagefind/*` 四条**指向不存在目录**的规则,并补 `/*.js` 长缓存规则 |
| **10** | `astro.config.mjs:27-45` `manualChunks` | 无。**直接删除** | 去掉一个"看起来在优化、实际对 Worker 无效"的配置 | 零 |
| **11** | `public/_routes.json`、`public/.assetsignore`(内容 `_worker.js`) | 无。Pages 时代遗留 | 去掉死配置与 `/_routes.json` 的公开暴露 | 零 |
| **12** | `astro.config.mjs:8-11` `prefetch.prefetchAll: true` + `defaultStrategy: "viewport"` | 官方 `prefetch` 的 `defaultStrategy: "hover"`(或 `"tap"`);`Header.astro:60` 的 `data-astro-prefetch="load"` 在 `prefetchAll` 下完全冗余 | `/blog` 一屏 10 张卡片 × 最多 4 个链接 ≈ **预取 10 个完整 SSR 文档**(每个都查 D1) | 低,1 行 |

**关于 sitemap 的例外说明:** 官方 `@astrojs/sitemap` 是**构建期爬取路由**的集成,在 `output: "server"` + 内容存在 D1 的前提下**无法枚举文章**(Astro issue #12437)。因此 `src/pages/sitemap.xml.ts` 这个动态路由**应当保留**,只修它的输出质量(见 4.4)。这是"官方优先"原则的合理例外,不要为了统一而改坏它。

---

## 4. 性能优化路线(按风险/收益排序)

每一项都给出**验收指标**,避免"感觉快了"。

### 阶段 A —— 零风险、当天可完成

| 项 | 动作 | 验收指标 |
| --- | --- | --- |
| A1 | **修复 P0-1 缓存键**(白名单化 + `page` 校验) | 构造 `/blog?category=不存在` 后立即访问 `/blog`,必须仍返回完整归档 |
| A2 | **删除 `manualChunks`**(`astro.config.mjs:27-45`) | 构建产物结构不变(证明它本来就无效),配置文件缩短 |
| A3 | **删除 `public/_routes.json`、`public/.assetsignore`** | `https://<域名>/_routes.json` 返回 404 |
| A4 | **清理 `public/_headers`**:删掉 4 条死规则,补 `/*.js` 与 `/*.css` 的哈希外资源策略 | `/theme.js` 响应头不再出现 `max-age=0, must-revalidate` |
| A5 | **提交在途工作**(P0-3) | 线上不再有 2 个 `/fonts/*.woff2` 404 预加载 |
| A6 | 声明 `sharp`(devDependency)、补 `engines`、`.dsh/` 进 `.gitignore` | 干净检出后 `npm run media:optimize` 可运行 |

### 阶段 B —— 首屏体积(收益最大,1-2 天)

**B1. 字体重建(最高优先级)**

现状机制必须先讲清楚,否则优化方向会错:

- `src/styles/global.css:26-32` 的字体栈是 `"Lora Variable", "LXGW WenKai", "Shippori Mincho", serif`。
  **`Shippori Mincho` 排在第三位**,在 CJK 文本上几乎总是被 `LXGW WenKai` 命中——它那 456 个文件 / 15.64 MB 基本是**构建与仓库负担,而不是首屏负担**。
- 真正会下载的是 **LXGW WenKai 的 unicode-range 子集**:regular 97 个 + bold 97 个,平均 **46.6 KB/子集**。
  中文文章的字符会命中多个子集,所以**单页字体流量 = 命中子集数 × ~46 KB**。
- **必须用真实浏览器实测**(DevTools → Network → 只看 Font,读 `Transferred`)。本机无浏览器,无法给出确切数字;这是阶段 B 的第一个验收动作,不要跳过。
- `.woff`(9.01 MB / 260 文件)对现代浏览器是**永不请求的兜底格式**,可以直接不构建。

**目标与手段(按官方优先):**

1. 用 `fonts` 配置替换 `global.css:1-8` 的 8 条 `@import`。可用 provider:`fontProviders.fontsource()`、`fontProviders.npm()`(直接从已装的 `@fontsource/*`、`lxgw-wenkai-webfont` 取)、`fontProviders.local()`。构建期自托管 + 生成回退度量,**顺带消除字体切换造成的 CLS**。
2. **从字体栈里删掉 `Shippori Mincho`**(`global.css:26-32`),并从 `package.json` 移除 `@fontsource/shippori-mincho` —— 这是"零成本减 15.64 MB"。
3. 明确 CJK 策略,二选一:
   - **保守(推荐先做)**:正文 CJK 走**系统字体**(`system-ui` / `PingFang SC` / `Microsoft YaHei`),仅保留 Latin 展示字体。首屏字体流量直接归零。中文博客用系统字体在视觉上完全可接受,且 `BaseHead.astro:24-26` 的注释已经承认"CJK 走系统字体回退"。
   - **进取**:保留 LXGW WenKai,但只 preload 前 N 个高频子集,其余靠 `unicode-range` 懒加载。
4. `katex/dist/katex.min.css`(`global.css:9`)**不要全站引入**——KaTeX 的 8 个字体家族 / 20 条 `font-display: block` 规则会进全站 CSS。只在实际含公式的页面引入(或用 `rehype-katex` + 按路由 import)。

**验收指标:**
- 首页 `Base.css` 原始体积从 534 KB 降到 **< 150 KB**(即 CSS 里 `@font-face` 数量从 480 降到 < 20)
- 单篇文章页字体 `Transferred` 总量 **< 150 KB**
- 构建产物总大小从 30.32 MB 降到 **< 8 MB**

**B2. 脚本不再阻塞解析**

`src/layouts/Base.astro:95-99` 放 5 个、`Post.astro:173-177` 放 5 个解析阻塞脚本。

- **`theme.js` 必须保持内联阻塞**——它在 `public/theme.js:25-28` 于绘制前读 `localStorage` 写 `data-theme`,这正是"无主题闪烁"的实现。**不要"优化"它。**
- 其余 9 个(`local-time`、`header-scroll-hide`、`analytics`、`footer-reveal`、`code-block-enhance`、`diagram-render`、`article-transparency-toggle`、`article-toc-highlight`、`article-reveal`)全是渐进增强:移到 `src/scripts/*` 并用**裸 `<script>`**(去掉 `is:inline`),交给 Astro 打包 → 压缩 → 哈希 → `type="module"`(天然 defer)→ `/_astro/` 永久缓存。

**验收指标:** `<head>` 内解析阻塞请求从 5 个降到 **1 个**(只剩 theme);首页 JS 总传输字节下降 ≥ 30%。

**B3. prefetch 收敛**

`astro.config.mjs:8-11` 改成 `defaultStrategy: "hover"`,并删掉 `Header.astro:60` 冗余的 `data-astro-prefetch="load"`。

**验收指标:** 打开 `/blog` 静止 3 秒,Network 中不应出现 10 个文章文档预取;悬停导航链接时仍能正常预取。

### 阶段 C —— 缓存与数据(1-2 天)

| 项 | 动作 | 验收指标 |
| --- | --- | --- |
| C1 | **补索引**(P0-2) | `sitemap.xml` 与 `/search` 的 D1 查询不再出现全表扫描(用 `wrangler d1 execute … "EXPLAIN QUERY PLAN …"` 验证走索引) |
| C2 | **停止为字数统计 SELECT 全文**(`index.astro:82`、`blog/index.astro:77`、`search.astro:136-155`)——`content` 整列只为算 `estimateArticleReadStats` 而被读出,`/search` 一次最多 50 行 | 列表页 D1 rows_read 下降;`/search` 首字节明显改善 |
| C3 | **迁移到官方 `cache` + `routeRules`**,删掉中间件缓存与 `content-version.ts`;发文钩子改用 `cache.purge({ tags })` | 代码行数净减;`/shuoshuo`、`/search`、`/rss.xml`、`/sitemap.xml` 纳入缓存;编辑文章后**立即可见**(不再等 300 s) |
| C4 | **把"响应已决定后"的工作移出关键路径**:`src/admin/routes/posts.ts:44-50` 顺序 `await` 了 KV 版本号 + 最长 6 s 超时的部署钩子(`src/admin/lib/deploy-hook.ts:1,74-85`);`public-analytics.ts:259-306` 在返回 204 前 `await` KV 读 + 最多 3 条 DELETE;`middleware.ts:262` 的 `edgeCache.put` | 用 `c.executionCtx.waitUntil(...)` 并并行化独立 I/O。**目前 `src/` 中 `waitUntil` 出现 0 次**。验收:保存文章 P95 延迟从秒级降到 < 500 ms |
| C5 | **KV 非原子读改写限流** → Cloudflare 原生 **Rate Limiting binding**(`compatibility_date: 2026-03-17` 已支持):`rate-limit.ts:72-92`、`public-ai.ts:376-388`、`mcp.ts:406-428`,三处同样的 `get`+`put` 竞态 | 并发下不再绕过锁定;每个受限请求少 2 次 KV 往返 |
| C6 | 合并顺序 D1 往返:`analytics.ts:202-279`(8 次)、`dashboard.ts:17-44`(4 次)、`analytics-retention.ts:63-77`(3 次)→ `Promise.all` / `db.batch()` | 后台页面 TTFB |
| C7 | `getAiSettings`(`src/lib/site-appearance.ts:723-744`)补记忆化,对齐 `getSiteAppearance`(同文件 `:625-634,689-721` 已有 30 s 缓存 + in-flight 去重) | `/api/ai/*` 每次少 1 次 D1 读 |

### 阶段 D —— 结构性(周级,先评估再动)

- **D1. Markdown 渲染一次化(收益/风险比最好的结构改动)**
  现状:`src/lib/security.ts` 1576 行,模块顶层 `import` 了 `katex`/`marked`/`node-emoji`/`sanitize-html`(`:1-4`),**24 个文件**引入它,其中多数只为 `escapeHtml`/`sanitizePlainText`——包括访问量最大的埋点路由 `src/admin/routes/public-analytics.ts:4`。渲染本身在**每次缓存未命中**时执行(`blog/[slug].astro:181`):13 轮全文档正则(`:1042-1066`)+ 每个占位符在循环内 `new RegExp` 并全串 `replaceAll`(`:850-876,1079-1197`)。
  **动作(按顺序,每步都可独立上线):**
  1. 把零依赖的字符串工具(`escapeHtml`、`escapeAttribute`、`sanitizePlainText`、`sanitizeSlug`、URL 守卫)拆到 `src/lib/text.ts` → **立刻**把 katex/marked/sanitize-html 移出埋点与鉴权的模块图,降低冷启动。
  2. 在 `renderSafeMarkdownWithToc` 内部**动态 `import()`** katex / sanitize-html / node-emoji。
  3. **发文时渲染一次并落库**(`src/admin/routes/posts.ts` 保存路径已有),按内容哈希缓存 HTML;请求路径只读结果。
  4. 最后才考虑 `marked` → remark/rehype(见下)。
- **D2. 不要整体重写 Markdown 管线。** Typora 语法面是真实需求:`[details=]`、`[spoiler]`、`> [!NOTE]` callout、`kanban`/`chat`/`timeline`/`calendar`/`drawio`/`echarts`/`mermaid` 围栏(`security.ts:667-679,1251-1575`)、脚注重编号(`:1154-1171`)、被 `public/article-toc-highlight.js` 依赖的标题 ID 方案(`:685-710`)。remark/rehype 生态里 `remark-math`+`rehype-katex`、`remark-gfm`、`rehype-sanitize`、`rehype-pretty-code` 可覆盖一部分,但 kanban/chat/timeline 这类**没有现成插件**。可行终点是"保留这些渲染器、改写成 remark/rehype 插件并输出相同 HTML",属于**数周级**项目,不是顺手能做的。
- **D3. `admin.js` 纳入 Vite 构建。** `public/admin.js` 2138 行、未打包未压缩、由 `src/admin/views/layout.ts:1579` 以 `/admin.js` 引入,且**没有任何 `_headers` 缓存规则**。改为从 `layout.ts` 作为 Vite 入口 import,即可压缩 + 哈希 + 长缓存。**不要**顺手把 Hono 后台改写成 Astro Actions——14 个路由模块 + 8 个视图函数的重写成本极高而用户可见收益为零。
- **D4. 测试体系。** `npm test` 现在是 `tsx --test`(Node 内置 runner)+ 手写 mock D1。官方受支持路径是 **`vitest` + `@cloudflare/vitest-pool-workers`**(在真实 `workerd` 里跑,带真实 D1/KV/R2、Cache API、`waitUntil`)。
  **迁移的真实代价要先知道:** 现有 25 个测试文件里有相当一部分是**对源码文本做正则断言**(如 `tests/unit/admin-ui.test.ts:34-58`、`analytics-admin.test.ts:9-77`、`github-oauth.test.ts:23-38`),这些在重构时会误报、在改名后会失效——迁移会**让测试数量下降而真实覆盖率上升**。预计 3-5 天,应作为一个独立项目立项,而不是夹在别的改动里。
  当前**完全没有行为测试**的关键路径:`src/middleware.ts`(边缘缓存命中/未命中、`X-Edge-Cache`、不可变头重建 `:227`、15 s 版本 memo)、`src/admin/middleware/rate-limit.ts`(锁定竞态)、`requireAuth` 的成功/过期/失败分支。

### 4.4 顺带要修的 SEO/正确性问题(低成本)

| 问题 | 位置 | 修法 |
| --- | --- | --- |
| canonical **带查询串**,`?page=2`/`?category=`/`?q=`/`?adminPreview=1` 全部自我规范化 | `src/components/BaseHead.astro:15` | 用不含 query 的 pathname;并显式忽略未知参数(顺带挡住客户端塞 `?__cv=`) |
| `og:type` 在文章页也硬编码 `website` | `BaseHead.astro:45` | 文章页传 `article`;补 `og:locale`/`og:site_name`/`twitter:site` 与 `BlogPosting` JSON-LD(全站当前 **0 处** `ld+json`) |
| sitemap `lastmod` 是 SQLite 原始格式 `2026-05-02 19:29:11`,不是 ISO-8601 | `sitemap.xml.ts`(`schema.ts:66-67` 的默认值) | 输出 ISO-8601;补图片 sitemap(`featuredImageKey` 现成)、`/shuoshuo`、分页页;`max-age=3600` 补 `s-maxage` |
| RSS `lastBuildDate` 每次请求都是 `now`;`guid` 用 slug,改名后订阅者看到重复 | `rss.xml.ts:83,92,107` | 迁移 `@astrojs/rss`;guid 改用稳定的 `post:<id>` |
| `robots.txt` 未屏蔽 `/media/`,只部分屏蔽 `/api` | `robots.txt.ts:4-13` | 补规则(该路由也完全不缓存) |
| `/search` 的 `LIKE '%kw%'` 跨 `title|content|excerpt`、且在做 `hasSearchCriteria` 判断**之前**就跑两个无界 `SELECT`(分类、标签) | `search.astro:83-100`、`public-content.ts:26-32` | 先判条件再查;前导通配符无法走索引,考虑用 D1 FTS5 或把搜索改成 API + 客户端 |
| `diagram-render.js` 从 jsdelivr 拉 mermaid/echarts/chart.js,但 CSP 的 `script-src` 未放行 jsdelivr | `public/diagram-render.js:11-18` vs `middleware.ts:192` | **生产环境下图表功能实际是被 CSP 拦掉的**。要么自托管脚本,要么把域名加进 CSP。另:`securityLevel:"loose"` + `innerHTML = svg`(`:49,61`)是 XSS 面 |

### 4.5 明确"不要修"的地方

这些看起来可疑,但实测/审阅后是**正确实现**,优化它们会引入回归:

- `public/theme.js:25-28` 在绘制前阻塞读 `localStorage` —— 这是防主题闪烁的正确做法。
- `Header.astro:32` 的 `transition:persist` —— 正确用法,避免导航栏重建。
- 已正确实现 `astro:before-swap` 清理的文件:`local-time.js:131`、`article-toc-highlight.js:150`、`footer-reveal.js:62`、`comments.js:96`、`home-motion.js:261`。
- CSS 按路由分成 5 个 chunk 是 Vite 的预期行为(`PostCard.astro:2`、`search.astro:4` 按组件引入)。
- `Base.astro:76-78` 把外观变量内联到 `<body>`,不产生主题 CLS。
- 边缘缓存**命中时确实完全不查 D1**,`Vary`/`Set-Cookie` 的写入门禁也是对的(`middleware.ts:241-247`)。
- `[slug].astro:155-179` 对墓碑文章返回 410 —— 符合 Webmention 规范,别改。

> **例外**:`article-reveal.js` 的机制**是**脆弱的(`global.css:1816-1823` 先把 `.article-prose.js-reveal > *` 设为 `opacity:0`,再由 JS 在 `scan()` 里放行;`code-block-enhance.js:220-221,240` 会重新挂载 `<pre>` 并靠 `prose:restructured` 事件触发重扫)。任何在最后一次 `scan()` 之后插入、且未被该事件覆盖的元素会**永久不可见**。`scan()` 每次调用还新建一个 `IntersectionObserver` 且从不断开,这个文件也是唯一没有 `astro:before-swap` 清理的。官方替代:纯 CSS 的 `@starting-style` + `transition`,或 `transition:animate` —— 没有 JS,就没有竞态。

---

### 4.6 字体的真实成本:每页 653 KB(已量化并修掉一半浪费)

§4 阶段 B1 一直留着一句"必须用真实浏览器实测"。本轮补上了,而且**不需要浏览器**:
网络字体按 `unicode-range` 分片,所以只要拿到页面文本,就能**逐码点按字体栈回退**
确定性地算出浏览器会下载哪些子集,再按文件体积求和。

工具已固化为 `scripts/analyze-font-payload.mjs`（`npm run fonts:payload -- <url>...`,
需先起 `wrangler dev`）。它把文本按 CSS 的真实赋值分成四类:正文(`--font-serif-body`
@400)、`.prose strong`(`--font-strong` @700)、其它 `<strong>`(继承 body 但 700)、
`em`(`--font-serif-em`),并且实现了 **CSS 字重匹配规则**(请求 700 但只有 400 的 face
时会选中 400 并在浏览器端合成粗体)——只做字重精确匹配会低估体积。

#### 实测结果

| 页面 | 修复前 | 修复后 | 节省 |
| --- | --- | --- | --- |
| 首页 | **775.3 KB** | **653.2 KB** | −122.1 KB(−15.7%) |
| 归档 `/blog` | **775.3 KB** | **653.2 KB** | −122.1 KB |
| 文章详情 | **664.8 KB** | **542.8 KB** | −122.0 KB(−18.4%) |
| 说说 | **460.3 KB** | **338.2 KB** | −122.1 KB(−26.5%) |

对照:共享 CSS 原始 231 KB、首页 HTML 压缩后约 7 KB。**字体是每页最大的单项资产。**

#### 那 122 KB 是怎么来的

不是"正文用了很多粗体",而是:**为了给 3 个汉字加粗**。

站点 logo 是 `<strong>Kiwi 的博客</strong>`,它继承 `--font-serif-body` → 命中
LXGW WenKai **700** → 拉下 3 个完整的粗体子集。每个子集约 46 KB(按 unicode-range
分片,每个覆盖约 85 个汉字),而我们只用到其中 1 个字。

四个被测页面的粗体负载**完全相同**(122.1 KB),证明这笔开销与正文内容无关 ——
它全部来自 logo。除此之外「评论区」等 UI 标签也是同一模式。

#### 修法:整体去掉粗体 CJK 字体

与其给每个 UI 标签打 `font-family` 补丁(散落且容易漏),不如去掉
`@import "lxgw-wenkai-webfont/lxgwwenkai-bold.css"`:

- 粗体 CJK 退化为 **LXGW WenKai 400 + 浏览器合成粗体**,**字体族不变**;
- 由于常规子集本来就要为正文下载,粗体文本的**额外下载降为 0**;
- 构建产物少 **4.49 MB**(字体 face 216 → 119,LXGW 8.82 MB → 4.42 MB)。

`tests/unit/public-content.test.ts` 加了回归断言(匹配 **@import 语句**而不是
"源码里出现过该字符串"——注释里正当地提到了文件名,按字符串判断会误报),
并验证过非空转。`global.css` 的注释里写清了什么时候该把它加回来(正文大量使用
粗体 CJK 时)以及如何复测。

#### 最终决策:改用系统 CJK 字体(已完成)

剩下的 653 KB 由 LXGW WenKai 常规子集构成,是 CJK 网络字体的固有成本,继续降只有两条路:
按站内用字做字体子集化(保留观感,但要引入构建期流水线),或者改用系统 CJK 字体
(每页下载归零,但正文从楷体风格变为系统默认的宋体/黑体)。**站长选择了后者。**

改动:`src/styles/global.css` 移除 `lxgw-wenkai-webfont` 的 `@import`,三个字体栈改为
「西文字体 + 系统 CJK 族」,并从 `package.json` 去掉该依赖。西文的 Lora / Cormorant /
Space Grotesk 保留(体积小,是站点的西文排版身份)。

#### 三步累积效果

| 页面 | 最初 | 去掉粗体后 | **改用系统 CJK 后** | 累计 |
| --- | --- | --- | --- | --- |
| 首页 | 775.3 KB | 653.2 KB | **36.9 KB** | **−95%** |
| 归档 | 775.3 KB | 653.2 KB | **36.9 KB** | **−95%** |
| 文章详情 | 664.8 KB | 542.8 KB | **36.9 KB** | **−94%** |
| 说说 | 460.3 KB | 338.2 KB | **0 B** | **−100%** |

同时:

| 指标 | 最初 | 现在 |
| --- | --- | --- |
| 构建产物 | 30.32 MB | **5.29 MB(−82.6%)** |
| 共享 `Base.css` | 534 KB | **51.7 KB(−90%)** |
| `@font-face` 条数 | 480 | **22**(只剩西文与 KaTeX) |
| 字体文件 | 743 个 / 27.0 MB | 41 个 / 678 KB |

`tests/unit/public-content.test.ts` 的字体断言同步改成"禁止再引入 CJK 网络字体",
并在失败信息里指向 `npm run fonts:payload` 作为复测手段。**若将来要把楷体找回来,
先跑那个工具确认每页体积。**



### 4.7 官方 `cache`/`routeRules` 迁移:已实测,但**卡在无法验证失效**

这项迁移做过一次完整实验(不是在纸面评估),结论是:**缓存这一半可以本地验证,失效那一半不行。**

#### 实测可行的部分

正确的配置形状**不是** `provider: cloudflareCache()`,`cache.provider` 是一个配置对象
(见 `node_modules/astro/dist/core/cache/types.d.ts` 的 `CacheProviderConfig`);
而且适配器靠 `provider.name === "cloudflare"` 判断是否开启 Workers Cache
(`@astrojs/cloudflare/dist/index.js:126`),所以 `name` 必须显式写:

```js
// astro.config.mjs
cache: {
  provider: {
    name: "cloudflare",                                   // 适配器据此开启 Workers Cache
    entrypoint: "@astrojs/cloudflare/cache/provider",
  },
},
routeRules: {
  "/": { maxAge: 300, swr: 86400 },
  "/blog": { maxAge: 300, swr: 86400 },
},
```

实测结果(本机 `wrangler dev`,构建产物模式):

| 检查项 | 结果 |
| --- | --- |
| `astro build` | ✅ 通过 |
| 适配器生成的 `dist/server/wrangler.json` | ✅ 自动加入 `cache: {"enabled": true}` |
| 响应头 | ✅ `cloudflare-cdn-cache-control: public, max-age=300, stale-while-revalidate=86400` |
| 失效标签 | ✅ `cache-tag: astro-path:/`、`astro-path:/blog` |
| 是否真的缓存 | ✅ 第二次请求 `CF-Cache-Status: HIT` + `Age: 0` |

#### 卡住的部分(有明确报错)

用临时探针路由调用官方的失效 API:

```ts
await cache.invalidate({ path: "/" });
// → failed: cache.purge is not a function
```

`cache.enabled` 为 `true`,缓存也确实命中;但 provider 的 `invalidate()` 内部要调用
`cloudflare:workers` 的 `cache.purge()`,而**本地 workerd 没有实现它**。

**为什么这条足以叫停迁移:** 迁移后内容新鲜度完全依赖 purge。去掉 `swr` 时最坏情况是
`maxAge`(300 秒)内看到旧内容;保留 `swr: 86400` 则最坏可达 24 小时。而当前实现通过
KV 内容版本号换缓存键,真实新鲜度约 **60-75 秒**(见 §5.6)。

也就是说:**在无法验证 purge 的环境里强行迁移,等于把一个"秒级生效"的能力换成
"≤300 秒甚至更久",而且没有任何手段能在上线前发现问题。** 这不是"更规范"能抵消的。
`cache.purge` 是否在目标套餐/区域可用,我在这里无法确认。

#### 给有预览环境的维护者的操作步骤

1. 按上面的配置改 `astro.config.mjs`,构建后确认生成的 wrangler 配置里有 `cache.enabled`;
2. 部署到预览环境,先验证**失效**:写一篇测试文章 → 立即访问 `/`、`/blog`、`/blog/<slug>`,
   确认看到新内容(这一步是本迁移的成败关键,务必先做);
3. 再验证命中:同一 URL 连续两次请求,第二次应有 `CF-Cache-Status: HIT`;
4. 确认 `/media/*` 的长缓存未受影响;
5. 全部通过后,删除 `src/middleware.ts` 的缓存分支(`buildEdgeCacheKeyUrl` /
   `canUseEdgeCache` / `resolveEdgeCacheTtl` 的调用与 `getEdgeCache`)与
   `src/lib/content-version.ts`;把 `src/lib/edge-cache-key.ts` 精简为只保留
   `parseBlogPage` / `parseBlogCategory`(归档页仍在用),并同步删除
   `tests/unit/edge-cache-key.test.ts` 里针对已删函数的用例。

**在第 2 步通过之前不要改代码。** 当前的自研缓存是能工作的(命中时完全不查 D1,
已端到端验证),替换它是"更规范",不是"修 bug";§2 的 P0-1 已经修掉了它真正的缺陷。



### 5.1 交接清单:必须重新指向你自己账号的值

| 值 | 文件:行 |
| --- | --- |
| D1 `database_id` `94446958-…` | `wrangler.jsonc:20` |
| KV `SESSION` id `6e47bbd6…` | `wrangler.jsonc:33` |
| R2 桶 `blog-media` | `wrangler.jsonc:27` |
| Turnstile site key / `SITE_NAME` / `SITE_URL` | `wrangler.jsonc:37-39` |
| `site` 域名 `ffaff.fun` | `astro.config.mjs:13` |
| 站点 URL/名称重复常量 | `src/lib/types.ts:17,27` |
| 评论服务 origin | `src/admin/routes/comments-proxy.ts:14` |
| webmention.io 端点、GitHub 账号 | `src/components/BaseHead.astro:40-42`;`WebmentionPanel.astro:27,246` |
| CSP 白名单里的域名 | `src/middleware.ts:194,196`;`src/admin/app.ts:49` |
| Webmention 脚本里的站点常量 | `scripts/send-webmentions.mjs:24-26` |
| 媒体脚本默认站点 | `scripts/optimize-media.mjs:60` |
| 前任域名残留 | `review-report.md:1,7`(仍在审计 `blog.ericterminal.com`) |

**必须重新配置的 Worker secrets:** `JWT_SECRET`、`ADMIN_USERNAME`(`src/lib/env.ts:92-94` 判定为必需)、`ADMIN_PASSWORD_HASH`、`ADMIN_GITHUB_LOGIN` + `GITHUB_OAUTH_CLIENT_ID/SECRET`(不用 GitHub 登录则可省)、`TURNSTILE_SECRET_KEY`、`MCP_BEARER_TOKEN`、`AUTO_DEPLOY_WEBHOOK_URL` / `AUTO_DEPLOY_WEBHOOK_SECRET`。

**GitHub Actions secrets:** `CLOUDFLARE_API_TOKEN`(缺了会**静默跳过部署**)、`GH_ADMIN_TOKEN`(缺了会**硬失败**)。

### 5.2 文档纠偏(README 是新手第一个踩的坑)

| README 现状 | 事实 |
| --- | --- |
| `:6,:103` "Astro 6" | 实际 **Astro 7.3.6** |
| `:108` "Cloudflare Workers + Pages" | 只有 **Workers**(`_routes.json` 之类 Pages 文件已失效) |
| `:480-487` 部署六步含 `npm run search:index:remote` | **该 script 根本不存在**。真实链(`package.json:12`):`db:migrate:remote` → `astro build` → `analyze-build.mjs` → `wrangler deploy` |
| `:26,:523,:627` "文章存储在 `content/posts/`" | `content/` **已被 `.gitignore` 忽略**,是 `sync-local-posts.mjs` 从 D1 拉下来的**本地副本**,真源是 **D1**。新手改 `content/` 里的文件不会有任何效果 |
| `:122` "Node.js ≥ 18" | CI 用 24,部署用 22.12,`@astrojs/cloudflare` 14 要求 wrangler ≥ 4.125 |
| `:647` 让用户检查 `assets.directory`(通常 `./dist`)与 `public/_routes.json` 的 exclude | 两者都是误导:`_routes.json` 无效,`./dist` 被适配器改写为 `../client` |
| `:663` 让用户检查 `public/_headers` 的 CORS 配置 | `_headers` 里没有任何 CORS 规则 |
| `:628` 自定义域名要绑定到 "Pages 项目" | 是 Workers 的 Custom Domains |

**另有一个文档结构问题:** 仓库里存在 `RELEASE.md`(525 行),它是一份发布记录,但**同时抄了一份 README 的部署说明**——例如 `RELEASE.md:668` 与 `README.md:647` 是完全相同的错误段落。两处并存意味着任何文档修正都要改两遍,漏一处就继续误导人。建议 `RELEASE.md` 只保留变更日志,把部署说明统一交给 README。

`MEDIA-OPTIMIZATION.md:190-192` 关于 `_headers` 不生效的说法**是错的**(见 1.3),应改写。

### 5.3 依赖与 CI

- **声明与实际漂移:** `package.json` 写 `astro ^7.1.6` / `@astrojs/cloudflare ^14.1.7` / `wrangler ^4.50.0`,实际装的是 7.3.6 / 14.3.4 / 4.147.0。CI 的 `npm ci` 之所以能过,只是因为 lockfile 已经领先;**一旦重新解析依赖,可能选中 wrangler < 4.125 从而违反适配器的 peer 要求**。建议把关键依赖的下界提到已验证版本。
- **没有 `engines`、没有 `packageManager`、没有 Dependabot/Renovate 配置。**
- `overrides`(`package.json:87-90`)的 `minimist`/`nth-check` 下限**已被满足**,属于历史遗留,可以保留作为下限但不再是关键防线。
- 已核实**确实在用**、不要删:`@remy/webmention`(`send-webmentions.mjs:19` 调用其 bin)、`@modelcontextprotocol/sdk`(`mcp.ts:1-3`)、`gray-matter`(仅脚本)、`node-emoji`(`security.ts:3`)。
- **可以删:** `scripts/_debug_d1.mjs`(无对应 npm script、Windows 专用 `npx.cmd`、硬编码表名)。
- **CI 加固:** `.github/workflows/auto-deploy-from-admin.yml:111` 直接 `npm run deploy`,**没有任何 check/test 门禁**,而 `ci.yml:28-37` 跑的是完整的 `npm ci` + `check` + `test` + `build`。两者 Node 版本还不一致(22.12 vs 24),action 版本也混用(v6/v5 vs v4/v4)。另外 `:38-49` 缓存了 `dist`,有部署陈旧产物的风险。**建议:部署前跑 `npm run check && npm test`,统一 Node 版本,不要缓存 `dist`。**

### 5.4 `npm audit` 的 5 个 high 需要正确解读(新发现)

`review-report.md:18` 声称"`npm audit --omit=dev` 输出 found 0 vulnerabilities"——**这个结论已经过期**。当前实测(2026-10-08):

```
high  @astrojs/cloudflare  | via: @cloudflare/vite-plugin / wrangler
high  @cloudflare/vite-plugin | via: miniflare / wrangler
high  miniflare           | via: sharp
high  sharp               | via: sharp : Vulnerability in librsvg dependency CVE-2026-96889
high  wrangler            | via: miniflare
```

**为什么"production"这个标签在这里会误导人:**

这 5 条全部来自**构建 / CLI 工具链**(`wrangler` → `miniflare` → `sharp`),它们的代码**不会进入部署到 Cloudflare 的 Worker 包体**。之所以被 `--omit=dev` 计入生产依赖,只是因为本项目把 `astro`、`@astrojs/cloudflare`、`wrangler` 声明在 `dependencies` 而不是 `devDependencies` 里。

**唯一需要真正看一眼的是 `sharp`**:CVE 在 librsvg 依赖上,而 `sharp` 正是 `scripts/optimize-media.mjs:51` 处理图片时调用的库。由于输入的图片都来自站点作者自己的 R2/CDN,实际暴露面很小,但这条链确实在跑。

**不要按它建议的"修复"去做:** `npm audit` 给出的方案是把 `@astrojs/cloudflare` 降到 `12.6.7`、`wrangler` 降到 `4.15.2`——都是**降级且跨大版本**,会直接违反适配器 v14 的 peer 要求(需要 `astro ^7.2.0`、`wrangler ^4.125.0`),属于拿一个可用系统去换一张审计报告。

**建议的处理:**
1. 在 `docs/` 里写明"本项目的 `npm audit --omit=dev` 包含工具链,不能直接当作运行时风险指标",避免每个接手的人重新困惑一次。
2. 等上游 `sharp` / `miniflare` 发布修复版本后随常规依赖更新升级(**不要手工降级**)。
3. 若要立刻消除告警,可在 `package.json` 的 `overrides` 里把 `sharp` 钉到已修复版本——但必须先确认 `wrangler` 与之兼容。


### 5.5 `npm run db:generate` 在本仓库是危险的(重要)

本次增加索引时实测发现:`npm run db:generate` 生成的**不是一条增量迁移**,而是把
`0001`~`0024` 的历史**整个重放了一遍**——文件里包含 `CREATE TABLE friend_links`、
`CREATE TABLE shuoshuo_posts`、`ALTER TABLE blog_posts ADD background_*` 等等。

原因是 `drizzle/meta/_journal.json` 里**只有一条记录**(`0000_magical_hedge_knight`),
`0001`~`0024` 这 24 个迁移是手写的、从未登记进 drizzle-kit 的 journal。于是
drizzle-kit 以为当前 schema 还停在 `0000`,自然就把之后所有变更当作"待生成"。

**后果:** 按 `README.md:581-586` 的指引跑 `db:generate` 再应用,会尝试重复建表,
在**已有数据的线上 D1** 上直接报 `table xxx already exists` 而失败(若部分执行还会
留下不一致的中间状态)。

**当前做法:** `0025_public_query_indexes.sql` 是**手写**的,与该目录下 `0013`~`0024`
的既有惯例一致(它们也都是手写、用 `CREATE INDEX IF NOT EXISTS`)。

**建议(二选一,别让下一个人再踩):**

1. **保持手写迁移**(推荐,零风险):在 `README.md` 与 `docs/maintenance-guide.md`
   里把 `db:generate` 标注为"本仓库不可用",改为"在 `drizzle/` 下手写 `00NN_*.sql`"。
2. **修复 journal**:以当前 schema 为基线重建 drizzle-kit 元数据(需要一次性对齐
   `_journal.json` 与各个 snapshot,并在本地 D1 上验证 `generate` 产出为空 diff)。
   工作量不大但必须验证到位,否则会生成破坏性迁移。

### 5.6 一条需要澄清的"失效"语义

`src/lib/content-version.ts:1-2` 与 `src/middleware.ts:14-15,110` 的注释宣称"发文后所有节点立即失效 / 最多 15 秒"。实际链路是:**KV 最终一致(全球传播约 60 s)+ 进程内 15 s memo + 300 s TTL**。所以真实预算是 **约 60-75 秒**,而删除文章的不可见性上限是 300 s。这不是 bug,但注释与 README 的承诺需要改成真实数字,否则未来会被当成 bug 排查。改走官方 `cache.purge()` 后这个不确定窗口会直接消失。

---

## 6. 性能预算与验收

以"一个中文博客,首屏为首页、内容页为长文"为前提,建议锁定以下预算并纳入 CI 或人工核对:

| 指标 | 现状 | 目标 | 测量方式 |
| --- | --- | --- | --- |
| 构建产物总大小 | 30.32 MB | **< 8 MB** | `npm run build:analyze` |
| 最大单个 CSS(原始) | 534 KB | **< 150 KB** | 构建产物 |
| CSS 内 `@font-face` 数量 | 480 | **< 20** | `grep -c "@font-face"` 构建后的 CSS |
| 首页解析阻塞脚本数 | 5 | **1**(仅 `theme.js`) | 首页 HTML 中 `<head>` 内无 `defer`/`module` 的 `<script src>` 计数 |
| 单篇文章页字体传输量 | 未测(机制上可达数百 KB~MB) | **< 150 KB** | DevTools Network 过滤 Font,读 `Transferred` |
| Worker bundle | 3.26 MB | **< 2 MB**(去 katex/marked 出热路径后) | `dist/server` 合计 |
| `/blog` 缓存正确性 | ❌ 可被污染 | ✅ | 冷缓存下先访问 `/blog?category=不存在`,再访问 `/blog` 必须返回完整列表 |
| 保存文章 P95 延迟 | 秒级(含 6 s 超时钩子) | **< 500 ms** | 后台保存操作 |
| 编辑文章后的可见延迟 | ≤ 300 s | **≈ 0**(主动 purge) | 改动后立即刷新 |

**测试方式建议:** 先用 `npx wrangler dev` 本地跑,再用 DevTools 的 Lighthouse + Network 面板取数,最后用线上 `curl -w` 交叉验证 TTFB 与响应头。不要只看磁盘体积——`brotli` 后的传输体积才是用户实际成本(本次 CSS 的 534 KB → 125 KB 就是典型差异)。

---

## 7. 执行顺序建议

```
第 1 步(半天,必须先做)
  P0-1 缓存键污染  →  P0-3 提交在途工作  →  P0-4 重指向账号值 + 补 sharp/engines

第 2 步(1-2 天,收益最大)
  阶段 B1 字体重建(先实测 DevTools 字体流量,再动手)
  阶段 B2 脚本去阻塞化  →  B3 prefetch 收敛

第 3 步(1 天,零风险清账)
  阶段 A2/A3/A4 删除 manualChunks / _routes.json / 修 _headers
  4.4 的 SEO 低成本修正(canonical、og:type、sitemap lastmod)

第 4 步(1-2 天,数据与缓存)
  C1 索引  →  C4 waitUntil  →  C5 原生限流  →  C2 去掉全文 SELECT
  C3 迁移到官方 cache/routeRules + 删掉中间件缓存与 content-version.ts

第 5 步(结构性,需单独立项)
  D1 Markdown 渲染一次化(分 4 小步,每步可独立上线)
  D3 admin.js 纳入构建
  D4 vitest + vitest-pool-workers 测试迁移

第 6 步(文档)
  5.2 文档纠偏  →  5.3 CI 门禁  →  本文档随改动同步更新
```

---

## 附:本次审计的证据来源

- **本机实测:** `npm run build:analyze`、`npm run check`、`npm test`、`git status`/`git diff`、`dist/` 产物分类统计、`dist/server/wrangler.json`(适配器生成)、线上 `curl`(状态码/响应头/传输体积)、`Invoke-WebRequest`(首页 HTML 资产清单)。
- **官方实现核对:** `node_modules/astro/dist/types/public/config.d.ts`(`fonts` v6.0.0、`cache`/`routeRules` v7.0.0、`env`)、`node_modules/@astrojs/cloudflare/dist/{index,wrangler,utils/response,cache/provider}.js`、`node -e` 导出的 `astro/config` 与 `@astrojs/cloudflare/cache/provider` 实际成员。
- **静态审计:** 4 路并行代码审计(前端交付与运行时、数据/渲染/SEO、后台与 Workers、构建/部署/工具链),结论已逐条与本机实测交叉验证;凡与实测冲突的(如 `_headers` 是否生效),本文以实测为准并标注了差异。

> 文档版本:2026-10-08 · 对应代码状态 `9d21ee0` + 6 个未提交修改
