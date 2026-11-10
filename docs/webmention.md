# Webmention 实现说明

本站的互动只有 Webmention 一条链路：**接收、存储、验证全部由 webmention.io 代管，本站只做「声明端点 / 读取渲染 / 主动出站」**。本文记录这条链路的设计依据、实现位置，以及踩过的坑。

---

## 1. 依据：哪些来自文档，哪些是工程判断

这个实现不是凭印象写的。下面把来源分三类，方便后来者判断某条规则能不能改。

### 1.1 来自 W3C 规范（`Webmention`, W3C Recommendation 2017-01-12）

| 条款 | 内容 | 在本仓库的体现 |
| --- | --- | --- |
| §3.1.2 | 发送方先对 target 做端点发现：`Link` 响应头 `rel="webmention"` → `<link>` → `<a>`，按此顺序回退 | `BaseHead.astro` 输出 `<link rel="webmention">` |
| §3.1.3 | 以 `application/x-www-form-urlencoded` POST `source` 与 `target`；**任何 2xx 都必须视为成功**（常见 201 / 202） | `postWebmention()` 用 `response.ok` 判断，不只认 201 |
| §3.1.4 | source 更新后**应当**重发，且必须重新发现 target 的端点 | `send-webmentions.mjs` 单篇模式不过滤 `status` |
| §3.1.5 | source 删除后**应当**对原 URL 返回 `410 Gone` 并重发 | 单篇模式不限 `deleted_at`，删文也能重发 |
| §3.2.2 | 接收方必须 GET source，确认其中确有指向 target 的链接 | 由 webmention.io 完成，本站无相关代码 |
| §3.2.4 | 若 source 返回 410 或不含该链接，应删除已有 Webmention | 同上，这是「删文后提及自动消失」的机制来源 |
| §4.1 | 接收方若展示 source 抓来的数据，**必须**编码/过滤以防 XSS | `escapeHtml()` 统一转义 + 外链 `rel="nofollow ugc"` |

### 1.2 来自 webmention.io 的 API 文档

- 多目标查询写成 `target[]=A&target[]=B`，一次最多 50 个。
- `per-page` 默认 20、上限 1000；响应带 `paging: {per-page, page, total, total-pages}`。
- **提及归档在 target 的规范 URL 下**：服务会抓取 target、跟随重定向、尊重 `rel="canonical"`；`#fragment` 会被单独记为 `wm-fragment`；所有「曾经指向该页的写法」会被记成别名。
- **尾斜杠与 http/https 不是等价规则**：文档原话是"由站点自己决定（靠重定向）"。只有真的发生过跳转，才会被记成别名。
- 用 `target=` 的公开查询**永不返回私有 Webmention**；带 token 的账户级查询才会包含它们。
- POST 成功返回 `201 Created` + `Location`（状态页保留三天）+ JSON 体 `{"status":"queued"}`。
- 限流：每个 `(source, target)` 对 30 秒一次，另有按客户端 IP、按 source 站点两重限制；超限 `429` 带 `Retry-After`，队列满 `503`（应当稍后重试）。
- `source` / `target` 各最长 512 字节。
- 审核三档：立即发布（默认）/ 仅扣留首次来源 / 全部扣留。**被扣留的不在 API 与 web hook 里**；批准会补发 web hook，拒绝则删除并封禁该 source URL。
- 旧的 `/d/{domain}/webmention` 已被移除（会 404），只能使用 `/{账号}/webmention`。

### 1.3 本仓库实测过的行为（2026-11，直接打线上接口）

- `GET /api/mentions.jf2` 返回 `Access-Control-Allow-Origin: *` 与 `Cache-Control: no-store`，因此**浏览器可以直连**，不必经 Worker 代理。
- **`target=A&target=B` 只有最后一个生效**：`?target=https://indieweb.org/&target=https://bogus.invalid/x` → `total=0`；把两者顺序对调 → `total=1704`。这是 PHP 解析重复查询参数的行为，不是文档写明的，但只要用错就会静默丢数据。
- `target[]=A&target[]=B` → `total=1704`，即并集生效。

### 1.4 纯工程判断（与协议无关）

- 发送表单用 `fetch` 而非原生提交：避免离开页面、避免开新标签页看裸 JSON。
- 读取失败与「真的没有提及」必须区分（失败显示 `—` 与重试提示，而不是「暂无」）。
- 用 `DOMParser` 解析远端 HTML 片段，而不是 `div.innerHTML`（前者是惰性文档，不加载图片、不执行脚本）。
- 8 秒超时（`AbortController`），慢网可用、又不至于让「加载中…」常驻。
- 外链统一 `rel="nofollow ugc noopener noreferrer"`，头像加 `referrerpolicy="no-referrer"`。

---

## 2. 角色分工

| 环节 | 由谁完成 | 本站是否有代码 |
| --- | --- | --- |
| 端点发现（对方找到我们的收件地址） | 对方 | 只提供 `<link rel="webmention">` |
| 收件、抓取 source、验证链接存在 | webmention.io | 无 |
| 审核（扣留 / 批准 / 拒绝） | webmention.io 后台 | 无 |
| 存储与别名管理 | webmention.io | 无 |
| 读取列表 | 浏览器 → webmention.io API | `WebmentionPanel.astro` |
| 渲染（头像墙 / 卡片 / 计数） | 本站前端 | `WebmentionPanel.astro` |
| 读者手动发送 | 浏览器 → webmention.io | 同一面板的表单 |
| 本站文章出站通知他人 | GitHub Actions 跑脚本 | `scripts/send-webmentions.mjs` |

Worker 侧完全不参与 Webmention 请求处理，这也是本站能保持小体积 bundle 的原因之一。

---

## 3. 接收链路

### 3.1 声明端点

`src/lib/webmention.ts` 是端点的**唯一来源**：

```ts
const siteHost = new URL(siteConfig.url).hostname;          // ffaff.fun
export const WEBMENTION_SITE = siteHost;
export const WEBMENTION_ENDPOINT = `https://webmention.io/${WEBMENTION_SITE}/webmention`;
```

`BaseHead.astro` 把它输出为 `<link rel="webmention">` 与 `<link rel="pingback">`。账号名就是域名——webmention.io 的 Sites 页登记的正是这个域名，换域名时这里跟着变。

> 之所以收敛成一个模块：域名此前在 `BaseHead`、表单 `action`、主机判断三处各硬编码一次，漏改一处的症状只是「面板永远空着」，几乎无法反推。

### 3.2 读取

`buildMentionsUrl()`（同文件）生成查询地址：

```
https://webmention.io/api/mentions.jf2
  ?target[]=<规范 URL>&target[]=<规范 URL>/
  &per-page=100
```

三点必须注意：

1. **必须写 `target[]=`。** 写成 `target=A&target=B` 时服务端只认最后一个（见 §1.3 实测），于是「再查一次尾斜杠变体」会把规范 URL 顶掉，面板在有提及的情况下也显示 0 条。
2. **尾斜杠要主动查两种。** 文档明确说这不算等价形式，只有站点真的重定向才会被记成别名，而本站不做跳转。
3. **总数用 `paging.total`，不是 `children.length`。** 单页最多 1000 条，超出一页时只数 `children` 会低报；超出时补一条「仅显示最近 N 条」。

URL 由服务端算好写进 `data-webmention-api-url`，浏览器端不再拼查询串——这样拼接逻辑可以被单元测试覆盖（`tests/unit/webmention.test.ts`）。

### 3.3 渲染

按 `wm-property` 分组：

| `wm-property` | 呈现 |
| --- | --- |
| `like-of` / `repost-of` / `bookmark-of` / `rsvp` | 头像墙（按作者去重），RSVP 带 ✅/❌/🤔/⭐ |
| `in-reply-to` | 卡片：头像、作者、域名、相对时间、正文摘录 |
| 其他（`mention-of` 或空） | 卡片，标记为「提及」 |

字段来源：`author.name/url/photo`、`url`、`wm-source`、`published`（缺省用 `wm-received`）。公开查询不会返回私有提及，代码里仍保留 `wm-private === true` 的防御性过滤。

### 3.4 摘录与转义

回复类提及的 `content.html` 是对方页面的片段。`extractContext()` 用 `DOMParser` 建惰性文档，找出 `hostname` 等于本站的那个 `<a>`，取锚文本前后各 100 字符，锚文本用 `<mark>` 包起，形成「……在讲这个的时候提到了你……」的上下文。

所有输出统一走 `escapeHtml()`（`escHtml` / `escAttr` 只是别名，实现只有一个），这也是规范 §4.1 要求的「必须编码/过滤」。

---

## 4. 发送链路

### 4.1 读者手动发送（面板表单）

场景：读者在自己站点写了文章引用你，想通知你。

```
POST https://webmention.io/<账号>/webmention
Content-Type: application/x-www-form-urlencoded

source=<读者文章>&target=<被引用页面>
```

- 表单 `action` 就是这个端点，**保留**作为无 JS 时的兜底。
- 有 JS 时改为 `fetch`，把结果就地变成一行中文：

| 情况 | 提示 |
| --- | --- |
| 2xx | 已提交。对方验证通过后会显示在这里。 |
| 429 | 提交太频繁了（同一来源 30 秒内只能发一次），稍后再试。 |
| 503 | 对方队列满了，稍后再试。 |
| 400 | 对方不认这个地址，请填你引用本页那篇文章的网址。 |
| 网络异常 | 网络异常，没能提交；稍后再试。 |

> 原生表单提交需要 CSP `form-action` 放行跨源目标，否则会被浏览器**静默拦截**（控制台报 `Refused to send form data`，没有任何网络错误可查）。这是曾经「按钮点了没反应」的真正原因。

### 4.2 本站出站（脚本）

场景：**你的**文章引用了**别人**的文章，要通知对方。

`scripts/send-webmentions.mjs`：

1. `wrangler d1 execute DB --remote|--local --json` 读文章
   - 默认：最近 5 篇已发布（部署后补发、手动重试）
   - `--slug=xxx`：只处理这一篇，**且不限 `status` / `deleted_at`**（为了 §3.1.4 / §3.1.5）
2. 现场拼一份临时 RSS（`.webmention-rss-tmp.xml`，在 `finally` 里删除）
   - 正文用 `marked` 渲染后 `sanitize-html` 清洗，**只保留 `<a href>`**，`<img>`/`<video>` 全部剔除——Webmention 语境下的「提及」是超链接，不是资源嵌入
   - 不用现成的 `/rss.xml`，因为公开 feed 只有已发布文章、按时间倒序，覆盖不到「指定某篇（含已删除）」
3. `wm <rss> --limit 100 --send`（`@remy/webmention`）：解析每条正文里的外链 → 发现目标端点 → 逐个 POST

CLI 的 `--limit` 截断的是「已解析出的端点总数」，所以文章数由 SQL 的 `LIMIT` 控制，脚本里只给一个足够高的安全上限。

### 4.3 触发链路

```
后台保存文章
  └─ handlePublicContentChange()
       ├─ bumpContentCacheVersion()            ← 关键路径：让边缘缓存立即失效
       └─ waitUntil(triggerDeployHook())       ← 后台：GitHub repository_dispatch
            └─ Actions（WEBMENTION_ONLY=1）
                 └─ node scripts/send-webmentions.mjs --remote --slug=<slug>
```

| 触发方式 | 行为 |
| --- | --- |
| `repository_dispatch`（发文/改文/删文） | 只跑 Webmention，不构建、不部署 |
| `push` / 手动 `workflow_dispatch` | 质量门禁 → 构建部署 → 再补发最近 5 篇 |

部署钩子 6 秒超时，失败只打日志，不影响保存结果——它不参与「新内容何时对访客可见」这件事，那由 KV 版本号负责。

---

## 5. 文件对照

| 文件 | 职责 |
| --- | --- |
| `src/lib/webmention.ts` | 端点常量 + `buildMentionsUrl()`，唯一来源 |
| `src/components/WebmentionPanel.astro` | 读取 + 渲染 + 发送表单（含全部内联 JS） |
| `src/components/BaseHead.astro` | `rel="webmention"` / `rel="pingback"` |
| `src/layouts/Post.astro` | 文章页挂载面板（`aria-label="回应"` 保留区块可访问名） |
| `src/middleware.ts` | CSP：`connect-src` / `form-action` / `frame-src` 放行 `webmention.io` |
| `scripts/send-webmentions.mjs` | 出站：D1 → 临时 RSS → `wm --send` |
| `src/admin/lib/deploy-hook.ts` | 触发 GitHub `repository_dispatch` |
| `src/admin/routes/posts.ts` | 保存后递增缓存版本 + 触发补发 |
| `.github/workflows/auto-deploy-from-admin.yml` | 两种触发路径的实际执行 |
| `tests/unit/webmention.test.ts` | `target[]` 语法、尾斜杠去重、端点推导 |
| `tests/unit/csp.test.ts` | 公共页面放行 `form-action`，后台不允许跨源表单 |

---

## 6. CSP 与安全

- `connect-src ... https://webmention.io`：读取列表与 `fetch` 提交。
- `form-action 'self' https://webmention.io`：**仅公共页面**。后台 CSP 仍为 `'self'`，不为跨源表单开口子（有测试锁住）。
- `frame-src ... https://webmention.io`：保留用于将来嵌入其组件。
- 远端内容：`DOMParser` 惰性解析 + 统一转义 + 外链带 `ugc nofollow`。
- 不向 webmention.io 发送任何本站用户信息；读者手动发送时只提交他自己填的 URL。

---

## 7. 已知限制

1. **单页最多取 1000 条**（`per-page` 上限）。超出时只展示最近一页并提示「仅显示最近 N 条」，不做翻页。
2. **不校验来源真实性**：验证是 webmention.io 的事；本站信任它的公开查询结果。
3. **拖尾斜杠依赖双查询**：这是对「站点不重定向」这一事实的补偿；若将来启用 `trailingSlash` 重定向，可只查规范 URL。
4. **无实时性**：进入页面时拉取一次，不轮询、不订阅 web hook（web hook 需要 Worker 端点，与「接收交给托管服务」的取舍冲突）。
5. **`pingback` 只是声明**：`rel="pingback"` 指向 webmention.io 的 XML-RPC 端点，本站不实现 pingback 协议。

---

## 8. 排错清单

| 现象 | 先查什么 |
| --- | --- |
| 面板显示 0，但确实有人引用 | 查询串是不是 `target[]=`；target 是否与 `<link rel="canonical">` 一致 |
| 面板显示「加载失败」 | 浏览器控制台是否被 CSP `connect-src` 拦；接口是否 5xx |
| 提交按钮点了没反应 | 控制台是否有 `Refused to send form data`（`form-action`）；网络面板是否真的发出请求 |
| 本地改了代码但页面没变 | Edge cache（`x-edge-cache: HIT`）。停 dev → 清 `.wrangler\state\v3\cache` → 重启 |
| 后端保存成功但对方没收到 | Actions 是否触发；`send-webmentions.mjs` 日志；对方端点是否可达 |
| 提及提交后对方看不到 | webmention.io 的验证是否通过（source 必须真的链到 target，且 source 可公开访问） |

---

## 9. 参考

- W3C, *Webmention*, W3C Recommendation, 12 January 2017 — <https://www.w3.org/TR/webmention/>
- webmention.io API 与行为文档（README）— <https://github.com/aaronpk/webmention.io>
- 在线 API 文档（渲染脚本跑在示例 feed 上）— <https://webmention.io/api>
- 发送工具 `@remy/webmention` — <https://github.com/remy/wm>
- 测试套件与调试工具 — <https://webmention.rocks/>
