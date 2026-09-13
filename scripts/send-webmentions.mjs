// 从 D1 生成 RSS，然后用 @remy/webmention 自动向外发送 Webmention
// --remote / --local：D1 读取模式
// --slug=xxx：只处理指定文章（发文触发时使用，精准发送）
// 默认：处理最近 LIMIT 篇（部署后补发 / 手动重试）
import { execSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const ROOT_DIR = process.cwd();
const BIN_DIR = join(ROOT_DIR, "node_modules", ".bin");
const IS_WINDOWS = process.platform === "win32";
const WRANGLER = join(BIN_DIR, IS_WINDOWS ? "wrangler.cmd" : "wrangler");
const WM = join(BIN_DIR, IS_WINDOWS ? "wm.cmd" : "wm");

const BASE_QUERY =
	"SELECT p.title AS title, p.slug AS slug, p.excerpt AS excerpt, p.content AS content, p.published_at AS publishedAt, p.updated_at AS updatedAt FROM blog_posts p WHERE (p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at IS NOT NULL AND p.publish_at <= datetime('now')))";

const SITE_URL = "https://ffaff.fun";
const SITE_NAME = "Kiwi 的博客";
const SITE_DESC = "记录 生活";
const SITE_LANG = "zh-CN";
const LIMIT = 5;

function escapeXml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function escapeSqlString(value) {
	// wrangler d1 --command 不支持绑定参数，单引号翻倍转义防止注入/语法错误
	return String(value).replaceAll("'", "''");
}

function encodeSlug(slug) {
	return encodeURIComponent(slug);
}

function toRssDate(value) {
	if (!value) return null;
	const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toUTCString();
}

// 渲染为安全 HTML：与站点正文一致地清洗，wm 工具从中扫描 <a href> 外链
function renderContentHtml(content) {
	const raw = String(content || "").trim();
	if (!raw) {
		return "";
	}

	const html = marked.parse(raw, { async: false });
	return sanitizeHtml(html, {
		allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
		allowedAttributes: {
			a: ["href", "title", "rel", "target"],
			img: ["src", "alt", "title", "loading", "decoding"],
		},
	});
}

async function main() {
	const forceRemote = process.argv.includes("--remote");
	const mode = forceRemote ? "--remote" : "--local";
	const slugArg = process.argv.find((arg) => arg.startsWith("--slug="));
	const targetSlug = slugArg ? slugArg.slice("--slug=".length).trim() : "";

	let query = BASE_QUERY;
	if (targetSlug) {
		query += ` AND p.slug = '${escapeSqlString(targetSlug)}'`;
	}
	query += " ORDER BY COALESCE(p.published_at, p.updated_at, p.created_at) DESC LIMIT 30;";

	console.log(
		targetSlug
			? `[Webmention Send] 从 D1 读取指定文章（slug=${targetSlug}）...`
			: "[Webmention Send] 从 D1 读取文章列表...",
	);
	let posts = [];
	try {
		const raw = execSync(
			`"${WRANGLER}" d1 execute DB ${mode} --command "${query.replaceAll('"', '\\"')}" --json`,
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
		);
		const result = JSON.parse(raw);
		posts = (result[0]?.results ?? []).map((row) => ({
			title: row.title,
			slug: row.slug,
			excerpt: row.excerpt,
			content: row.content,
			publishedAt: row.publishedAt,
			updatedAt: row.updatedAt,
		}));
	} catch (err) {
		console.error("[Webmention Send] D1 读取失败，跳过发送。", err.message);
		process.exit(0);
	}

	if (posts.length === 0) {
		console.log(
			targetSlug
				? `[Webmention Send] 未找到文章（slug=${targetSlug}），跳过。`
				: "[Webmention Send] 没有已发布文章，跳过。",
		);
		process.exit(0);
	}

	const now = new Date().toUTCString();
	const items = posts
		.map((post) => {
			const url = `${SITE_URL}/blog/${encodeSlug(post.slug)}`;
			const pubDate = toRssDate(post.publishedAt) || toRssDate(post.updatedAt) || now;
			// 全文渲染为安全 HTML：wm 工具可发现正文任意位置的外链，
			// 不再局限于摘要前 220 字符
			const html = renderContentHtml(post.content);
			return `<item>
	<title>${escapeXml(post.title)}</title>
	<link>${url}</link>
	<guid isPermaLink="true">${url}</guid>
	<description>${escapeXml(html)}</description>
	<pubDate>${pubDate}</pubDate>
</item>`;
		})
		.join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
	<title>${escapeXml(SITE_NAME)}</title>
	<link>${SITE_URL}</link>
	<description>${escapeXml(SITE_DESC)}</description>
	<language>${SITE_LANG}</language>
	<atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
	<lastBuildDate>${now}</lastBuildDate>
	${items}
</channel>
</rss>`;

	const tmpFile = join(ROOT_DIR, ".webmention-rss-tmp.xml");
	await writeFile(tmpFile, rss.trim(), "utf-8");
	console.log(`[Webmention Send] 已生成临时 RSS（${posts.length} 篇文章，全文渲染）`);

	const wmLimit = targetSlug ? 1 : Math.min(LIMIT, posts.length);
	try {
		console.log(
			targetSlug
				? `[Webmention Send] 扫描指定文章的正文外链并发送 Webmention...`
				: `[Webmention Send] 扫描最近 ${wmLimit} 篇文章的正文外链并发送 Webmention...`,
		);
		execSync(`"${WM}" "${tmpFile}" --limit ${wmLimit} --send`, {
			encoding: "utf-8",
			stdio: "inherit",
		});
	} catch (err) {
		console.error("[Webmention Send] 发送过程出错：", err.message);
	} finally {
		await unlink(tmpFile).catch(() => {});
	}

	console.log("[Webmention Send] 完成。");
}

main();
