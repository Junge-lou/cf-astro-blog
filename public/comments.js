(function () {
	const PANEL_SELECTOR = "[data-comments-panel]";
	const TOGGLE_SELECTOR = "[data-comments-toggle]";
	const BODY_SELECTOR = "[data-comments-body]";
	const HOST_SELECTOR = "[data-comments-host]";
	let disposeComments = () => {};

	const injectMomo = (panel, host) => {
		if (panel.dataset.commentsLoaded === "true") {
			return;
		}

		const apiUrl = panel.dataset.commentsApiUrl;
		const title = panel.dataset.commentsTitle;
		const slugId = panel.dataset.commentsSlugId;

		if (!apiUrl || !title || !slugId) {
			return;
		}

		host.innerHTML = "<div id=\"momo-comment\"></div>";

		const script = document.createElement("script");
		script.src = "/momo-comment.min.js";
		script.async = true;
		script.onload = () => {
			if (window.momo?.init) {
				window.momo.init({
					el: "#momo-comment",
					title,
					slugId,
					lang: panel.dataset.commentsLang || "zh-cn",
					apiUrl,
				});
			}
		};
		host.appendChild(script);
		panel.dataset.commentsLoaded = "true";
	};

	const setExpandedState = (panel, isOpen) => {
		const toggle = panel.querySelector(TOGGLE_SELECTOR);
		const body = panel.querySelector(BODY_SELECTOR);

		if (!(toggle instanceof HTMLButtonElement) || !(body instanceof HTMLElement)) {
			return;
		}

		panel.classList.toggle("is-open", isOpen);
		toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
		body.hidden = !isOpen;
	};

	const initComments = () => {
		disposeComments();

		const panel = document.querySelector(PANEL_SELECTOR);

		if (!(panel instanceof HTMLElement)) {
			return;
		}

		const host = panel.querySelector(HOST_SELECTOR);
		if (!(host instanceof HTMLElement)) {
			return;
		}

		const isReady = panel.dataset.commentsReady === "true";
		const toggle = panel.querySelector(TOGGLE_SELECTOR);

		if (!(toggle instanceof HTMLButtonElement)) {
			return;
		}

		const handleToggle = () => {
			const isOpen = !panel.classList.contains("is-open");
			setExpandedState(panel, isOpen);

			if (isOpen && isReady) {
				injectMomo(panel, host);
			}
		};

		setExpandedState(panel, false);
		toggle.addEventListener("click", handleToggle);

		disposeComments = () => {
			toggle.removeEventListener("click", handleToggle);
		};
	};

	document.addEventListener("astro:before-swap", () => disposeComments());
	document.addEventListener("astro:page-load", initComments);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initComments, { once: true });
	} else {
		initComments();
	}
})();
