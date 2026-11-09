-- 回复通知需要读者邮箱；退订需要一次性凭据。
-- 两列都允许为空：不填邮箱的评论者与历史评论都不受影响。
ALTER TABLE `blog_comments` ADD COLUMN `author_email` text;
ALTER TABLE `blog_comments` ADD COLUMN `notify_token` text;

CREATE INDEX `blog_comments_notify_token_idx` ON `blog_comments` (`notify_token`);
CREATE INDEX `blog_comments_author_email_idx` ON `blog_comments` (`author_email`);
