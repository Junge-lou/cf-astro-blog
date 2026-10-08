-- 公开页面热点查询的索引
--
-- 背景：这些查询此前虽然能借 posts_status_publish_idx 定位行，但查询计划里带
-- `USE TEMP B-TREE FOR ORDER BY` —— 也就是说每次都要把**全部已发布文章**排序一遍
-- 才取 LIMIT。另外 blog_post_tags 与 shuoshuo_posts 上完全没有可用索引。
--
-- 关于部分索引的 WHERE 条件：公开可见性条件（src/lib/public-content.ts）恒为
--   deleted_at IS NULL AND (status='published' OR (status='scheduled' AND ...))
-- 其中 `deleted_at IS NULL` 是顶层 AND 合取项，查询"蕴含"它，SQLite 因此允许使用
-- 以它作条件的部分索引。**不能**把 status='published' 放进部分索引条件：status 出现
-- 在 OR 中，查询并不蕴含该条件，规划器会直接拒绝整个索引。
--
-- 索引形状来自真实查询计划的实测选型（4000 行合成数据，有 ANALYZE 统计）：
--   归档列表 3.9ms → 0.15ms、归档深分页 11.3ms → 0.16ms、搜索 25.9ms → 0.67ms、
--   RSS 3.6ms → 0.07ms、首页最新 3.7ms → 0.09ms、首页置顶 1.5ms → 0.09ms，
--   9 条热点查询全部消除"全表扫描"与"排序全结果集"，且没有一条退步。
-- 回归保护见 tests/unit/query-plans.test.ts —— 改名或调整列顺序前请先跑它。
--
-- ⚠ 末尾的 ANALYZE 不是可选项：
-- 以 `published_at DESC` 打头的部分索引，只有在数据库存在 sqlite_stat1 统计时
-- 才会被查询规划器选中。没有统计时它退回原来的 "MULTI-INDEX OR + 排序全结果集"，
-- 也就是这些索引**完全不生效**（实测无统计：归档列表 3.9ms、搜索 25.9ms，
-- 与加索引前的 3.9ms / 25.9ms 一致）。所以索引与统计必须一起落地。
-- 大量导入内容之后，可以再跑一次 `ANALYZE` 让统计跟上数据分布。

CREATE INDEX IF NOT EXISTS `posts_public_rss_idx`
	ON `blog_posts` (`published_at` DESC, `updated_at` DESC)
	WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS `posts_public_home_idx`
	ON `blog_posts` (`is_pinned`, `published_at` DESC, `created_at` DESC)
	WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS `posts_public_pinned_idx`
	ON `blog_posts` (`is_pinned`, `pinned_order`, `published_at` DESC, `created_at` DESC)
	WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS `posts_public_sitemap_idx`
	ON `blog_posts` (`updated_at`)
	WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS `blog_post_tags_tag_idx`
	ON `blog_post_tags` (`tag_id`);

CREATE INDEX IF NOT EXISTS `shuoshuo_status_created_idx`
	ON `shuoshuo_posts` (`status`, `created_at` DESC);

-- 让规划器拿到统计信息。理由见文件开头：没有它，上面那几个以 published_at DESC
-- 打头的部分索引不会被采用。
ANALYZE;
