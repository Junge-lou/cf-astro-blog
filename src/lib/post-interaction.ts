/**
 * 文章声明的 Webmention 互动类型（like / repost / bookmark / reply / rsvp）。
 *
 * ⚠ 类型**不是 POST 出来的**。Webmention 的请求体只有 `source` 与 `target`；
 * 「喜欢 / 回复 / 转发 / 收藏 / RSVP」是**接收方抓取 source 页面后解析
 * microformats2 h-entry** 得出的结论，webmention.io 再把它映射成 `wm-property`。
 *
 * 规范依据（都可查）：
 * - W3C Webmention REC 完全没有提到 microformats，它只知道「一个 URL 链接了另一个 URL」；
 * - h-entry 才是类型载体：`u-in-reply-to` / `u-like-of` / `u-repost-of` / `p-rsvp`；
 * - `p-rsvp` **必须**用 `<data value>`（或 value-class-pattern），值限
 *   `yes` / `no` / `maybe` / `interested`；
 * - `u-bookmark-of` 在 h-entry 里仍属 Proposed Additions，但 webmention.io 已按
 *   `bookmark-of` 接收，因此这里一并支持。
 *
 * 本模块只做两件事：校验三个字段、给出**官方类名**。渲染位置在 `Post.astro` 的
 * `h-entry` 内、`e-content` 外——放错位置解析器就不会把它当成本条目的属性。
 */

/** 可声明的互动类型，与 webmention.io 的 `wm-property` 一一对应。 */
export const POST_INTERACTIONS = ["like", "repost", "bookmark", "reply", "rsvp"] as const;

export type PostInteraction = (typeof POST_INTERACTIONS)[number];

/** RSVP 的四个合法取值（h-entry 规范：大小写不敏感，规范化为小写）。 */
export const RSVP_VALUES = ["yes", "no", "maybe", "interested"] as const;

export type RsvpValue = (typeof RSVP_VALUES)[number];

interface InteractionMeta {
	/** h-entry 属性类名。 */
	propertyClass: string;
	emoji: string;
	/** 人类可读动词，用于页面上的「❤️ 喜欢了…」。 */
	verb: string;
	/** 链接文字；目标标题未知，因此用中性描述。 */
	linkText: string;
}

const INTERACTION_META: Record<PostInteraction, InteractionMeta> = {
	like: { propertyClass: "u-like-of", emoji: "❤️", verb: "喜欢了", linkText: "这篇文章" },
	repost: { propertyClass: "u-repost-of", emoji: "🔄", verb: "转发了", linkText: "这篇文章" },
	bookmark: { propertyClass: "u-bookmark-of", emoji: "🔖", verb: "收藏了", linkText: "这篇文章" },
	reply: { propertyClass: "u-in-reply-to", emoji: "💬", verb: "回复了", linkText: "这篇文章" },
	rsvp: { propertyClass: "u-in-reply-to", emoji: "📅", verb: "回应了", linkText: "这个活动" },
};

const RSVP_LABELS: Record<RsvpValue, string> = {
	yes: "参加",
	no: "不参加",
	maybe: "可能参加",
	interested: "感兴趣",
};

/** 归一化互动类型；无法识别时返回 null（未声明，按普通提及处理）。 */
export function normalizeInteraction(value: unknown): PostInteraction | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return null;
	}

	return POST_INTERACTIONS.includes(normalized as PostInteraction)
		? (normalized as PostInteraction)
		: null;
}

/** 归一化 RSVP 取值；非法返回 null。 */
export function normalizeRsvp(value: unknown): RsvpValue | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return null;
	}

	return RSVP_VALUES.includes(normalized as RsvpValue) ? (normalized as RsvpValue) : null;
}

/**
 * 归一化互动目标：必须是 http/https 绝对地址。
 *
 * 不接受相对路径——Webmention 的 target 是接收方要去抓取的公网地址，
 * 相对地址在对方站点上无意义，且会让验证必然失败。
 */
export function normalizeInteractionTarget(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const raw = value.trim();
	if (!raw) {
		return null;
	}

	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return parsed.toString();
	} catch {
		return null;
	}
}

export interface InteractionMarkup extends InteractionMeta {
	interaction: PostInteraction;
	href: string;
	/** 仅 rsvp 有值；渲染成 `<data class="p-rsvp" value="…">`。 */
	rsvp: RsvpValue | null;
}

/**
 * 把三个字段变成可直接渲染的官方标记描述。
 *
 * 任何一种不自洽（类型无效 / 目标地址无效 / rsvp 缺值）都返回 null：
 * 宁可当作没有声明，也不要输出半截标记——半截标记会让接收方把它当成普通提及，
 * 而这正好是最难排查的失败方式。
 */
export function buildInteractionMarkup(input: {
	interaction: unknown;
	interactionTarget: unknown;
	interactionRsvp?: unknown;
}): InteractionMarkup | null {
	const interaction = normalizeInteraction(input.interaction);
	if (!interaction) {
		return null;
	}

	const href = normalizeInteractionTarget(input.interactionTarget);
	if (!href) {
		return null;
	}

	let rsvp: RsvpValue | null = null;
	if (interaction === "rsvp") {
		rsvp = normalizeRsvp(input.interactionRsvp);
		if (!rsvp) {
			return null;
		}
	}

	return {
		interaction,
		...INTERACTION_META[interaction],
		href,
		rsvp,
	};
}

/** RSVP 取值的中文说明，用于页面上 `<data>` 的可见文本。 */
export function rsvpLabel(value: RsvpValue): string {
	return RSVP_LABELS[value];
}
