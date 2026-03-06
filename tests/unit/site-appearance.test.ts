import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildBackgroundImageUrl,
	DEFAULT_SITE_APPEARANCE,
	normalizeSiteAppearanceInput,
} from "../../src/lib/site-appearance";

describe("站点外观设置喵", () => {
	test("normalizeSiteAppearanceInput 会约束裁切和模糊范围喵", () => {
		const normalized = normalizeSiteAppearanceInput({
			backgroundImageKey: "appearance/background/2026-03-07/example.webp",
			backgroundBlur: 88,
			backgroundScale: 220,
			backgroundPositionX: -10,
			backgroundPositionY: 140,
		});

		assert.equal(
			normalized.backgroundImageKey,
			"appearance/background/2026-03-07/example.webp",
		);
		assert.equal(normalized.backgroundBlur, 60);
		assert.equal(normalized.backgroundScale, 180);
		assert.equal(normalized.backgroundPositionX, 0);
		assert.equal(normalized.backgroundPositionY, 100);
	});

	test("normalizeSiteAppearanceInput 会回退到默认值喵", () => {
		const normalized = normalizeSiteAppearanceInput({
			backgroundImageKey: "%%%bad-key%%%",
		});

		assert.deepEqual(normalized, DEFAULT_SITE_APPEARANCE);
	});

	test("buildBackgroundImageUrl 会生成公开媒体地址喵", () => {
		assert.equal(
			buildBackgroundImageUrl("appearance/background/2026-03-07/example.webp"),
			"/media/appearance/background/2026-03-07/example.webp",
		);
		assert.equal(buildBackgroundImageUrl(null), null);
	});
});
