import { Hono } from "hono";
import type { AdminAppEnv } from "../middleware/auth";

/**
 * Proxy route for momo comments API.
 *
 * The momo comment widget runs on the blog's origin (ffaff.fun) but the
 * comments API lives on a subdomain (comments.ffaff.fun).  Browsers block
 * cross-origin fetch() when the target server doesn't send CORS headers.
 *
 * This route forwards /api/comments requests to the external comments
 * server so that the browser talks to the same origin → no CORS needed.
 */
const COMMENTS_ORIGIN = "https://comments.ffaff.fun";

const commentsProxyRoutes = new Hono<AdminAppEnv>();

commentsProxyRoutes.all("/", async (c) => {
	const targetUrl = new URL(c.req.url);
	targetUrl.host = new URL(COMMENTS_ORIGIN).host;
	targetUrl.protocol = "https";
	targetUrl.port = "";
	targetUrl.pathname = "/api/comments";

	const proxyHeaders = new Headers(c.req.raw.headers);
	proxyHeaders.set("Host", new URL(COMMENTS_ORIGIN).host);
	// Remove hop-by-hop / astro-internal headers that shouldn't be forwarded
	proxyHeaders.delete("cf-connecting-ip");
	proxyHeaders.delete("x-forwarded-for");
	proxyHeaders.delete("x-real-ip");

	const proxyRequest = new Request(targetUrl.toString(), {
		method: c.req.method,
		headers: proxyHeaders,
		body: c.req.method === "GET" || c.req.method === "HEAD"
			? undefined
			: c.req.raw.body,
	});

	const proxyResponse = await fetch(proxyRequest);

	// Copy over CORS headers in case they're needed for anything downstream
	const responseHeaders = new Headers(proxyResponse.headers);
	responseHeaders.set("Access-Control-Allow-Origin", c.req.header("origin") ?? "*");
	responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	responseHeaders.set("Access-Control-Allow-Headers", "Content-Type");
	responseHeaders.delete("content-encoding");

	return new Response(proxyResponse.body, {
		status: proxyResponse.status,
		statusText: proxyResponse.statusText,
		headers: responseHeaders,
	});
});

export { commentsProxyRoutes };
