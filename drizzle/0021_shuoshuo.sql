CREATE TABLE `shuoshuo_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`content` text NOT NULL,
	`status` text NOT NULL DEFAULT 'published',
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	`updated_at` text NOT NULL DEFAULT (datetime('now'))
);
