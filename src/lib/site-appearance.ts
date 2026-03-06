import { eq } from "drizzle-orm";
import { siteAppearanceSettings } from "@/db/schema";
import type { Database } from "@/lib/db";
import { sanitizeMediaKey } from "@/lib/security";

export interface SiteAppearance {
	backgroundImageKey: string | null;
	backgroundBlur: number;
	backgroundScale: number;
	backgroundPositionX: number;
	backgroundPositionY: number;
}

export const DEFAULT_SITE_APPEARANCE: SiteAppearance = {
	backgroundImageKey: null,
	backgroundBlur: 24,
	backgroundScale: 112,
	backgroundPositionX: 50,
	backgroundPositionY: 50,
};

function clampInteger(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function normalizeSiteAppearanceInput(
	input: Partial<SiteAppearance>,
): SiteAppearance {
	return {
		backgroundImageKey: input.backgroundImageKey
			? sanitizeMediaKey(input.backgroundImageKey)
			: null,
		backgroundBlur: clampInteger(
			input.backgroundBlur,
			0,
			60,
			DEFAULT_SITE_APPEARANCE.backgroundBlur,
		),
		backgroundScale: clampInteger(
			input.backgroundScale,
			100,
			180,
			DEFAULT_SITE_APPEARANCE.backgroundScale,
		),
		backgroundPositionX: clampInteger(
			input.backgroundPositionX,
			0,
			100,
			DEFAULT_SITE_APPEARANCE.backgroundPositionX,
		),
		backgroundPositionY: clampInteger(
			input.backgroundPositionY,
			0,
			100,
			DEFAULT_SITE_APPEARANCE.backgroundPositionY,
		),
	};
}

export async function getSiteAppearance(db: Database): Promise<SiteAppearance> {
	const [row] = await db
		.select({
			backgroundImageKey: siteAppearanceSettings.backgroundImageKey,
			backgroundBlur: siteAppearanceSettings.backgroundBlur,
			backgroundScale: siteAppearanceSettings.backgroundScale,
			backgroundPositionX: siteAppearanceSettings.backgroundPositionX,
			backgroundPositionY: siteAppearanceSettings.backgroundPositionY,
		})
		.from(siteAppearanceSettings)
		.where(eq(siteAppearanceSettings.id, 1))
		.limit(1);

	if (!row) {
		return DEFAULT_SITE_APPEARANCE;
	}

	return normalizeSiteAppearanceInput(row);
}

export async function saveSiteAppearance(
	db: Database,
	input: Partial<SiteAppearance>,
) {
	const normalized = normalizeSiteAppearanceInput(input);

	await db
		.insert(siteAppearanceSettings)
		.values({
			id: 1,
			backgroundImageKey: normalized.backgroundImageKey,
			backgroundBlur: normalized.backgroundBlur,
			backgroundScale: normalized.backgroundScale,
			backgroundPositionX: normalized.backgroundPositionX,
			backgroundPositionY: normalized.backgroundPositionY,
		})
		.onConflictDoUpdate({
			target: siteAppearanceSettings.id,
			set: {
				backgroundImageKey: normalized.backgroundImageKey,
				backgroundBlur: normalized.backgroundBlur,
				backgroundScale: normalized.backgroundScale,
				backgroundPositionX: normalized.backgroundPositionX,
				backgroundPositionY: normalized.backgroundPositionY,
			},
		});

	return normalized;
}

export function buildBackgroundImageUrl(key: string | null) {
	return key ? `/media/${key}` : null;
}
