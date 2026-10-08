/**
 * 冒烟测试:对**运行中的**站点做端到端核查。
 *
 * 为什么需要它:这个项目里最贵的两类问题都只有把服务跑起来才能发现 ——
 *   1. `public/_headers` 的格式错误(14/17 条规则被平台静默丢弃,文件看起来完全正常);
 *   2. 边缘缓存键把查询串丢掉,导致 `/blog?category=X` 的渲染结果污染 `/blog`。
 * 单测覆盖不到这两类,因为它们依赖平台行为与真实请求链路。
 *
 * 用法:
 *   npx wrangler dev --port 8787        # 另开一个终端
 *   node scripts/smoke-test.mjs                  # 默认 http://127.0.0.1:8787
 *   node scripts/smoke-test.mjs https://你的域名    # 也可以直接打线上
 *
 * 退出码非 0 表示有检查失败,因此可以直接用作部署后的门禁。
 */
const BASE = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:8787").replace(
	/\/+$/u,
	"",
);

/** 归档页在"没有匹配文章"时渲染的文案，用来识别空态。 */
const EMPTY_ARCHIVE_SENTINEL = "还没有已发布文章";

const results = [];

function record(name, ok, detail) {
	results.push({ name, ok, detail });
	const mark = ok ? "✓" : "✗";
	console.log(`${mark} ${name}${detail ? `  — ${detail}` : ""}`);
}

async function fetchText(path) {
	const response = await fetch(`${BASE}${path}`);
	return { response, text: await response.text() };
}

function headerOf(response, name) {
	return response.headers.get(name) ?? "";
}

// ── 1. 基础可用性 ────────────────────────────────────────────────────────────
const ROUTES = [
	"/",
	"/blog",
	"/friends",
	"/search",
	"/shuoshuo",
	"/rss.xml",
	"/sitemap.xml",
	"/robots.txt",
];
for (const path of ROUTES) {
	try {
		const { response } = await fetchText(path);
		record(`GET ${path} 返回 200`, response.status === 200, `status=${response.status}`);
	} catch (error) {
		record(`GET ${path} 返回 200`, false, `请求失败: ${error.message}`);
	}
}

// ── 2. 缓存键不变量（这是修复过的真实缺陷）─────────────────────────────────
{
	// 必须用**合法但不存在的**分类 slug 来制造空态。
	// 注意别用下划线等非法字符：那会被 sanitizeSlug 归一化掉、按"无筛选"渲染全量
	// 归档（这是有意设计，不是 bug），于是根本构造不出空态、也就测不到污染。
	const baseline = await fetchText("/blog");
	const poisoned = await fetchText("/blog?category=smoke-nonexistent-xyz");
	const afterPoison = await fetchText("/blog");

	const poisonWasEmpty = poisoned.text.includes(EMPTY_ARCHIVE_SENTINEL);
	const baselineHasPosts = !baseline.text.includes(EMPTY_ARCHIVE_SENTINEL);

	record(
		"归档空态只写进它自己的缓存键，不污染 /blog",
		poisonWasEmpty && baselineHasPosts && !afterPoison.text.includes(EMPTY_ARCHIVE_SENTINEL),
		`poison=${poisoned.text.length}B baseline=${baseline.text.length}B after=${afterPoison.text.length}B`,
	);
}

// ── 3. 非法分页参数归一化到第 1 页（旧实现会渲染出空归档）─────────────────
{
	const plain = await fetchText("/blog");
	const badPage = await fetchText("/blog?page=abc");
	record(
		"非法 page 参数渲染第 1 页而不是空归档",
		!badPage.text.includes(EMPTY_ARCHIVE_SENTINEL) && badPage.text.length === plain.text.length,
		`plain=${plain.text.length}B badPage=${badPage.text.length}B`,
	);
}

// ── 4. 边缘缓存链路 ──────────────────────────────────────────────────────────
{
	await fetchText("/blog");
	const { response } = await fetchText("/blog");
	const status = headerOf(response, "x-edge-cache");
	record("第二次请求命中边缘缓存", status === "HIT", `X-Edge-Cache=${status || "(缺失)"}`);
}

// ── 5. 安全头 ────────────────────────────────────────────────────────────────
{
	const html = await fetchText("/");
	record("HTML 页面带 CSP", headerOf(html.response, "content-security-policy") !== "");
	record(
		"HTML 页面带 X-Content-Type-Options",
		headerOf(html.response, "x-content-type-options") === "nosniff",
	);

	const api = await fetchText("/api/health");
	record("健康检查可用", api.response.status === 200, `status=${api.response.status}`);
	record(
		"/api/* 不加 CSP（与中间件设计一致）",
		headerOf(api.response, "content-security-policy") === "",
	);
}

// ── 6. 静态资源缓存（_headers 是否被平台真正接受）──────────────────────────
{
	const asset = await fetch(`${BASE}/favicon.svg`);
	const cacheControl = headerOf(asset, "cache-control");
	record(
		"public/ 静态资源命中 _headers 的缓存规则",
		cacheControl.includes("max-age=86400"),
		`Cache-Control=${cacheControl || "(缺失)"}`,
	);

	const script = await fetch(`${BASE}/theme.js`);
	const scriptCache = headerOf(script, "cache-control");
	record(
		"public/ 下的脚本带长缓存（_headers 每个路径必须紧跟自己的缩进块）",
		scriptCache.includes("max-age=86400"),
		`Cache-Control=${scriptCache || "(缺失)"}`,
	);
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length > 0) {
	console.error("\n失败项:");
	for (const item of failed) {
		console.error(`  ✗ ${item.name}${item.detail ? `  — ${item.detail}` : ""}`);
	}
	process.exit(1);
}
