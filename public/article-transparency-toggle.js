(function () {
	if (window.__articleTransparencyToggleInitialized) {
		return;
	}
	window.__articleTransparencyToggleInitialized = true;

	const STORAGE_KEY = "articleOpaqueMode";
	const ROOT = document.documentElement;

	const readPreference = () => {
		try {
			return window.localStorage.getItem(STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	};

	const writePreference = (enabled) => {
		try {
			window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
		} catch {
			// 私密模式或受限环境中忽略存储失败
		}
	};

	const setOpaqueMode = (enabled) => {
		ROOT.classList.toggle("article-opaque-mode", enabled);
	};

	const updateToggleLabel = (button, enabled) => {
		button.textContent = enabled ? "恢复透明度" : "取消透明度";
		button.setAttribute("aria-pressed", String(enabled));
	};

	const initArticleToggle = () => {
		const articleShell = document.querySelector(".article-shell");
		if (!(articleShell instanceof HTMLElement)) {
			setOpaqueMode(false);
			return;
		}

		const enabled = readPreference();
		setOpaqueMode(enabled);

		const toggleButton = document.querySelector(
			"[data-article-transparency-toggle]",
		);
		if (!(toggleButton instanceof HTMLButtonElement)) {
			return;
		}

		updateToggleLabel(toggleButton, enabled);
		if (toggleButton.dataset.bound === "true") {
			return;
		}
		toggleButton.dataset.bound = "true";

		toggleButton.addEventListener("click", () => {
			const nextEnabled = !ROOT.classList.contains("article-opaque-mode");
			setOpaqueMode(nextEnabled);
			writePreference(nextEnabled);
			updateToggleLabel(toggleButton, nextEnabled);
		});
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initArticleToggle, {
			once: true,
		});
	} else {
		initArticleToggle();
	}

	document.addEventListener("astro:page-load", initArticleToggle);
})();
