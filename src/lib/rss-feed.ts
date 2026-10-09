/**
 * RSS 2.0 Feed 构建器（纯函数，无运行时依赖）。
 *
 * 从 rss.xml.ts 抽出，方便单元测试直接验证输出结构；
 * 路由层只负责查库与 markdown 渲染。Feed 在标准 RSS 2.0 之上声明：
 * - content 模块（content:encoded）：全文输出
 * - media 模块（media:thumbnail）：文章封面缩略图
 * 并输出频道 <image> 头像（favicon.png），供订阅器展示。
 */

export interface RssFeedItem {
	title: string;
	/** 文章绝对地址 */
	url: string;
	/** 纯文本摘要（未转义，构建时统一转义） */
	description: string;
	/** 渲染后的完整 HTML；null 表示仅输出摘要 */
	contentHtml: string | null;
	/** 封面图绝对地址；null 表示无封面 */
	coverImageUrl: string | null;
	/** RFC 822 日期字符串（UTC） */
	pubDate: string;
}

export interface RssFeedOptions {
	siteName: string;
	siteUrl: string;
	description: string;
	language: string;
	/** Feed 自身绝对地址 */
	feedUrl: string;
	/** 频道头像绝对地址（PNG）；null 表示不输出 <image> */
	iconUrl: string | null;
	lastBuildDate: string;
	items: RssFeedItem[];
}

export function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export function toRssDate(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}

	const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
	const parsed = new Date(normalized);

	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return parsed.toUTCString();
}

/**
 * 把渲染后 HTML 里的站内相对地址（src/href 以单个 / 开头）补全为绝对地址，
 * 订阅器没有站内上下文，相对路径在那里是死链。协议相对（//）与锚点（#）不动。
 */
export function absolutizeContentUrls(html: string, siteUrl: string): string {
	const base = siteUrl.replace(/\/+$/u, "");
	return html.replace(/(\s(?:src|href)=["'])\/(?!\/)/gu, `$1${base}/`);
}

export function buildRssXml(options: RssFeedOptions): string {
	const { items } = options;
	const channelImage = options.iconUrl
		? `<image>
	<url>${escapeXml(options.iconUrl)}</url>
	<title>${escapeXml(options.siteName)}</title>
	<link>${escapeXml(options.siteUrl)}</link>
</image>`
		: "";

	const itemsXml = items
		.map((item) => {
			const thumbnail = item.coverImageUrl
				? `\n\t<media:thumbnail url="${escapeXml(item.coverImageUrl)}" />`
				: "";
			const content = item.contentHtml
				? `\n\t<content:encoded>${escapeXml(item.contentHtml)}</content:encoded>`
				: "";

			return `<item>
	<title>${escapeXml(item.title)}</title>
	<link>${escapeXml(item.url)}</link>
	<guid isPermaLink="true">${escapeXml(item.url)}</guid>
	<description>${escapeXml(item.description)}</description>${thumbnail}${content}
	<pubDate>${escapeXml(item.pubDate)}</pubDate>
</item>`;
		})
		.join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
	<title>${escapeXml(options.siteName)}</title>
	<link>${escapeXml(options.siteUrl)}</link>
	<description>${escapeXml(options.description)}</description>
	<language>${escapeXml(options.language)}</language>
	${channelImage}
	<atom:link href="${escapeXml(options.feedUrl)}" rel="self" type="application/rss+xml" />
	<lastBuildDate>${escapeXml(options.lastBuildDate)}</lastBuildDate>
	${itemsXml}
</channel>
</rss>`;

	return rss.trim();
}
