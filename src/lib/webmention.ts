import { renderSafeMarkdown } from "@/lib/security";

// Worker 内直接发送 Webmention：
// 发文后通过 waitUntil 异步执行，不再依赖 GitHub Actions 里的脚本。
const MAX_LINKS_PER_POST = 15;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_DISCOVERY_HTML_BYTES = 120 * 1024;

export interface WebmentionTarget {
	slug: string;
	content: string;
}

function resolveSiteUrl(env: Env): string {
	const raw = String(env.SITE_URL || "").trim();
	return raw.replace(/\/+$/u, "") || "https://ffaff.fun";
}

export function extractExternalLinks(html: string, siteUrl: string): string[] {
	const siteOrigin = new URL(siteUrl).origin;
	const links = new Set<string>();
	const anchorPattern = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/giu;

	for (const match of html.matchAll(anchorPattern)) {
		if (links.size >= MAX_LINKS_PER_POST) {
			break;
		}
		const rawHref = match[1]?.trim();
		if (!rawHref) {
			continue;
		}

		let url: URL;
		try {
			url = new URL(rawHref, siteUrl);
		} catch {
			continue;
		}

		if (url.protocol !== "http:" && url.protocol !== "https:") {
			continue;
		}
		if (url.origin === siteOrigin) {
			continue;
		}
		// 跳过纯资源链接
		if (
			/\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|json|xml|pdf|zip|mp4|mp3|webm|woff2?)(?:[?#].*)?$/iu.test(
				url.pathname,
			)
		) {
			continue;
		}

		links.add(url.toString());
	}

	return [...links];
}

function parseLinkHeaderEndpoints(linkHeaders: string[], pageUrl: URL): string[] {
	const endpoints: string[] = [];

	for (const header of linkHeaders) {
		// Link: <https://example.com/webmention>; rel="webmention"
		const pattern = /<([^>]+)>\s*;\s*rel\s*=\s*"?([^";]+[^";\s])"?/giu;
		for (const match of header.matchAll(pattern)) {
			const href = match[1];
			const rels = match[2]?.toLowerCase().split(/\s+/u) ?? [];
			if (!href || !rels.includes("webmention")) {
				continue;
			}

			try {
				endpoints.push(new URL(href, pageUrl).toString());
			} catch {
				// 无效地址直接忽略
			}
		}
	}

	return endpoints;
}

function parseHtmlEndpoints(html: string, pageUrl: URL): string[] {
	const endpoints: string[] = [];
	const pattern = /<(?:link|a)\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/giu;

	for (const match of html.matchAll(pattern)) {
		const tag = match[0];
		const href = match[1];
		if (!href || !/\srel\s*=\s*["'][^"']*\bwebmention\b[^"']*["']/iu.test(tag)) {
			continue;
		}

		try {
			endpoints.push(new URL(href, pageUrl).toString());
		} catch {
			// 无效地址直接忽略
		}
	}

	return endpoints;
}

async function discoverWebmentionEndpoint(targetUrl: string): Promise<string | null> {
	try {
		const response = await fetch(targetUrl, {
			method: "GET",
			redirect: "follow",
			headers: {
				accept: "text/html,application/xhtml+xml",
				"user-agent": "cf-astro-blog-webmention/1.0",
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			return null;
		}

		const pageUrl = new URL(response.url || targetUrl);

		const linkHeaders: string[] = [];
		try {
			const headerLines = response.headers.get("link");
			if (headerLines) {
				linkHeaders.push(...headerLines.split(/,\s*(?=<)/u));
			}
		} catch {
			// 读取头失败时忽略
		}
		const headerEndpoints = parseLinkHeaderEndpoints(linkHeaders, pageUrl);
		if (headerEndpoints.length > 0) {
			return headerEndpoints[0] ?? null;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			return null;
		}

		let received = 0;
		const decoder = new TextDecoder();
		let html = "";
		while (received < MAX_DISCOVERY_HTML_BYTES) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			received += value.byteLength;
			html += decoder.decode(value, { stream: true });
		}

		const htmlEndpoints = parseHtmlEndpoints(html, pageUrl);
		return htmlEndpoints[0] ?? null;
	} catch {
		return null;
	}
}

async function sendSingleWebmention(endpoint: string, source: string, target: string) {
	try {
		const body = new URLSearchParams({ source, target });
		await fetch(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"user-agent": "cf-astro-blog-webmention/1.0",
			},
			body: body.toString(),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch {
		// 单个目标失败不影响其他目标
	}
}

export async function sendWebmentionsForPost(env: Env, target: WebmentionTarget): Promise<number> {
	const siteUrl = resolveSiteUrl(env);
	const source = `${siteUrl}/blog/${encodeURIComponent(target.slug)}`;
	const html = await renderSafeMarkdown(target.content);
	const links = extractExternalLinks(html, siteUrl);

	let sentCount = 0;
	for (const link of links) {
		const endpoint = await discoverWebmentionEndpoint(link);
		if (!endpoint) {
			continue;
		}

		await sendSingleWebmention(endpoint, source, link);
		sentCount += 1;
	}

	return sentCount;
}
