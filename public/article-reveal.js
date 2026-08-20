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
 */
(function () {
	if (window.__articleRevealBooted) return;
	window.__articleRevealBooted = true;

	const PROSE_SELECTOR = ".article-prose";
	const STAGGER_MS = 60;
	const MAX_DELAY_MS = 420;

	const prefersReducedMotion = () =>
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const init = () => {
		const prose = document.querySelector(PROSE_SELECTOR);
		if (!prose || prose.classList.contains("js-reveal")) return;
		if (prefersReducedMotion()) return;

		const items = Array.from(prose.children);
		if (items.length === 0) return;

		prose.classList.add("js-reveal");

		let delay = 0;
		items.forEach((el) => {
			el.setAttribute("data-reveal", "");
			el.style.setProperty("--reveal-delay", `${delay}ms`);
			delay = Math.min(delay + STAGGER_MS, MAX_DELAY_MS);
		});

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

		items.forEach((el) => observer.observe(el));
	};

	document.addEventListener("astro:page-load", init);
	init();
})();
