# Webmention 互动类型：设计与实现

> 状态：**已实现**（2026-11）。三个 frontmatter 字段、模板渲染、后台表单与回归测试均已落地；
> 手动测试步骤见 [`webmention-manual-test.md`](./webmention-manual-test.md)。
> 关联文档：[`webmention.md`](./webmention.md)（收发链路与协议依据）。

---

## 1. 背景：类型不是 POST 出来的

Webmention 的请求体只有两个字段：

```
source=<你的页面>&target=<对方的页面>
```

「喜欢 / 回复 / 转发 / 收藏 / RSVP」是**接收方抓取 source 页面后解析微格式**得出的结论，写进 `wm-property`。所以想发什么类型，取决于 **source 页面里有没有对应的标记**，与 POST 请求无关。

| `wm-property` | 需要的标记（source 页面内） |
| --- | --- |
| `mention-of` | 任意指向 target 的 `<a href>`（其他都不匹配时） |
| `in-reply-to` | `class="u-in-reply-to"` |
| `like-of` | `class="u-like-of"` |
| `repost-of` | `class="u-repost-of"` |
| `bookmark-of` | `class="u-bookmark-of"` |
| `rsvp` | `class="p-rsvp"`（`yes`/`no`/`maybe`/`interested`）+ 指向活动页的 `u-in-reply-to` |

---

## 2. 现状实测：正文里写不出来

用项目自己的渲染管线（`renderSafeMarkdown`）验证：

```
输入：like <a class="u-like-of" href="https://example.com/post">this</a>
输出：<p>like &lt;a class="u-like-of" href="..."&gt;this</p>     ← 被转义成文本

输入：<div class="h-entry"><a href="https://example.com/post">x</a></div>
输出：<div class="h-entry">&lt;a href="..."&gt;x&lt;/a&gt;</div>  ← div 保留，里面的 a 仍被转义

输入：[like](https://example.com/post)
输出：<p><a href="..." rel="nofollow ugc noopener noreferrer">like</a></p>  ← 只有 markdown 语法生成的 a 能活
```

原因在 `src/lib/security.ts`：`SAFE_HTML_TAGS` 是**原始 HTML 块**的白名单（`div`/`span`/`img`/`video`…），故意不含 `a`/`p`/`h1`，因为那些应该由 markdown 生成。于是任何手写的 `<a>` 都被 `disallowedTagsMode: "escape"` 转义，而微格式要求 URL 必须挂在 `<a href>` 上。

**结论：不放开原始 HTML，就无法靠正文标记互动类型。**

---

## 3. 方案：frontmatter 声明 + 模板渲染

不放开正文的原始 HTML（那会扩大 XSS 面），而是给文章加三个可选字段，由 `Post.astro` 在已有 `h-entry` 内渲染一个微格式链接。

文章外壳其实已经是合法的 h-entry —— `Post.astro` 里已有 `article.h-entry`、`a.u-url`、`p-author`、`dt-published`、`p-category`、`e-content`。缺的只是这一个关系属性。

```yaml
interaction: like          # like | repost | bookmark | reply | rsvp
interactionTarget: https://example.com/some-article
interactionRsvp: yes       # 仅 interaction=rsvp
```

| `interaction` | 渲染出的标记 | 对方显示 |
| --- | --- | --- |
| 不填 | 无 | 💭 提及 |
| `like` | `<a class="u-like-of" href="…">` | ❤️ 喜欢 |
| `repost` | `<a class="u-repost-of" href="…">` | 🔄 转发 |
| `bookmark` | `<a class="u-bookmark-of" href="…">` | 🔖 收藏 |
| `reply` | `<a class="u-in-reply-to" href="…">` | 💬 回复 |
| `rsvp` | `u-in-reply-to` + `<data class="p-rsvp" value="…">` | 📅 回应 |

### 约束

1. `interaction` 有值时 `interactionTarget` 必填；缺失则**同步阶段直接报错**，不写进库——避免发出一批注定验证失败的互动。
2. `interactionTarget` 必须是 http/https 绝对地址（复用 `sanitizeCanonicalUrl`）。
3. 该链接渲染在文章头部信息区，同时作为可见文本（「❤️ 喜欢了：某文章」），对读者也是线索，不做隐藏。
4. 不影响正文、RSS、分页、缓存键；无 `interaction` 的文章输出与现在完全一致。
5. 同步修改 `scripts/sync-local-posts.mjs`（解析字段）、`src/db/schema.ts` + 迁移（两列 + 一列 rsvp）、`src/admin` 编辑器（已实现，与文件同步共用同一套校验）。

### 影响面

| 文件 | 改动 |
| --- | --- |
| `src/lib/types.ts` | 新增 `PostInteraction` 类型 |
| `src/db/schema.ts` + `drizzle/00NN_post_interaction.sql` | `interaction`、`interaction_target`、`interaction_rsvp` 三列 |
| `scripts/sync-local-posts.mjs` | 解析并校验三个字段 |
| `src/layouts/Post.astro` | 头部渲染微格式链接 |
| `src/admin/routes/posts.ts` | 保存时透传（后台表单可后置） |
| `tests/unit/` | 渲染与校验的回归测试 |

### 验收方式

1. 发布一篇 `interaction: like` 的短文章，目标指向 `https://webmention.rocks/test/1`
2. 抓取该页面 HTML，确认存在 `class="u-like-of"` 且位于 `h-entry` 内
3. 跑 `node scripts/send-webmentions.mjs --remote --slug=<slug>`
4. 在目标页确认收到；再用 IndieWeb 的 mf2 解析器复核属性名

---

## 4. 备选方案（不推荐）

**放开 `a` 到 `SAFE_HTML_TAGS`。** 改动只有一行，但会让所有文章正文可以携带任意 `<a>` 及其 `class`/`target`/`rel`，等于把标注能力交给每篇文章的作者手写；也失去「类型是站点级声明」这一语义。若确实需要单篇灵活控制，更稳妥的做法是后续加一个显式的 `interaction:` 短代码，而不是解除整条白名单。

---

## 5. 已定的三件事

1. 字段名就是 `interaction` / `interactionTarget` / `interactionRsvp`。
2. 后台编辑器已暴露这三个字段，保存时与文件同步走同一套校验（`src/lib/post-interaction.ts`）。
3. 一篇文章只声明一个互动（单值），足够用；需要多值时再扩成数组。
