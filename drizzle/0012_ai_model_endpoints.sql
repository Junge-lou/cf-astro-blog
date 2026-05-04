ALTER TABLE `site_appearance_settings` ADD `ai_internal_enabled` integer DEFAULT 0 NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_internal_base_url` text DEFAULT 'https://api.deepseek.com' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_internal_api_key` text DEFAULT '' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_internal_model` text DEFAULT 'deepseek-v4-flash' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_public_enabled` integer DEFAULT 0 NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_public_base_url` text DEFAULT 'https://api.deepseek.com' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_public_api_key` text DEFAULT '' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `ai_public_model` text DEFAULT 'deepseek-v4-flash' NOT NULL;
