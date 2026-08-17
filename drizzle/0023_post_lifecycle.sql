-- 文章来源（file / admin / mcp）与软删除（回收站）
ALTER TABLE `blog_posts` ADD COLUMN `source` text NOT NULL DEFAULT 'admin';
ALTER TABLE `blog_posts` ADD COLUMN `deleted_at` text;
CREATE INDEX `posts_source_idx` ON `blog_posts` (`source`);
CREATE INDEX `posts_deleted_idx` ON `blog_posts` (`deleted_at`);
