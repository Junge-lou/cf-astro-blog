-- 移除自建评论区。
--
-- 文章页的互动改为只走 Webmention：收件由 `WebmentionPanel.astro` 直接读
-- webmention.io 的 JF2 接口，发件由 `scripts/send-webmentions.mjs` 负责。
-- 因此 `blog_comments`（含读者邮箱与退订 token）整表不再需要——邮箱属于
-- 个人数据，留着不用的表只会增加泄露面，一并删掉。
--
-- 索引随表一起被 DROP TABLE 清除，不需要单独 DROP INDEX。

DROP TABLE IF EXISTS `blog_comments`;
