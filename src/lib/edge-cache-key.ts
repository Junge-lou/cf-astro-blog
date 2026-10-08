/**
 * 边缘缓存的**纯逻辑**：TTL 决策、缓存键归一化、可缓存性判断。
 *
 * 这些函数原本内联在 `src/middleware.ts`。抽出成独立模块的原因有两个：
 *
 * 1. **可测试**。缓存键归一化曾经有一个线上正确性缺陷（清空 `/blog` 的查询串
 *    导致 `?category=` 的渲染结果被存进 `/blog` 的键），但因为它藏在中间件
 *    内部、依赖 `astro:middleware` 与 `cloudflare:workers`，无法被单元测试
 *    覆盖，只能靠"读源码 + 正则匹配"来断言。现在这里是零依赖纯函数，
 *    `tests/unit/edge-cache-key.test.ts` 直接对其行为做断言。
 * 2. **单一事实来源**。`src/pages/blog/index.astro` 的分页/分类校验必须与缓存键
 *    使用完全相同的规则，否则会出现"键相同、渲染不同"。相关常量与函数都从这里
 *    导出，双方共同引用。
 */
import { sanitizeSlug } from "@/lib/text";

/** 页面边缘缓存时长（秒）。 */
export const EDGE_CACHE_TTL_SECONDS = 300;

/**
 * 媒体资源缓存时长：一年。
 * 图片是内容寻址的（key 含 UUID），无需随文章改动失效，
 * 因此使用长 TTL 且不参与内容版本号。
 */
export const MEDIA_CACHE_TTL_SECONDS = 31_536_000;

/**
 * 归档页分页上限。
 * `src/pages/blog/index.astro` 与缓存键归一化必须共用这个上限。
 */
export const BLOG_PAGE_MAX = 500;

export function normalizePathname(pathname: string): string {
	if (!pathname || pathname === "/") {
		return "/";
	}

	return pathname.replace(/\/+$/u, "") || "/";
}

/**
 * 静态产物（Astro 构建输出带内容哈希）已由 assets 层以
 * `Cache-Control: public, max-age=31536000, immutable` 提供并缓存。
 * 再写入 Cache API 属于重复劳动，且会把大文件塞进边缘缓存。
 */
export function isImmutableStaticAsset(pathname: string): boolean {
	return pathname.startsWith("/_astro/");
}

/**
 * /media/* 由 Worker 从 R2 提供。它不依赖任何查询参数或内容版本号，
 * 因此缓存键需要保持干净，否则每个不同的 query 都会产生一次回源。
 */
export function isMediaPath(pathname: string): boolean {
	return pathname.startsWith("/media/");
}

export function resolveEdgeCacheTtl(pathname: string): number {
	if (isImmutableStaticAsset(pathname)) {
		return 0;
	}

	if (isMediaPath(pathname)) {
		return MEDIA_CACHE_TTL_SECONDS;
	}

	switch (pathname) {
		case "/":
		case "/blog":
		case "/friends":
			return EDGE_CACHE_TTL_SECONDS;
		default:
			// 文章详情页同样缓存 300 秒，大幅降低 D1 查询压力和导航延迟
			if (pathname.startsWith("/blog/")) {
				return EDGE_CACHE_TTL_SECONDS;
			}
			return 0;
	}
}

/**
 * 分类 slug 的最大长度。
 *
 * `sanitizeSlug` 本身没有长度上限，如果直接把任意长度的合法 slug 放进缓存键，
 * 攻击者可以用大量不同的长字符串制造出大量缓存条目（缓存键空间放大）。
 * 超过上限的值在这里统一视为"未提供分类"。
 *
 * 关键：**渲染侧必须调用同一个函数**（`src/pages/blog/index.astro` 已如此），
 * 否则会出现"键被归一化掉、但页面仍按长分类渲染"的错位——那正是我们要修的
 * 那类缺陷。
 */
export const BLOG_CATEGORY_MAX_LENGTH = 64;

/**
 * 解析归档页的 `category` 参数。
 * 走 `sanitizeSlug`（NFKC + 小写 + 空格转连字符），并施加长度上限。
 * 返回 `null` 表示"没有有效分类"，即按无筛选渲染。
 */
export function parseBlogCategory(raw: string | null | undefined): string | null {
	const slug = sanitizeSlug(raw);
	if (!slug) {
		return null;
	}

	if ([...slug].length > BLOG_CATEGORY_MAX_LENGTH) {
		return null;
	}

	return slug;
}

/**
 * 解析归档页的 `page` 参数。只有规范的十进制数字串会被接受，
 * `2.0` / `02` / `abc` / 越界值一律按第 1 页处理。
 *
 * 必须与 `src/pages/blog/index.astro` 使用同一规则：那边旧实现直接 `Number()`，
 * `?page=abc` 得到 NaN → offset 变成 NaN → 查询抛错被空 catch 吞掉 →
 * 渲染出"空归档"，而这个空响应恰好会被存进 `/blog` 的缓存键。
 */
export function parseBlogPage(raw: string | null | undefined): number {
	const trimmed = (raw ?? "").trim();
	if (trimmed === "") {
		return 1;
	}

	const parsed = Number(trimmed);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > BLOG_PAGE_MAX) {
		return 1;
	}

	return parsed;
}

/**
 * 归一化归档页 `/blog` 的缓存键查询参数。
 *
 * 原则：**只有会影响渲染的参数才进入缓存键，并且必须使用与渲染完全相同的
 * 归一化结果。**
 *
 * 这里曾经存在一个线上正确性缺陷：旧实现无条件清空 `/blog` 的 search，只
 * 放回一个整数 `page`，于是 `?category=xxx` 的渲染结果被存进了 `/blog` 这个
 * 键——只要先访问 `/blog?category=不存在的分类`（渲染 0 篇的"还没有已发布
 * 文章"空态），之后所有访问 `/blog` 的人在 TTL 内都会看到空归档。
 *
 * 现在：
 * - `page` 只接受 2..500 的**规范**数字串（`2.0`/`02`/`abc`/越界值一律归一化
 *   为无参数形式，第 1 页与无参数等价）
 * - `category` 走 `parseBlogCategory` → `sanitizeSlug`，与
 *   `src/pages/blog/index.astro` 用的是同一个函数，保证"缓存键里的值"与
 *   "查询用的值"逐字节一致，并带长度上限
 * - 其余参数（`utm_*` 及任意未知参数）不影响渲染，一律归一化掉：既避免它们
 *   制造无限多个缓存条目，也避免 `?x=1` 变成绕过缓存的入口
 */
export function normalizeBlogCacheKey(cacheUrl: URL): void {
	const rawPage = (cacheUrl.searchParams.get("page") ?? "").trim();
	const rawCategory = cacheUrl.searchParams.get("category") ?? "";

	cacheUrl.search = "";

	const page = parseBlogPage(rawPage);
	if (page >= 2) {
		cacheUrl.searchParams.set("page", String(page));
	}

	const category = parseBlogCategory(rawCategory);
	if (category) {
		cacheUrl.searchParams.set("category", category);
	}
}

export function buildEdgeCacheKeyUrl(url: URL, contentVersion: string): URL {
	const cacheUrl = new URL(url.toString());
	const pathname = normalizePathname(cacheUrl.pathname);
	cacheUrl.pathname = pathname;
	cacheUrl.hash = "";

	// 媒体资源不依赖查询参数：清空 search 并跳过版本号，
	// 让所有等价的媒体 URL 归一到同一个缓存键。
	if (isMediaPath(pathname)) {
		cacheUrl.search = "";
		return cacheUrl;
	}

	if (pathname === "/blog") {
		normalizeBlogCacheKey(cacheUrl);
	} else {
		// `/`、`/friends`、`/blog/<slug>` 的渲染都不依赖查询参数，直接清空。
		cacheUrl.search = "";
	}

	// 缓存键携带内容版本号：发文后版本号变化，旧缓存在所有节点立即失效
	cacheUrl.searchParams.set("__cv", contentVersion);

	return cacheUrl;
}

export function canUseEdgeCache(options: {
	method: string;
	isAdminPreview: boolean;
	pathname: string;
	hasAuthorization: boolean;
}): boolean {
	if (options.method !== "GET") {
		return false;
	}
	if (options.isAdminPreview || options.hasAuthorization) {
		return false;
	}
	return resolveEdgeCacheTtl(options.pathname) > 0;
}
