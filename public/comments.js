(() => {
	const PANEL_SELECTOR = "[data-comments-panel]";
	const HOST_SELECTOR = "[data-comments-host]";
	const BUNDLE_SRC = "/momo-comment.min.js";

	/*
	 * 评论区不再折叠，所以挂载只做一次就行。
	 * 组件 bundle 只加载一次：客户端路由切到另一篇文章时本脚本会重新执行，
	 * 之前每次都会再 append 一个 <script>（连带重复注入一份组件样式），
	 * 这里用 window 上的 promise 做跨导航去重。
	 */
	const loadBundle = () => {
		if (window.momo?.init) {
			return Promise.resolve(window.momo);
		}

		if (window.__momoBundlePromise) {
			return window.__momoBundlePromise;
		}

		window.__momoBundlePromise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = BUNDLE_SRC;
			script.async = true;
			script.dataset.momoBundle = "true";
			script.addEventListener("load", () => resolve(window.momo));
			script.addEventListener("error", () => reject(new Error("momo bundle failed")));
			document.head.appendChild(script);
		}).catch(() => null);

		return window.__momoBundlePromise;
	};

	const mount = async (panel) => {
		if (panel.dataset.commentsMounted === "true" || panel.dataset.commentsReady !== "true") {
			return;
		}

		const host = panel.querySelector(HOST_SELECTOR);
		if (!(host instanceof HTMLElement)) {
			return;
		}

		const apiUrl = panel.dataset.commentsApiUrl;
		const title = panel.dataset.commentsTitle;
		const slugId = panel.dataset.commentsSlugId;

		if (!apiUrl || !title || !slugId) {
			return;
		}

		panel.dataset.commentsMounted = "true";
		host.innerHTML = '<div id="momo-comment"></div>';

		const bundle = await loadBundle();

		if (!bundle || typeof bundle.init !== "function") {
			host.innerHTML = '<p class="comments-error">评论组件加载失败，请稍后刷新重试。</p>';
			panel.dataset.commentsMounted = "false";
			return;
		}

		bundle.init({
			el: "#momo-comment",
			title,
			slugId,
			lang: panel.dataset.commentsLang || "zh-cn",
			apiUrl,
		});
	};

	const initComments = () => {
		document.querySelectorAll(PANEL_SELECTOR).forEach((panel) => {
			if (panel instanceof HTMLElement) {
				mount(panel);
			}
		});
	};

	document.addEventListener("astro:page-load", initComments);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initComments, { once: true });
	} else {
		initComments();
	}
})();
