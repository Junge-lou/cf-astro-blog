import { defineMiddleware } from "astro:middleware";
import { runInBackground } from "@/lib/background";
import { getContentCacheVersion } from "@/lib/content-version";
import { buildContentImgSrc } from "@/lib/csp";
// 缓存键归一化、TTL 决策等纯逻辑都在这里，便于单元测试与跨文件共用同一规则。
// 注意：不要从 @/lib/security 引入任何东西——它顶层依赖 katex/marked/
// sanitize-html，会把整个 Markdown 渲染栈拖进中间件的模块图。
import {
	buildEdgeCacheKeyUrl,
	canUseEdgeCache,
	isMediaPath,
	normalizePathname,
	resolveEdgeCacheTtl,
} from "@/lib/edge-cache-key";

const CONTENT_VERSION_MEMO_TTL_MS = 15_000;

// 内容版本号进程级缓存：避免每次请求都读 KV。
// 15 秒的窗口意味着发文后全球各节点最多 15 秒内切换到新缓存键。
let contentVersionMemo: { value: string; expiresAt: number } | null = null;

async function resolveContentVersion(): Promise<string> {
	const now = Date.now();
	if (contentVersionMemo && contentVersionMemo.expiresAt > now) {
		return contentVersionMemo.value;
	}

	try {
		const { env } = await import("cloudflare:workers");
		const value = await getContentCacheVersion(env);
		contentVersionMemo = { value, expiresAt: now + CONTENT_VERSION_MEMO_TTL_MS };
		return value;
	} catch {
		return "0";
	}
}

function getEdgeCache(): Cache | null {
	if (typeof caches === "undefined") {
		return null;
	}

	const defaultCache = (caches as unknown as { default?: Cache }).default;
	return defaultCache || null;
}

function applySecurityHeaders(pathname: string, response: Response, isAdminPreview: boolean) {
	const normalizedPath = normalizePathname(pathname);

	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", isAdminPreview ? "SAMEORIGIN" : "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	response.headers.set("Cross-Origin-Opener-Policy", "same-origin");

	// 媒体资源跳过 Vary：图片已按目标格式编码，按 Accept-Encoding 拆分会
	// 产生多个缓存条目，降低边缘命中率且没有收益。
	if (!isMediaPath(normalizedPath)) {
		// 告知 CDN/浏览器响应可因 Accept-Encoding 和 Cookie 而不同
		const existingVary = response.headers.get("Vary") || "";
		const varySegments = new Set(
			existingVary
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
		);
		varySegments.add("Accept-Encoding");
		if (response.headers.has("set-cookie")) {
			varySegments.add("Cookie");
		}
		response.headers.set("Vary", [...varySegments].join(", "));
	}

	// 媒体资源只写入边缘缓存，不改写 Cache-Control：
	// 媒体路由已设置了准确的 `immutable` 语义，此处覆盖会把它冲掉。
	if (!isMediaPath(normalizedPath) && !normalizedPath.startsWith("/api/")) {
		const frameAncestors = isAdminPreview ? "'self'" : "'none'";
		// Astro ClientRouter (View Transitions) 客户端导航时不会刷新文档级 CSP，
		// 且在页面切换时会执行内联脚本片段，未放行时会在控制台持续报错。
		const scriptSources = [
			"'self'",
			"'unsafe-inline'",
			"https://challenges.cloudflare.com",
			"https://static.cloudflareinsights.com",
		];
		response.headers.set(
			"Content-Security-Policy",
			[
				"default-src 'self'",
				"base-uri 'self'",
				`frame-ancestors ${frameAncestors}`,
				"object-src 'none'",
				"form-action 'self'",
				// ✅ 视频：新增 video-src 支持 MP4 直链 + B站/腾讯视频
				"video-src 'self' https: data:",

				// ✅ 媒体（音频）
				"media-src 'self' https: data:",
				`script-src ${scriptSources.join(" ")}`,
				"style-src 'self' 'unsafe-inline'",
				`img-src ${buildContentImgSrc({ allowAnyHttps: true })}`,
				"font-src 'self' data: https:",
				"connect-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://cloudflareinsights.com https://comments.ffaff.fun https://webmention.io",
				"frame-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://player.bilibili.com https://webmention.io",
			].join("; "),
		);
	}
}

export const onRequest = defineMiddleware(async (context, next) => {
	const isAdminPreview = context.url.searchParams.get("adminPreview") === "1";
	const pathname = normalizePathname(context.url.pathname);
	const shouldUseEdgeCache = canUseEdgeCache({
		method: context.request.method.toUpperCase(),
		isAdminPreview,
		pathname,
		hasAuthorization: context.request.headers.has("authorization"),
	});
	const edgeCache = getEdgeCache();
	const edgeCacheTtl = resolveEdgeCacheTtl(pathname);
	// 媒体资源不参与内容版本号，避免白白读取一次 KV
	const shouldResolveVersion = shouldUseEdgeCache && !isMediaPath(pathname);
	const contentVersion = shouldResolveVersion ? await resolveContentVersion() : "0";
	const cacheKeyUrl = buildEdgeCacheKeyUrl(context.url, contentVersion);
	const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

	if (shouldUseEdgeCache && edgeCache) {
		try {
			const cachedResponse = await edgeCache.match(cacheKey);
			if (cachedResponse) {
				// Cloudflare 的 cache.match() 返回的 Response（含 clone）headers 不可变，
				// 直接 set 会抛 "Can't modify immutable headers"，
				// 需用 new Response(body, init) 重建可变副本
				const response = new Response(cachedResponse.body, cachedResponse);
				response.headers.set("X-Edge-Cache", "HIT");
				applySecurityHeaders(pathname, response, isAdminPreview);
				return response;
			}
		} catch (error) {
			// 边缘缓存读取失败时回退实时渲染，避免影响主链路
			console.error("[edge-cache] match 失败", cacheKey.url, error);
		}
	}

	const response = await next();
	applySecurityHeaders(pathname, response, isAdminPreview);

	if (
		shouldUseEdgeCache &&
		edgeCache &&
		edgeCacheTtl > 0 &&
		response.status === 200 &&
		!response.headers.has("set-cookie")
	) {
		const existingCacheControl = response.headers.get("cache-control") || "";
		if (!/no-store|private/iu.test(existingCacheControl)) {
			const cacheControl = isMediaPath(pathname)
				? existingCacheControl
				: // max-age 与 s-maxage 保持一致：
					// 浏览器缓存使 Astro prefetch 预取的内容可以被 ClientRouter 的 fetch() 直接命中，
					// 避免每次导航都需要服务器往返，彻底消除点击延迟。
					`public, s-maxage=${edgeCacheTtl}, max-age=${edgeCacheTtl}, stale-while-revalidate=86400`;
			response.headers.set("Cache-Control", cacheControl);
			response.headers.set("X-Edge-Cache", "MISS");

			const responseForCache = response.clone();
			responseForCache.headers.set("Cache-Control", cacheControl);
			// 写缓存不需要挡在响应前面：它对本请求的结果没有任何影响，
			// 失败只会让下一次请求重新渲染（与今天 put 抛错时的行为一致）。
			// 交给 waitUntil 后，缓存未命中的请求可以立刻把正文交给客户端。
			runInBackground(
				edgeCache.put(cacheKey, responseForCache).catch((error) => {
					console.error("[edge-cache] put 失败", cacheKey.url, error);
				}),
			);
		}
	}

	return response;
});
