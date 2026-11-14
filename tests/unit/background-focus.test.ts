import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { loginPage } from "../../src/admin/views/login";

function extractRule(source: string, selector: string): string {
	const start = source.indexOf(selector);
	assert.ok(start >= 0, `未找到规则：${selector}`);

	const end = source.indexOf("\n}", start);
	assert.ok(end > start, `规则未闭合：${selector}`);

	return source.slice(start, end);
}

describe("背景图焦点计算", () => {
	test("首页背景图的位移按出血预算计算，且解除 base 层的宽度夹取", async () => {
		const css = await readFile("src/styles/global.css", "utf8");
		const block = extractRule(css, ".site-background-image {");

		// @layer base 的 img { max-width: 100% } 会把 116% 宽压回 100%，
		// 横向出血消失后焦点一右滑就露底，必须显式解除。
		assert.match(block, /max-width:\s*none/u);
		// 每侧出血 = (1.16 × scale − 1) / 2 个视口 = (50 × scale − 43.1)% 元素尺寸。
		assert.match(block, /var\(--bg-scale\) \* 50% - 43\.1%/u);
		assert.match(
			block,
			/calc\(\(50 - var\(--bg-focus-x\)\) \* 0\.02 \* var\(--bg-focus-travel\)\)/u,
		);
		assert.match(
			block,
			/calc\(\(50 - var\(--bg-focus-y\)\) \* 0\.02 \* var\(--bg-focus-travel\)\)/u,
		);
		// 旧实现写死 0.45%／焦点单位，极值 22.5%，是可用出血的 1.3–1.7 倍。
		assert.doesNotMatch(block, /0\.45%/u);
		// 会被动画覆盖的属性才需要 will-change。
		assert.doesNotMatch(block, /will-change:[^;]*object-position/u);
	});

	test("登录页输出与前台同名的背景变量，并复用同一套焦点公式", async () => {
		const html = loginPage({
			backgroundImageUrl: "https://example.com/background.webp",
			backgroundOpacity: 60,
			backgroundBlur: 12,
			backgroundScale: 130,
			backgroundPositionX: 30,
			backgroundPositionY: 70,
		});

		// 焦点是 0–100 的无单位数字，CSS 里要拿它做 calc 运算。
		assert.match(html, /--bg-focus-x: 30/u);
		assert.match(html, /--bg-focus-y: 70/u);
		assert.match(html, /--bg-blur: 12px/u);
		assert.match(html, /--bg-scale: 1\.3/u);
		assert.match(html, /--bg-opacity: 0\.6/u);

		const source = await readFile("src/admin/views/login.ts", "utf8");
		assert.match(source, /var\(--bg-scale\) \* 50% - 43\.1%/u);
		// object-position 只接受长度/百分比，拿到无单位数字会让整条声明失效。
		assert.doesNotMatch(source, /object-position:\s*var\(--bg-focus-x/u);
	});

	test("登录页的站点背景参数由 renderLoginPage 统一解析", async () => {
		const [loginView, authRoute, rateLimit] = await Promise.all([
			readFile("src/admin/views/login.ts", "utf8"),
			readFile("src/admin/routes/auth.ts", "utf8"),
			readFile("src/admin/middleware/rate-limit.ts", "utf8"),
		]);

		assert.match(loginView, /export async function renderLoginPage/u);
		assert.ok(
			!authRoute.includes("loginPage({"),
			"认证路由应统一走 renderLoginPage，直接调 loginPage 会丢掉背景参数",
		);
		assert.ok(!rateLimit.includes("loginPage({"), "限流中间件应统一走 renderLoginPage");
		assert.match(authRoute, /renderLoginPage\(c\.env/u);
		assert.match(rateLimit, /renderLoginPage\(c\.env/u);
	});

	test("后台预览图会随滑条实时套用背景参数", async () => {
		const [adminScript, layout, appearanceView, editorView] = await Promise.all([
			readFile("public/admin.js", "utf8"),
			readFile("src/admin/views/layout.ts", "utf8"),
			readFile("src/admin/routes/appearance.ts", "utf8"),
			readFile("src/admin/views/posts/editor.ts", "utf8"),
		]);

		assert.match(adminScript, /function applyBackgroundFocusPreview\(/u);
		assert.match(adminScript, /--bg-focus-x/u);
		assert.match(adminScript, /50 \+ values\.positionX/u);
		assert.match(layout, /\.bg-focus-preview \{/u);
		assert.match(layout, /var\(--bg-scale\) \* 58% - 50%/u);
		assert.match(appearanceView, /bg-focus-preview/u);
		assert.match(editorView, /cover-preview-image bg-focus-preview/u);
	});
});
