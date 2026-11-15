/**
 * momo-comments.js
 *
 * Momo-Backend 官方评论组件（`momo-comment.min.js`）的引导脚本。
 *
 * 为什么不在文章页直接写 `<script src="...">` + `momo.init()`：
 * 1. 站点用 Astro ClientRouter，客户端导航不会执行新文档里的外链脚本 ——
 *    评论容器已经是新 DOM，却没人再挂载它。表现是「直接打开文章有评论，
 *    从归档页点进来就只剩一片空白」，而且刷新一次又好；
 * 2. 只有文章页需要这 200KB，懒加载可以让首页/归档页完全不付这份代价；
 * 3. CDN 被墙或被 CSP 拦掉时必须给出可读提示，而不是永久停在加载态。
 *
 * 因此这里只做三件事：跟随 `astro:page-load` 重入、脚本只加载一次、
 * 挂载幂等（同一容器不会挂两次）。具体配置从容器 data-* 读取，
 * 不在脚本里硬编码任何地址。
 */
(() => {
	if (window.__momoCommentsBooted) return;
	window.__momoCommentsBooted = true;

	const SECTION_SELECTOR = "[data-momo-comment-section]";
	const ROOT_SELECTOR = "[data-momo-comment-root]";
	const ERROR_TEXT = "评论组件加载失败，请刷新页面重试。";

	/** 共享的加载 Promise：并发多次导航只会注入一个 <script>。 */
	let loader = null;

	/** 只加载一次 CDN 脚本；失败时清空缓存，允许下次导航重试。 */
	const loadComponent = (src) => {
		if (window.momo) return Promise.resolve(window.momo);
		if (loader) return loader;

		loader = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = src;
			script.async = true;
			// crossorigin 不设：jsDelivr 未开 CORS 时 script 标签本身也不需要，
			// 设了反而会因缺少 Access-Control-Allow-Origin 而加载失败。
			script.onload = () => {
				if (window.momo) resolve(window.momo);
				else reject(new Error("momo is not registered on window"));
			};
			script.onerror = () => reject(new Error("failed to load comment bundle"));
			document.head.appendChild(script);
		}).catch((error) => {
			loader = null;
			throw error;
		});

		return loader;
	};

	const mount = (section) => {
		const root = section.querySelector(ROOT_SELECTOR);
		if (!root || root.dataset.momoMounted === "1" || root.dataset.momoMounting === "1") return;

		const scriptUrl = section.dataset.scriptUrl;
		if (!scriptUrl || !root.id) return;

		root.dataset.momoMounting = "1";

		loadComponent(scriptUrl)
			.then((momo) => {
				// 组件自己会渲染「正在加载评论…」，清掉容器里可能残留的占位/错误文案
				root.replaceChildren();
				momo.init({
					el: `#${root.id}`,
					apiUrl: section.dataset.apiUrl,
					slugId: section.dataset.slugId,
					title: section.dataset.postTitle,
					lang: section.dataset.lang,
				});
				root.dataset.momoMounted = "1";
			})
			.catch((error) => {
				console.error("[momo-comments]", error);
				root.textContent = ERROR_TEXT;
			})
			.finally(() => {
				delete root.dataset.momoMounting;
			});
	};

	const init = () => {
		for (const section of document.querySelectorAll(SECTION_SELECTOR)) mount(section);
	};

	document.addEventListener("astro:page-load", init);
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
