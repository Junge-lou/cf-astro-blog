#!/usr/bin/env node
/**
 * 票面组件图处理流水线：`.reference/zujian2/` → `public/bill/`。
 *
 * 每张图的处理顺序（见 docs/bill-image-components-plan.md §5.2）：
 *   1. 保留 alpha 通道
 *   2. 按 alpha 边界裁掉透明留白（不裁会导致 contain 后画面明显偏小）
 *   3. 清掉 alpha < 24 的噪点并把全透明像素的 RGB 归零（编码体积大头）
 *   4. 缩到 2× 显示尺寸（票面渲染宽 1184px ≈ 7.59 px/mm）
 *   5. 导出 WebP（q85 起逐档降质；仍超 80 KB 则按 0.85 / 0.7 / 0.6 缩小尺寸重试）
 *
 * 体积红线：单张 ≤ 80 KB，全部合计 ≤ 400 KB，超限脚本以非零码退出。
 *
 * 用法：
 *   node scripts/prepare-bill-art.mjs
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, ".reference", "zujian2");
const OUT = path.join(ROOT, "public", "bill");

const MAX_SINGLE_KB = 80;
const MAX_TOTAL_KB = 400;
/** 从 85 开始逐档降质（plan §11：超限先降 q） */
const QUALITY_LADDER = [85, 78, 70, 62, 55, 48, 40, 32, 25];
/** 降质阶梯用尽后按此缩小目标尺寸重试（实测：雕版密布线条的图 q 降到底也压不进 80KB） */
const SCALE_LADDER = [1, 0.85, 0.7, 0.6];

/**
 * @typedef {Object} ArtTask
 * @property {string} source 源文件名（.reference/zujian2/ 下）
 * @property {string} out 输出文件名（public/bill/ 下）
 * @property {number} width 2× 目标宽（px）
 * @property {number} height 2× 目标高（px）
 * @property {"inside"|"fill"} fit inside=等比装进盒子；fill=精确拉伸（仅整票边框）
 * @property {{top:number, height:number}|null} slice 先按纵向区间切条（签名图是上下两组）
 */

/** @type {ArtTask[]} 目标尺寸对应 plan §5.3 的 2× 输出表 */
const TASKS = [
	// 整票边框：比例 2.37 vs 票面 2.353，横向差 0.7%，直接拉伸可接受
	{ source: "边框.png", out: "frame.webp", width: 2400, height: 1020, fit: "fill", slice: null },
	{ source: "头像.png", out: "portrait.webp", width: 720, height: 900, fit: "inside", slice: null },
	{
		source: "doubao_image_5.png",
		out: "denom-100.webp",
		width: 420,
		height: 300,
		fit: "inside",
		slice: null,
	},
	{
		source: "doubao_image_6.png",
		out: "seal.webp",
		width: 340,
		height: 300,
		fit: "inside",
		slice: null,
	},
	// 签名图源图是上下两组「手写签名 + 印刷职衔」（第一组 y≈0–560，第二组 y≈630–1088），
	// 在 y=595 处切开——中间是组间空白，不会切到笔画
	{
		source: "doubao_image_1.png",
		out: "signature-1.webp",
		width: 360,
		height: 110,
		fit: "inside",
		slice: { top: 0, height: 595 },
	},
	{
		source: "doubao_image_1.png",
		out: "signature-2.webp",
		width: 380,
		height: 110,
		fit: "inside",
		slice: { top: 595, height: 493 },
	},
	{
		source: "Layer 5.png",
		out: "inkwell.webp",
		width: 230,
		height: 230,
		fit: "inside",
		slice: null,
	},
	// 羽毛笔：区块放大到整根羽毛（23 × 24 mm，见 ref 实测 30.9×28.8 的羽毛主体部分），
	// 2× 目标 ≈ 349 × 364 px
	{
		source: "doubao_image_7.png",
		out: "quill.webp",
		width: 360,
		height: 340,
		fit: "inside",
		slice: null,
	},
	// 铜色大号 100（右下角，实测墨迹 119.8–142.0 / 53.0–60.0 mm）→ 2× ≈ 337 × 106 px
	{
		source: "doubao_image_4.png",
		out: "big-100.webp",
		width: 340,
		height: 106,
		fit: "inside",
		slice: null,
	},
];

/**
 * 第一阶段：切条（签名图）→ 按 alpha 裁边 → 清理透明噪点，输出中间 PNG buffer。
 * 注意切条与裁边必须分两条流水线：sharp 内部会把 trim 排到 extract 之前，
 * 串在同一条流水线里 extract 的坐标会按裁边后的尺寸校验而报错。
 */
async function cutAndTrim(task) {
	let pipeline = sharp(path.join(SRC, task.source), { limitInputPixels: false });

	if (task.slice) {
		const meta = await pipeline.metadata();
		const cut = await pipeline
			.extract({
				left: 0,
				top: task.slice.top,
				width: meta.width ?? 0,
				height: task.slice.height,
			})
			.png()
			.toBuffer();
		pipeline = sharp(cut);
	}

	// 以左上角像素（透明）为基准裁边
	const trimmed = await pipeline.trim({ threshold: 10 }).png().toBuffer();

	// 透明噪点清零：alpha < 24 的像素连同 RGB 一起归零。
	// 生成图的透明区常带一层稀薄噪声，WebP 会认真编码它们，白白吃掉几十 KB。
	const { data, info } = await sharp(trimmed)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 24) {
			data[i - 3] = 0;
			data[i - 2] = 0;
			data[i - 1] = 0;
			data[i] = 0;
		}
	}
	return sharp(data, {
		raw: { width: info.width, height: info.height, channels: 4 },
	})
		.png()
		.toBuffer();
}

/** 第二阶段：缩放 + WebP；先降质、再降尺寸，取第一个压进 80 KB 的组合。 */
async function encode(trimmed, task) {
	for (const scale of SCALE_LADDER) {
		const width = Math.round(task.width * scale);
		const height = Math.round(task.height * scale);
		for (const quality of QUALITY_LADDER) {
			const buffer = await sharp(trimmed)
				.resize(width, height, {
					fit: task.fit,
					// 等比缩小时不放大原图（小图放大只会糊）
					withoutEnlargement: task.fit === "inside",
				})
				.webp({ quality, alphaQuality: 50, smartSubsample: true, effort: 6 })
				.toBuffer();
			if (buffer.byteLength / 1024 <= MAX_SINGLE_KB) {
				return { buffer, quality, scale };
			}
		}
	}
	// 阶梯用尽：返回最小尺寸的最低质量，由调用方标记超限
	const scale = SCALE_LADDER[SCALE_LADDER.length - 1];
	const quality = QUALITY_LADDER[QUALITY_LADDER.length - 1];
	const buffer = await sharp(trimmed)
		.resize(Math.round(task.width * scale), Math.round(task.height * scale), {
			fit: task.fit,
			withoutEnlargement: task.fit === "inside",
		})
		.webp({ quality, alphaQuality: 50, smartSubsample: true, effort: 6 })
		.toBuffer();
	return { buffer, quality, scale };
}

async function processOne(task) {
	const trimmed = await cutAndTrim(task);
	const { buffer, quality, scale } = await encode(trimmed, task);

	const outPath = path.join(OUT, task.out);
	await writeFile(outPath, buffer);

	const kb = (await stat(outPath)).size / 1024;
	const meta = await sharp(outPath).metadata();
	return { out: task.out, kb, width: meta.width ?? 0, height: meta.height ?? 0, quality, scale };
}

async function main() {
	await mkdir(OUT, { recursive: true });

	let totalKb = 0;
	let oversized = false;
	console.log("组件图处理结果：");
	for (const task of TASKS) {
		const result = await processOne(task);
		totalKb += result.kb;
		const over = result.kb > MAX_SINGLE_KB;
		if (over) {
			oversized = true;
		}
		const scaled = result.scale < 1 ? `（已缩到 ${result.scale}×）` : "";
		console.log(
			`  ${result.out.padEnd(18)} ${String(result.width).padStart(4)}×${result.height}  q${result.quality}  ${result.kb.toFixed(1)} KB${scaled}${over ? "  ⚠ 仍超 80KB" : ""}`,
		);
	}
	console.log(`  合计 ${totalKb.toFixed(1)} KB（上限 ${MAX_TOTAL_KB} KB）`);

	if (oversized || totalKb > MAX_TOTAL_KB) {
		console.error("体积超限：降质/降尺寸阶梯已用尽，需要人工权衡。");
		process.exitCode = 1;
	}
}

await main();
