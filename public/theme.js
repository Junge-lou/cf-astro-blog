(function () {
	const root = document.documentElement;

	const theme = localStorage.getItem("theme");
	if (theme === "dark" || theme === "light") {
		root.setAttribute("data-theme", theme);
	}

	const syncNavState = () => {
		root.toggleAttribute("data-nav-condensed", window.scrollY > 28);
	};

	syncNavState();
	window.addEventListener("scroll", syncNavState, { passive: true });
	window.addEventListener("resize", syncNavState, { passive: true });
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
