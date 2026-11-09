import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("评论组件保护", () => {
	test("文章布局把 Webmention 与评论合并为正文下方的「回应」卡片", async () => {
		const [postLayoutSource, commentsComponentSource] = await Promise.all([
			readFile("src/layouts/Post.astro", "utf8"),
			readFile("src/components/CommentsPanel.astro", "utf8"),
		]);

		assert.match(postLayoutSource, /<CommentsPanel/u);
		assert.match(postLayoutSource, /article-responses/u);

		// 顺序合同：回应卡片 → Webmention 子区块 → 分割线 → 评论区
		const responsesIndex = postLayoutSource.indexOf("article-responses glass-panel");
		const webmentionIndex = postLayoutSource.indexOf("<WebmentionPanel");
		const dividerIndex = postLayoutSource.indexOf("article-responses-divider");
		const commentsIndex = postLayoutSource.indexOf("<CommentsPanel");
		assert.ok(responsesIndex > -1, "缺少 .article-responses 卡片");
		assert.ok(webmentionIndex > responsesIndex, "Webmention 应在「回应」卡片内");
		assert.ok(dividerIndex > webmentionIndex, "分割线应在 Webmention 之后");
		assert.ok(commentsIndex > dividerIndex, "评论区应在 Webmention 下方");

		// 评论区常驻显示：不再有折叠开关
		assert.match(commentsComponentSource, /data-comments-panel/u);
		assert.match(commentsComponentSource, /data-comments-host/u);
		assert.doesNotMatch(commentsComponentSource, /data-comments-toggle/u);
		assert.doesNotMatch(commentsComponentSource, /is-open/u);
	});

	test("评论脚本在页面加载后直接挂载 momo 组件，不依赖展开", async () => {
		const commentsScriptSource = await readFile("public/comments.js", "utf8");

		assert.match(commentsScriptSource, /momo-comment\.min\.js/u);
		assert.match(commentsScriptSource, /astro:page-load/u);
		// 挂载只做一次，且组件 bundle 跨导航不重复注入
		assert.match(commentsScriptSource, /commentsMounted/u);
		assert.match(commentsScriptSource, /__momoBundlePromise/u);
		assert.doesNotMatch(commentsScriptSource, /data-comments-toggle/u);
		assert.doesNotMatch(commentsScriptSource, /commentsLoaded/u);
	});

	test("站点配置只保留 momo 评论配置", async () => {
		const typesSource = await readFile("src/lib/types.ts", "utf8");

		assert.match(typesSource, /comments:/u);
		assert.match(typesSource, /lang:\s*"zh-CN"/u);
		assert.match(typesSource, /apiUrl:\s*"https:\/\/ffaff\.fun"/u);
		assert.doesNotMatch(typesSource, /giscus/u);
		assert.doesNotMatch(typesSource, /provider/u);
	});
});
