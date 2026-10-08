/**
 * 量化「每个页面实际会下载多少字体」——不需要浏览器。
 *
 * 背景：`src/styles/global.css` 引入了 CJK 网络字体（LXGW WenKai，97 个子集 × 2 字重）。
 * 网络字体是按 `unicode-range` 分片下发的，所以"构建产物里有 8.8 MB 字体"和
 * "一个页面实际下载多少"是两件事。后者此前一直没被测量过，而它才是用户成本。
 *
 * 做法（确定性计算，不是抽样或估算）：
 *   1. 从构建后的 CSS 里抽出所有 `@font-face`：family / weight / src / unicode-range；
 *   2. 抓取真实页面 HTML，抽成文本，并按标签区分出「普通」「<strong>」「<em>」三类；
 *   3. 逐**码点**按该文本对应的字体栈回退，找到第一个覆盖它的 face —— 这正是浏览器
 *      的逐字符回退规则；
 *   4. 把命中到的 face 的文件体积求和。
 *
 * 字体栈按 `src/styles/global.css` 的真实赋值建模：
 *   body / .prose p → var(--font-serif-body)   @400
 *   .prose strong   → var(--font-strong)       @700
 *   .prose em       → var(--font-serif-em)
 *
 * 已知局限（会让你看到的数字**偏保守/偏大**，不会偏小）：
 *   - 不做 CSS 选择器匹配，只按上面的三条规则给文本归类；
 *   - 假定同一 family 内按请求字重精确选 face，不考虑合成粗体；
 *   - 只统计 woff2（现代浏览器不会请求 woff 回退格式）。
 *
 * 用法（先起本地服务：`npx wrangler dev --port 8792`）：
 *   node scripts/analyze-font-payload.mjs http://127.0.0.1:8792/ \
 *     http://127.0.0.1:8792/blog http://127.0.0.1:8792/blog/<slug>
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLIENT_FONT_DIR = join(ROOT, "dist", "client", "_astro");

/** 与 src/styles/global.css /Header.astro 的真实赋值保持一致。 */
const TEXT_KINDS = {
	// CJK 一律走系统字体（见 global.css），因此这里只列**网络字体**家族：
	// 西文命中 Lora / Cormorant / Space Grotesk；中文没有任何 face 覆盖它，
	// 会被记入 misses 并回退到系统字体（不产生下载）——这正是期望结果。
	body: { stack: ["Lora Variable"], weight: 400 },
	// .prose strong —— 全站唯一使用 var(--font-strong) 的选择器
	strong: { stack: ["Space Grotesk"], weight: 700 },
	// 其它 <strong>/<b> 继承 body 的 --font-serif-body，但字重是 700
	serifBold: { stack: ["Lora Variable"], weight: 700 },
	em: { stack: ["Cormorant Garamond"], weight: 400 },
};

/** 解析 `U+0-FF, U+131, U+152-153` 形式的 unicode-range。 */
function parseUnicodeRange(value) {
	const ranges = [];
	for (const part of value.split(",")) {
		const token = part.trim();
		const match = /^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?$/u.exec(token);
		if (!match) continue;
		const start = Number.parseInt(match[1].replaceAll("?", "0"), 16);
		const end = match[2] ? Number.parseInt(match[2], 16) : start;
		ranges.push([start, end]);
	}
	return ranges;
}

/** 解析 `font-weight: 400` 或 `font-weight: 100 900`。 */
function parseWeight(value) {
	const numbers = String(value).trim().split(/\s+/u).map(Number);
	if (numbers.length >= 2) return [numbers[0], numbers[1]];
	return [numbers[0], numbers[0]];
}

async function loadFontFaces() {
	const cssFiles = await readdir(join(ROOT, "dist", "client", "_astro"));
	const cssName = cssFiles.find((name) => name.startsWith("Base.") && name.endsWith(".css"));
	if (!cssName) throw new Error("未找到构建后的 Base.*.css，请先 npm run build");

	const css = await readFile(join(ROOT, "dist", "client", "_astro", cssName), "utf8");
	const faces = [];

	for (const block of css.matchAll(/@font-face\{([^}]*)\}/gu)) {
		const body = block[1];
		const family = /font-family:\s*([^;}]+)/u
			.exec(body)?.[1]
			?.trim()
			.replace(/^["']|["']$/gu, "");
		const weight = /font-weight:\s*([^;}]+)/u.exec(body)?.[1];
		const unicodeRange = /unicode-range:\s*([^;}]+)/u.exec(body)?.[1];
		const src = /url\(([^)]+\.woff2)\)/u.exec(body)?.[1];
		if (!family || !unicodeRange || !src) continue;

		const file = src.split("/").pop();
		let size = 0;
		try {
			size = (await readFile(join(CLIENT_FONT_DIR, decodeURIComponent(file)))).length;
		} catch {
			continue;
		}

		faces.push({
			family,
			weightRange: weight ? parseWeight(weight) : [400, 400],
			ranges: parseUnicodeRange(unicodeRange),
			file: decodeURIComponent(file),
			size,
		});
	}

	return { faces, cssName };
}

/** 把 HTML 抽成各类文本：普通 / .prose strong / 其它粗体 / em。 */
function extractText(html) {
	const stripped = html
		.replaceAll(/<script[\s\S]*?<\/script>/giu, " ")
		.replaceAll(/<style[\s\S]*?<\/style>/giu, " ")
		.replaceAll(/<!--[\s\S]*?-->/gu, " ");

	const buckets = { body: new Set(), strong: new Set(), serifBold: new Set(), em: new Set() };

	// 只跟踪带 class 的开标签 + 文本，足以判断「是否在 .prose 内」
	const tokenPattern = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>|([^<]+)/gu;
	const stack = [];

	const inProse = () => stack.some((entry) => entry.classes.includes("prose"));

	for (const match of stripped.matchAll(tokenPattern)) {
		const [, closing, tagName, attrs, text] = match;

		if (tagName) {
			const classes = /class\s*=\s*"([^"]*)"/iu.exec(attrs ?? "")?.[1]?.split(/\s+/u) ?? [];
			if (closing) {
				const index = stack.findLastIndex((entry) => entry.name === tagName);
				if (index !== -1) stack.splice(index, 1);
			} else {
				stack.push({ name: tagName.toLowerCase(), classes });
			}
			continue;
		}

		if (!text) continue;

		const bold = stack.some((entry) => ["strong", "b"].includes(entry.name));
		const italic = stack.some((entry) => ["em", "i"].includes(entry.name));
		const key = bold ? (inProse() ? "strong" : "serifBold") : italic ? "em" : "body";

		for (const char of text) {
			const code = char.codePointAt(0);
			if (code > 32) buckets[key].add(code);
		}
	}

	return { buckets };
}

function faceCovers(face, code) {
	return face.ranges.some(([start, end]) => code >= start && code <= end);
}

/**
 * 按 CSS 字体匹配规则在某个家族里挑出字重最接近的 face。
 *
 * 不能只做"字重精确相等"的匹配：项目**刻意没有引入粗体 CJK 字体**（见
 * src/styles/global.css 的说明），因此请求 700 时只能匹配到 400 的 face，
 * 浏览器随后自行合成粗体。精确匹配会把这类码点误判成"没有字体覆盖"，
 * 从而低估体积。
 */
function selectFace(faces, family, code, desired) {
	const candidates = faces.filter((face) => face.family === family && faceCovers(face, code));
	if (candidates.length === 0) return null;

	const atWeight = (weight) =>
		candidates.find((face) => weight >= face.weightRange[0] && weight <= face.weightRange[1]);
	const ascendingFrom = (from) =>
		candidates
			.filter((face) => face.weightRange[0] >= from)
			.sort((a, b) => a.weightRange[0] - b.weightRange[0])[0];
	const descendingFrom = (from) =>
		candidates
			.filter((face) => face.weightRange[1] <= from)
			.sort((a, b) => b.weightRange[1] - a.weightRange[1])[0];

	if (desired >= 400 && desired <= 500) {
		return (
			atWeight(desired) ?? atWeight(500) ?? descendingFrom(desired) ?? ascendingFrom(500) ?? null
		);
	}
	if (desired < 400) {
		return descendingFrom(desired) ?? ascendingFrom(desired) ?? null;
	}
	return ascendingFrom(desired) ?? descendingFrom(desired) ?? null;
}

/** 逐码点按字体栈回退，返回命中的 face 集合。 */
function resolveFaces(faces, codes, kind) {
	const { stack, weight } = TEXT_KINDS[kind];
	const hits = new Map();
	const misses = new Set();

	for (const code of codes) {
		let matched = false;
		for (const family of stack) {
			const face = selectFace(faces, family, code, weight);
			if (face) {
				hits.set(face.file, face);
				matched = true;
				break;
			}
		}
		if (!matched) misses.add(code);
	}

	return { hits: [...hits.values()], misses: [...misses] };
}

function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const urls = process.argv.slice(2);
if (urls.length === 0) {
	console.error("用法: node scripts/analyze-font-payload.mjs <url> [url...]");
	process.exit(1);
}

const { faces, cssName } = await loadFontFaces();
console.log(`\n字体表: ${faces.length} 个 woff2 face（来自 ${cssName}）`);
const totalFontBytes = faces.reduce((sum, face) => sum + face.size, 0);
console.log(`全部字体文件合计: ${formatSize(totalFontBytes)}\n`);

const byFamily = new Map();
for (const face of faces) {
	byFamily.set(face.family, (byFamily.get(face.family) ?? 0) + face.size);
}
console.log("按字体族：");
for (const [family, size] of [...byFamily].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${family.padEnd(22)} ${formatSize(size).padStart(10)}`);
}

console.log("\n按页面（模型：逐码点按字体栈回退）：");
console.log("─".repeat(104));
console.log(
	"页面".padEnd(30) +
		"正文".padStart(10) +
		"prose粗".padStart(10) +
		"其它粗".padStart(10) +
		"斜体".padStart(10) +
		"合计".padStart(10),
);

for (const url of urls) {
	let html;
	try {
		const response = await fetch(url);
		html = await response.text();
	} catch (error) {
		console.log(`${url}  抓取失败: ${error.message}`);
		continue;
	}

	const { buckets } = extractText(html);
	const perKind = {};
	const allFiles = new Map();

	for (const kind of Object.keys(TEXT_KINDS)) {
		const { hits, misses } = resolveFaces(faces, buckets[kind], kind);
		perKind[kind] = hits.reduce((sum, face) => sum + face.size, 0);
		for (const face of hits) allFiles.set(face.file, face);
		// 没有 face 覆盖的码点会回退到系统字体（不产生下载）。数量异常大通常意味着
		// 模型或解析出了问题，因此显式打印出来而不是静默略过。
		if (misses.length > 0) {
			perKind[`${kind}Misses`] = misses.length;
		}
	}

	const total = [...allFiles.values()].reduce((sum, face) => sum + face.size, 0);
	const label = url.replace(/^https?:\/\/[^/]+/u, "") || "/";
	console.log(
		label.padEnd(30) +
			formatSize(perKind.body).padStart(10) +
			formatSize(perKind.strong).padStart(10) +
			formatSize(perKind.serifBold).padStart(10) +
			formatSize(perKind.em).padStart(10) +
			formatSize(total).padStart(10),
	);
	const missNote = ["body", "strong", "serifBold", "em"]
		.filter((kind) => perKind[`${kind}Misses`])
		.map((kind) => `${kind} ${perKind[`${kind}Misses`]} 个码点回退系统字体`)
		.join("、");
	console.log(`   命中 ${allFiles.size} 个 face${missNote ? `（${missNote}）` : ""}`);
}

console.log(
	"\n说明：合计为三类命中的并集（同一个子集被多类命中时只算一次）。\n" +
		"     这是「传输前」体积；Cloudflare 会对 woff2 再次压缩，实际会更小。\n" +
		"     若要对照浏览器实测，看 DevTools → Network → 过滤 Font → 读 Transferred 列。",
);
