import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("页面过渡与跨页状态保护喵", () => {
	test("基础布局会关闭根节点默认淡化并为页面主体启用滑动过渡喵", async () => {
		const [baseLayoutSource, globalStylesSource] = await Promise.all([
			readFile("src/layouts/Base.astro", "utf8"),
			readFile("src/styles/global.css", "utf8"),
		]);

		assert.match(baseLayoutSource, /transition:animate="none"/u);
		assert.match(baseLayoutSource, /transition:name="page-shell"/u);
		assert.match(baseLayoutSource, /slide\(\{\s*duration:\s*"460ms"\s*\}\)/u);
		assert.match(globalStylesSource, /::view-transition-group\(page-shell\)/u);
		assert.match(
			globalStylesSource,
			/cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/u,
		);
	});

	test("主题脚本会在切页时保留根节点状态并重写顶层页面方向喵", async () => {
		const themeScriptSource = await readFile("public/theme.js", "utf8");

		assert.match(themeScriptSource, /astro:before-preparation/u);
		assert.match(themeScriptSource, /astro:before-swap/u);
		assert.match(themeScriptSource, /data-nav-condensed/u);
		assert.match(
			themeScriptSource,
			/syncRootAttributeToDocument\("data-theme"/u,
		);
		assert.match(themeScriptSource, /pathname === "\/search"/u);
		assert.match(themeScriptSource, /pathname === "\/"/u);
	});

	test("首页、归档与搜索页会共享顶部 Hero 和搜索入口的过渡命名喵", async () => {
		const [homePageSource, archivePageSource, searchPageSource] =
			await Promise.all([
				readFile("src/pages/index.astro", "utf8"),
				readFile("src/pages/blog/index.astro", "utf8"),
				readFile("src/pages/search.astro", "utf8"),
			]);

		assert.match(homePageSource, /transition:name="top-page-hero"/u);
		assert.match(archivePageSource, /transition:name="top-page-hero"/u);
		assert.match(searchPageSource, /transition:name="top-page-hero"/u);
		assert.match(homePageSource, /transition:name="search-entry"/u);
		assert.match(searchPageSource, /transition:name="search-entry"/u);
	});
});
