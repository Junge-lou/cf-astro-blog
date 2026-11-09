CREATE TABLE `blog_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`post_slug` text NOT NULL,
	`parent_id` integer,
	`author_name` text NOT NULL,
	`author_url` text,
	`content` text NOT NULL,
	`status` text NOT NULL DEFAULT 'published',
	`ip_hash` text,
	`user_agent` text,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	`updated_at` text NOT NULL DEFAULT (datetime('now'))
);

-- 文章页：WHERE post_slug=? AND status='published' ORDER BY created_at
CREATE INDEX `blog_comments_post_idx` ON `blog_comments` (`post_slug`, `status`, `created_at`);

-- 后台列表：ORDER BY created_at DESC
CREATE INDEX `blog_comments_status_created_idx` ON `blog_comments` (`status`, `created_at` DESC);
