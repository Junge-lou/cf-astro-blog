#!/usr/bin/env node
/**
 * 媒体图片优化脚本
 *
 * 用途：把站点上过大的封面图 / 背景图压缩为 WebP，输出可直接上传 R2 的产物。
 *
 * 背景：站点部署在 Cloudflare Workers 上，Worker 运行时无法运行 sharp/libvips，
 * 且当前套餐未开通 Image Resizing（/cdn-cgi/image/ 返回 404），
 * 因此图片必须在离线环境中预先优化，再回传 R2。
 *
 * 用法：
 *   node scripts/optimize-media.mjs --status    # 体检：列出全部图片体积，标出待优化项
 *   node scripts/optimize-media.mjs --fetch     # 下载线上图片到工作目录
 *   node scripts/optimize-media.mjs --apply     # 压缩并生成上传产物 + 清单 + D1 SQL
 *   node scripts/optimize-media.mjs --fetch --apply
 *   node scripts/optimize-media.mjs --apply --mirror          # 同时镜像进仓库 media/
 *   node scripts/optimize-media.mjs --fetch --apply --only=<子串>   # 只处理匹配项
 *
 * 媒体清单由 sitemap.xml + 关键页面自动爬取得出，文章更新后新增的封面会被
 * 自动纳入，无需手工维护。`FALLBACK_MEDIA_KEYS` 仅在爬取失败时兜底。
 *
 * 可选参数：
 *   --origin=<url>     站点源，默认 https://ffaff.fun
 *   --out=<dir>        工作目录，默认 <系统临时目录>/blog-media-opt
 *   --only=<子串>      只处理 key 中包含该子串的条目（增量优化新图）
 *   --mirror           把优化后的 WebP 复制到仓库内 media/（纳入版本控制）
 *   --dry-run          只压缩和报告，不写出上传产物
 *
 * 产物：
 *   <out>/manifest.json          完整清单（体积对比、目标 key）
 *   <out>/upload/<key>           待上传的 WebP 文件（保持相对路径）
 *   <out>/upload-commands.txt    可直接执行的 wrangler 上传命令
 *   <out>/update-keys.sql        更新 D1 中图片引用的 SQL
 *   <out>/rollback-keys.sql      上一步的回滚 SQL
 *
 * 设计取舍：
 *   - 保留原文件名的“基名”，仅把扩展名换成 .webp，便于与数据库引用一一对应。
 *   - 采用「新增 key」而非覆盖旧对象：原图保留在 R2 中可随时回滚，
 *     且 .webp 是全新 URL，不受旧缓存影响。
 *   - 数据库更新使用 REPLACE() 且带 WHERE + LIKE 限定，只改动目标行。
 *     同一个 key 被多篇文章共用时（如 uploads/ 下的图），REPLACE 会自动覆盖所有行。
 *   - 背景图目标宽度 1920（原图 3840 超标；站点渲染宽度约 1184px，
 *     且该图在 CSS 中带 blur(--bg-blur)，1920 已远超可见需求）。
 *   - 封面图目标宽度 800（卡片实际渲染约 240–272px，800 可覆盖 3x 屏）。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getOpt = (name, fallback) => {
	const hit = args.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const ORIGIN = getOpt("origin", "https://ffaff.fun").replace(/\/+$/, "");
const OUT = getOpt("out", path.join(os.tmpdir(), "blog-media-opt"));
const DO_FETCH = hasFlag("fetch");
const DO_APPLY = hasFlag("apply");
const DO_STATUS = hasFlag("status");
const DRY_RUN = hasFlag("dry-run");
const DO_MIRROR = hasFlag("mirror");
/** 只处理 key 中包含该子串的条目，便于文章更新后增量优化 */
const ONLY = getOpt("only", "").trim();

/** 仓库内用于版本控制的媒体产物目录 */
const REPO_MEDIA_DIR = path.join(process.cwd(), "media");

if (!DO_FETCH && !DO_APPLY && !DO_STATUS) {
	console.error("请指定 --status、--fetch 和/或 --apply。见文件头部注释。");
	process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 体积阈值：用于 --status 体检告警
 * ------------------------------------------------------------------ */

/** 超过此体积的封面图值得优化 */
const COVER_WARN_BYTES = 120 * 1024;
/** 超过此体积的背景图值得优化 */
const BACKGROUND_WARN_BYTES = 400 * 1024;

/* ------------------------------------------------------------------ *
 * 优化规格
 * ------------------------------------------------------------------ */

// 背景图：整屏铺满，带 CSS blur 与不透明度衰减，1920 足够
const BACKGROUND_SPEC = { width: 1920, quality: 80, role: "background" };
// 封面图：卡片渲染约 240–272px 宽，800 覆盖 3x 屏
const COVER_SPEC = { width: 800, quality: 80, role: "cover" };

/**
 * 依据 R2 key 判断该图片用途，返回压缩规格。
 *
 * 注意：背景图的 key 形如 `appearance/background/<date>/<uuid>.jpg`，
 * 目录名与文件名都含有 "background"；而封面图也可能落在含 background 字样的
 * 目录下。因此这里以 **目录路径** 作为判定依据，且 background 规则必须优先于
 * cover 规则，否则背景图会被误压成封面规格。
 */
function resolveSpec(key) {
	if (key.startsWith("appearance/background/")) {
		return BACKGROUND_SPEC;
	}
	return COVER_SPEC;
}

function formatBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / 1048576).toFixed(2)} MB`;
}

function sha256(buf) {
	return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ------------------------------------------------------------------ *
 * 媒体引用清单
 *
 * 由 `discoverMediaKeys()` 从 sitemap.xml + 首页/归档/友链页 自动爬取，
 * 无需手工维护。`FALLBACK_MEDIA_KEYS` 仅在爬取失败时兜底。
 * ------------------------------------------------------------------ */

const FALLBACK_MEDIA_KEYS = [
	"appearance/background/2026-08-07/b4eba08a-4dfa-4dc8-b87a-94da44ddadcf.jpg",
	"posts/draft/cover/2026-05-13/985cf198-ca9b-46e3-868c-a7a8c0cde0cf.jpg",
	"posts/draft/cover/2026-05-21/a9f6ea89-1b25-4d8d-9492-e23ba0a79dec.png",
	"posts/post-45/cover/2026-08-23/e7e1f3ad-3830-433c-bc49-d3cde8ca099c.png",
	"posts/typora/cover/2026-08-02/4b0ed30d-24cf-4669-a1c0-06aca70d179a.png",
	"uploads/2026-05-02/25f51295-bb2e-4fac-92ef-ffcac47875c0.png",
	"uploads/2026-05-02/ab606316-9ed6-4c6a-9e51-41ac29e26be6.png",
];

const MANIFEST_PATH = path.join(OUT, "manifest.json");
const UPLOAD_DIR = path.join(OUT, "upload");

function localPathFor(key) {
	return path.join(OUT, "source", key);
}

/* ------------------------------------------------------------------ *
 * 自动发现：sitemap + 关键页面爬取
 * ------------------------------------------------------------------ */

const MEDIA_REF_RE = /\/media\/([A-Za-z0-9/_\-.]+\.(?:png|jpe?g|gif|webp|avif))/gi;

function collectRefs(html, into) {
	for (const m of html.matchAll(MEDIA_REF_RE)) {
		into.add(m[1]);
	}
}

async function tryFetchText(url) {
	try {
		const res = await fetch(url, { headers: { "user-agent": "cf-astro-blog media optimizer" } });
		if (!res.ok) return null;
		return await res.text();
	} catch {
		return null;
	}
}

/**
 * 从 sitemap.xml 取出页面列表（含全部文章页），再抓取这些页面收集 /media/ 引用。
 * 这样文章更新后新增的封面会被自动纳入，无需手工维护清单。
 */
async function discoverMediaKeys() {
	const keys = new Set();
	const pages = new Set(["/", "/blog", "/friends"]);

	// 1) sitemap 提供完整页面清单
	const sitemap = await tryFetchText(`${ORIGIN}/sitemap.xml`);
	if (sitemap) {
		for (const m of sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
			try {
				const u = new URL(m[1]);
				if (u.origin === new URL(ORIGIN).origin) pages.add(u.pathname + u.search);
			} catch {
				/* 忽略非法 URL */
			}
		}
	}

	// 2) 并行抓取（限制并发，避免给站点压力）
	const list = [...pages];
	const CONCURRENCY = 6;
	let discovered = 0;
	for (let i = 0; i < list.length; i += CONCURRENCY) {
		const batch = list.slice(i, i + CONCURRENCY);
		const results = await Promise.all(batch.map((p) => tryFetchText(`${ORIGIN}${p}`)));
		for (const html of results) {
			if (html) {
				collectRefs(html, keys);
				discovered++;
			}
		}
	}

	// 3) 归档页翻页兜底（sitemap 可能不含分页）
	for (let page = 2; page <= 5; page++) {
		const html = await tryFetchText(`${ORIGIN}/blog?page=${page}`);
		if (!html) break;
		collectRefs(html, keys);
		discovered++;
	}

	return { keys: [...keys].sort(), pageCount: discovered };
}

/* ------------------------------------------------------------------ *
 * --status：只探测体积，不下载内容
 * ------------------------------------------------------------------ */

/**
 * 用 Range 请求取回 Content-Length。
 * 注意：该 Worker 对 HEAD 不返回 Content-Length（chunked），
 * 因此必须用 `Range: bytes=0-0` 拿 200 响应里的总长度，只传输 1 字节。
 */
async function probeSize(key) {
	const res = await fetch(`${ORIGIN}/media/${key}`, { headers: { range: "bytes=0-0" } });
	if (!res.ok) return { status: res.status };
	const len = res.headers.get("content-length");
	// 必须消费响应体，否则连接不会释放
	await res.arrayBuffer();
	return {
		status: res.status,
		bytes: len ? Number.parseInt(len, 10) : null,
		contentType: res.headers.get("content-type"),
	};
}

async function runStatus(keys) {
	console.log(`\n=== 媒体体检 (origin=${ORIGIN}) ===`);
	console.log(`共发现 ${keys.length} 个被引用的媒体资源\n`);

	const rows = [];
	for (const key of keys) {
		const spec = resolveSpec(key);
		const info = await probeSize(key);
		const repoFiles = [".webp", ".avif"].map((ext) =>
			path.join(REPO_MEDIA_DIR, key.replace(/\.[^.]+$/u, ext)),
		);
		const optimizedLocal = repoFiles.find((p) => fs.existsSync(p));
		const warnAt = spec.role === "background" ? BACKGROUND_WARN_BYTES : COVER_WARN_BYTES;
		const needsWork = info.bytes != null && info.bytes > warnAt;

		rows.push({ key, ...info, role: spec.role, optimizedLocal, needsWork });
	}

	rows.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));

	let total = 0;
	let needsCount = 0;
	for (const r of rows) {
		total += r.bytes ?? 0;
		if (r.needsWork) needsCount++;
		const flag = r.needsWork ? "⚠ 待优化" : "✓";
		const opt = r.optimizedLocal
			? `已优化 ${formatBytes(fs.statSync(r.optimizedLocal).size)}`
			: "未优化";
		console.log(
			`  ${formatBytes(r.bytes ?? 0).padStart(9)}  ${flag.padEnd(8)} ${opt.padEnd(16)} [${r.role}] ${r.key}`,
		);
	}

	console.log(`\n  合计: ${formatBytes(total)}`);
	console.log(`  待优化: ${needsCount} 个`);
	if (needsCount === 0) {
		console.log("\n  所有图片体积均在阈值内。");
	} else {
		console.log("\n  执行 npm run media:optimize 进行优化。");
	}
	return rows;
}

/* ------------------------------------------------------------------ *
 * --fetch：下载线上原图
 * ------------------------------------------------------------------ */

async function fetchAll() {
	console.log(`\n=== 下载原图 (origin=${ORIGIN}) ===\n`);
	const results = [];
	for (const key of keys) {
		const url = `${ORIGIN}/media/${key}`;
		const dest = localPathFor(key);
		fs.mkdirSync(path.dirname(dest), { recursive: true });

		if (fs.existsSync(dest)) {
			const size = fs.statSync(dest).size;
			console.log(`  跳过（已存在）  ${formatBytes(size).padStart(9)}  ${key}`);
			results.push({ key, sourceBytes: size, skipped: true });
			continue;
		}

		const res = await fetch(url);
		if (!res.ok) {
			console.log(`  失败 ${res.status}  ${key}`);
			results.push({ key, error: `HTTP ${res.status}` });
			continue;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		fs.writeFileSync(dest, buf);
		console.log(`  已下载  ${formatBytes(buf.length).padStart(9)}  ${key}`);
		results.push({ key, sourceBytes: buf.length });
	}

	const total = results.reduce((s, r) => s + (r.sourceBytes || 0), 0);
	console.log(`\n原图合计: ${formatBytes(total)}  ->  ${path.join(OUT, "source")}`);
	return results;
}

/* ------------------------------------------------------------------ *
 * --apply：压缩 + 生成上传产物
 * ------------------------------------------------------------------ */

/**
 * 读取上一次运行留下的 manifest，用于 --only 增量优化时保留其余条目，
 * 确保生成的 SQL 始终覆盖全部图片，不会漏掉已优化的引用。
 */
function loadPreviousEntries() {
	if (!fs.existsSync(MANIFEST_PATH)) return [];
	try {
		const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
		return Array.isArray(prev.entries) ? prev.entries : [];
	} catch {
		return [];
	}
}

async function applyAll(keys) {
	console.log(`\n=== 压缩为 WebP ===\n`);
	const entries = [];

	for (const key of keys) {
		const src = localPathFor(key);
		if (!fs.existsSync(src)) {
			console.log(`  缺少原图，跳过: ${key}`);
			continue;
		}

		const spec = resolveSpec(key);
		const inputBuf = fs.readFileSync(src);
		const meta = await sharp(inputBuf).metadata();

		let pipeline = sharp(inputBuf).rotate(); // 依据 EXIF 自动转正
		if (meta.width && meta.width > spec.width) {
			pipeline = pipeline.resize({ width: spec.width, withoutEnlargement: true });
		}
		const outBuf = await pipeline.webp({ quality: spec.quality, effort: 5 }).toBuffer();

		// 目标 key：同目录同基名，扩展名换 .webp
		const dir = path.posix.dirname(key);
		const base = path.posix.basename(key).replace(/\.[^.]+$/u, "");
		const targetKey = `${dir}/${base}.webp`;

		const outMeta = await sharp(outBuf).metadata();
		const ratio = ((1 - outBuf.length / inputBuf.length) * 100).toFixed(1);

		console.log(
			`  ${path.basename(key)}\n` +
				`      ${meta.width}x${meta.height} ${formatBytes(inputBuf.length)}` +
				`  ->  ${outMeta.width}x${outMeta.height} ${formatBytes(outBuf.length)}  (-${ratio}%)` +
				`  [${spec.role}]`,
		);

		if (!DRY_RUN) {
			const dest = path.join(UPLOAD_DIR, targetKey);
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, outBuf);
		}

		entries.push({
			sourceKey: key,
			targetKey,
			role: spec.role,
			originalBytes: inputBuf.length,
			originalDimensions: meta.width && meta.height ? `${meta.width}x${meta.height}` : null,
			optimizedBytes: outBuf.length,
			optimizedDimensions:
				outMeta.width && outMeta.height ? `${outMeta.width}x${outMeta.height}` : null,
			contentType: "image/webp",
			sha256: sha256(outBuf),
		});
	}

	// 增量优化：把本次未处理但上次已记录的条目合并进来，
	// 保证生成的 SQL / 清单始终覆盖全部图片，不会漏条目。
	const processed = new Set(entries.map((e) => e.sourceKey));
	const carried = loadPreviousEntries().filter((e) => !processed.has(e.sourceKey));
	if (carried.length > 0) {
		console.log(`\n  合并上次清单中未处理的 ${carried.length} 个条目`);
	}

	const allEntries = [...carried, ...entries];

	const origTotal = allEntries.reduce((s, e) => s + e.originalBytes, 0);
	const optTotal = allEntries.reduce((s, e) => s + e.optimizedBytes, 0);
	const saved = origTotal ? ((1 - optTotal / origTotal) * 100).toFixed(1) : "0";

	console.log(`\n--- 汇总 ---`);
	console.log(
		`  条目数:    ${allEntries.length}${carried.length ? `（本次新处理 ${entries.length}）` : ""}`,
	);
	console.log(`  原图合计:  ${formatBytes(origTotal)}`);
	console.log(`  优化后:    ${formatBytes(optTotal)}`);
	console.log(`  减少:      ${saved}%`);

	const manifest = {
		generatedAt: new Date().toISOString(),
		origin: ORIGIN,
		summary: {
			count: allEntries.length,
			originalBytes: origTotal,
			optimizedBytes: optTotal,
			savedPercent: Number(saved),
		},
		entries: allEntries,
	};

	if (!DRY_RUN) {
		fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

		// 只为本次实际产出文件的条目生成上传命令（跳过未处理的旧条目）
		const cmds = entries.map(
			(e) =>
				`npx wrangler r2 object put blog-media/${e.targetKey} ` +
				`--file="${path.join(UPLOAD_DIR, e.targetKey)}" ` +
				`--content-type=image/webp --remote`,
		);
		const cmdFile = path.join(OUT, "upload-commands.txt");
		fs.writeFileSync(cmdFile, `${cmds.join("\n")}\n`);

		// 生成 D1 引用更新 SQL（含回滚）——始终覆盖全部条目
		const { forward, rollback } = buildKeyUpdateSql(allEntries);
		const sqlFile = path.join(OUT, "update-keys.sql");
		const rollbackFile = path.join(OUT, "rollback-keys.sql");
		fs.writeFileSync(sqlFile, forward);
		fs.writeFileSync(rollbackFile, rollback);

		console.log(`\n  清单:      ${MANIFEST_PATH}`);
		console.log(`  上传产物:  ${UPLOAD_DIR}`);
		console.log(`  上传命令:  ${cmdFile}  (${entries.length} 条)`);
		console.log(`  D1 更新:   ${sqlFile}  (${allEntries.length} 个 key)`);
		console.log(`  D1 回滚:   ${rollbackFile}`);

		if (DO_MIRROR) {
			mirrorToRepo(entries.length > 0 ? entries : allEntries);
		}
	}

	return manifest;
}

/* ------------------------------------------------------------------ *
 * D1 引用更新
 * ------------------------------------------------------------------ */

/** SQL 字符串转义：单引号翻倍 */
function sqlStr(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 生成把图片引用从旧 key 改为新 key 的 SQL。
 *
 * 两个表、三种列：
 *   blog_posts.featured_image_key          封面图
 *   blog_posts.background_image_key        文章级自定义背景（本批没有，但一并覆盖）
 *   site_appearance_settings.background_image_key  站点级背景图
 *
 * 更新策略：REPLACE(col, 'old', 'new') + WHERE col LIKE '%old%'
 *   - 同一个 key 被多篇文章共用时，一次 REPLACE 会同时更新所有行（这正是需要的）。
 *   - WHERE 限制只扫描引用了该 key 的行，避免全表写入。
 *   - 只改 *_image_key 列，不碰 content 正文，因此正文里即使出现同名字符串也不受影响。
 */
function buildKeyUpdateSql(entries) {
	const forwardParts = [];
	const rollbackParts = [];

	for (const e of entries) {
		const oldKey = e.sourceKey;
		const newKey = e.targetKey;
		for (const col of ["featured_image_key", "background_image_key"]) {
			forwardParts.push(
				`UPDATE blog_posts SET ${col} = REPLACE(${col}, ${sqlStr(oldKey)}, ${sqlStr(newKey)}) ` +
					`WHERE ${col} LIKE ${sqlStr(`%${oldKey}%`)};`,
			);
			rollbackParts.push(
				`UPDATE blog_posts SET ${col} = REPLACE(${col}, ${sqlStr(newKey)}, ${sqlStr(oldKey)}) ` +
					`WHERE ${col} LIKE ${sqlStr(`%${newKey}%`)};`,
			);
		}
		forwardParts.push(
			`UPDATE site_appearance_settings SET background_image_key = REPLACE(background_image_key, ${sqlStr(oldKey)}, ${sqlStr(newKey)}) ` +
				`WHERE background_image_key LIKE ${sqlStr(`%${oldKey}%`)};`,
		);
		rollbackParts.push(
			`UPDATE site_appearance_settings SET background_image_key = REPLACE(background_image_key, ${sqlStr(newKey)}, ${sqlStr(oldKey)}) ` +
				`WHERE background_image_key LIKE ${sqlStr(`%${newKey}%`)};`,
		);
	}

	const header = (title) =>
		[
			`-- ${title}`,
			`-- 由 scripts/optimize-media.mjs 生成于 ${new Date().toISOString()}`,
			`-- 执行: npx wrangler d1 execute blog --remote --file=<本文件>`,
			`-- 注意: 请先完成 R2 上传（upload-commands.txt），否则引用会指向不存在的对象。`,
			"",
		].join("\n");

	return {
		forward: `${header("图片引用更新（旧 -> 新）")}${forwardParts.join("\n")}\n`,
		rollback: `${header("回滚（新 -> 旧）")}${rollbackParts.join("\n")}\n`,
	};
}

/* ------------------------------------------------------------------ *
 * 仓库镜像：把产物纳入版本控制，避免只存在于临时目录
 * ------------------------------------------------------------------ */

function mirrorToRepo(entries) {
	console.log(`\n=== 镜像到仓库 ${REPO_MEDIA_DIR} ===\n`);
	for (const e of entries) {
		const src = path.join(UPLOAD_DIR, e.targetKey);
		const dest = path.join(REPO_MEDIA_DIR, e.targetKey);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(src, dest);
		console.log(`  ${formatBytes(e.optimizedBytes).padStart(9)}  media/${e.targetKey}`);
	}
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

fs.mkdirSync(OUT, { recursive: true });
console.log(`工作目录: ${OUT}`);

// 1) 自动发现全站引用的媒体
let keys = [];
if (DO_STATUS || DO_FETCH || DO_APPLY) {
	console.log(`\n=== 发现媒体引用 (${ORIGIN}) ===`);
	const discovered = await discoverMediaKeys();
	if (discovered.keys.length > 0) {
		keys = discovered.keys;
		console.log(`  扫描 ${discovered.pageCount} 个页面，发现 ${keys.length} 个媒体资源`);
	} else {
		keys = FALLBACK_MEDIA_KEYS;
		console.log(`  爬取失败，回退到内置清单（${keys.length} 个）`);
	}
}

// 2) --only 增量过滤
if (ONLY) {
	const before = keys.length;
	keys = keys.filter((k) => k.includes(ONLY));
	console.log(`  --only="${ONLY}" 过滤: ${before} -> ${keys.length}`);
	if (keys.length === 0) {
		console.error(`\n没有匹配 "${ONLY}" 的媒体资源。`);
		process.exit(1);
	}
}

// 3) 执行各模式
if (DO_STATUS) await runStatus(keys);
if (DO_FETCH) await fetchAll(keys);
if (DO_APPLY) await applyAll(keys);

console.log("\n完成。");
