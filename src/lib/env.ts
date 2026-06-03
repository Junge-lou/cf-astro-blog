/**
 * 环境变量校验与类型安全访问层
 *
 * 在服务端入口调用 validateEnv() 确保所有必需变量已配置。
 * 前端仅使用 isEnvValid 做静默检查，不在客户端暴露任何密钥。
 *
 * 不使用 Zod 等外部依赖——零额外体积，Cloudflare Workers 友好。
 */

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface ValidatedEnv {
	DB?: D1Database;
	MEDIA_BUCKET?: R2Bucket;
	SESSION?: KVNamespace;
	ASSETS?: Fetcher;

	SITE_NAME: string;
	SITE_URL: string;

	JWT_SECRET: string;
	ADMIN_USERNAME: string;
	ADMIN_PASSWORD_HASH: string;

	TURNSTILE_SITE_KEY?: string;
	TURNSTILE_SECRET_KEY?: string;

	GITHUB_OAUTH_CLIENT_ID?: string;
	GITHUB_OAUTH_CLIENT_SECRET?: string;
	GITHUB_OAUTH_REDIRECT_URI?: string;

	AI_INTERNAL_API_KEY?: string;
	AI_PUBLIC_API_KEY?: string;
	PUBLIC_AI_RATE_LIMIT_PER_MINUTE?: string;
	PUBLIC_AI_DAILY_LIMIT_PER_IP?: string;

	MCP_BEARER_TOKEN?: string;
	MCP_RATE_LIMIT_PER_MINUTE?: string;
	MCP_AUTH_FAIL_LIMIT_PER_MINUTE?: string;
	MCP_AUTH_BLOCK_SECONDS?: string;

	AUTO_DEPLOY_WEBHOOK_URL?: string;
	AUTO_DEPLOY_WEBHOOK_SECRET?: string;
	AUTO_DEPLOY_GITHUB_EVENT_TYPE?: string;
}

// ─── 校验规则 ────────────────────────────────────────────────────────────────

interface EnvRule {
	key: keyof ValidatedEnv;
	required: boolean;
	validate?: (value: unknown) => string | null; // 返回错误消息或 null
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value: unknown): boolean {
	if (!isNonEmptyString(value)) return false;
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

const ENV_RULES: EnvRule[] = [
	// ── 站点元信息 ──
	{ key: "SITE_NAME", required: true, validate: (v) => (!isNonEmptyString(v) ? "SITE_NAME 不能为空" : null) },
	{ key: "SITE_URL", required: true, validate: (v) => (!isValidUrl(v) ? "SITE_URL 必须是有效 URL" : null) },

	// ── 安全密钥 ──
	{ key: "JWT_SECRET", required: true, validate: (v) => (!isNonEmptyString(v) || (typeof v === "string" && v.length < 16) ? "JWT_SECRET 至少需要 16 个字符" : null) },
	{ key: "ADMIN_USERNAME", required: true, validate: (v) => (!isNonEmptyString(v) ? "ADMIN_USERNAME 不能为空" : null) },
	{ key: "ADMIN_PASSWORD_HASH", required: true, validate: (v) => (!isNonEmptyString(v) ? "ADMIN_PASSWORD_HASH 不能为空" : null) },

	// ── 可选变量（不校验，仅记录缺失） ──
	{ key: "TURNSTILE_SITE_KEY", required: false },
	{ key: "TURNSTILE_SECRET_KEY", required: false },
	{ key: "GITHUB_OAUTH_CLIENT_ID", required: false },
	{ key: "GITHUB_OAUTH_CLIENT_SECRET", required: false },
	{ key: "GITHUB_OAUTH_REDIRECT_URI", required: false },
	{ key: "AI_INTERNAL_API_KEY", required: false },
	{ key: "AI_PUBLIC_API_KEY", required: false },
	{ key: "PUBLIC_AI_RATE_LIMIT_PER_MINUTE", required: false },
	{ key: "PUBLIC_AI_DAILY_LIMIT_PER_IP", required: false },
	{ key: "MCP_BEARER_TOKEN", required: false },
	{ key: "MCP_RATE_LIMIT_PER_MINUTE", required: false },
	{ key: "MCP_AUTH_FAIL_LIMIT_PER_MINUTE", required: false },
	{ key: "MCP_AUTH_BLOCK_SECONDS", required: false },
	{ key: "AUTO_DEPLOY_WEBHOOK_URL", required: false },
	{ key: "AUTO_DEPLOY_WEBHOOK_SECRET", required: false },
	{ key: "AUTO_DEPLOY_GITHUB_EVENT_TYPE", required: false },
];

// ─── 校验逻辑 ────────────────────────────────────────────────────────────────

let validationResult:
	| { ok: true; env: ValidatedEnv }
	| { ok: false; errors: string[] }
	| null = null;

/**
 * 校验 Cloudflare Workers 环境变量。
 * 结果会被缓存，多次调用不会重复校验。
 */
export function validateEnv(rawEnv: Record<string, unknown>): {
	ok: boolean;
	env?: ValidatedEnv;
	errors: string[];
} {
	if (validationResult) {
		return {
			ok: validationResult.ok,
			env: validationResult.ok ? validationResult.env : undefined,
			errors: validationResult.ok ? [] : validationResult.errors,
		};
	}

	const errors: string[] = [];
	const warnings: string[] = [];

	for (const rule of ENV_RULES) {
		const value = rawEnv[rule.key];

		if (rule.required && !isNonEmptyString(value)) {
			errors.push(`${rule.key}: 缺少必需的字符串值`);
			continue;
		}

		if (rule.validate && isNonEmptyString(value)) {
			const error = rule.validate(value);
			if (error) {
				errors.push(`${rule.key}: ${error}`);
			}
		}

		if (!rule.required && !isNonEmptyString(value)) {
			warnings.push(`${rule.key}: 未配置（可选）`);
		}
	}

	if (errors.length > 0) {
		console.error("[env] 环境变量校验失败：");
		for (const err of errors) {
			console.error(`  ✗ ${err}`);
		}
		validationResult = { ok: false, errors };
		return { ok: false, errors };
	}

	if (warnings.length > 0) {
		console.warn("[env] 可选环境变量未配置：");
		for (const warn of warnings) {
			console.warn(`  ! ${warn}`);
		}
	}

	const env = rawEnv as unknown as ValidatedEnv;
	validationResult = { ok: true, env };
	console.log("[env] 环境变量校验通过");

	return { ok: true, env, errors: [] };
}

/**
 * 检查环境变量是否已正确配置（前端安全调用）。
 */
export function isEnvConfigured(): boolean {
	if (!validationResult) return false;
	return validationResult.ok;
}

/**
 * 获取已校验的环境变量。未校验时抛出。
 */
export function getValidatedEnv(): ValidatedEnv {
	if (!validationResult?.ok) {
		throw new Error("环境变量尚未校验。请在启动时先调用 validateEnv()。");
	}
	return validationResult.env;
}

/**
 * 重置校验缓存（仅测试用）。
 */
export function resetEnvValidation(): void {
	validationResult = null;
}
