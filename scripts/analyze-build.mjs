/**
 * 生产构建产物分析脚本
 *
 * 用法：
 *   node scripts/analyze-build.mjs          # 分析 dist/ 目录
 *   node scripts/analyze-build.mjs --json   # 输出 JSON 格式
 *
 * 输出：
 *   - 总体大小与文件数量
 *   - 按类型分组的体积占比
 *   - Top-10 最大文件列表
 *   - 与上次构建的差异对比（若存在 .build-snapshot.json）
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const DIST_DIR = resolve(import.meta.dirname ?? ".", "..", "dist");
const SNAPSHOT_FILE = resolve(import.meta.dirname ?? ".", "..", "meta", ".build-snapshot.json");
const OUTPUT_JSON = process.argv.includes("--json");

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 递归收集目录下所有文件信息 */
async function collectFiles(
	dir,
	base = dir,
) {
	const entries = [];
	const items = await readdir(dir, { withFileTypes: true });

	for (const item of items) {
		const fullPath = join(dir, item.name);
		if (item.isDirectory()) {
			entries.push(...(await collectFiles(fullPath, base)));
		} else if (item.isFile()) {
			const info = await stat(fullPath);
			entries.push({
				path: fullPath,
				relativePath: relative(base, fullPath),
				size: info.size,
			});
		}
	}

	return entries;
}

/** 按扩展名分类 */
function categorizeByExt(files) {
	const groups = new Map();

	for (const file of files) {
		const ext = file.relativePath.split(".").pop()?.toLowerCase() || "other";
		const existing = groups.get(ext) || { ext, count: 0, totalSize: 0 };
		existing.count++;
		existing.totalSize += file.size;
		groups.set(ext, existing);
	}

	return [...groups.values()].sort((a, b) => b.totalSize - a.totalSize);
}

/** 人类可读的文件大小 */
function formatSize(bytes) {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/** 加载上次快照 */
async function loadSnapshot() {
	try {
		const raw = await readFile(SNAPSHOT_FILE, "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
	const files = await collectFiles(DIST_DIR);
	const totalSize = files.reduce((sum, f) => sum + f.size, 0);
	const categories = categorizeByExt(files);
	const topFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 10);

	// 加载上次快照用于对比
	const prev = await loadSnapshot();
	let diffText = "";

	if (prev?.totalSize) {
		const delta = totalSize - prev.totalSize;
		const deltaPercent = prev.totalSize > 0
			? ((delta / prev.totalSize) * 100).toFixed(2)
			: "0";
		const sign = delta >= 0 ? "+" : "";
		diffText = ` (${sign}${formatSize(delta)}, ${sign}${deltaPercent}%)`;
	}

	if (OUTPUT_JSON) {
		console.log(
			JSON.stringify(
				{
					totalSize,
					totalFiles: files.length,
					categories,
					topFiles: topFiles.map((f) => ({ path: f.relativePath, size: f.size })),
					previousSize: prev?.totalSize ?? null,
				},
				null,
				2,
			),
		);
	} else {
		console.log("\n╔══════════════════════════════════════════════╗");
		console.log("║        📦 构建产物分析报告                    ║");
		console.log("╚══════════════════════════════════════════════╝\n");

		console.log(`  总大小：    ${formatSize(totalSize)}${diffText}`);
		console.log(`  总文件数：  ${files.length}\n`);

		console.log("  ── 按类型分布 ──");
		for (const cat of categories) {
			const pct = ((cat.totalSize / totalSize) * 100).toFixed(1);
			console.log(
				`  .${cat.ext.padEnd(8)} ${formatSize(cat.totalSize).padStart(10)}  ${pct.padStart(6)}%  (${cat.count} 文件)`,
			);
		}

		console.log("\n  ── Top 10 最大文件 ──");
		for (const file of topFiles) {
			console.log(`  ${formatSize(file.size).padStart(10)}  ${file.relativePath}`);
		}

		console.log("\n  ── 建议 ──");
		if (topFiles.some((f) => f.relativePath.endsWith(".woff2") && f.size > 1024 * 1024)) {
			console.log("  ⚠ 存在大体积字体文件，考虑使用子集化或 CDN 加载");
		}
		if (totalSize > 10 * 1024 * 1024) {
			console.log("  ⚠ Worker 体积超过 10 MB，Cloudflare 免费计划限制 1 MB");
			console.log("     考虑拆分为多个 Worker 或减少依赖");
		}
		const jsFiles = categories.find((c) => c.ext === "js" || c.ext === "mjs");
		if (jsFiles && jsFiles.totalSize > 500 * 1024) {
			console.log("  ⚠ JS 总体积较大，考虑 tree-shaking 和代码分割");
		}
		console.log("");
	}

	// 保存快照
	const snapshot = {
		timestamp: new Date().toISOString(),
		totalSize,
		totalFiles: files.length,
		categories: categories.map((c) => ({ ext: c.ext, count: c.count, totalSize: c.totalSize })),
	};
	await mkdir(dirname(SNAPSHOT_FILE), { recursive: true });
	await writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
	console.error("分析失败:", err.message);
	process.exit(1);
});
