#!/usr/bin/env tsx
// 把 bill-config 里的区块几何导出成 JSON，供 Python 核对脚本画框。
// 这是一次性核对工具，不属于产品代码。
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_BILL_ZONES, NOTE_MM } from "../src/lib/bill-config.ts";

const zones = DEFAULT_BILL_ZONES.map((zone) => ({
	id: zone.id,
	enabled: zone.enabled,
	x0: +((zone.x / 100) * NOTE_MM.width).toFixed(2),
	y0: +((zone.y / 100) * NOTE_MM.height).toFixed(2),
	x1: +(((zone.x + zone.w) / 100) * NOTE_MM.width).toFixed(2),
	y1: +(((zone.y + zone.h) / 100) * NOTE_MM.height).toFixed(2),
}));

const out = ".reference/bill/zones.json";
mkdirSync(".reference/bill", { recursive: true });
writeFileSync(out, JSON.stringify(zones, null, 2), "utf8");
console.log(`导出 ${zones.length} 个区块 → ${out}`);
