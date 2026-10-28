import { eq, sql } from "drizzle-orm";
import { siteAppearanceSettings } from "@/db/schema";
import {
	BILL_TEXT_MM,
	type BillSheetConfig,
	type BillZone,
	type BillZoneArt,
	type BillZoneKind,
	DEFAULT_BILL_SHEET_CONFIG,
	DEFAULT_BILL_ZONES,
} from "@/lib/bill-config";
import type { Database } from "@/lib/db";
import { sanitizePlainText } from "@/lib/security";

/**
 * 票面配置：后台可编排的全部内容。
 *
 * 三个部分是分开存的，因为它们的修改频率与校验规则完全不同：
 *   config —— 纸张、墨色、纹样密度这些"全局观感"，改一次影响整张票面
 *   zones  —— 区块几何与目标链接，最常改
 *   textMm —— 实测字高，只在重新标定参考图时才动
 */
export interface BillSettings {
	config: BillSheetConfig;
	zones: BillZone[];
	textMm: Record<string, number>;
}

export const DEFAULT_BILL_SETTINGS: BillSettings = {
	config: DEFAULT_BILL_SHEET_CONFIG,
	zones: DEFAULT_BILL_ZONES,
	textMm: BILL_TEXT_MM,
};

/** 已知区块 id。组件里的铭文表按 id 索引，所以不允许后台凭空造新 id。 */
const KNOWN_ZONE_IDS = new Set(DEFAULT_BILL_ZONES.map((zone) => zone.id));

const ZONE_KINDS = new Set<BillZoneKind>([
	"portrait",
	"denomination",
	"rule",
	"serial",
	"seal",
	"signature",
	"marker",
	"legal",
]);

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(numeric * 100) / 100));
}

function asText(value: unknown, maxLength: number, fallback = ""): string {
	if (typeof value !== "string") {
		return fallback;
	}
	return sanitizePlainText(value, maxLength).trim();
}

/**
 * 链接白名单：只放行站内绝对路径与 http(s)。
 *
 * 票面区块是 `<a href>`，如果放任后台填 `javascript:` 就等于开放 XSS。
 * 空串表示"不可点"，调用方会渲染成 `<span>`。
 */
function asHref(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	const href = value.trim();
	if (href === "") {
		return "";
	}
	if (href.length > 300) {
		return "";
	}
	if (href.startsWith("/") && !href.startsWith("//")) {
		return href;
	}
	if (/^https?:\/\//i.test(href)) {
		return href;
	}
	return "";
}

const ART_FITS = new Set(["contain", "cover", "fill"]);
const ART_BLENDS = new Set(["normal", "multiply"]);

/**
 * 整票边框图 / 组件图的路径白名单：只允许 /bill/ 下的站内资源。
 * 防外链（http://）、防协议注入（javascript:）、防目录穿越（..）、防协议相对（//）。
 */
function asBillAssetPath(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	const src = value.trim();
	if (!src.startsWith("/bill/") || src.includes("..") || src.length > 120) {
		return "";
	}
	// 只允许安全字符，杜绝引号/空白/控制字符注入到 HTML 属性
	if (!/^\/bill\/[\w./-]+$/.test(src)) {
		return "";
	}
	return src;
}

/**
 * 组件图归一化。`art` 无有效 src 时整体丢弃——渲染层见到无 art 就回退文本解算，
 * 这是票面换图方案的回滚开关（见 docs/bill-image-components-plan.md §3）。
 */
function asArt(value: unknown): BillZoneArt | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const src = asBillAssetPath(candidate.src);
	if (!src) {
		return undefined;
	}
	const art: BillZoneArt = { src };
	if (typeof candidate.fit === "string" && ART_FITS.has(candidate.fit)) {
		art.fit = candidate.fit as BillZoneArt["fit"];
	}
	if (typeof candidate.blend === "string" && ART_BLENDS.has(candidate.blend)) {
		art.blend = candidate.blend as BillZoneArt["blend"];
	}
	if (candidate.opacity !== undefined) {
		art.opacity = clamp(candidate.opacity, 0, 1, 1);
	}
	if (candidate.align !== undefined) {
		// 限长 24：object-position 只需要 "center 30%" 这种短词
		const align = asText(candidate.align, 24);
		if (align) {
			art.align = align;
		}
	}
	return art;
}

/**
 * 区块 `x` 的下限（百分比）。取负值是允许的：票面文字在区块盒内居中，
 * 某些铭文为了左缘对齐必须让盒子左边伸到票面外（如 Z4 的 x = −1.25），
 * 外溢部分由 `.bill` 的 overflow:hidden 裁掉。−5% ≈ 7.8 mm，够用且不至于离谱。
 */
export const BILL_ZONE_MIN_X = -5;

/**
 * 几何约束：百分比，且区块不得越出票面（x 允许到 BILL_ZONE_MIN_X，见上）。
 */
function asGeometry(raw: Partial<BillZone>, fallback: BillZone): BillZone {
	// 左上角先留出最小尺寸的余量，否则 x=100 时 maxW 会变成 0，
	// clamp 的上下界颠倒，结果会算出 w=100 / h=0 这种离谱值。
	const x = clamp(raw.x, BILL_ZONE_MIN_X, 99, fallback.x);
	const y = clamp(raw.y, 0, 99, fallback.y);
	// x 可以为负，此时 100 − x 会大于 100，已自动放宽 w 的上限，无需额外处理
	const w = clamp(raw.w, 0.5, Math.max(0.5, 100 - x), fallback.w);
	const h = clamp(raw.h, 0.5, Math.max(0.5, 100 - y), fallback.h);
	return { ...fallback, x, y, w, h };
}

/**
 * 把任意输入规整成完整的 BillSettings。
 *
 * 输入可能来自：数据库里的历史 JSON、后台表单、或者未来某个 API。
 * 所以这里对每个字段都做"类型不对就回退默认值"，而不是抛错——
 * 首页不应该因为一条脏配置就整页打不开。
 */
export function normalizeBillSettingsInput(raw: unknown): BillSettings {
	const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

	const rawConfig = (
		source.config && typeof source.config === "object" ? source.config : {}
	) as Record<string, unknown>;
	const config: BillSheetConfig = {
		// 票面比例跟着实物走，不允许后台改坏，否则所有毫米换算都会失准
		aspectRatio: DEFAULT_BILL_SHEET_CONFIG.aspectRatio,
		paperColor: COLOR_PATTERN.test(String(rawConfig.paperColor ?? ""))
			? String(rawConfig.paperColor)
			: DEFAULT_BILL_SHEET_CONFIG.paperColor,
		inkColor: COLOR_PATTERN.test(String(rawConfig.inkColor ?? ""))
			? String(rawConfig.inkColor)
			: DEFAULT_BILL_SHEET_CONFIG.inkColor,
		frameWeight: clamp(rawConfig.frameWeight, 0, 6, DEFAULT_BILL_SHEET_CONFIG.frameWeight),
		guillocheDensity: clamp(
			rawConfig.guillocheDensity,
			1,
			5,
			DEFAULT_BILL_SHEET_CONFIG.guillocheDensity,
		),
		cornerOrnament:
			typeof rawConfig.cornerOrnament === "boolean"
				? rawConfig.cornerOrnament
				: DEFAULT_BILL_SHEET_CONFIG.cornerOrnament,
		microText: asText(rawConfig.microText, 160, DEFAULT_BILL_SHEET_CONFIG.microText),
		portraitShape: rawConfig.portraitShape === "oval" ? "oval" : "plain",
		// 整票边框图：键缺省沿用默认；显式空串 = 停用（回退参数化纹样）；
		// 非法路径（外链 / .. / 非 /bill/ 前缀）回落默认
		frameArt:
			"frameArt" in rawConfig
				? asBillAssetPath(rawConfig.frameArt) ||
					(asText(rawConfig.frameArt, 120) === "" ? "" : DEFAULT_BILL_SHEET_CONFIG.frameArt)
				: DEFAULT_BILL_SHEET_CONFIG.frameArt,
	};

	const rawZones = Array.isArray(source.zones) ? source.zones : [];
	const incoming = new Map<string, Partial<BillZone>>();
	for (const item of rawZones) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const candidate = item as Partial<BillZone>;
		const id = typeof candidate.id === "string" ? candidate.id : "";
		if (!KNOWN_ZONE_IDS.has(id)) {
			continue;
		}
		incoming.set(id, candidate);
	}

	// 以默认顺序输出，确保渲染层级稳定（后渲染的压在上面）
	const zones: BillZone[] = DEFAULT_BILL_ZONES.map((fallback) => {
		const raw = incoming.get(fallback.id);
		if (!raw) {
			return fallback;
		}
		const geo = asGeometry(raw, fallback);
		const kind = raw.kind && ZONE_KINDS.has(raw.kind) ? raw.kind : fallback.kind;
		const tier =
			raw.tier === 1 || raw.tier === 2 || raw.tier === 3
				? raw.tier
				: (fallback.tier as 1 | 2 | 3 | undefined);
		// art 键缺省 = 沿用默认组件图；显式给出但无有效 src = 删除（回退文本渲染）
		const art = "art" in raw ? asArt(raw.art) : fallback.art;
		// 叠压层序：不填沿用默认，填了就钳到 0–99（整数）
		const z = raw.z === undefined ? fallback.z : clamp(raw.z, 0, 99, fallback.z ?? 3);
		return {
			...geo,
			kind,
			tier,
			ariaLabel: asText(raw.ariaLabel, 60, fallback.ariaLabel),
			// label 是文案覆盖位；空串表示"沿用组件里的原版铭文"
			label: asText(raw.label, 80, fallback.label),
			href: asHref(raw.href),
			enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
			art,
			z,
		};
	});

	const rawText = (
		source.textMm && typeof source.textMm === "object" ? source.textMm : {}
	) as Record<string, unknown>;
	const textMm: Record<string, number> = { ...BILL_TEXT_MM };
	for (const id of KNOWN_ZONE_IDS) {
		if (!(id in rawText)) {
			continue;
		}
		// 字高的合理区间：全票最大的数字 19.5 mm，最小的铭文 1.4 mm。
		// 上限留到 24 mm 是给"整张票面只有一个大字"这类玩法留余地，再多就该改盒子了。
		textMm[id] = clamp(rawText[id], 0.5, 24, BILL_TEXT_MM[id] ?? 2.5);
	}

	return { config, zones, textMm };
}

/** 解析数据库里的 JSON 列。空值或坏 JSON 一律回退默认票面。 */
export function parseBillSettingsJson(raw: string | null | undefined): BillSettings {
	if (!raw) {
		return DEFAULT_BILL_SETTINGS;
	}
	try {
		return normalizeBillSettingsInput(JSON.parse(raw));
	} catch {
		return DEFAULT_BILL_SETTINGS;
	}
}

export function serializeBillSettings(settings: BillSettings): string {
	return JSON.stringify(settings);
}

const CACHE_TTL_MS = 30_000;
let cache: { value: BillSettings; expiresAt: number } | null = null;
let pending: Promise<BillSettings> | null = null;

export function invalidateBillSettingsCache(): void {
	cache = null;
	pending = null;
}

export async function getBillSettings(db: Database): Promise<BillSettings> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return cache.value;
	}
	if (pending) {
		return pending;
	}

	pending = db
		.select({ homeBillJson: siteAppearanceSettings.homeBillJson })
		.from(siteAppearanceSettings)
		.where(eq(siteAppearanceSettings.id, 1))
		.limit(1)
		.then((rows) => parseBillSettingsJson(rows[0]?.homeBillJson ?? null))
		.then((value) => {
			cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
			return value;
		})
		.finally(() => {
			pending = null;
		});

	return pending;
}

/**
 * 只写 home_bill_json 这一列。
 *
 * 刻意不用 saveSiteAppearance：那个函数会整行覆盖，后台同时开着两个标签页时
 * 保存票面就会把外观页刚改的内容冲掉。这里用 onConflictDoUpdate 只更新本列。
 */
export async function saveBillSettings(db: Database, input: unknown): Promise<BillSettings> {
	const normalized = normalizeBillSettingsInput(input);

	await db
		.insert(siteAppearanceSettings)
		.values({ id: 1, homeBillJson: serializeBillSettings(normalized) })
		.onConflictDoUpdate({
			target: siteAppearanceSettings.id,
			set: {
				homeBillJson: serializeBillSettings(normalized),
				updatedAt: sql`(datetime('now'))`,
			},
		});

	invalidateBillSettingsCache();

	return normalized;
}
