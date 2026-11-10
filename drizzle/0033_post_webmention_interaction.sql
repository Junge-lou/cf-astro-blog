-- 文章声明的 Webmention 互动类型（like / repost / bookmark / reply / rsvp）。
--
-- 只存三个字段，渲染出来的却是官方 microformats2 标记：接收方（webmention.io）
-- 抓取页面后读取 h-entry 的 `u-like-of` / `u-in-reply-to` / `p-rsvp` 等属性，
-- 才知道这条是「喜欢」而不是一条普通提及。类型无法在 POST 时指定——
-- Webmention 的请求体只有 source 与 target。
--
-- 三列都允许为 NULL：绝大多数文章不声明互动，走普通提及。
-- 校验与类名映射在 src/lib/post-interaction.ts，设计说明见 docs/webmention-interactions.md。
ALTER TABLE `blog_posts` ADD COLUMN `interaction` text;
ALTER TABLE `blog_posts` ADD COLUMN `interaction_target` text;
ALTER TABLE `blog_posts` ADD COLUMN `interaction_rsvp` text;
