# Webmention 手动测试手册

> 用途：**不改代码**，从写一篇测试文章到「对方 / 本站面板显示 ❤️ 喜欢 · 💬 回复 · 📅 回应」把整条链路走通，
> 并逐项核对页面里输出的微格式标记是否就是 `wm-property` 需要的那个。
>
> 关联文档：[`webmention.md`](./webmention.md)（收发链路与协议依据）、
> [`webmention-interactions.md`](./webmention-interactions.md)（类型设计）。
>
> 已实现范围：`interaction` / `interactionTarget` / `interactionRsvp` 三个 frontmatter 字段
> → `scripts/sync-local-posts.mjs` 校验入库 → `src/layouts/Post.astro` 渲染官方 mf2 标记 → 出站脚本发送。

---

## 0. 三条硬前提（不满足则后面全是白费）

1. **类型不是 POST 出来的。** 请求体只有 `source` 与 `target`；「喜欢 / 转发 / 收藏 / 回复 / RSVP」是接收方
   抓取 source 页面、解析 microformats2 `h-entry` 得出的结论。所以想测哪种类型，取决于**页面里有没有对应的类名**。
2. **source 必须公网可访问。** webmention.io 会回头抓你的页面；`localhost` 一律不通。
   要么 `npm run deploy` 发到线上，要么开一条 Cloudflare Tunnel 并把 `siteConfig.url` 临时指过去。
3. **正文里必须有一条指向 target 的普通链接。**
   出站脚本（`send-webmentions.mjs`）是从 **D1 里的 markdown 正文** 渲染出的 HTML 中找 `<a href>` 来发现目标端点的；
   `Post.astro` 头部那条互动链接位于模板里、不在正文、也不进 RSS。
   → 只在 frontmatter 写 `interactionTarget`、正文不写链接，结果是**一条都不会发出去，而且不报错**。
   这是本手册里最容易踩的坑，测试文章请照抄下面的正文。

---

## 1. 五分钟最短路径（测 `like`）

```powershell
# 1) 写文章（内容见 §2.1），文件放 content/posts/ 顶层，不要放子目录
# 2) 入库：写远端 D1（--remote）；只想本地看效果用 npm run sync:posts:local
npm run sync:posts

# 3) 部署（页面必须先上线，接收方才能抓取）
npm run deploy

# 4) 发送：只处理这一篇；不带 --remote 时默认读本地 D1
node scripts/send-webmentions.mjs --remote --slug=wm-test-like
```

然后按 §4 逐层核对。顺序不能颠倒：**先上线、再发送**。

---

## 2. 测试文章清单（复制即用）

`slug` 一律显式写 ASCII：不写时脚本会由标题生成，中文标题会生成中文 slug（URL 可编码但是难核对）。
`status` 必须显式 `published`，**脚本默认 `draft`**——草稿不会出现在站点上，也就没有可抓取的 source。

### 2.1 喜欢 `like-of`

```markdown
---
title: WM 测试 · 喜欢
slug: wm-test-like
status: published
date: 2026-11-10
interaction: like
interactionTarget: https://example.com/some-article
---

手动测试用文章：验证 `u-like-of`。

目标页：https://example.com/some-article
```

### 2.2 转发 `repost-of`

```markdown
---
title: WM 测试 · 转发
slug: wm-test-repost
status: published
date: 2026-11-10
interaction: repost
interactionTarget: https://example.com/some-article
---

手动测试用文章：验证 `u-repost-of`。

目标页：https://example.com/some-article
```

### 2.3 收藏 `bookmark-of`

```markdown
---
title: WM 测试 · 收藏
slug: wm-test-bookmark
status: published
date: 2026-11-10
interaction: bookmark
interactionTarget: https://example.com/some-article
---

手动测试用文章：验证 `u-bookmark-of`。

目标页：https://example.com/some-article
```

### 2.4 回复 `in-reply-to`

```markdown
---
title: WM 测试 · 回复
slug: wm-test-reply
status: published
date: 2026-11-10
interaction: reply
interactionTarget: https://example.com/some-article
---

手动测试用文章：验证 `u-in-reply-to`。

回复对象：https://example.com/some-article
```

### 2.5 RSVP（`u-in-reply-to` + `p-rsvp`）

四个取值 `yes` / `no` / `maybe` / `interested` 各测一遍，只改 `interactionRsvp` 与 `slug`。

```markdown
---
title: WM 测试 · RSVP 参加
slug: wm-test-rsvp-yes
status: published
date: 2026-11-10
interaction: rsvp
interactionTarget: https://example.com/some-event
interactionRsvp: yes
---

手动测试用文章：验证 `u-in-reply-to` + `p-rsvp`。

活动页：https://example.com/some-event
```

### 2.6 对照文章（不声明互动）

用来确认「没声明 = 什么都不输出」：

```markdown
---
title: WM 测试 · 普通提及
slug: wm-test-mention
status: published
date: 2026-11-10
---

手动测试用文章：普通外链，应被识别为 `mention-of`。

目标页：https://example.com/some-article
```

### 渲染结果对照表

| frontmatter | 页面里应出现的标记 | 接收方 `wm-property` | 面板文案 |
| --- | --- | --- | --- |
| （不填） | 无 | `mention-of` | 💭 提及 |
| `like` | `<a class="u-like-of" href="…">` | `like-of` | ❤️ 喜欢 |
| `repost` | `<a class="u-repost-of" href="…">` | `repost-of` | 🔄 转发 |
| `bookmark` | `<a class="u-bookmark-of" href="…">` | `bookmark-of` | 🔖 收藏 |
| `reply` | `<a class="u-in-reply-to" href="…">` | `in-reply-to` | 💬 回复 |
| `rsvp` + `yes` | 上面那条 `u-in-reply-to` **加** `<data class="p-rsvp" value="yes">` | `rsvp` | ✅ 参加 |

---

## 3. 负例：半截声明必须整篇被拒

这些文件在同步阶段就会被跳过（`continue`），**不会入库、不会上线**，也绝不会渲染出半截标记。
逐条复制、逐条确认控制台输出：

| 文章写法 | 期望输出 |
| --- | --- |
| 有 `interaction: like`，无 `interactionTarget` | `[跳过] x.md: 声明了 interaction 就必须填写 interactionTarget` |
| `interactionTarget: /blog/some-post`（相对路径） | `[跳过] x.md: interactionTarget 必须是 http/https 绝对地址` |
| `interactionTarget: mailto:a@b.c` 或 `javascript:…` | 同上 |
| `interaction: favorite`（拼错） | `[跳过] x.md: interaction「favorite」不合法，可选 like/repost/bookmark/reply/rsvp` |
| `interaction: rsvp`，无 `interactionRsvp` | `[跳过] x.md: interaction=rsvp 需要 interactionRsvp` |
| `interactionRsvp: y`（缩写） | `[跳过] x.md: interactionRsvp 只能是 yes/no/maybe/interested` |
| `interaction: like` 但 `interactionRsvp: yes`（多余字段） | 不报错，`rsvp` 被忽略（只有 `rsvp` 类型才读该字段） |

> 设计意图：宁可当作「没声明」（普通提及），也不要输出半截标记。
> 半截标记会被接收方静默降级成 `mention-of`，是最难排查的失败方式。

同一套规则在后台编辑器（`src/admin/views/posts/editor.ts` + `routes/posts.ts`）里也生效，
保存时会直接报错而不是落库。两种入口各测一次即可。

---

## 4. 验收：四层核对

### 4.1 页面源码（最快）

```powershell
# 三种类型各查一次；把 slug 换掉即可
curl.exe -sS -L "https://ffaff.fun/blog/wm-test-like" |
  Select-String -Pattern 'u-like-of|p-rsvp|h-entry|article-interaction'
```

判定标准：

- 必须能在同一个 `<article class="… h-entry …">` 内找到该链接；
- 链接上应带 `rel="nofollow ugc noopener noreferrer"`（正常，不影响解析）；
- RSVP 的 `<data class="p-rsvp" value="yes">` 必须有 `value` 属性——**挂在 `<span>` 上就读不到取值**；
- 互动那一行应在 `e-content` **之外**（放进去会被当成正文内容）。

### 4.2 微格式解析（确认解析器读得到）

把页面地址贴进 IndieWeb 的 mf2 解析器（搜索「IndieWeb mf2 parser」，常用的是 `pin13.net/mf2`），
或 `indiewebify.me` 的 h-entry 校验页。看第一项 `items[0].properties`：

| 类型 | 期望 |
| --- | --- |
| `like` | `properties["like-of"]` 是数组且首项为该 target URL |
| `repost` | `properties["repost-of"]` 同上 |
| `bookmark` | `properties["bookmark-of"]` 同上（此属性在 h-entry 里属 Proposed Additions，但 webmention.io 已接受） |
| `reply` / `rsvp` | `properties["in-reply-to"]` 有值 |
| `rsvp` | `properties["rsvp"][0] === "yes"`（大小写不敏感） |

若 `like-of` 为空，先回 §4.1 确认链接在 `h-entry` 内。

### 4.3 本站面板（同站闭环，最省事）

同站互指即可自测收发两端，不依赖外部站点：

1. `wm-test-like`（source，声明 `like-of`）→ target 用你自己的另一篇文章，例如 `https://ffaff.fun/blog/weekly-log`；
2. 发送：`node scripts/send-webmentions.mjs --remote --slug=wm-test-like`；
3. 打开 target 文章页，`WebmentionPanel` 里应出现该 source 的头像与「❤️ 喜欢」。

也可以用接口直接查（把 target 换成规范 URL）：

```powershell
curl.exe -sS "https://webmention.io/api/mentions.jf2?target[]=https://ffaff.fun/blog/weekly-log&per-page=10"
```

响应里逐条看 `wm-property` 与 `rsvp` 字段，比面板更早暴露问题。

### 4.4 发给外部站点

- **端点发现**用 `https://webmention.rocks`：它自带一批用例，分别测 `Link` 头 / `<link>` / `<a>` 三种发现路径，
  编号含义见该站首页表格。它的用途是「能不能找到端点」，不是「类型对不对」。
- **类型是否正确**只能在能展示 `wm-property` 的地方看：对方的 webmention 面板、或对方的 webmention.io 后台。
  没有这样的目标时，就用 §4.3 的同站闭环 + §4.2 的解析器。

---

## 5. 命令速查

| 目的 | 命令 |
| --- | --- |
| 同步到**线上** D1 | `npm run sync:posts` |
| 同步到**本地** D1（只在本地 dev / preview 生效） | `npm run sync:posts:local` |
| 本地跑起来看页面 | `npm run dev` |
| 本地 DB + 构建 + wrangler dev | `npm run preview` |
| 部署 | `npm run deploy` |
| 出站发送（单篇，读线上 D1） | `node scripts/send-webmentions.mjs --remote --slug=<slug>` |
| 出站发送（最近 5 篇已发布） | `node scripts/send-webmentions.mjs --remote` |
| 手工直发（绕过脚本） | `curl.exe -i -X POST -d "source=https://ffaff.fun/blog/a" -d "target=https://example.com/b" https://webmention.io/ffaff.fun/webmention` |
| 查已收到的提及 | `curl.exe -sS "https://webmention.io/api/mentions.jf2?target[]=<target>&per-page=10"` |

注意：

- `send-webmentions.mjs` **不带 `--remote` 时默认读本地 D1**，会拿本地内容去发线上请求，容易白跑；
- `wm` 的 `--limit` 截断的是「已解析出的端点总数」，脚本已设为 100，不要拿它当文章数上限；
- 文章是更新过的，也要重发（规范 §3.1.4），单篇模式不过滤 `status`，删除的文章同样要重发（§3.1.5）。

---

## 6. 排错表

| 现象 | 先查 |
| --- | --- |
| 页面里根本没有 `u-*` 标记 | D1 三列是否为空（`sync` 是否跑过、后台是否保存成功）；`buildInteractionMarkup` 是否判定为不自洽而返回 `null` |
| 标记在，但接收方记成 `mention-of` | 标记是否在 `h-entry` **内**；类名是否拼成 `u-like-of`（`like-of` / `p-like-of` 都错） |
| RSVP 显示成普通回复 | `p-rsvp` 是否挂在 `<data value>` 上；`value` 是否是四个合法取值的原文 |
| 发送脚本 0 条、无报错 | 正文有没有 target 链接（§0.3）；`--slug` 是否拼错；target 是否公网可达 |
| 发了但面板 0 条 | target 是否与 `<link rel="canonical">` 一致；查询是否用 `target[]=`；边缘缓存是否还返回旧 HTML |
| 面板「加载失败」 | 浏览器控制台是否被 CSP `connect-src` 拦；接口是否 5xx |
| 同步后页面 404 | `status` 是否写成了 `published`；文件是否被放进了 `content/posts/` 子目录（脚本不递归） |

---

## 7. 清理

1. 删除测试文章文件；
2. 再跑一次 `npm run sync:posts`——脚本会把本地已不存在的 `source='file'` 文章**软删除**（写 `deleted_at`），
   页面变 410，接收方重新验证 source 后会移除展示（规范 §3.1.5）；
3. 已经发出去的 self-mention 会随 source 失效而消失；
4. 若测试时改过线上文章的真实字段，记得在后台改回并重新部署。
