import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { buildPublicImageHeaders, getMediaContentTypeForKey } from "@/lib/media";
import { sanitizeMediaKey } from "@/lib/security";

/**
 * 公开媒体资源（封面图、背景图等）。
 *
 * 该响应不走 src/middleware.ts 的常规头部逻辑：
 * 中间件会追加 `Vary: Accept-Encoding`，而图片已按目标格式编码，
 * 按编码拆分缓存条目没有意义，只会拉低边缘缓存命中率。
 * 因此这里自行补齐必要的最小安全头。
 */
const MEDIA_SECURITY_HEADERS = {
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
	"Cross-Origin-Opener-Policy": "same-origin",
} as const;

function emptyResponse(status: number): Response {
	return new Response(null, { status, headers: MEDIA_SECURITY_HEADERS });
}

export const GET: APIRoute = async ({ params }) => {
	const key = sanitizeMediaKey(params.key ?? "");
	if (!key) {
		return emptyResponse(404);
	}

	const contentType = getMediaContentTypeForKey(key);
	if (!contentType) {
		return emptyResponse(404);
	}

	try {
		const object = await env.MEDIA_BUCKET.get(key);
		if (!object) {
			return emptyResponse(404);
		}

		return new Response(object.body, {
			headers: {
				...buildPublicImageHeaders(contentType),
				...MEDIA_SECURITY_HEADERS,
			},
		});
	} catch {
		return emptyResponse(404);
	}
};
