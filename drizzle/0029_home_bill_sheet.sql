-- 首页票面（bill sheet）的可视化配置。
--
-- 之前区块几何只存在于 src/lib/bill-config.ts 的代码里，管理员想挪一个区块
-- 就得改代码再部署一次。这里把整份票面配置落成单列 JSON：
--   { config: BillSheetConfig, zones: BillZone[], textMm: { [zoneId]: number } }
--
-- 存 JSON 而不是 15 组列，是因为区块数量本身会变（新增/合并区块不该再来一次迁移），
-- 而读的时候总要整份一起用，拆开反而要 15 次拼接。
-- 字段缺失或类型不对时由 normalizeBillSettingsInput 逐项回退到默认值。
ALTER TABLE `site_appearance_settings` ADD COLUMN `home_bill_json` TEXT;
