import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("首页灵动交互保护", () => {
	test("首页会加载交互脚本且布局保留背景图钩子", async () => {
		const [homePageSource, baseLayoutSource] = await Promise.all([
			readFile("src/pages/index.astro", "utf8"),
			readFile("src/layouts/Base.astro", "utf8"),
		]);

		assert.match(homePageSource, /home-motion\.js/u);
		assert.match(baseLayoutSource, /site-shell-has-background-image/u);
	});

	test("首页 Hero 为单栏玻璃面板，旧的双栏 / 信号卡结构不再回流", async () => {
		const homePageSource = await readFile("src/pages/index.astro", "utf8");

		// 当前结构
		assert.match(homePageSource, /class="home-hero-copy glass-panel"/u);
		assert.match(homePageSource, /class="hero-body"/u);

		// 1.7 删除的双栏 Hero / 侧栏信号卡：模板里已无引用，样式也不该再出现，
		// 否则就是没人使用的死 CSS。这里只匹配**选择器**（带前导点），
		// 以免误伤样式块顶部那段"删掉了哪些类"的说明性注释。
		assert.doesNotMatch(homePageSource, /\.hero-signal-card/u);
		assert.doesNotMatch(homePageSource, /\.hero-main-media/u);
		assert.doesNotMatch(homePageSource, /\.hero-aura-primary/u);
		assert.doesNotMatch(homePageSource, /\.home-hero-side/u);
		assert.doesNotMatch(homePageSource, /\.hero-atmosphere/u);
	});

	test("首页会单独渲染置顶文章板块并将最近更新与置顶分离", async () => {
		const homePageSource = await readFile("src/pages/index.astro", "utf8");

		assert.match(homePageSource, /置顶文章/u);
		assert.match(homePageSource, /eq\(blogPosts\.isPinned, true\)/u);
		assert.match(homePageSource, /eq\(blogPosts\.isPinned, false\)/u);
		assert.match(homePageSource, /recentSectionSubheading/u);
	});

	test("首页仅在存在置顶文章时渲染置顶栏目", async () => {
		const homePageSource = await readFile("src/pages/index.astro", "utf8");

		assert.match(homePageSource, /pinnedPosts\.length > 0/u);
		assert.match(homePageSource, /pinnedPosts\.length > 0 && \(/u);
	});

	test("首页交互脚本会在切页后重新初始化并驱动卡片姿态变量", async () => {
		const homeMotionSource = await readFile("public/home-motion.js", "utf8");

		assert.match(homeMotionSource, /astro:page-load/u);
		assert.match(homeMotionSource, /astro:before-swap/u);
		assert.match(homeMotionSource, /--tilt-rotate-x/u);
		assert.match(homeMotionSource, /pointermove/u);
		assert.match(homeMotionSource, /mousemove/u);
		assert.match(homeMotionSource, /any-pointer:\s*fine/u);

		// 1.7 删除了 Hero 视差：`[data-hero-depth]` 与 --hero-pointer-* 已无 CSS 消费者，
		// 脚本不该再监听 scroll/pointer 去写一个没人读的变量。
		assert.doesNotMatch(homeMotionSource, /data-hero-depth/u);
		assert.doesNotMatch(homeMotionSource, /--hero-pointer-x/u);
	});

	test("首页首屏简介支持保留换行展示", async () => {
		const homePageSource = await readFile("src/pages/index.astro", "utf8");

		assert.match(homePageSource, /\.home-hero-copy \.page-intro/u);
		assert.match(homePageSource, /white-space:\s*pre-line/u);
	});
});
