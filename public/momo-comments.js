/**
 * momo-comments.js
 *
 * Momo-Backend 官方评论组件（`momo-comment.min.js`）的引导脚本。
 *
 * 为什么不在文章页直接写 `<script src>` + `momo.init()`：
 * 1. 站点用 Astro ClientRouter，客户端导航**不会**执行新文档里的外链脚本 ——
 *    评论容器已经是新 DOM，却没人再挂载它。表现是「直接打开文章有评论，
 *    从归档页点进来就只剩一片空白」，刷新一次又好；
 * 2. 只有文章页需要这 228KB，不能让首页/归档页也付这份代价。
 *
 * 所以这里做三件事：
 * - **解析期就把同源组件包拉起来**（不等 page-load）：脚本标签一执行就发起请求，
 *   下载与后续 HTML 解析/CSS 并行。早期版本等到 `astro:page-load` 才注入，
 *   白白把一个 228KB 的请求推到了首屏之后；
 * - 跟随 `astro:page-load` 重入挂载（客户端导航后容器是新 DOM）；
 * - 加载/执行失败时给出可读提示，而不是永久停在加载态。
 *
 * 具体地址从容器 data-* 读取（`src/lib/comment.ts` 是唯一来源），不在这里硬编码。
 */
(() => {
	if (window.__momoCommentsBooted) return;
	window.__momoCommentsBooted = true;

	const SECTION_SELECTOR = "[data-momo-comment-section]";
	const ROOT_SELECTOR = "[data-momo-comment-root]";
	const ERROR_TEXT = "评论组件加载失败，请刷新页面重试。";

	/** 共享的加载 Promise：并发多次导航只会注入一个 <script>。 */
	let loader = null;

	/** 只加载一次组件包；失败时清空缓存，允许下次导航重试。 */
	const loadComponent = (src) => {
		if (window.momo) return Promise.resolve(window.momo);
		if (loader) return loader;

		loader = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = src;
			script.async = true;
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

	/*
	 * 关键：**在这里**就发起组件包请求，而不是等 page-load。
	 * 本脚本位于文章页 body 末尾、紧跟在评论容器之后，此刻开始下载可以与
	 * 剩下的 HTML 解析/CSS 计算并行；同源请求还能复用已有连接。
	 */
	const firstSection = document.querySelector(SECTION_SELECTOR);
	if (firstSection?.dataset.scriptUrl) {
		loadComponent(firstSection.dataset.scriptUrl).catch(() => {
			/* 失败提示在 mount() 里统一处理，这里只避免未捕获的 rejection */
		});
	}

	document.addEventListener("astro:page-load", init);
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
