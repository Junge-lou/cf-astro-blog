// 从 D1 生成 RSS，然后用 @remy/webmention 自动向外发送 Webmention
import { execSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const BIN_DIR = join(ROOT_DIR, "node_modules", ".bin");
const WRANGLER = join(
	BIN_DIR,
	process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

const RSS_QUERY = "SELECT p.title AS title, p.slug AS slug, p.excerpt AS excerpt, p.content AS content, p.published_at AS publishedAt, p.updated_at AS updatedAt FROM blog_posts p WHERE p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at IS NOT NULL AND p.publish_at <= datetime('now')) ORDER BY COALESCE(p.published_at, p.updated_at, p.created_at) DESC LIMIT 30;";

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

async function main() {
	const forceRemote = process.argv.includes("--remote");
	const mode = forceRemote ? "--remote" : "--local";

	console.log("[Webmention Send] 从 D1 读取文章列表...");
	let posts = [];
	try {
		const raw = execSync(
			`"${WRANGLER}" d1 execute DB ${mode} --command "${RSS_QUERY.replaceAll('"', '\\"')}" --json`,
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
		console.log("[Webmention Send] 没有已发布文章，跳过。");
		process.exit(0);
	}

	const now = new Date().toUTCString();
	const items = posts
		.map((post) => {
			const url = `${SITE_URL}/blog/${encodeSlug(post.slug)}`;
			const pubDate = toRssDate(post.publishedAt) || toRssDate(post.updatedAt) || now;
			const raw = (post.excerpt?.trim() || post.content?.trim() || "").replace(/\s+/g, " ").slice(0, 220);
			return `<item>
	<title>${escapeXml(post.title)}</title>
	<link>${url}</link>
	<guid isPermaLink="true">${url}</guid>
	<description>${escapeXml(raw)}</description>
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
	console.log(`[Webmention Send] 已生成临时 RSS（${posts.length} 篇文章）`);

	try {
		console.log(`[Webmention Send] 扫描最近 ${LIMIT} 篇文章的链接并发送 Webmention...`);
		execSync(`"${join(BIN_DIR, "wm.cmd")}" "${tmpFile}" --limit ${LIMIT} --send`, {
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
