import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

/**
 * 首页 Hero 侧栏的行为保护。
 *
 * 背景：侧栏曾经把卡片张数写死（置顶 1 张 + 最新 1 张），结果 `.hero-body` 与
 * `.hero-sidebar` 高度不匹配时侧栏里总有空白。现在的约定是：置顶固定 1 张，
 * 最新文章由 `public/hero-sidebar-fit.js` 按 `.hero-body` 的实测高度决定显示几张，
 * 窄屏固定两张。这几条断言就是防止有人把它改回写死。
 */
describe("首页 Hero 侧栏按高度决定文章个数", () => {
	test("侧栏渲染的是「置顶 1 张 + 最新 3 张候选」，不是两个固定变量", async () => {
		const [source, postCardSource] = await Promise.all([
			readFile("src/pages/index.astro", "utf8"),
			readFile("src/components/PostCard.astro", "utf8"),
		]);

		// 侧栏预算有具名常量：置顶 1 张 + 最新 3 张候选，而不是散落的字面量
		assert.match(source, /HERO_SIDEBAR_PINNED_COUNT = 1/u);
		assert.match(source, /HERO_SIDEBAR_RECENT_COUNT = 3/u);
		assert.match(source, /HERO_SIDEBAR_MAX_POSTS/u);
		assert.match(source, /pinnedPosts\.slice\(0,\s*HERO_SIDEBAR_PINNED_COUNT\)/u);
		assert.match(source, /recentPosts\.slice\(0,\s*HERO_SIDEBAR_RECENT_COUNT\)/u);
		assert.match(source, /heroPinnedPosts\.map\(/u);
		// 候选卡必须带序号，脚本靠它决定隐藏前几张；同时首屏先隐藏，避免闪一下
		assert.match(source, /sidebarPostIndex=\{index\}/u);
		assert.match(source, /sidebarHidden/u);
		assert.match(source, /data-hero-sidebar-fit="true"/u);
		// PostCard 必须显式接收并输出这两个属性：
		// Astro 不会把未声明的 data-* 透传到组件根节点，这一点踩过一次
		assert.match(postCardSource, /sidebarPostIndex\?: number/u);
		assert.match(postCardSource, /sidebarHidden\?: boolean/u);
		assert.match(postCardSource, /data-hero-sidebar-post=\{sidebarPostIndex/u);
		assert.match(postCardSource, /data-sidebar-hidden=\{sidebarHidden/u);
		// 回退护栏：不能再退回到「heroRecentPost 单张」的写死写法
		assert.doesNotMatch(source, /heroRecentPost/u);
	});

	test("候选卡的隐藏样式与模板用的属性选择器一致", async () => {
		const source = await readFile("src/pages/index.astro", "utf8");

		assert.match(
			source,
			/\[data-hero-sidebar-post\]\[data-sidebar-hidden\][\s\S]{0,40}display:\s*none/u,
		);
	});

	test("测量脚本按高度二分、窄屏固定、并接上切页生命周期", async () => {
		const script = await readFile("public/hero-sidebar-fit.js", "utf8");

		assert.match(script, /ResizeObserver/u);
		assert.match(script, /\(min-width:\s*768px\)/u);
		assert.match(script, /NARROW_VISIBLE_POSTS/u);
		assert.match(script, /astro:page-load/u);
		assert.match(script, /astro:before-swap/u);
		// 视图切换后旧节点失效，必须断开观察器与监听
		assert.match(script, /resizeObserver\.disconnect\(\)/u);
	});

	test("首页会加载这个脚本", async () => {
		const source = await readFile("src/pages/index.astro", "utf8");

		assert.match(source, /<script is:inline src="\/hero-sidebar-fit\.js"><\/script>/u);
	});

	test("渲染预算与脚本里的总数上限是同一个数（1 + 3 = 4）", async () => {
		const [source, script] = await Promise.all([
			readFile("src/pages/index.astro", "utf8"),
			readFile("public/hero-sidebar-fit.js", "utf8"),
		]);

		// 模板侧：预算由 2 + 3 相加得出，不写死 5，改张数时不会两边对不上
		assert.match(
			source,
			/HERO_SIDEBAR_MAX_POSTS = HERO_SIDEBAR_PINNED_COUNT \+ HERO_SIDEBAR_RECENT_COUNT/u,
		);
		// 脚本侧：可见总数被夹住，不能因为正文很高就把候选全放出来
		assert.match(script, /MAX_VISIBLE_POSTS = 5/u);
		assert.match(script, /MAX_VISIBLE_POSTS - pinned\.length/u);
	});

	test("卡片高度由张数与可用高度算出，并写回 CSS 变量", async () => {
		const [source, script] = await Promise.all([
			readFile("src/pages/index.astro", "utf8"),
			readFile("public/hero-sidebar-fit.js", "utf8"),
		]);

		// 脚本：候选卡高 = 剩余高度按张数均分，并夹在上限内
		assert.match(script, /ROW_VAR = "--hero-sidebar-card-row"/u);
		assert.match(script, /\(bodyHeight - fixed - GAP \* Math\.max\(0, count - 1\)\) \/ count/u);
		assert.match(script, /Math\.min\(rowHeight, CARD_MAX_HEIGHT\)/u);
		// 高度只写给候选卡：置顶卡里是固定比例的封面，拉伸只会把图裁掉
		assert.match(script, /setRowHeight\(card, index < count \? rowHeight : null\)/u);
		// CSS：候选卡 flex 均分，下限与上限必须与脚本常量一致（76px / 208px = 4.75rem / 13rem）
		assert.match(source, /flex: 1 1 auto/u);
		assert.match(source, /--hero-sidebar-card-min, 4\.75rem/u);
		assert.match(source, /--hero-sidebar-card-max, 13rem/u);
		// 置顶卡：保留封面，文字块在封面以下居中，封面有高度上限
		assert.match(source, /\.hero-sidebar :global\(\.post-compact-body\) \{[\s\S]{0,200}justify-content: center/u);
		assert.match(source, /\.hero-sidebar :global\(\.post-compact-cover\) \{[\s\S]{0,200}max-height/u);
	});
});
