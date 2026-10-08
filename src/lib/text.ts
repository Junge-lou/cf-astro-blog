/**
 * 零依赖的字符串 / slug / 转义工具。
 *
 * 这些函数原本定义在 `src/lib/security.ts`,但那个模块在顶层 `import` 了
 * katex、marked、node-emoji、sanitize-html（见该文件 1-4 行）。中间件、埋点、
 * 鉴权等只需要转义或 slug 校验的路径一旦从 `security.ts` 引入，就会把整个
 * Markdown 渲染栈拖进自己的模块图，抬高 Worker 冷启动成本。
 *
 * 因此这里保持**不引入任何依赖**：只放纯函数，供 `security.ts` 与其它轻量
 * 路径共同使用。`security.ts` 会原样重新导出这些符号，历史引用无需改动。
 */

const POST_STATUS_VALUES = ["draft", "published", "scheduled"] as const;

const SLUG_SEGMENT_PATTERN = /[^\p{Letter}\p{Number}]+/gu;
const SLUG_VALID_PATTERN = /^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u;

export type PostStatus = (typeof POST_STATUS_VALUES)[number];

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function escapeAttribute(value: string): string {
	return escapeHtml(value).replaceAll("`", "&#96;");
}

export function escapeTextarea(value: string): string {
	return escapeHtml(value);
}

export function encodeRouteParam(value: string): string {
	return encodeURIComponent(value);
}

export function decodeRouteParam(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * 归一化并校验 slug。
 *
 * 注意：返回的是**归一化后**的小写形式（NFKC + 小写 + 空格转连字符）。
 * 任何把 slug 用于查询条件的地方都必须使用本函数的返回值而不是原始输入，
 * 否则「归一化后的缓存键」与「未归一化的渲染结果」会不一致。
 * 允许 Unicode 字母与数字，因此中文 slug 是合法的。
 */
export function sanitizeSlug(value: unknown): string | null {
	const normalized = decodeRouteParam(String(value ?? ""))
		.trim()
		.toLowerCase()
		.normalize("NFKC")
		.replaceAll(/\s+/gu, "-")
		.replaceAll(/-+/g, "-")
		.replaceAll(/^-+|-+$/g, "");

	if (!normalized || !SLUG_VALID_PATTERN.test(normalized)) {
		return null;
	}

	return normalized;
}

export function buildUrlSlug(
	value: unknown,
	options?: { fallbackPrefix?: string; maxLength?: number },
): string {
	const fallbackPrefix = sanitizeSlug(options?.fallbackPrefix || "post") || "post";
	const maxLength = Math.max(8, options?.maxLength ?? 120);
	const normalized = String(value ?? "")
		.toLowerCase()
		.normalize("NFKC")
		.replaceAll(SLUG_SEGMENT_PATTERN, "-")
		.replaceAll(/-+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
	const safeSlug = sanitizeSlug(normalized);

	if (!safeSlug) {
		const fallback = `${fallbackPrefix}-${crypto.randomUUID().slice(0, 8)}`;
		return fallback.slice(0, maxLength);
	}

	const truncated = [...safeSlug].slice(0, maxLength).join("");
	return truncated.replaceAll(/-+$/g, "") || fallbackPrefix;
}

export function sanitizePostStatus(value: unknown): PostStatus | null {
	const normalized = String(value ?? "").trim();
	return POST_STATUS_VALUES.includes(normalized as PostStatus) ? (normalized as PostStatus) : null;
}
