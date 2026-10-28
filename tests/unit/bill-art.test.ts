import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { DEFAULT_BILL_SHEET_CONFIG, DEFAULT_BILL_ZONES } from "../../src/lib/bill-config";
import { BILL_ZONE_MIN_X, normalizeBillSettingsInput } from "../../src/lib/bill-settings";

/**
 * 票面组件图（art 通道）的闸门。
 *
 * 背景：art.src 写错路径不会在任何编译期报错，只会在生产环境 404；
 * 而后台表单是自由文本，脏输入必须被归一化拦下。
 * 见 docs/bill-image-components-plan.md §8/§9。
 */

/** 默认配置里所有引用的组件图路径（区块 art + 整票边框 frameArt）。 */
function collectArtSrcs(): string[] {
	const srcs = DEFAULT_BILL_ZONES.map((zone) => zone.art?.src).filter(
		(src): src is string => typeof src === "string" && src !== "",
	);
	if (DEFAULT_BILL_SHEET_CONFIG.frameArt) {
		srcs.push(DEFAULT_BILL_SHEET_CONFIG.frameArt);
	}
	return srcs;
}

describe("票面组件图资源", () => {
	test("每个 art.src 都能在 public/ 下找到真实文件（防 404）", async () => {
		const srcs = collectArtSrcs();
		assert.ok(srcs.length > 0, "默认配置应当引用了组件图");
		for (const src of srcs) {
			await access(`public${src}`);
		}
	});

	test("art.src 必须是 /bill/ 前缀且不含 ..", () => {
		for (const src of collectArtSrcs()) {
			assert.ok(src.startsWith("/bill/"), `${src} 不在 /bill/ 下`);
			assert.ok(!src.includes(".."), `${src} 含目录穿越`);
		}
	});

	test("整票边框图在 public/_headers 的缓存规则覆盖内", async () => {
		const headers = await readFile("public/_headers", "utf8");
		assert.match(headers, /\/bill\/\*/u, "_headers 缺少 /bill/* 规则");
	});
});

describe("票面组件图归一化", () => {
	test("javascript: 路径被整体丢弃，回退文本渲染", () => {
		const result = normalizeBillSettingsInput({
			zones: [{ id: "Z1", art: { src: "javascript:alert(1)" } }],
		});
		const zone = result.zones.find((item) => item.id === "Z1");
		assert.equal(zone?.art, undefined);
	});

	test("外链与目录穿越被整体丢弃", () => {
		const result = normalizeBillSettingsInput({
			zones: [
				{ id: "Z1", art: { src: "https://evil.example/x.webp" } },
				{ id: "Z2", art: { src: "/bill/../secret.png" } },
				{ id: "Z3", art: { src: "//evil.example/x.webp" } },
			],
		});
		for (const id of ["Z1", "Z2", "Z3"]) {
			assert.equal(result.zones.find((item) => item.id === id)?.art, undefined, id);
		}
	});

	test("fit / blend 走白名单，非法值丢弃字段（渲染层回落默认）", () => {
		const result = normalizeBillSettingsInput({
			zones: [
				{ id: "Z1", art: { src: "/bill/portrait.webp", fit: "hack", blend: "screen" } },
				{ id: "Z2", art: { src: "/bill/denom-100.webp", fit: "cover", blend: "normal" } },
			],
		});
		const z1 = result.zones.find((item) => item.id === "Z1");
		assert.equal(z1?.art?.src, "/bill/portrait.webp");
		assert.equal(z1?.art?.fit, undefined);
		assert.equal(z1?.art?.blend, undefined);
		const z2 = result.zones.find((item) => item.id === "Z2");
		assert.equal(z2?.art?.fit, "cover");
		assert.equal(z2?.art?.blend, "normal");
	});

	test("opacity 钳到 0–1，align 限长 24", () => {
		const result = normalizeBillSettingsInput({
			zones: [
				{ id: "Z1", art: { src: "/bill/portrait.webp", opacity: 9, align: "x".repeat(80) } },
				{ id: "Z2", art: { src: "/bill/denom-100.webp", opacity: -3 } },
			],
		});
		const z1 = result.zones.find((item) => item.id === "Z1");
		assert.equal(z1?.art?.opacity, 1);
		assert.ok((z1?.art?.align ?? "").length <= 24);
		const z2 = result.zones.find((item) => item.id === "Z2");
		assert.equal(z2?.art?.opacity, 0);
	});

	test("art 键缺省时沿用默认组件图（旧数据升级不丢图）", () => {
		const result = normalizeBillSettingsInput({
			zones: [{ id: "Z14", x: 50 }],
		});
		const zone = result.zones.find((item) => item.id === "Z14");
		assert.equal(zone?.art?.src, "/bill/inkwell.webp");
	});

	test("显式给出空 src 等于删除 art（后台清空即回退）", () => {
		const result = normalizeBillSettingsInput({
			zones: [{ id: "Z14", art: { src: "" } }],
		});
		const zone = result.zones.find((item) => item.id === "Z14");
		assert.equal(zone?.art, undefined);
	});

	test("frameArt：缺省沿用默认，显式空串停用，非法路径回落默认", () => {
		assert.equal(
			normalizeBillSettingsInput({}).config.frameArt,
			DEFAULT_BILL_SHEET_CONFIG.frameArt,
		);
		assert.equal(normalizeBillSettingsInput({ config: { frameArt: "" } }).config.frameArt, "");
		assert.equal(
			normalizeBillSettingsInput({ config: { frameArt: "https://evil.example/f.webp" } }).config
				.frameArt,
			DEFAULT_BILL_SHEET_CONFIG.frameArt,
		);
		assert.equal(
			normalizeBillSettingsInput({ config: { frameArt: "/bill/custom.webp" } }).config.frameArt,
			"/bill/custom.webp",
		);
	});
});

describe("票面区块几何归一化", () => {
	test("x 允许负数（文字左缘对齐时盒子需外溢），下限 BILL_ZONE_MIN_X", () => {
		const kept = normalizeBillSettingsInput({ zones: [{ id: "Z4", x: -1.25 }] });
		assert.equal(kept.zones.find((zone) => zone.id === "Z4")?.x, -1.25);

		const clamped = normalizeBillSettingsInput({ zones: [{ id: "Z4", x: -40 }] });
		assert.equal(clamped.zones.find((zone) => zone.id === "Z4")?.x, BILL_ZONE_MIN_X);
	});

	test("y 仍然不允许为负，w/h 不越出票面", () => {
		const result = normalizeBillSettingsInput({
			zones: [{ id: "Z4", y: -10, w: 200, h: 200 }],
		});
		const zone = result.zones.find((item) => item.id === "Z4");
		assert.equal(zone?.y, 0);
		// x 可以为负，所以右边界是 100 − x（盒子右侧恰好不超出票面）
		assert.ok((zone?.w ?? 0) <= 100 - (zone?.x ?? 0) + 1e-6, `w=${zone?.w}`);
		assert.ok((zone?.h ?? 0) <= 100, `h=${zone?.h}`);
	});
});

describe("票面区块叠压与交互", () => {
	test("叠压层序 z 会被钳到 0–99，缺省沿用默认", () => {
		const dirty = normalizeBillSettingsInput({
			zones: [
				{ id: "Z1", z: 999 },
				{ id: "Z2", z: -5 },
			],
		});
		assert.equal(dirty.zones.find((zone) => zone.id === "Z1")?.z, 99);
		assert.equal(dirty.zones.find((zone) => zone.id === "Z2")?.z, 0);

		const untouched = normalizeBillSettingsInput({ zones: [{ id: "Z2", x: 50 }] });
		const fallbackZ = DEFAULT_BILL_ZONES.find((zone) => zone.id === "Z2")?.z;
		assert.equal(untouched.zones.find((zone) => zone.id === "Z2")?.z, fallbackZ);
	});

	test("羽毛笔与报头铭文是可交互区块（有 href，不是纯装饰 span）", () => {
		for (const id of ["Z22", "Z23"]) {
			const zone = DEFAULT_BILL_ZONES.find((item) => item.id === id);
			assert.ok(zone, `${id} 应存在`);
			assert.ok((zone?.href ?? "").startsWith("/"), `${id} 的 href 必须是站内路径`);
			assert.ok((zone?.ariaLabel ?? "").length > 0, `${id} 必须有无障碍名称`);
		}
	});

	test("肖像区块不越出票面（上下各留余量）", () => {
		const portrait = DEFAULT_BILL_ZONES.find((zone) => zone.id === "Z1");
		const topMm = ((portrait?.y ?? 0) / 100) * 66.3;
		const bottomMm = (((portrait?.y ?? 0) + (portrait?.h ?? 0)) / 100) * 66.3;
		// 票面高 66.3 mm；上下都要留出边框带，否则人像会盖住花边
		assert.ok(topMm >= 1, `肖像上缘 ${topMm.toFixed(2)} mm，应 ≥1 mm`);
		assert.ok(bottomMm <= 65.3, `肖像下缘 ${bottomMm.toFixed(2)} mm，应 ≤65.3 mm`);
		assert.equal(portrait?.art?.align, "center bottom");
	});

	test("肖像区块按 760:659 等比，不横向拉伸", () => {
		const portrait = DEFAULT_BILL_ZONES.find((zone) => zone.id === "Z1");
		const wMm = ((portrait?.w ?? 0) / 100) * 156;
		const hMm = ((portrait?.h ?? 0) / 100) * 66.3;
		assert.ok(Math.abs(wMm / hMm - 760 / 659) < 0.02, `比例 ${(wMm / hMm).toFixed(3)}`);
	});

	test("羽毛笔区块高度覆盖整根羽毛（≥29 mm）", () => {
		const quill = DEFAULT_BILL_ZONES.find((zone) => zone.id === "Z22");
		const heightMm = ((quill?.h ?? 0) / 100) * 66.3;
		assert.ok(heightMm >= 29, `羽毛笔区块高 ${heightMm.toFixed(1)} mm，应 ≥29 mm`);
	});

	test("像主名下移到底部花纹带上，且不越出票面", async () => {
		const zone = DEFAULT_BILL_ZONES.find((item) => item.id === "Z21");
		const topMm = ((zone?.y ?? 0) / 100) * 66.3;
		const bottomMm = topMm + ((zone?.h ?? 0) / 100) * 66.3;
		assert.ok(topMm >= 60, `像主名上缘 ${topMm.toFixed(1)} mm，应已落在底部花纹带`);
		assert.ok(bottomMm <= 66.3, `像主名下缘 ${bottomMm.toFixed(1)} mm 超出票面`);

		// 浅灰白斜体靠 [data-bill-zone="Z21"] 选择器定位，区块没输出这个属性样式会落空
		const sheet = await readFile("src/components/bill/BillSheet.astro", "utf8");
		assert.match(sheet, /data-bill-zone=\{zone\.id\}/, "区块应输出 data-bill-zone 属性");
		assert.match(sheet, /\.bill__zone\[data-bill-zone="Z21"\]/, "缺少 Z21 专属样式");
	});

	test("铜色大 100（Z8）可交互，盒子比例与 big-100.webp 一致", () => {
		const zone = DEFAULT_BILL_ZONES.find((item) => item.id === "Z8");
		assert.ok((zone?.href ?? "").startsWith("/"), "Z8 必须有站内 href，否则会渲染成装饰 span");
		assert.ok((zone?.ariaLabel ?? "").length > 0, "Z8 必须有无障碍名称");
		const wMm = ((zone?.w ?? 0) / 100) * 156;
		const hMm = ((zone?.h ?? 0) / 100) * 66.3;
		assert.ok(Math.abs(wMm / hMm - 340 / 93) < 0.02, `盒子比例 ${(wMm / hMm).toFixed(3)}`);
	});

	test("逐区块墨色：凹印黑 / 油墨绿序列号 / 浅灰白 + 黑描影", async () => {
		const sheet = await readFile("src/components/bill/BillSheet.astro", "utf8");
		// FEDERAL RESERVE NOTE：凹印黑
		assert.match(sheet, /\[data-bill-zone="Z4"\]\s*\{\s*color:\s*#151515/);
		// 序列号（上、下两处）：绿色胶印油墨
		assert.match(
			sheet,
			/\[data-bill-zone="Z3"\],[\s\S]{0,160}\[data-bill-zone="Z15"\]\s*\{\s*color:\s*#2e5a3a/,
		);
		// 顶部两条铭文：浅灰白 + 黑描影
		assert.match(
			sheet,
			/\[data-bill-zone="Z10"\],[\s\S]{0,160}\[data-bill-zone="Z23"\]\s*\{\s*color:\s*#e9e6dd/,
		);
		// 且带多层投影（颜色会在黑/深蓝之间迭代，只校验存在带透明度的 text-shadow）
		assert.match(sheet, /text-shadow:[\s\S]{0,260}rgb\(\d+ \d+ \d+ \/ 0\.\d+\)/);
	});

	test("多行铭文按行数反算字号，且法定货币铭文排成两行", async () => {
		const sheet = await readFile("src/components/bill/BillSheet.astro", "utf8");
		// 字高上限必须除以「行数 × 行距」。只除 BILL_CAP_RATIO 的话，作者写死换行的
		// 多行铭文会按单行算字号，整块上下各漫出区块（报头三行曾各溢 3 mm）。
		assert.match(sheet, /depthMm \/ \(rows \* lineHeight\)/, "字高上限未按行数折算");
		// 行高允许逐区块覆盖（三行报头要靠它把行距收到 1.0 才装得进 9.5 mm）
		assert.match(
			sheet,
			/BILL_ZONE_LINE_HEIGHT\[zone\.id\] \?\? metric\.lineHeight/,
			"解算器没有读取逐区块行高",
		);
		// 法定货币铭文：真钞就是两行，挤成一行会被横向压缩到 0.64 倍
		assert.match(sheet, /THIS NOTE IS LEGAL TENDER\\nFOR ALL DEBTS/, "法定货币铭文应为两行");
	});

	test("叠压层次：边框图 < 羽毛笔 < 徽记 < 肖像 < 像主名", async () => {
		// 整票边框图必须固定在最底层，否则会盖住肖像与铭文
		const sheet = await readFile("src/components/bill/BillSheet.astro", "utf8");
		assert.match(sheet, /\.bill__frame-art\s*\{[^}]*z-index:\s*0/, "整票边框图应固定 z-index: 0");

		// 未写 z 的区块走默认文字层 3，与 BillSheet 的 .bill__zone 默认值一致
		const z = (id: string) => DEFAULT_BILL_ZONES.find((zone) => zone.id === id)?.z ?? 3;
		assert.ok(z("Z22") < z("Z9"), `羽毛笔 ${z("Z22")} 应低于徽记 ${z("Z9")}`);
		assert.ok(z("Z9") < z("Z1"), `徽记 ${z("Z9")} 应低于肖像 ${z("Z1")}`);
		assert.ok(z("Z1") < z("Z21"), `肖像 ${z("Z1")} 应低于像主名 ${z("Z21")}`);
		// 像主名与徽记、肖像必须同时可点：z 高的那个吃指针事件
		assert.ok(z("Z1") > 3, "肖像必须高于默认文字层，才能盖住边框印刷细节");
	});
});
