import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { blogPosts } from "../../src/db/schema";
import {
	getPublicPostBySlugCondition,
	getPublicPostKeywordCondition,
	getPublicPostSearchCondition,
} from "../../src/lib/public-content";
import { buildProtectedAssetHeaders } from "../../src/lib/security";

const dialect = new SQLiteSyncDialect();

describe("公开内容保护", () => {
	test("文章详情过滤条件会限制为已发布或已到时的定时文章", () => {
		const compiled = dialect.sqlToQuery(
			sql`select * from ${blogPosts} where ${getPublicPostBySlugCondition("draft-post")}`,
		);

		assert.match(compiled.sql, /"blog_posts"\."slug" = \?/u);
		assert.match(compiled.sql, /"blog_posts"\."status" = \?/u);
		assert.ok(compiled.params.includes("draft-post"));
		assert.ok(compiled.params.includes("published"));
		assert.ok(compiled.params.includes("scheduled"));
	});

	test("搜索过滤条件会限制为已发布或已到时的定时文章", () => {
		const compiled = dialect.sqlToQuery(
			sql`select * from ${blogPosts} where ${getPublicPostSearchCondition("%draft%")}`,
		);

		assert.match(compiled.sql, /"blog_posts"\."status" = \?/u);
		assert.ok(compiled.params.includes("published"));
		assert.ok(compiled.params.includes("scheduled"));
		assert.equal(compiled.params.filter((value) => value === "%draft%").length, 3);
	});

	test("关键词过滤条件会覆盖标题、正文与摘要", () => {
		const compiled = dialect.sqlToQuery(
			sql`select * from ${blogPosts} where ${getPublicPostKeywordCondition("%astro%")}`,
		);

		assert.equal(compiled.params.filter((value) => value === "%astro%").length, 3);
		assert.match(compiled.sql, /"blog_posts"\."title" like \?/u);
		assert.match(compiled.sql, /"blog_posts"\."content" like \?/u);
		assert.match(compiled.sql, /"blog_posts"\."excerpt" like \?/u);
	});

	test("受保护资源响应头会禁用共享缓存", () => {
		const headers = buildProtectedAssetHeaders("image/png");

		assert.equal(headers["Content-Type"], "image/png");
		assert.equal(headers["Cache-Control"], "private, no-store, max-age=0");
		assert.equal(headers.Vary, "Cookie");
		assert.equal(headers.Pragma, "no-cache");
		assert.equal(headers["X-Content-Type-Options"], "nosniff");
	});
});

describe("源码回归保护", () => {
	test("公开文章详情页使用发布态过滤，搜索页由服务端直查 D1 实时检索", async () => {
		const [postPageSource, searchPageSource] = await Promise.all([
			readFile("src/pages/blog/[slug].astro", "utf8"),
			readFile("src/pages/search.astro", "utf8"),
		]);

		assert.match(postPageSource, /getPublicPostBySlugCondition/u);
		assert.match(postPageSource, /shouldCountPostViewOnce/u);
		assert.match(postPageSource, /buildPostViewDedupKey/u);
		assert.match(postPageSource, /VIEW_COUNT_DEDUP_TTL_SECONDS/u);
		assert.match(postPageSource, /env\.SESSION\.get/u);
		assert.match(postPageSource, /env\.SESSION\.put/u);
		assert.match(postPageSource, /viewCount:\s*sql`\$\{blogPosts\.viewCount\}\s*\+\s*1`/u);
		assert.match(postPageSource, /backgroundMode:\s*blogPosts\.backgroundMode/u);
		assert.match(postPageSource, /backgroundOverride=\{postBackgroundOverride\}/u);
		// 搜索页不再依赖 Pagefind 客户端索引，改为 SSR 直查 D1
		assert.match(searchPageSource, /getPublicPostVisibilityCondition/u);
		assert.match(searchPageSource, /getPublicPostKeywordCondition/u);
		assert.ok(!searchPageSource.includes("pagefind"));
	});

	test("主题切换组件不再包含内联脚本，并改由外置脚本接管", async () => {
		const [toggleSource, themeScriptSource, mediaRouteSource] = await Promise.all([
			readFile("src/components/ThemeToggle.astro", "utf8"),
			readFile("public/theme.js", "utf8"),
			readFile("src/admin/routes/media.ts", "utf8"),
		]);

		assert.ok(!toggleSource.includes("<script"));
		assert.match(themeScriptSource, /closest\("\.theme-toggle"\)/u);
		assert.match(themeScriptSource, /startViewTransition/u);
		assert.match(themeScriptSource, /data-theme-switching/u);
		assert.match(themeScriptSource, /clipPath/u);
		assert.match(mediaRouteSource, /buildProtectedAssetHeaders/u);
	});

	test("404 页面提供可交互终端彩蛋，并通过公开 AI 终端接口返回结果", async () => {
		const [notFoundPageSource, terminalScriptSource] = await Promise.all([
			readFile("src/pages/404.astro", "utf8"),
			readFile("public/not-found-terminal.js", "utf8"),
		]);

		assert.match(notFoundPageSource, /Astro\.response\.status = 404/u);
		assert.match(notFoundPageSource, /data-not-found-terminal="true"/u);
		assert.match(notFoundPageSource, /data-ai-endpoint="\/api\/ai\/terminal-404"/u);
		assert.match(notFoundPageSource, /guest@404:~\$/u);
		assert.match(notFoundPageSource, /\/not-found-terminal\.js/u);
		assert.match(terminalScriptSource, /\/api\/ai\/terminal-404/u);
		assert.match(terminalScriptSource, /TERMINAL_CLEAR/u);
		assert.match(terminalScriptSource, /guest@404:\$\{cwd\}\$/u);
		assert.match(terminalScriptSource, /cwd,/u);
		assert.match(terminalScriptSource, /history:\s*terminalState\.history/u);
		assert.match(terminalScriptSource, /TERMINAL_STORAGE_KEY/u);
		assert.match(terminalScriptSource, /window\.localStorage/u);
		assert.match(terminalScriptSource, /buildTerminalHistoryMessage/u);
		assert.match(terminalScriptSource, /normalizeTerminalPath/u);
		assert.match(
			terminalScriptSource,
			/command\.toLowerCase\(\)\s*===\s*"clear"\s*\|\|\s*command\.toLowerCase\(\)\s*===\s*"cls"[\s\S]*terminalState\.history\s*=\s*\[\]/u,
		);
		assert.match(
			terminalScriptSource,
			/reply\s*===\s*"TERMINAL_CLEAR"[\s\S]*terminalState\.history\s*=\s*\[\]/u,
		);
		assert.match(terminalScriptSource, /astro:page-load/u);
	});

	test("文章卡片封面不再被额外高斯遮罩并保持满高显示", async () => {
		const [postCardSource, postCardStyleSource] = await Promise.all([
			readFile("src/components/PostCard.astro", "utf8"),
			readFile("src/styles/post-card.css", "utf8"),
		]);

		assert.ok(!postCardStyleSource.includes("transform: scale(0.88);"));
		assert.ok(
			!postCardStyleSource.includes("backdrop-filter: blur(var(--post-card-cover-blur-effective))"),
		);
		assert.ok(!postCardSource.includes("post-card-cover-fallback"));
		assert.match(postCardSource, /post-card-no-cover/u);
		assert.match(postCardSource, /\{hasCover && \(/u);
		assert.match(postCardSource, /articleLengthLabel/u);
		assert.match(postCardSource, /articleReadingTimeLabel/u);
		assert.match(postCardSource, /<div class="pill-row"/u);
		assert.match(
			postCardSource,
			/<span class="pill">\{articleReadingTimeLabel\} · \{articleLengthLabel\}<\/span>/u,
		);
		assert.match(postCardStyleSource, /object-position: center;/u);
	});

	test("首页与归档会为文章卡片计算并传递阅读统计", async () => {
		const [homeSource, archiveSource] = await Promise.all([
			readFile("src/pages/index.astro", "utf8"),
			readFile("src/pages/blog/index.astro", "utf8"),
		]);

		assert.match(homeSource, /estimateArticleReadStats/u);
		assert.match(archiveSource, /estimateArticleReadStats/u);
		assert.match(homeSource, /estimatedReadingMinutes=\{post\.estimatedReadingMinutes\}/u);
		assert.match(archiveSource, /estimatedReadingMinutes=\{post\.estimatedReadingMinutes\}/u);
	});

	test("友链页只保留申请入口卡片，申请表移到独立页面", async () => {
		const [friendsSource, applyPageSource] = await Promise.all([
			readFile("src/pages/friends.astro", "utf8"),
			readFile("src/pages/friends/apply.astro", "utf8"),
		]);

		assert.ok(friendsSource.includes('href="/friends/apply"'));
		assert.ok(!friendsSource.includes('action="/api/friend-links/apply"'));
		assert.ok(applyPageSource.includes('action="/api/friend-links/apply"'));
		assert.ok(
			friendsSource.includes("--glass-panel-opacity: calc(var(--hero-card-opacity, 14) / 100);"),
		);
		assert.ok(friendsSource.includes("--glass-panel-blur: var(--hero-card-blur, 18px);"));
		assert.ok(
			applyPageSource.includes("--glass-panel-opacity: calc(var(--hero-card-opacity, 14) / 100);"),
		);
		assert.ok(applyPageSource.includes("--glass-panel-blur: var(--hero-card-blur, 18px);"));
		assert.ok(applyPageSource.includes("站点简介（可选）"));
		assert.doesNotMatch(applyPageSource, /<textarea[^>]*name="description"[^>]*required/u);
		assert.ok(applyPageSource.includes("https://challenges.cloudflare.com/turnstile/v0/api.js"));
		assert.ok(applyPageSource.includes('class="cf-turnstile"'));
		assert.ok(applyPageSource.includes("申请须知"));
		assert.ok(applyPageSource.includes("siteAppearanceSettings.friendApplyNotice"));
		assert.ok(applyPageSource.includes('<p class="page-intro">{friendApplyNotice}</p>'));
		assert.ok(applyPageSource.includes("white-space: pre-line;"));
	});

	test("友链申请接口会校验 Turnstile token", async () => {
		const source = await readFile("src/admin/routes/friend-links.ts", "utf8");

		assert.ok(source.includes("cf-turnstile-response"));
		assert.ok(source.includes("https://challenges.cloudflare.com/turnstile/v0/siteverify"));
		assert.match(source, /if \(!name \|\| !contact \|\| !siteUrl\)/u);
	});

	test("公共页面 CSP 放行 Turnstile 域名", async () => {
		const source = await readFile("src/middleware.ts", "utf8");
		assert.ok(source.includes("https://challenges.cloudflare.com"));
		assert.ok(source.includes('!normalizedPath.startsWith("/api/")'));
		// Pagefind WASM 已移除，CSP 不再放行 wasm-unsafe-eval
		assert.ok(!source.includes("'wasm-unsafe-eval'"));
	});

	test("公共页面中间件会对首页/归档/友链启用边缘缓存", async () => {
		const [source, keySource] = await Promise.all([
			readFile("src/middleware.ts", "utf8"),
			readFile("src/lib/edge-cache-key.ts", "utf8"),
		]);
		// 中间件负责缓存读写、响应头与安全头
		assert.ok(source.includes("getEdgeCache"));
		assert.ok(source.includes("X-Edge-Cache"));
		assert.ok(source.includes("s-maxage"));
		assert.ok(source.includes("buildEdgeCacheKeyUrl"));
		// TTL 路由表位于可单元测试的纯模块里
		// （行为级断言见 tests/unit/edge-cache-key.test.ts，避免只依赖源码文本）
		assert.ok(keySource.includes('case "/blog"'));
		assert.ok(keySource.includes('case "/friends"'));
	});

	test("搜索组件将标签筛选放入折叠面板并外显已选标签", async () => {
		const source = await readFile("src/components/Search.astro", "utf8");
		assert.ok(source.includes("search-tags-panel"));
		assert.ok(source.includes("search-selected-tags"));
		assert.ok(source.includes("search-selected-chip"));
		assert.ok(source.includes("调整标签（已选"));
	});

	test("搜索与表单占位文字使用主题自适应颜色变量，避免浅色背景下发灰难辨识", async () => {
		const [searchSource, globalStyleSource] = await Promise.all([
			readFile("src/components/Search.astro", "utf8"),
			readFile("src/styles/global.css", "utf8"),
		]);

		assert.ok(searchSource.includes("search-input::placeholder"));
		assert.ok(searchSource.includes("var(--color-text-placeholder)"));
		assert.ok(globalStyleSource.includes("--color-text-placeholder: #4b556a;"));
		assert.ok(globalStyleSource.includes("--color-text-placeholder: #b6c4dc;"));
		assert.match(
			globalStyleSource,
			/input::placeholder,\s*textarea::placeholder\s*\{[\s\S]*opacity:\s*1;/u,
		);
	});

	test("文章详情页支持目录导航并提供阅读去透明度开关", async () => {
		const [postLayoutSource, postPageSource, articleToggleScript] = await Promise.all([
			readFile("src/layouts/Post.astro", "utf8"),
			readFile("src/pages/blog/[slug].astro", "utf8"),
			readFile("public/article-transparency-toggle.js", "utf8"),
		]);

		assert.ok(postLayoutSource.includes("article-shell"));
		assert.ok(postLayoutSource.includes("article-shell-no-sidebar"));
		assert.ok(postLayoutSource.includes("article-sidebar"));
		assert.ok(postLayoutSource.includes("article-toc"));
		assert.ok(postLayoutSource.includes("align-self: stretch;"));
		assert.ok(postLayoutSource.includes("align-content: start;"));
		assert.ok(postLayoutSource.includes("grid-auto-rows: max-content;"));
		assert.ok(postLayoutSource.includes("data-article-transparency-toggle"));
		assert.ok(postLayoutSource.includes("article-transparency-toggle-compact"));
		assert.ok(postLayoutSource.includes("/article-transparency-toggle.js"));
		assert.ok(postLayoutSource.includes("article-opaque-mode"));
		assert.doesNotMatch(postLayoutSource, /article-profile/u);
		assert.doesNotMatch(postLayoutSource, /article-sidebar-sticky\.js/u);
		assert.match(postLayoutSource, /\.article-toc\s*\{[^}]*position:\s*sticky/u);
		assert.match(
			postLayoutSource,
			/\.article-toc\s*\{[^}]*top:\s*var\(--article-sidebar-sticky-top\)/u,
		);
		assert.doesNotMatch(postLayoutSource, /\.article-toc\s*\{[^}]*overflow:\s*auto/u);
		assert.match(postLayoutSource, /\.article-toc\s*\{[^}]*max-height/u);
		assert.match(postLayoutSource, /\.article-toc-body\s*\{[^}]*overflow-y:\s*auto/u);
		assert.ok(postLayoutSource.includes(".article-toc-item::before"));
		assert.ok(postLayoutSource.includes(".article-toc-list::before"));
		assert.doesNotMatch(postLayoutSource, /\.article-sidebar\s*\{[^}]*position:\s*sticky/u);
		assert.ok(postLayoutSource.includes("orientation: portrait"));
		assert.doesNotMatch(postPageSource, /articleSidebar/u);
		assert.doesNotMatch(postPageSource, /getSiteAppearance/u);
		assert.ok(postPageSource.includes("renderSafeMarkdownWithToc"));
		assert.ok(postPageSource.includes("toc={toc}"));
		assert.ok(articleToggleScript.includes("articleOpaqueMode"));
		assert.ok(articleToggleScript.includes("querySelectorAll"));
		assert.ok(articleToggleScript.includes("astro:page-load"));
		assert.ok(articleToggleScript.includes("startViewTransition"));
		assert.ok(articleToggleScript.includes("data-article-transparency-switching"));
		assert.ok(articleToggleScript.includes("clipPath"));
	});

	test("文章代码块启用 Mac 终端样式增强与复制按钮脚本", async () => {
		const [postLayoutSource, scriptSource, globalStyleSource] = await Promise.all([
			readFile("src/layouts/Post.astro", "utf8"),
			readFile("public/code-block-enhance.js", "utf8"),
			readFile("src/styles/global.css", "utf8"),
		]);

		assert.ok(postLayoutSource.includes("/code-block-enhance.js"));
		assert.ok(scriptSource.includes("prose-code-block"));
		assert.ok(scriptSource.includes("prose-code-head"));
		assert.ok(scriptSource.includes("prose-code-copy"));
		assert.ok(scriptSource.includes("code-window-dot-close"));
		assert.ok(scriptSource.includes("code-window-dot-minimize"));
		assert.ok(scriptSource.includes("code-window-dot-zoom"));
		assert.ok(scriptSource.includes("language-"));
		assert.ok(globalStyleSource.includes(".prose .prose-code-head"));
		assert.ok(globalStyleSource.includes(".prose .code-window-dot"));
		assert.ok(globalStyleSource.includes(".prose .prose-code-copy"));
		assert.ok(globalStyleSource.includes(".prose .prose-code-block pre"));
	});

	test("代码块包装后会通知 reveal 重扫描，避免刷新后代码块透明不可见", async () => {
		const [enhanceScript, revealScript, globalStyleSource, postLayoutSource] = await Promise.all([
			readFile("public/code-block-enhance.js", "utf8"),
			readFile("public/article-reveal.js", "utf8"),
			readFile("src/styles/global.css", "utf8"),
			readFile("src/layouts/Post.astro", "utf8"),
		]);

		// 硬刷新时 article-reveal.js 先执行（无 readyState 守卫），
		// code-block-enhance.js 等 DOMContentLoaded 后把 <pre> 包进 <figure>；
		// 新的正文直接子元素 <figure> 必须触发 reveal 重扫描，否则永远 opacity:0
		assert.ok(enhanceScript.includes("prose:restructured"));
		assert.ok(enhanceScript.includes("CustomEvent"));
		assert.ok(
			enhanceScript.includes('preElement.removeAttribute("data-reveal")'),
			"包装时应清理 pre 上失效的 reveal 标记",
		);
		assert.ok(revealScript.includes("prose:restructured"));
		// 重扫描必须可重入：跳过已标记的子元素，只处理新增节点
		assert.ok(revealScript.includes('!el.hasAttribute("data-reveal")'));
		// reveal 不得再因 js-reveal 已存在而提前返回（否则重扫描被跳过）
		assert.doesNotMatch(revealScript, /classList\.contains\("js-reveal"\)\)\s*return/u);
		// CSS 隐藏态必须以直接子元素为目标（包装节点 figure 会成为直接子元素）
		assert.match(globalStyleSource, /\.article-prose\.js-reveal\s*>\s*\*/u);
		// 两个脚本的加载顺序：enhance 在 reveal 之前
		const enhanceIndex = postLayoutSource.indexOf("/code-block-enhance.js");
		const revealIndex = postLayoutSource.indexOf("/article-reveal.js");
		assert.ok(enhanceIndex !== -1 && revealIndex !== -1 && enhanceIndex < revealIndex);
	});

	test("全局字体配置会加载文楷与分层英文字体", async () => {
		const [globalStyleSource, packageSource, postLayoutSource] = await Promise.all([
			readFile("src/styles/global.css", "utf8"),
			readFile("package.json", "utf8"),
			readFile("src/layouts/Post.astro", "utf8"),
		]);
		const dependencies =
			(
				JSON.parse(packageSource) as {
					dependencies?: Record<string, string>;
				}
			).dependencies ?? {};

		// 全站共享的字体：只保留**拉丁字形**字体；CJK 一律走系统字体。
		//
		// 为什么 CJK 不引入网络字体：实测每页字体下载量（scripts/analyze-font-payload.mjs）
		// 显示，LXGW WenKai 常规子集是每页最大的单项资产——首页 653 KB、文章页 543 KB；
		// 其粗体部分更是仅为了给 logo 等几个 UI 标签加粗，就在**每个页面**恒定多下 122 KB。
		// 因此整族移除，CJK 交由系统字体渲染。
		assert.ok(!dependencies["lxgw-wenkai-webfont"]);
		assert.ok(dependencies["@fontsource-variable/lora"]);
		assert.ok(dependencies["@fontsource/cormorant-garamond"]);
		assert.ok(dependencies["@fontsource/space-grotesk"]);
		assert.ok(globalStyleSource.includes('@import "@fontsource-variable/lora/wght.css";'));
		assert.ok(globalStyleSource.includes('@import "@fontsource-variable/lora/wght-italic.css";'));
		assert.ok(
			globalStyleSource.includes('@import "@fontsource/cormorant-garamond/500-italic.css";'),
		);
		assert.ok(globalStyleSource.includes('@import "@fontsource/space-grotesk/700.css";'));
		// 断言针对 **@import 语句**而不是"源码里出现过这个字符串"——global.css 的
		// 注释里正当地提到了这个包名，按字符串判断会误报。
		assert.doesNotMatch(
			globalStyleSource,
			/@import\s+"lxgw-wenkai-webfont\//u,
			"重新引入 CJK 网络字体前，请先用 npm run fonts:payload 复测每页下载量",
		);
		// 西文字体在前、系统 CJK 族在后。用正则而不是 `includes("--font-serif-body: X")`：
		// 格式化工具会把长字体栈折到下一行，按"同一行字符串"断言会无谓地失败。
		assert.match(
			globalStyleSource,
			/--font-serif-body:\s*"Lora Variable",\s*"Songti SC",[\s\S]*?serif;/u,
		);
		assert.match(
			globalStyleSource,
			/--font-serif-em:\s*"Cormorant Garamond",\s*"Songti SC",[\s\S]*?serif;/u,
		);
		assert.match(
			globalStyleSource,
			/--font-strong:\s*"Space Grotesk",\s*"PingFang SC",[\s\S]*?sans-serif;/u,
		);
		// 任何字体栈里都不应再出现 CJK 网络字体族名
		assert.doesNotMatch(globalStyleSource, /"LXGW WenKai"/u);

		// 回归保护：本文件会被打进每个页面共享且渲染阻塞的 Base.css，因此禁止把
		// 大体积或单页专用的字体放进来。
		// Shippori Mincho 曾在此贡献 244 条 @font-face / 261.6 KB（占当时 Base.css
		// 534 KB 的近一半），但它在每个字体栈里都排在覆盖 CJK 的 LXGW WenKai 之后，
		// 456 个字体文件几乎永远不会被请求。
		assert.ok(!dependencies["@fontsource/shippori-mincho"]);
		assert.doesNotMatch(globalStyleSource, /shippori-mincho/iu);
		assert.doesNotMatch(globalStyleSource, /"Shippori Mincho"/u);
		// KaTeX 只服务文章正文的公式，必须留在文章详情页专属的布局里
		assert.doesNotMatch(globalStyleSource, /katex\.min\.css/u);
		assert.ok(postLayoutSource.includes("katex/dist/katex.min.css"));
		assert.ok(globalStyleSource.includes("body {"));
		assert.ok(globalStyleSource.includes(".prose p {"));
		assert.ok(globalStyleSource.includes(".prose blockquote {"));
		assert.ok(globalStyleSource.includes(".prose blockquote > :first-child {"));
		assert.ok(globalStyleSource.includes(".prose blockquote > :last-child {"));
		assert.ok(globalStyleSource.includes(".prose em {"));
		assert.ok(globalStyleSource.includes(".prose strong {"));
	});

	test("后台文章变更即时生效：缓存版本号失效 + 轻量 Webmention 任务", async () => {
		const [
			postRouteSource,
			workflowSource,
			middlewareSource,
			contentVersionSource,
			edgeCacheKeySource,
		] = await Promise.all([
			readFile("src/admin/routes/posts.ts", "utf8"),
			readFile(".github/workflows/auto-deploy-from-admin.yml", "utf8"),
			readFile("src/middleware.ts", "utf8"),
			readFile("src/lib/content-version.ts", "utf8"),
			readFile("src/lib/edge-cache-key.ts", "utf8"),
		]);

		// 发文/改文/删文：递增缓存版本号即时生效；Webmention 走 Actions 轻量任务（不整站构建）
		assert.ok(postRouteSource.includes("handlePublicContentChange"));
		assert.ok(postRouteSource.includes("bumpContentCacheVersion"));
		assert.ok(postRouteSource.includes("triggerDeployHook"));
		assert.ok(!postRouteSource.includes("sendWebmentionsForPost"));
		// 边缘缓存键携带内容版本号（键的构造在可单测的纯模块里）
		assert.ok(contentVersionSource.includes("CONTENT_VERSION_KEY"));
		assert.ok(edgeCacheKeySource.includes("__cv"));
		assert.ok(middlewareSource.includes("getContentCacheVersion"));
		// dispatch 触发轻量 Webmention 任务，push 触发完整部署 + 补发
		assert.ok(workflowSource.includes("repository_dispatch"));
		assert.ok(workflowSource.includes("WEBMENTION_ONLY"));
		assert.ok(workflowSource.includes("send-webmentions.mjs"));
		assert.ok(workflowSource.includes("npm run deploy"));
	});

	test("后台文章创建与编辑支持手动设置发布日期", async () => {
		const postRouteSource = await readFile("src/admin/routes/posts.ts", "utf8");

		assert.match(postRouteSource, /sanitizePlainText\(body\.publishedAt/u);
		assert.match(postRouteSource, /发布日期格式不合法/u);
		assert.match(
			postRouteSource,
			/postInput\.status === "published" \? \(postInput\.publishedAt \?\? now\) : null/u,
		);
		assert.match(
			postRouteSource,
			/postInput\.publishedAt \?\?\s*\(existing\.status === "published"/u,
		);
		assert.match(postRouteSource, /publishedAt,/u);
	});
});
