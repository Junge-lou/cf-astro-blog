import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getDb } from "@/lib/db";
import { timingSafeEqualText, verifyPassword } from "@/lib/password";
import { sanitizePlainText } from "@/lib/security";
import {
	buildBackgroundImageUrl,
	getSiteAppearance,
} from "@/lib/site-appearance";
import {
	type AdminAppEnv,
	assertCsrfToken,
	createSession,
	createToken,
	destroySession,
	getAuthenticatedSession,
	getBodyText,
	getSessionCookieOptions,
	getSessionFromToken,
	requireAuth,
} from "../middleware/auth";
import {
	clearAttempts,
	rateLimit,
	recordFailedAttempt,
} from "../middleware/rate-limit";
import { loginPage } from "../views/login";

const auth = new Hono<AdminAppEnv>();
const OAUTH_STATE_COOKIE = "admin_oauth_state";
const OAUTH_VERIFIER_COOKIE = "admin_oauth_verifier";
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

// Login CSRF token: stored in KV with 5-min TTL, validated on POST /login
const LOGIN_CSRF_PREFIX = "login-csrf:";
const LOGIN_CSRF_TTL_SECONDS = 5 * 60;

interface GitHubOAuthConfig {
	clientId: string;
	clientSecret: string;
	adminLogin: string;
	redirectUri?: string;
}

interface GitHubAccessTokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
}

interface GitHubUserProfile {
	login?: string;
	id?: number;
}

function getClientIp(c: Context<AdminAppEnv>): string {
	return c.req.header("cf-connecting-ip") || "unknown";
}

async function recordOAuthFailure(c: Context<AdminAppEnv>) {
	try {
		await recordFailedAttempt(c.env, getClientIp(c));
	} catch {
		// 限流写入失败时不阻断 OAuth 回调流程，避免误伤合法登录
	}
}

async function clearOAuthFailures(c: Context<AdminAppEnv>) {
	try {
		await clearAttempts(c.env, getClientIp(c));
	} catch {
		// 限流清理失败时忽略，避免影响登录成功后的跳转
	}
}

function getAdminGitHubLogin(env: Env): string | undefined {
	const login = env.ADMIN_GITHUB_LOGIN?.trim() || env.ADMIN_USERNAME?.trim();
	return login ? login : undefined;
}

function getGitHubOAuthConfig(env: Env): GitHubOAuthConfig | null {
	const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
	const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
	const adminLogin = getAdminGitHubLogin(env);
	const redirectUri = env.GITHUB_OAUTH_REDIRECT_URI?.trim();

	if (!clientId || !clientSecret || !adminLogin) {
		return null;
	}

	return {
		clientId,
		clientSecret,
		adminLogin,
		redirectUri: redirectUri || undefined,
	};
}

function getOAuthCookieOptions(requestUrl: string) {
	const secure = !["localhost", "127.0.0.1"].includes(
		new URL(requestUrl).hostname,
	);

	return {
		httpOnly: true,
		secure,
		sameSite: "Lax" as const,
		path: "/",
		maxAge: OAUTH_COOKIE_TTL_SECONDS,
	};
}

function encodeBase64Url(bytes: Uint8Array): string {
	let value = "";
	for (const byte of bytes) {
		value += String.fromCharCode(byte);
	}

	return btoa(value)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
}

function createCodeVerifier(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return encodeBase64Url(bytes);
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(codeVerifier),
	);

	return encodeBase64Url(new Uint8Array(digest));
}

function getResolvedRedirectUri(
	config: GitHubOAuthConfig,
	requestUrl: string,
): string {
	return (
		config.redirectUri ||
		new URL("/api/auth/github/callback", requestUrl).toString()
	);
}

async function exchangeGitHubAccessToken(
	config: GitHubOAuthConfig,
	code: string,
	requestUrl: string,
	codeVerifier: string,
) {
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"User-Agent": "cf-astro-blog-starter",
		},
		body: JSON.stringify({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: getResolvedRedirectUri(config, requestUrl),
			code_verifier: codeVerifier,
		}),
	});

	if (!response.ok) {
		return null;
	}

	const result = (await response.json()) as GitHubAccessTokenResponse;

	if (!result.access_token || result.error) {
		return null;
	}

	return result.access_token;
}

async function fetchGitHubUserProfile(accessToken: string) {
	const response = await fetch("https://api.github.com/user", {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${accessToken}`,
			"User-Agent": "cf-astro-blog-starter",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (!response.ok) {
		return null;
	}

	const profile = (await response.json()) as GitHubUserProfile;
	return profile.login ? profile : null;
}

function isPasswordLoginEnabled(env: Env): boolean {
	const hash = env.ADMIN_PASSWORD_HASH?.trim();
	return Boolean(hash && hash.length > 0);
}

async function generateLoginCsrfToken(env: Env): Promise<string> {
	const token = crypto.randomUUID();
	await env.SESSION.put(
		`${LOGIN_CSRF_PREFIX}${token}`,
		"1",
		{ expirationTtl: LOGIN_CSRF_TTL_SECONDS },
	);
	return token;
}

async function consumeLoginCsrfToken(
	env: Env,
	token: string,
): Promise<boolean> {
	const key = `${LOGIN_CSRF_PREFIX}${token}`;
	const value = await env.SESSION.get(key);
	if (!value) return false;
	await env.SESSION.delete(key);
	return true;
}

auth.get("/login", async (c) => {
	const token = getCookie(c, "admin_session");
	if (token) {
		try {
			const session = await getSessionFromToken(c.env, token);
			if (session) {
				return c.redirect("/api/admin");
			}
		} catch {
			// 会话存储偶发失败时保持登录页可用，避免把访客困在 500
		}
	}

	const config = getGitHubOAuthConfig(c.env);
	const passwordEnabled = isPasswordLoginEnabled(c.env);

	let backgroundImageUrl: string | null = null;
	try {
		const appearance = await getSiteAppearance(getDb(c.env.DB));
		backgroundImageUrl = buildBackgroundImageUrl(appearance.backgroundImageKey);
	} catch {
		// DB 未绑定或查询失败时退化为无背景图
	}

	const csrfToken = passwordEnabled
		? await generateLoginCsrfToken(c.env)
		: undefined;

	return c.html(
		loginPage({
			oauthEnabled: Boolean(config),
			passwordEnabled,
			csrfToken,
			backgroundImageUrl,
		}),
	);
});

auth.post("/login", async (c) => {
	const passwordEnabled = isPasswordLoginEnabled(c.env);
	const config = getGitHubOAuthConfig(c.env);

	if (!passwordEnabled) {
		// 仅 GitHub OAuth 模式
		if (config) {
			return c.text("当前后台仅支持 GitHub OAuth 登录", 405);
		}
		return c.html(
			loginPage({
				error: "后台登录尚未配置，请联系站点管理员",
				oauthEnabled: false,
				passwordEnabled: false,
			}),
			503,
		);
	}

	// Rate limit check for password login
	const ip = getClientIp(c);
	try {
		const state = await (async () => {
			const raw = await c.env.SESSION.get(`login-rate:${ip}`);
			return raw ? (JSON.parse(raw) as {
				attempts: number;
				lockedUntil: string | null;
			}) : null;
		})();

		if (state?.lockedUntil) {
			const lockExpiry = new Date(state.lockedUntil);
			if (lockExpiry.getTime() > Date.now()) {
				const remainingSeconds = Math.ceil(
					(lockExpiry.getTime() - Date.now()) / 1000,
				);
				return c.html(
					loginPage({
						error: `登录尝试过多，请 ${remainingSeconds} 秒后再试`,
						oauthEnabled: Boolean(config),
						passwordEnabled,
					}),
					429,
				);
			}
		}
	} catch {
		// KV read failed — allow login attempt to proceed
	}

	const body = await c.req.parseBody({ all: true });
	const username = sanitizePlainText(getBodyText(body, "username"), 120);
	const password = sanitizePlainText(getBodyText(body, "password"), 256);
	const csrfToken = sanitizePlainText(getBodyText(body, "_csrf"), 128);

	// Validate CSRF token
	if (!csrfToken || !(await consumeLoginCsrfToken(c.env, csrfToken))) {
		await recordFailedAttempt(c.env, ip);
		return c.html(
			loginPage({
				error: "表单已过期，请刷新页面后重试",
				oauthEnabled: Boolean(config),
				passwordEnabled,
			}),
			403,
		);
	}

	if (!username || !password) {
		await recordFailedAttempt(c.env, ip);
		return c.html(
			loginPage({
				error: "请输入用户名和密码",
				oauthEnabled: Boolean(config),
				passwordEnabled,
			}),
			400,
		);
	}

	// Verify username
	const adminUsername = (
		c.env.ADMIN_USERNAME?.trim() ||
		c.env.ADMIN_GITHUB_LOGIN?.trim() ||
		""
	).trim();

	if (!adminUsername || !timingSafeEqualText(username, adminUsername)) {
		await recordFailedAttempt(c.env, ip);
		return c.html(
			loginPage({
				error: "用户名或密码错误",
				oauthEnabled: Boolean(config),
				passwordEnabled,
			}),
			401,
		);
	}

	// Verify password
	const passwordHash = c.env.ADMIN_PASSWORD_HASH?.trim();
	if (!passwordHash) {
		await recordFailedAttempt(c.env, ip);
		return c.html(
			loginPage({
				error: "后台密码未配置，请联系站点管理员",
				oauthEnabled: Boolean(config),
				passwordEnabled: false,
			}),
			503,
		);
	}

	let passwordValid = false;
	try {
		passwordValid = await verifyPassword(password, passwordHash);
	} catch {
		// Hash verification failed — let it fall through to 401
	}

	if (!passwordValid) {
		await recordFailedAttempt(c.env, ip);
		return c.html(
			loginPage({
				error: "用户名或密码错误",
				oauthEnabled: Boolean(config),
				passwordEnabled,
			}),
			401,
		);
	}

	// Password correct — create session
	const session = await createSession(c.env, adminUsername);
	let token: string;
	try {
		token = await createToken(c.env, session);
	} catch (error) {
		console.error("admin_token_create_failed", error);
		await destroySession(c.env, session.id);
		return c.html(
			loginPage({
				error: "后台会话配置异常，请联系站点管理员检查 JWT_SECRET",
				oauthEnabled: Boolean(config),
				passwordEnabled,
			}),
			503,
		);
	}
	setCookie(c, "admin_session", token, {
		...getSessionCookieOptions(c.req.url),
	});
	await clearAttempts(c.env, ip);

	return c.redirect("/api/admin");
});
auth.use("/github", rateLimit);
auth.use("/github/callback", rateLimit);

auth.get("/github", async (c) => {
	const config = getGitHubOAuthConfig(c.env);

	if (!config) {
		return c.html(
			loginPage({
				error: "后台尚未完成 GitHub OAuth 配置",
				oauthEnabled: false,
			}),
			503,
		);
	}

	const state = crypto.randomUUID();
	const codeVerifier = createCodeVerifier();
	const codeChallenge = await createCodeChallenge(codeVerifier);
	const authorizeUrl = new URL("https://github.com/login/oauth/authorize");

	authorizeUrl.searchParams.set("client_id", config.clientId);
	authorizeUrl.searchParams.set(
		"redirect_uri",
		getResolvedRedirectUri(config, c.req.url),
	);
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("scope", "read:user");
	authorizeUrl.searchParams.set("code_challenge", codeChallenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");

	const cookieOptions = getOAuthCookieOptions(c.req.url);
	setCookie(c, OAUTH_STATE_COOKIE, state, cookieOptions);
	setCookie(c, OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOptions);

	return c.redirect(authorizeUrl.toString());
});

auth.get("/github/callback", async (c) => {
	const config = getGitHubOAuthConfig(c.env);
	const code = sanitizePlainText(c.req.query("code"), 200);
	const state = sanitizePlainText(c.req.query("state"), 200);
	const oauthError = sanitizePlainText(c.req.query("error"), 120);
	const storedState = getCookie(c, OAUTH_STATE_COOKIE);
	const storedVerifier = getCookie(c, OAUTH_VERIFIER_COOKIE);

	deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
	deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: "/" });

	if (!config) {
		return c.html(
			loginPage({
				error: "后台尚未完成 GitHub OAuth 配置",
				oauthEnabled: false,
			}),
			503,
		);
	}

	if (oauthError) {
		await recordOAuthFailure(c);
		return c.html(
			loginPage({
				error: "GitHub 授权被取消或未完成",
				oauthEnabled: true,
			}),
			400,
		);
	}

	if (
		!code ||
		!state ||
		!storedState ||
		!storedVerifier ||
		!timingSafeEqualText(state, storedState)
	) {
		await recordOAuthFailure(c);
		return c.html(
			loginPage({
				error: "GitHub OAuth 状态校验失败",
				oauthEnabled: true,
			}),
			400,
		);
	}

	const accessToken = await exchangeGitHubAccessToken(
		config,
		code,
		c.req.url,
		storedVerifier,
	);

	if (!accessToken) {
		await recordOAuthFailure(c);
		return c.html(
			loginPage({
				error: "GitHub 访问令牌交换失败",
				oauthEnabled: true,
			}),
			502,
		);
	}

	const profile = await fetchGitHubUserProfile(accessToken);

	if (!profile?.login) {
		await recordOAuthFailure(c);
		return c.html(
			loginPage({
				error: "无法获取 GitHub 账号信息",
				oauthEnabled: true,
			}),
			502,
		);
	}

	if (!timingSafeEqualText(profile.login, config.adminLogin)) {
		await recordOAuthFailure(c);
		return c.html(
			loginPage({
				error: `当前 GitHub 账号 ${profile.login} 没有后台权限`,
				oauthEnabled: true,
			}),
			403,
		);
	}

	const session = await createSession(c.env, profile.login);
	let token: string;
	try {
		token = await createToken(c.env, session);
	} catch (error) {
		console.error("admin_token_create_failed", error);
		await destroySession(c.env, session.id);
		await recordOAuthFailure(c);
		return c.html(
			loginPage({
				error: "后台会话配置异常，请联系站点管理员检查 JWT_SECRET",
				oauthEnabled: true,
			}),
			503,
		);
	}
	setCookie(c, "admin_session", token, {
		...getSessionCookieOptions(c.req.url),
	});
	await clearOAuthFailures(c);

	return c.redirect("/api/admin");
});

auth.get("/logout", (c) => {
	return c.text("不支持当前请求方法", 405);
});

auth.post("/logout", requireAuth, async (c) => {
	const body = await c.req.parseBody({ all: true });
	const session = getAuthenticatedSession(c);

	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.text("CSRF 校验失败", 403);
	}

	await destroySession(c.env, session.id);
	deleteCookie(c, "admin_session", { path: "/" });
	return c.redirect("/api/auth/login");
});

auth.get("/verify", requireAuth, async (c) => {
	const session = getAuthenticatedSession(c);
	return c.json(
		{
			authenticated: true,
			csrfToken: session.csrfToken,
			authProvider: "github-oauth",
			username: session.username,
		},
		200,
	);
});

export { auth as authRoutes };
