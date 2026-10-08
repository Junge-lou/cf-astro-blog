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
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const DIST_DIR = resolve(import.meta.dirname ?? ".", "..", "dist");
const SNAPSHOT_FILE = resolve(import.meta.dirname ?? ".", "..", "meta", ".build-snapshot.json");
const OUTPUT_JSON = process.argv.includes("--json");

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 递归收集目录下所有文件信息 */
async function collectFiles(dir, base = dir) {
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

/** 人类可读的文件大小（支持负数：先取绝对值定单位，再补符号） */
function formatSize(bytes) {
	if (!Number.isFinite(bytes)) return "n/a";
	if (bytes === 0) return "0 B";
	const negative = bytes < 0;
	const units = ["B", "KB", "MB", "GB"];
	const abs = Math.abs(bytes);
	const i = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), units.length - 1);
	const text = `${(abs / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
	return negative ? `-${text}` : text;
}

/** 统计某个子树的大小（子树不存在时返回 null） */
async function measureSubtree(dir) {
	try {
		const files = await collectFiles(dir);
		return {
			size: files.reduce((sum, f) => sum + f.size, 0),
			count: files.length,
		};
	} catch {
		return null;
	}
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

	// Worker 包体只由 dist/server 决定；字体、CSS 是静态资源，由 assets 层直接
	// 下发，不进 Worker。此前这里拿**整站** dist 体积去和 10 MB 比较，于是十几 MB
	// 的字体被误报成"Worker 体积超标"，会把人引向错误的优化方向。
	const server = await measureSubtree(join(DIST_DIR, "server"));
	const client = await measureSubtree(join(DIST_DIR, "client"));

	// 加载上次快照用于对比
	const prev = await loadSnapshot();
	let diffText = "";

	if (prev?.totalSize) {
		const delta = totalSize - prev.totalSize;
		const deltaPercent = prev.totalSize > 0 ? ((delta / prev.totalSize) * 100).toFixed(2) : "0";
		const sign = delta >= 0 ? "+" : "";
		diffText = ` (${sign}${formatSize(delta)}, ${sign}${deltaPercent}%)`;
	}

	if (OUTPUT_JSON) {
		console.log(
			JSON.stringify(
				{
					totalSize,
					totalFiles: files.length,
					// 拆分上报：Worker 包体只看 serverSize，静态资源看 clientSize
					serverSize: server?.size ?? null,
					clientSize: client?.size ?? null,
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
		console.log(`  总文件数：  ${files.length}`);
		if (server) {
			console.log(`  Worker：    ${formatSize(server.size)}  (dist/server, ${server.count} 文件)`);
		}
		if (client) {
			console.log(`  静态资源：  ${formatSize(client.size)}  (dist/client, ${client.count} 文件)`);
		}
		console.log("");

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
		let hasAdvice = false;

		// 字体：子集化之后单个文件都很小，按"字体总体积"判断才有意义
		const fontBytes = categories
			.filter((c) => ["woff", "woff2", "ttf", "otf"].includes(c.ext))
			.reduce((sum, c) => sum + c.totalSize, 0);
		if (fontBytes > 2 * 1024 * 1024) {
			hasAdvice = true;
			console.log(`  ⚠ 字体产物合计 ${formatSize(fontBytes)}，考虑子集化或改用系统字体回退`);
		}

		// public/ 的 .js 是浏览器下载量，dist/server 的 .mjs 是 Worker 包体，
		// 两者优化手段完全不同，必须分开判断。
		const publicJs = categories
			.filter((c) => c.ext === "js")
			.reduce((sum, c) => sum + c.totalSize, 0);
		const serverJs = categories
			.filter((c) => c.ext === "mjs")
			.reduce((sum, c) => sum + c.totalSize, 0);
		if (publicJs > 500 * 1024) {
			hasAdvice = true;
			console.log(`  ⚠ public/ 客户端 JS 合计 ${formatSize(publicJs)}，考虑打包压缩与内容哈希`);
		}
		if (serverJs > 3 * 1024 * 1024) {
			hasAdvice = true;
			console.log(`  ⚠ Worker 服务端 JS 合计 ${formatSize(serverJs)}，这是包体的主要占用`);
		}

		// Worker 体积只看 dist/server。平台上限按**压缩后**包体计算，因此这里
		// 只在未压缩体积明显偏大时提示，真实数值以 wrangler deploy 输出为准。
		if (server && server.size > 10 * 1024 * 1024) {
			hasAdvice = true;
			console.log(`  ⚠ Worker 服务端产物（未压缩）${formatSize(server.size)}，已超过 10 MB 量级`);
			console.log("     平台上限按压缩后包体计算，请以 `wrangler deploy` 的输出为准");
		}

		if (!hasAdvice) {
			console.log("  ✓ 未发现明显体积问题");
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
