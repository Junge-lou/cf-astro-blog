const slugInput = document.getElementById("slug");
const titleInput = document.getElementById("title");
const tagIdsInput = document.getElementById("tagIds");

function updateSlugFromTitle() {
	if (!(titleInput instanceof HTMLInputElement)) {
		return;
	}

	if (!(slugInput instanceof HTMLInputElement)) {
		return;
	}

	if (slugInput.dataset.manual === "true") {
		return;
	}

	slugInput.value = titleInput.value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function updateTagIds() {
	if (!(tagIdsInput instanceof HTMLInputElement)) {
		return;
	}

	const checkedValues = Array.from(
		document.querySelectorAll("input[data-tag-checkbox='true']"),
	)
		.filter(
			(node): node is HTMLInputElement =>
				node instanceof HTMLInputElement && node.checked,
		)
		.map((node) => node.value);

	tagIdsInput.value = checkedValues.join(",");
}

titleInput?.addEventListener("input", updateSlugFromTitle);

slugInput?.addEventListener("input", () => {
	if (slugInput instanceof HTMLInputElement) {
		slugInput.dataset.manual = "true";
	}
});

for (const checkbox of document.querySelectorAll("input[data-tag-checkbox='true']")) {
	checkbox.addEventListener("change", updateTagIds);
}

for (const button of document.querySelectorAll("button[data-copy-value]")) {
	button.addEventListener("click", async () => {
		const value = button.getAttribute("data-copy-value") ?? "";
		if (!value) {
			return;
		}

		await navigator.clipboard.writeText(value);
	});
}

for (const form of document.querySelectorAll("form[data-confirm-message]")) {
	form.addEventListener("submit", (event) => {
		const message = form.getAttribute("data-confirm-message");
		if (message && !window.confirm(message)) {
			event.preventDefault();
		}
	});
}

const appearanceStage = document.querySelector("[data-appearance-stage]");
const appearanceFocus = document.querySelector("[data-appearance-focus]");
const appearanceEmpty = document.querySelector("[data-appearance-empty]");
const uploadInput = document.querySelector("[data-appearance-upload-input]");
const appearanceControls = {
	backgroundScale: document.querySelector(
		'[data-appearance-control="backgroundScale"]',
	),
	backgroundBlur: document.querySelector(
		'[data-appearance-control="backgroundBlur"]',
	),
	backgroundPositionX: document.querySelector(
		'[data-appearance-control="backgroundPositionX"]',
	),
	backgroundPositionY: document.querySelector(
		'[data-appearance-control="backgroundPositionY"]',
	),
};

function updateAppearanceDisplay(name, value) {
	const target = document.querySelector(`[data-appearance-display="${name}"]`);
	if (!(target instanceof HTMLElement)) {
		return;
	}

	target.textContent =
		name === "backgroundBlur" ? `${value} px` : `${value}%`;
}

function ensureAppearanceImage() {
	if (!(appearanceStage instanceof HTMLElement)) {
		return null;
	}

	const existingImage = appearanceStage.querySelector("[data-appearance-image]");
	if (existingImage instanceof HTMLImageElement) {
		return existingImage;
	}

	const image = document.createElement("img");
	image.className = "appearance-stage-image";
	image.setAttribute("data-appearance-image", "");
	appearanceStage.insertBefore(image, appearanceStage.firstChild);
	appearanceEmpty?.remove();
	if (appearanceFocus instanceof HTMLElement) {
		appearanceFocus.hidden = false;
	}

	return image;
}

function updateAppearancePreview() {
	if (!(appearanceStage instanceof HTMLElement)) {
		return;
	}

	const scaleInput = appearanceControls.backgroundScale;
	const blurInput = appearanceControls.backgroundBlur;
	const positionXInput = appearanceControls.backgroundPositionX;
	const positionYInput = appearanceControls.backgroundPositionY;

	if (
		!(scaleInput instanceof HTMLInputElement) ||
		!(blurInput instanceof HTMLInputElement) ||
		!(positionXInput instanceof HTMLInputElement) ||
		!(positionYInput instanceof HTMLInputElement)
	) {
		return;
	}

	const scale = Number(scaleInput.value);
	const blur = Number(blurInput.value);
	const positionX = Number(positionXInput.value);
	const positionY = Number(positionYInput.value);

	updateAppearanceDisplay("backgroundScale", scale);
	updateAppearanceDisplay("backgroundBlur", blur);
	updateAppearanceDisplay("backgroundPositionX", positionX);
	updateAppearanceDisplay("backgroundPositionY", positionY);

	const image = appearanceStage?.querySelector("[data-appearance-image]");
	if (image instanceof HTMLImageElement) {
		image.style.objectPosition = `${positionX}% ${positionY}%`;
		image.style.filter = `blur(${blur}px) saturate(1.08)`;
		image.style.transform = `scale(${scale / 100})`;
	}

	if (appearanceFocus instanceof HTMLElement) {
		appearanceFocus.style.left = `${positionX}%`;
		appearanceFocus.style.top = `${positionY}%`;
	}
}

let appearanceObjectUrl = "";

uploadInput?.addEventListener("change", () => {
	if (!(uploadInput instanceof HTMLInputElement) || !uploadInput.files?.[0]) {
		return;
	}

	const image = ensureAppearanceImage();
	if (!(image instanceof HTMLImageElement)) {
		return;
	}

	if (appearanceObjectUrl) {
		URL.revokeObjectURL(appearanceObjectUrl);
	}

	appearanceObjectUrl = URL.createObjectURL(uploadInput.files[0]);
	image.src = appearanceObjectUrl;
	updateAppearancePreview();
});

let draggingAppearanceFocus = false;

function updateAppearanceFocusFromPointer(event) {
	if (!(appearanceStage instanceof HTMLElement)) {
		return;
	}

	const positionXInput = appearanceControls.backgroundPositionX;
	const positionYInput = appearanceControls.backgroundPositionY;
	if (
		!(positionXInput instanceof HTMLInputElement) ||
		!(positionYInput instanceof HTMLInputElement)
	) {
		return;
	}

	const rect = appearanceStage.getBoundingClientRect();
	const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
	const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));

	positionXInput.value = String(Math.round(x));
	positionYInput.value = String(Math.round(y));
	updateAppearancePreview();
}

appearanceStage?.addEventListener("pointerdown", (event) => {
	if (!(appearanceStage.querySelector("[data-appearance-image]") instanceof HTMLImageElement)) {
		return;
	}

	draggingAppearanceFocus = true;
	updateAppearanceFocusFromPointer(event);
});

window.addEventListener("pointermove", (event) => {
	if (!draggingAppearanceFocus) {
		return;
	}

	updateAppearanceFocusFromPointer(event);
});

window.addEventListener("pointerup", () => {
	draggingAppearanceFocus = false;
});

for (const control of Object.values(appearanceControls)) {
	control?.addEventListener("input", updateAppearancePreview);
}

updateAppearancePreview();
