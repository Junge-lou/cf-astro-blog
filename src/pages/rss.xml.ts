import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { desc } from "drizzle-orm";
import { blogPosts } from "@/db/schema";
import { getDb } from "@/lib/db";
import { getPublicPostVisibilityCondition } from "@/lib/public-content";
import { absolutizeContentUrls, buildRssXml, type RssFeedItem, toRssDate } from "@/lib/rss-feed";
import { encodeRouteParam, renderSafeMarkdown } from "@/lib/security";
import {
	DEFAULT_SITE_APPEARANCE,
	getSiteAppearance,
	resolveSiteDescriptionFromAppearance,
} from "@/lib/site-appearance";
import { siteConfig } from "@/lib/types";

interface FeedPost {
	title: string;
	slug: string;
	excerpt: string | null;
	content: string;
	featuredImageKey: string | null;
	publishedAt: string | null;
	updatedAt: string;
}

function buildDescription(post: FeedPost): string {
	const raw = post.excerpt?.trim() || post.content.trim();
	const preview = raw.replace(/\s+/g, " ").slice(0, 220);
	return preview || post.title;
}

export const GET: APIRoute = async () => {
	let posts: FeedPost[] = [];
	let feedDescription = siteConfig.description;

	try {
		const db = getDb(env.DB);

		const [postRows, appearance] = await Promise.all([
			db
				.select({
					title: blogPosts.title,
					slug: blogPosts.slug,
					excerpt: blogPosts.excerpt,
					content: blogPosts.content,
					featuredImageKey: blogPosts.featuredImageKey,
					publishedAt: blogPosts.publishedAt,
					updatedAt: blogPosts.updatedAt,
				})
				.from(blogPosts)
				.where(getPublicPostVisibilityCondition())
				.orderBy(desc(blogPosts.publishedAt), desc(blogPosts.updatedAt))
				.limit(30),
			getSiteAppearance(db).catch(() => DEFAULT_SITE_APPEARANCE),
		]);
		posts = postRows;
		feedDescription = resolveSiteDescriptionFromAppearance(appearance, siteConfig.description);
	} catch {
		// D1 未绑定时回退为空 Feed
	}

	const now = new Date().toUTCString();
	const items: RssFeedItem[] = await Promise.all(
		posts.map(async (post): Promise<RssFeedItem> => {
			const url = `${siteConfig.url}/blog/${encodeRouteParam(post.slug)}`;
			const pubDate = toRssDate(post.publishedAt) || toRssDate(post.updatedAt) || now;

			// 全文输出：复用站点同款渲染管线（含安全过滤），
			// 单篇渲染失败时回退为仅摘要，不影响整个 Feed
			let contentHtml: string | null = null;
			try {
				contentHtml = absolutizeContentUrls(await renderSafeMarkdown(post.content), siteConfig.url);
			} catch {
				contentHtml = null;
			}

			return {
				title: post.title,
				url,
				description: buildDescription(post),
				contentHtml,
				coverImageUrl: post.featuredImageKey
					? `${siteConfig.url}/media/${post.featuredImageKey}`
					: null,
				pubDate,
			};
		}),
	);

	const rss = buildRssXml({
		siteName: siteConfig.name,
		siteUrl: siteConfig.url,
		description: feedDescription,
		language: siteConfig.language,
		feedUrl: `${siteConfig.url}/rss.xml`,
		iconUrl: `${siteConfig.url}/favicon.png`,
		lastBuildDate: now,
		items,
	});

	return new Response(rss, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=1800",
		},
	});
};
