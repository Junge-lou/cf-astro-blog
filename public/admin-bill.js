// 票面编辑器的实时预览同步。
//
// 只做一件事：把左侧表单里的 x / y / w / h / 状态改动立刻反馈到概览图的虚线框上，
// 让管理员在提交前就能看出区块会不会互相压住。真正的保存仍然走服务端表单提交。

(() => {
	const preview = document.querySelector("[data-bill-preview]");
	if (!preview) {
		return;
	}

	const zones = new Map();
	for (const node of preview.querySelectorAll("[data-zone]")) {
		zones.set(node.dataset.zone, node);
	}

	const applyGeometry = (zoneId, field, value) => {
		const node = zones.get(zoneId);
		if (!node) {
			return;
		}

		const numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			return;
		}

		if (field === "x") node.style.left = `${numeric}%`;
		else if (field === "y") node.style.top = `${numeric}%`;
		else if (field === "w") node.style.width = `${numeric}%`;
		else if (field === "h") node.style.height = `${numeric}%`;
	};

	const applyEnabled = (zoneId, value) => {
		const node = zones.get(zoneId);
		if (!node) {
			return;
		}
		node.dataset.enabled = value === "0" ? "false" : "true";
	};

	const applyCaption = (zoneId, value) => {
		const node = zones.get(zoneId);
		if (!node) {
			return;
		}
		const caption = node.querySelector("i");
		if (caption) {
			caption.textContent = value || caption.dataset.kind || "";
		}
	};

	// 组件图：路径变化时立刻铺进预览框；fit 决定铺图方式
	const zoneFits = new Map();
	const applyArt = (zoneId) => {
		const node = zones.get(zoneId);
		if (!node) {
			return;
		}
		const srcInput = document.querySelector(`input[name="artSrc_${zoneId}"]`);
		const src = srcInput instanceof HTMLInputElement ? srcInput.value.trim() : "";
		const fit = zoneFits.get(zoneId) || "contain";
		if (src) {
			node.style.backgroundImage = `url("${src}")`;
			node.style.backgroundSize =
				fit === "cover" ? "cover" : fit === "fill" ? "100% 100%" : "contain";
			node.dataset.hasArt = "true";
		} else {
			node.style.backgroundImage = "";
			node.dataset.hasArt = "false";
		}
	};

	// 记住每块原生的 kind 文案，清空覆盖时回退用
	for (const node of zones.values()) {
		const caption = node.querySelector("i");
		if (caption) {
			caption.dataset.kind = caption.textContent || "";
		}
	}

	document.addEventListener("input", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		const zoneId = target.dataset.zone;
		if (!zoneId) {
			return;
		}

		const field = target.dataset.billField;
		const value =
			target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : "";

		if (field === "enabled") {
			applyEnabled(zoneId, value);
			return;
		}
		if (field === "label") {
			applyCaption(zoneId, value.trim());
			return;
		}
		if (field === "artFit") {
			zoneFits.set(zoneId, value || "contain");
			applyArt(zoneId);
			return;
		}
		if (field === "artSrc") {
			applyArt(zoneId);
			return;
		}
		if (field === "x" || field === "y" || field === "w" || field === "h") {
			applyGeometry(zoneId, field, value);
		}
	});

	// 初始化每个区块的 fit，供 artSrc 输入时查
	for (const node of zones.values()) {
		const fitSelect = document.querySelector(`select[name="artFit_${node.dataset.zone}"]`);
		if (fitSelect instanceof HTMLSelectElement) {
			zoneFits.set(node.dataset.zone, fitSelect.value || "contain");
		}
	}

	// 改纸张色时让概览图跟着变色。只改 backgroundColor：
	// 直接写 style.background 会把整票边框图的 background-image 一起冲掉
	const paper = document.querySelector('[data-bill-color="paper"]');
	if (paper instanceof HTMLInputElement) {
		paper.addEventListener("input", () => {
			preview.style.backgroundColor = paper.value;
		});
	}
})();
