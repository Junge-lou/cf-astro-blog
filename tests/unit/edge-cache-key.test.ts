import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BLOG_PAGE_MAX,
	buildEdgeCacheKeyUrl,
	canUseEdgeCache,
	MEDIA_CACHE_TTL_SECONDS,
	normalizeBlogCacheKey,
	normalizePathname,
	parseBlogPage,
	resolveEdgeCacheTtl,
} from "../../src/lib/edge-cache-key";

const ORIGIN = "https://example.com";

function cacheKey(path: string, contentVersion = "v1"): URL {
	return buildEdgeCacheKeyUrl(new URL(`${ORIGIN}${path}`), contentVersion);
}

describe("边缘缓存键归一化", () => {
	// ── 回归保护：这正是修复前的线上缺陷 ──────────────────────────────────
	test("分类筛选必须与无参归档使用不同的缓存键", () => {
		const plain = cacheKey("/blog");
		const filtered = cacheKey("/blog?category=tech");
		const missing = cacheKey("/blog?category=nonexistent");

		assert.notEqual(
			plain.toString(),
			filtered.toString(),
			"/blog?category=tech 不能与 /blog 共用缓存键，否则分类结果会污染主归档",
		);
		assert.notEqual(
			plain.toString(),
			missing.toString(),
			"不存在的分类会渲染空态，绝不能存进 /blog 的键",
		);
		assert.notEqual(filtered.toString(), missing.toString());
	});

	test("分类值经过 sanitizeSlug 归一化，与渲染侧使用同一规则", () => {
		// 大小写与首尾空白都会被归一化，因此这些 URL 共用同一个键
		assert.equal(
			cacheKey("/blog?category=Tech").toString(),
			cacheKey("/blog?category=tech").toString(),
		);
		assert.equal(
			cacheKey("/blog?category=%20tech%20").toString(),
			cacheKey("/blog?category=tech").toString(),
		);
		// 中文分类是合法 slug
		assert.equal(
			cacheKey("/blog?category=%E6%8A%80%E6%9C%AF").searchParams.get("category"),
			"技术",
		);
	});

	test("非法分类被归一化掉，不会放大缓存键空间", () => {
		const plain = cacheKey("/blog");
		for (const bad of ["", "  ", "<script>", "a/b", "!!!", "x".repeat(200), "技".repeat(80)]) {
			assert.equal(
				cacheKey(`/blog?category=${encodeURIComponent(bad)}`).toString(),
				plain.toString(),
				`非法分类 ${JSON.stringify(bad)} 应归一化为无参数形式`,
			);
		}
	});

	test("空格会被归一化为连字符，渲染侧使用同一函数因此结果一致", () => {
		assert.equal(cacheKey("/blog?category=a%20b").searchParams.get("category"), "a-b");
	});

	test("不影响渲染的参数被归一化掉，避免缓存绕过", () => {
		const plain = cacheKey("/blog");
		for (const extra of ["?utm_source=x", "?x=1&y=2", "?page=1", "?category=&page=1"]) {
			assert.equal(
				cacheKey(`/blog${extra}`).toString(),
				plain.toString(),
				`${extra} 不影响渲染，应归一到同一个键`,
			);
		}
	});

	test("分页参数只接受 1..上限，越界与非法值按第 1 页处理", () => {
		assert.equal(parseBlogPage(null), 1);
		assert.equal(parseBlogPage(""), 1);
		assert.equal(parseBlogPage("1"), 1);
		assert.equal(parseBlogPage("2"), 2);
		assert.equal(parseBlogPage(String(BLOG_PAGE_MAX)), BLOG_PAGE_MAX);
		assert.equal(parseBlogPage(String(BLOG_PAGE_MAX + 1)), 1);
		assert.equal(parseBlogPage("0"), 1);
		assert.equal(parseBlogPage("-3"), 1);
		// 旧实现会得到 NaN，进而让 offset 变成 NaN、查询抛错、渲染出空归档
		assert.equal(parseBlogPage("abc"), 1);
		assert.equal(parseBlogPage("NaN"), 1);
		assert.equal(parseBlogPage("1e999"), 1);
	});

	test("分页与分类可以同时进入缓存键", () => {
		const key = cacheKey("/blog?page=3&category=tech");
		assert.equal(key.searchParams.get("page"), "3");
		assert.equal(key.searchParams.get("category"), "tech");
	});

	test("第 1 页与无参数等价，非规范写法与规范写法等价", () => {
		assert.equal(cacheKey("/blog?page=1").toString(), cacheKey("/blog").toString());
		// 渲染侧同样用 parseBlogPage，因此 "02"/"2.0" 渲染出的就是第 2 页
		assert.equal(cacheKey("/blog?page=02").toString(), cacheKey("/blog?page=2").toString());
		assert.equal(cacheKey("/blog?page=2.0").toString(), cacheKey("/blog?page=2").toString());
	});

	// ── 其他路由 ────────────────────────────────────────────────────────
	test("文章详情页清空查询串但携带内容版本号", () => {
		const key = cacheKey("/blog/hello?utm_source=x&page=9");
		assert.equal(key.pathname, "/blog/hello");
		assert.equal(key.searchParams.get("page"), null);
		assert.equal(key.searchParams.get("__cv"), "v1");
	});

	test("媒体资源清空查询串且不携带内容版本号", () => {
		const key = cacheKey("/media/posts/a/b.webp?w=800&h=600");
		assert.equal(key.pathname, "/media/posts/a/b.webp");
		assert.equal(key.search, "", "媒体 URL 的等价写法必须归一到同一个键");
	});

	test("尾部斜杠与 hash 会被归一化", () => {
		assert.equal(cacheKey("/blog/").pathname, "/blog");
		assert.equal(normalizePathname("///"), "/");
		assert.equal(cacheKey("/blog#section").hash, "");
		assert.equal(cacheKey("/").pathname, "/");
	});

	test("内容版本号进入缓存键，使旧缓存立即失效", () => {
		assert.notEqual(cacheKey("/blog", "v1").toString(), cacheKey("/blog", "v2").toString());
	});
});

describe("边缘缓存 TTL 与可缓存性", () => {
	test("TTL 按路由决策", () => {
		assert.equal(resolveEdgeCacheTtl("/_astro/Base.abc.css"), 0, "指纹静态资源由 assets 层缓存");
		assert.equal(resolveEdgeCacheTtl("/media/a.webp"), MEDIA_CACHE_TTL_SECONDS);
		assert.equal(resolveEdgeCacheTtl("/"), 300);
		assert.equal(resolveEdgeCacheTtl("/blog"), 300);
		assert.equal(resolveEdgeCacheTtl("/blog/hello"), 300);
		assert.equal(resolveEdgeCacheTtl("/friends"), 300);
		// 未纳入缓存的动态路由
		assert.equal(resolveEdgeCacheTtl("/search"), 0);
		assert.equal(resolveEdgeCacheTtl("/rss.xml"), 0);
		assert.equal(resolveEdgeCacheTtl("/sitemap.xml"), 0);
	});

	test("只有匿名 GET 可以命中边缘缓存", () => {
		const base = {
			method: "GET",
			isAdminPreview: false,
			pathname: "/blog",
			hasAuthorization: false,
		};
		assert.equal(canUseEdgeCache(base), true);
		assert.equal(canUseEdgeCache({ ...base, method: "POST" }), false);
		assert.equal(canUseEdgeCache({ ...base, isAdminPreview: true }), false);
		assert.equal(canUseEdgeCache({ ...base, hasAuthorization: true }), false);
		assert.equal(canUseEdgeCache({ ...base, pathname: "/search" }), false);
	});

	test("normalizeBlogCacheKey 是幂等的", () => {
		const once = new URL(`${ORIGIN}/blog?page=2&category=Tech&utm_source=x`);
		normalizeBlogCacheKey(once);
		const twice = new URL(once.toString());
		normalizeBlogCacheKey(twice);
		assert.equal(once.toString(), twice.toString());
	});
});
