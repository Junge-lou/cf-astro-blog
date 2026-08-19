-- 移除已删除的文章页左侧信息栏字段
ALTER TABLE `site_appearance_settings` DROP COLUMN `article_sidebar_avatar_path`;
ALTER TABLE `site_appearance_settings` DROP COLUMN `article_sidebar_name`;
ALTER TABLE `site_appearance_settings` DROP COLUMN `article_sidebar_bio`;
ALTER TABLE `site_appearance_settings` DROP COLUMN `article_sidebar_badge`;
--> statement-breakpoint
-- 移除已删除的 Webmention 提及表
DROP TABLE IF EXISTS `web_mentions`;
