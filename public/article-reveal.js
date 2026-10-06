/**
 * article-reveal.js
 *
 * 仿 Momo 博客的 AOS fade-up 文字滑入效果：文章正文的直接子元素
 * 滚入视口时逐个上滑淡入，带递增 stagger 延迟。
 *
 * 防抖策略：
 * - 仅当 JS 可用时给 .article-prose 添加 .js-reveal（CSS 据此隐藏子元素），
 *   避免无 JS 场景下内容永久不可见。
 * - 尊重 prefers-reduced-motion，直接显示内容。
 * - 通过 IntersectionObserver 触发，一次后即解除观察。
 * - 扫描可重入：code-block-enhance.js 等脚本会把 <pre> 包装成
 *   <figure>（产生新的正文直接子元素），包装完成后会派发
 *   "prose:restructured" 事件，这里重新扫描未被标记的子元素并观察它们，
 *   否则新包装节点会一直停留在 CSS 的 opacity:0 隐藏态（刷新后代码块
 *   透明不可见的根因）。
 */
(() => {
	if (window.__articleRevealBooted) return;
	window.__articleRevealBooted = true;

	const PROSE_SELECTOR = ".article-prose";
	const STAGGER_MS = 60;
	const MAX_DELAY_MS = 420;

	const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const scan = (prose) => {
		const children = Array.from(prose.children);
		// 只处理尚未标记的直接子元素（重入扫描时跳过已观察节点）
		const items = children.filter((el) => !el.hasAttribute("data-reveal"));
		if (items.length === 0) return;

		for (const el of items) {
			const position = children.indexOf(el);
			const delay = Math.min(position * STAGGER_MS, MAX_DELAY_MS);
			el.setAttribute("data-reveal", "");
			el.style.setProperty("--reveal-delay", `${delay}ms`);
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						entry.target.classList.add("is-revealed");
						observer.unobserve(entry.target);
					}
				}
			},
			{ rootMargin: "0px 0px -10% 0px", threshold: 0.06 },
		);

		for (const el of items) {
			observer.observe(el);
		}
	};

	const init = () => {
		const prose = document.querySelector(PROSE_SELECTOR);
		if (!prose) return;

		if (!prose.classList.contains("js-reveal")) {
			if (prefersReducedMotion()) return;
			prose.classList.add("js-reveal");
		}

		scan(prose);
	};

	document.addEventListener("astro:page-load", init);
	// code-block-enhance.js 包装 <pre> 后派发；必须重新扫描，
	// 因为包装产生的 <figure> 是新的正文直接子元素
	document.addEventListener("prose:restructured", init);
	init();
})();
