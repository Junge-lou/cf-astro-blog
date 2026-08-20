/**
 * header-scroll-hide.js
 *
 * 仿 Momo 博客 #main-header：移动端下滚隐藏导航、上滚恢复；桌面端始终显示。
 * 通过给 <html> 添加/移除 data-header-hidden 属性驱动 CSS 过渡。
 */
(function () {
	if (window.__headerScrollHideBooted) return;
	window.__headerScrollHideBooted = true;

	const MOBILE_BREAKPOINT = 776;
	const HIDE_THRESHOLD = 100;

	let lastY = window.scrollY || 0;
	let ticking = false;

	const apply = () => {
		const y = window.scrollY || 0;
		const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
		const scrollingDown = y > lastY;

		if (isMobile && y > HIDE_THRESHOLD && scrollingDown) {
			document.documentElement.setAttribute("data-header-hidden", "true");
		} else {
			document.documentElement.removeAttribute("data-header-hidden");
		}
		lastY = y;
		ticking = false;
	};

	const onScroll = () => {
		if (!ticking) {
			window.requestAnimationFrame(apply);
			ticking = true;
		}
	};

	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", apply, { passive: true });
	apply();
})();
