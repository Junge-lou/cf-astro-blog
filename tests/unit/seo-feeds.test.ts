import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { absolutizeContentUrls, buildRssXml } from "../../src/lib/rss-feed";

describe("SEO 与订阅输出", () => {
	test("基础头部包含 RSS 与 sitemap 链接", async () => {
		const source = await readFile("src/components/BaseHead.astro", "utf8");

		assert.ok(source.includes('rel="sitemap"'));
		assert.ok(source.includes('type="application/rss+xml"'));
		assert.ok(source.includes('href="/rss.xml"'));
		assert.ok(source.includes('rel="webmention"'));
	});

	test("robots 仅屏蔽后台登录与管理路径", async () => {
		const source = await readFile("src/pages/robots.txt.ts", "utf8");

		assert.ok(source.includes('"/api/auth"'));
		assert.ok(source.includes('"/api/admin"'));
		assert.ok(source.includes('"/admin"'));
		assert.ok(source.includes("Allow: /"));
		assert.ok(source.includes("/sitemap.xml"));
	});

	test("RSS 源读取公开文章并输出标准响应头", async () => {
		const source = await readFile("src/pages/rss.xml.ts", "utf8");

		assert.ok(source.includes("getPublicPostVisibilityCondition"));
		assert.ok(source.includes("getSiteAppearance"));
		assert.ok(source.includes("resolveSiteDescriptionFromAppearance"));
		assert.ok(source.includes("buildRssXml"));
		assert.ok(source.includes("application/rss+xml; charset=utf-8"));
		assert.match(source, /encodeRouteParam\(post\.slug\)/u);
		assert.ok(source.includes(".limit(30)"));
	});

	test("RSS 构建器输出频道头像、全文与封面缩略图", () => {
		const contentHtml = absolutizeContentUrls(
			'<p>你好 <img src="/media/a.png" /><a href="/blog">归档</a><a href="#anchor">锚点</a></p>',
			"https://ffaff.fun",
		);

		const xml = buildRssXml({
			siteName: "Kiwi 的博客 & 分享",
			siteUrl: "https://ffaff.fun",
			description: "记录 生活",
			language: "zh-CN",
			feedUrl: "https://ffaff.fun/rss.xml",
			iconUrl: "https://ffaff.fun/favicon.png",
			lastBuildDate: "Thu, 01 Jan 2026 00:00:00 GMT",
			items: [
				{
					title: "标题 & 测试",
					url: "https://ffaff.fun/blog/hello-world",
					description: "摘要 <b>内容</b>",
					contentHtml,
					coverImageUrl: "https://ffaff.fun/media/cover.png",
					pubDate: "Thu, 01 Jan 2026 00:00:00 GMT",
				},
			],
		});

		// 命名空间：content 全文模块 + media 缩略图模块
		assert.ok(xml.includes('<rss version="2.0"'));
		assert.ok(xml.includes('xmlns:content="http://purl.org/rss/1.0/modules/content/"'));
		assert.ok(xml.includes('xmlns:media="http://search.yahoo.com/mrss/"'));

		// 频道头像
		assert.ok(xml.includes("<image>"));
		assert.ok(xml.includes("<url>https://ffaff.fun/favicon.png</url>"));

		// 全文：HTML 整体转义后包进 content:encoded
		assert.ok(xml.includes("<content:encoded>&lt;p&gt;你好"));

		// 相对地址补全为绝对地址；锚点不受影响
		// （content:encoded 内的 HTML 被整体转义，引号呈 &quot; 形式）
		assert.ok(xml.includes("src=&quot;https://ffaff.fun/media/a.png&quot;"));
		assert.ok(xml.includes("href=&quot;https://ffaff.fun/blog&quot;"));
		assert.ok(xml.includes("href=&quot;#anchor&quot;"));

		// 封面缩略图
		assert.ok(xml.includes('<media:thumbnail url="https://ffaff.fun/media/cover.png" />'));

		// 标题与描述均经过 XML 转义
		assert.ok(xml.includes("<title>标题 &amp; 测试</title>"));
		assert.ok(xml.includes("<description>摘要 &lt;b&gt;内容&lt;/b&gt;</description>"));
	});

	test("无头像、无封面、无全文时省略对应元素", () => {
		const xml = buildRssXml({
			siteName: "站名",
			siteUrl: "https://example.com",
			description: "描述",
			language: "zh-CN",
			feedUrl: "https://example.com/rss.xml",
			iconUrl: null,
			lastBuildDate: "Thu, 01 Jan 2026 00:00:00 GMT",
			items: [
				{
					title: "仅摘要",
					url: "https://example.com/a",
					description: "描述",
					contentHtml: null,
					coverImageUrl: null,
					pubDate: "Thu, 01 Jan 2026 00:00:00 GMT",
				},
			],
		});

		assert.ok(!xml.includes("<image>"));
		assert.ok(!xml.includes("media:thumbnail"));
		assert.ok(!xml.includes("content:encoded"));
	});

	test("基础布局会将外观简介作为默认 description", async () => {
		const source = await readFile("src/layouts/Base.astro", "utf8");

		assert.ok(source.includes("resolveSiteDescriptionFromAppearance"));
		assert.match(source, /description \?\?/u);
	});
});
