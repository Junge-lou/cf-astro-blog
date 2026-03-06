(function () {
	const root = document.documentElement;

	const theme = localStorage.getItem("theme");
	if (theme === "dark" || theme === "light") {
		root.setAttribute("data-theme", theme);
	}

	let navTicking = false;

	const syncNavMetrics = () => {
		const viewportWidth = window.innerWidth || 1;
		const condensedWidth = Math.min(Math.max(viewportWidth - 16, 0), 1184);
		const condensedScale = Math.min(
			1,
			Math.max(0.6, condensedWidth / viewportWidth),
		);
		root.style.setProperty("--nav-condensed-scale", condensedScale.toFixed(4));
	};

	const syncNavState = () => {
		navTicking = false;
		syncNavMetrics();
		root.toggleAttribute("data-nav-condensed", window.scrollY > 28);
	};

	const requestNavSync = () => {
		if (navTicking) {
			return;
		}

		navTicking = true;
		window.requestAnimationFrame(syncNavState);
	};

	syncNavState();
	window.addEventListener("scroll", requestNavSync, { passive: true });
	window.addEventListener("resize", requestNavSync, { passive: true });
	document.addEventListener("astro:page-load", syncNavState);

	document.addEventListener("click", (event) => {
		if (!(event.target instanceof Element)) {
			return;
		}

		const toggle = event.target.closest(".theme-toggle");
		if (!toggle) {
			return;
		}

		const current = root.getAttribute("data-theme");
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;

		const next =
			current === "dark" || (!current && prefersDark) ? "light" : "dark";

		root.setAttribute("data-theme", next);
		localStorage.setItem("theme", next);
	});
})();
