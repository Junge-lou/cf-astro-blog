import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("评论组件保护", () => {
	test("文章布局会挂载默认折叠的评论面板", async () => {
		const [postLayoutSource, commentsComponentSource] = await Promise.all([
			readFile("src/layouts/Post.astro", "utf8"),
			readFile("src/components/CommentsPanel.astro", "utf8"),
		]);

		assert.match(postLayoutSource, /<CommentsPanel/u);
		assert.match(postLayoutSource, /article-comments-card/u);
		assert.match(commentsComponentSource, /data-comments-panel/u);
		assert.match(commentsComponentSource, /data-comments-toggle/u);
		assert.match(commentsComponentSource, /aria-expanded="false"/u);
		assert.match(commentsComponentSource, /article-opaque-mode/u);
	});

	test("评论脚本会按展开时机懒加载 giscus 并同步主题", async () => {
		const commentsScriptSource = await readFile("public/comments.js", "utf8");

		assert.match(commentsScriptSource, /giscus\.app\/client\.js/u);
		assert.match(commentsScriptSource, /commentsLoaded/u);
		assert.match(commentsScriptSource, /MutationObserver/u);
		assert.match(commentsScriptSource, /astro:page-load/u);
	});

	test("站点配置会预留 momo 评论配置", async () => {
		const typesSource = await readFile("src/lib/types.ts", "utf8");

		assert.match(typesSource, /comments:/u);
		assert.match(typesSource, /provider:\s*"momo"/u);
		assert.match(typesSource, /lang:\s*"zh-CN"/u);
		assert.match(typesSource, /apiUrl:\s*"https:\/\/comments\.ffaff\.fun"/u);
	});
});
