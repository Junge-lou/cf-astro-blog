# 媒体图片优化运行手册

面向 `cf-astro-blog` 的图片优化流程。

> ## ⚡ 后台上传现在会**自动转 WebP**（2026-10 起）
>
> 上传 JPG/PNG 时会经 Cloudflare Images 绑定转成 WebP 并按用途缩宽，**不需要再手工跑
> 本文的离线流程**。实测（真实绑定 + 真实上传代码路径）：
>
> | 用途 | 上传前 | 存储后 | 压缩比 | 目标宽度 |
> | --- | --- | --- | --- | --- |
> | 封面（`posts/*/cover`） | 1 274 040 B PNG | **35 420 B** webp | 36.0x | 800 |
> | 背景（`appearance/background`） | 3 814 666 B JPEG | **167 674 B** webp | 22.8x | 1920 |
> | 正文图（`posts/*/content`） | — | — | — | 1600 |
> | 媒体库（`uploads`） | — | — | — | 1600 |
>
> 规则与例外：
>
> - 只转 `image/jpeg` 与 `image/png`。**GIF 不转**（会丢动画）、**AVIF 不转**（本来就比 WebP 省）。
> - 若转换后反而更大（小图、已是高压缩比），保留原图。
> - 转换失败、或账号未开通 Images，一律**回退为存原图**，上传本身永不因此失败。
> - 目标宽度由 key 前缀决定，见 `src/lib/media.ts` 的 `resolveUploadMaxWidth()`。
> - ⚠️ **额度**：Cloudflare Images 按"转换次数"计费（当前套餐每月 500 次）。因为是在
>   **上传时**转一次并落库，同一张图一辈子只消耗 1 次；**不要**改成"读取时按需转换"，
>   那样边缘缓存每次过期、每个 colo 回源都会重复计费。
>
> **存量图片怎么办**：直接在后台重新上传一次原图即可 —— 上传路径会自动转换，且
> 封面/背景的写入路径会自动更新 D1 引用（`appearance.ts` 的 `backgroundImageKey`）。
> 首页那张 3.64 MB 背景图就是这么修的，不需要 R2 命令行权限。
>
> 下面的离线流程仍然保留，用于**批量处理**（一次改一批图、或需要精确控制输出时）。

面向 `cf-astro-blog` 的**离线图片优化流程**。适用于批量场景：站点部署在
Cloudflare Workers 上，Worker 运行时无法执行 `sharp`/`libvips`，因此批处理必须
在本地完成再回传 R2。

## 为什么需要这套流程

2026-08 实测线上首页的图片开销：

| 项目 | 优化前 | 优化后 |
| --- | --- | --- |
| 首页 6 张封面图 | 6.83 MB | 111 KB |
| 全站图片（含背景图与归档页封面） | 10.32 MB | 373 KB |
| 单张背景图 | 3.64 MB（3840×2160） | 158 KB（1920×1080） |
| `/media/*` 边缘缓存 | **无**（每次回源 R2，TTFB 1.0–2.3s） | 一年 `s-maxage` + Cache API |

背景图原本是 4K 分辨率，而站点渲染宽度仅约 1184px 且带 CSS `blur()`；
封面图原本 1920/2560 宽，而卡片实际渲染宽度只有 240–272px。

## 优化规格

| 用途 | 判定依据（R2 key 前缀） | 目标 | 质量 |
| --- | --- | --- | --- |
| 背景图 | `appearance/background/` | 宽 1920 | WebP q80 |
| 封面图 | 其他 | 宽 800 | WebP q80 |

> 判定以 `resolveSpec()` 中的顺序为准：`appearance/background/` 必须优先于封面规则，
> 否则背景图会被误压成封面规格。修改规格时请同步更新 `scripts/optimize-media.mjs`。

## 使用步骤

### 1. 生成优化产物

```bash
npm run media:optimize
```

等价于：

```bash
node scripts/optimize-media.mjs --fetch --apply --mirror
```

- `--fetch` 从线上站点下载当前引用的原图
- `--apply` 压缩为 WebP，生成上传产物、清单与 D1 SQL
- `--mirror` 把产物复制到本地 `media/` 目录（该目录已加入 `.gitignore`，仅作本地备份；站点媒体始终从 R2 读取）

工作目录默认为 `<系统临时目录>/blog-media-opt`，可用 `--out=<dir>` 指定。

产物：

```
<out>/manifest.json          体积对比与目标 key 清单
<out>/upload/<key>           待上传的 WebP（保持目录结构）
<out>/upload-commands.txt    wrangler 上传命令
<out>/update-keys.sql        D1 引用更新（旧 -> 新）
<out>/rollback-keys.sql      回滚（新 -> 旧）
media/<key>                  本地镜像（由 --mirror 生成，不入库）
```

### 2. 上传到 R2

```bash
# 逐条执行 <out>/upload-commands.txt 中的命令，或：
bash -c "$(cat "$TMPDIR/blog-media-opt/upload-commands.txt")"
```

每条命令形如：

```bash
npx wrangler r2 object put blog-media/<key> \
  --file="<out>/upload/<key>" --content-type=image/webp --remote
```

采用**新增 `.webp` key** 而非覆盖旧对象，因此原图仍保留在 R2 中可随时回滚。

### 3. 更新 D1 引用

```bash
npx wrangler d1 execute blog --remote --file="$TMPDIR/blog-media-opt/update-keys.sql"
```

**这一步必须在第 2 步之后执行**，否则页面会引用尚不存在的对象。

SQL 只改动 `blog_posts.featured_image_key`、`blog_posts.background_image_key`
与 `site_appearance_settings.background_image_key` 三列，**不触碰 `content` 正文**。
使用 `REPLACE()` + `WHERE ... LIKE` 限定，同一个 key 被多篇文章共用时会一并更新
（例如 `uploads/2026-05-02/ab606316-....png` 被 2 篇文章共用）。

### 4. 部署

```bash
npm run deploy
```

首页与归档页有 300 秒边缘缓存，背景图由 `site_appearance_settings` 决定；
若未立即看到变化，等待缓存过期或用无痕窗口访问。

### 5. 验证

```bash
# 图片体积与响应头
curl -s -o NUL -D - "https://ffaff.fun/media/<key>.webp" | Select-String "HTTP/|cache-control|content-type"

# 边缘缓存是否生效：连续三次请求，第 2、3 次应显著变快
1..3 | ForEach-Object {
  curl.exe -s -o NUL -w "ttfb:%{time_starttransfer}s total:%{time_total}s bytes:%{size_download}`n" `
    "https://ffaff.fun/media/<key>.webp"
}
```

期望结果：`Cache-Control` 含 `s-maxage=31536000, immutable`，且无 `Vary` 头；
第 2 次起 `ttfb` 应降到数十毫秒。

## 回滚

```bash
npx wrangler d1 execute blog --remote --file="$TMPDIR/blog-media-opt/rollback-keys.sql"
```

原图对象始终保留在 R2，未被删除，因此数据库一经回滚即完全恢复。

## 日常运维：发文后加了新封面怎么办

新增封面**不会**影响已有图片：上传走 `buildMediaObjectKey()`，用
`crypto.randomUUID()` 生成全新 key，与旧图并存互不干扰。
封面（`blog_posts.featured_image_key`）与背景图
（`site_appearance_settings.background_image_key`）是彼此独立的字段，
加封面不会改动背景图。

但新上传的图会以**原始体积**存进 R2，需要单独优化：

### 第 1 步：体检

```bash
npm run media:status
```

自动从 `sitemap.xml` 抓取全部页面（约 35 个），列出每张图的线上体积、
压缩规格与是否已优化，并标记超阈值项：

```
    3.64 MB  ⚠ 待优化    已优化 158 KB       [background] appearance/background/...
    1.22 MB  ⚠ 待优化    未优化              [cover]      posts/draft/cover/...
      60 KB  ✓          已优化 9 KB         [cover]      posts/typora/cover/...
```

用 Range 请求探测体积，**只传输 1 字节**，不会产生流量开销。

阈值：封面图 120 KB、背景图 400 KB（见脚本内 `COVER_WARN_BYTES` /
`BACKGROUND_WARN_BYTES`）。

### 第 2 步：增量优化

```bash
npm run media:optimize
```

会自动发现新图并只处理需要优化的部分。若想只处理某一张：

```bash
node scripts/optimize-media.mjs --fetch --apply --mirror --only=<key 子串>
```

> 增量模式会自动合并上次 `manifest.json` 中未处理的条目，
> 因此生成的 `update-keys.sql` **始终覆盖全部图片**，不会漏掉引用。
> 已优化过的行不会被重复改写（`REPLACE()` 找不到旧值即无操作）。

### 第 3 步：上传 + 更新 + 部署

同前文的第 2～4 步。

### 重复运行是安全的

同一张图重复优化会产生**字节完全一致**的 WebP（已实测校验 sha256 幂等），
因此重复上传不会改变图片内容，也不会与 `immutable` 缓存冲突。

## 注意事项

- **不要覆盖同名对象来换图**。`buildPublicImageHeaders()` 设置了
  `max-age=31536000, immutable`，浏览器与边缘节点在 TTL 内不会重新校验。
  换图请使用新 key（或先确认缓存已过期）。
- **`npm run sync:posts` 可能覆盖本次改动**。该脚本会从 `content/` 回写 D1，
  若其中的 frontmatter（`featuredImageKey` 等）仍是旧值，会覆盖第 3 步的结果。
  同步前请确认本地 Markdown 已更新为 `.webp` key。
- **新增图片时**：直接跑 `npm run media:status` 体检、`npm run media:optimize` 优化即可，
  媒体清单由 `sitemap.xml` 自动发现，无需手工维护。
  （`scripts/optimize-media.mjs` 中的 `FALLBACK_MEDIA_KEYS` 仅在爬取失败时兜底。）
- **`public/_headers` 与 `public/_routes.json` 的实际生效情况不同,不要混为一谈**
  （原先这里写的是"两者都是 Pages 专用文件、在本项目下都不生效",**这是错的**）：
  - `public/_headers` **是生效的**。实测：`/_headers` 自身返回 404（被平台消费掉），
    而 `/_astro/*` 返回的正是该文件声明的 `public, max-age=31536000, immutable`。
    适配器构建时也会读取它（`@astrojs/cloudflare/dist/index.js` 的 `_headers` 注入逻辑）。
    ⚠️ 格式要求：**每个路径后面必须紧跟它自己的缩进头块**，多个路径不能共享一个块，
    否则只有最后一个生效、其余被静默丢弃。自检：`npx wrangler dev` 启动输出必须是
    `Parsed N valid header rules` 且没有 `Found M invalid header rules`。
  - `public/_routes.json` **确实是 Pages 专用、在 Workers 资源模式下无效**，而且会被
    原样复制到 `dist/client/` **被公开访问**（实测 200）。属于死配置，已删除。
- 媒体（`/media/*`）、页面缓存与内容版本号失效仍然以 `src/middleware.ts` 与
  `src/lib/media.ts` 为准；`_headers` 只覆盖由资源层直接下发的静态文件。

