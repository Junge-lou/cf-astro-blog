import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Context, Next } from "hono";
import type { AdminAppEnv } from "../../src/admin/middleware/auth";
import {
	clearAttempts,
	rateLimit,
	recordFailedAttempt,
} from "../../src/admin/middleware/rate-limit";

/**
 * 登录锁定逻辑的行为测试。
 *
 * 为什么补这组测试：审计发现 `src/admin/middleware/rate-limit.ts` 此前**只有**
 * "源码里出现过某个字符串"式的断言，没有任何行为测试——而这正是安全相关的代码：
 * 它决定暴力破解能不能被挡住。锁定阈值、过期解锁、KV 故障时的失败模式，此前都没有
 * 被真正执行过。
 *
 * 这里的做法是注入一个假的 KV 与假的 Hono Context，直接观察返回的响应与 KV 内容。
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ATTEMPT_TTL_SECONDS = 24 * 60 * 60;

interface FakeKv {
	store: Map<string, { value: string; expirationTtl?: number }>;
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

function createFakeKv(options: { failGet?: boolean } = {}): FakeKv {
	const store = new Map<string, { value: string; expirationTtl?: number }>();

	return {
		store,
		async get(key) {
			if (options.failGet) {
				throw new Error("模拟 KV 读取失败");
			}
			return store.get(key)?.value ?? null;
		},
		async put(key, value, putOptions) {
			store.set(key, { value, expirationTtl: putOptions?.expirationTtl });
		},
		async delete(key) {
			store.delete(key);
		},
	};
}

function createEnv(kv: FakeKv): Env {
	return {
		SESSION: kv,
		ADMIN_PASSWORD_HASH: "pbkdf2$fake",
		GITHUB_OAUTH_CLIENT_ID: "",
	} as unknown as Env;
}

/** 只实现 rateLimit 实际用到的部分：env / req.header / html。 */
function createContext(env: Env, ip: string): Context<AdminAppEnv> {
	return {
		env,
		req: {
			header: (name: string) => (name.toLowerCase() === "cf-connecting-ip" ? ip : undefined),
		},
		html: (body: string, status: number) =>
			new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } }),
	} as unknown as Context<AdminAppEnv>;
}

const IP = "203.0.113.7";

describe("登录锁定", () => {
	test("未锁定时会放行，并调用 next()", async () => {
		const env = createEnv(createFakeKv());
		let nextCalls = 0;
		const next: Next = async () => {
			nextCalls++;
		};

		await rateLimit(createContext(env, IP), next);

		assert.equal(nextCalls, 1);
	});

	test("连续失败达到阈值后返回 429 并阻止后续请求", async () => {
		const kv = createFakeKv();
		const env = createEnv(kv);

		// 阈值之前不应锁定
		for (let i = 1; i < MAX_ATTEMPTS; i++) {
			await recordFailedAttempt(env, IP);
			let nextCalls = 0;
			await rateLimit(createContext(env, IP), async () => {
				nextCalls++;
			});
			assert.equal(nextCalls, 1, `第 ${i} 次失败后不应锁定`);
		}

		// 第 MAX_ATTEMPTS 次失败触发锁定
		await recordFailedAttempt(env, IP);
		let nextCalls = 0;
		const response = await rateLimit(createContext(env, IP), async () => {
			nextCalls++;
		});

		assert.equal(nextCalls, 0, "锁定期间绝不能放行到下一个处理器");
		assert.ok(response, "锁定时必须返回响应（而不是 undefined）");
		assert.equal(response.status, 429);
		assert.match(await response.text(), /登录尝试过多/u);
	});

	test("锁定时长约为配置的分钟数", async () => {
		const env = createEnv(createFakeKv());
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			await recordFailedAttempt(env, IP);
		}

		const raw = await env.SESSION.get(`login-rate:${IP}`);
		const state = JSON.parse(String(raw)) as { attempts: number; lockedUntil: string | null };
		const remainingMs = Date.parse(String(state.lockedUntil)) - Date.now();

		assert.equal(state.attempts, MAX_ATTEMPTS);
		// 允许执行耗时带来的少量偏差
		const expectedMs = LOCKOUT_MINUTES * 60 * 1000;
		assert.ok(
			remainingMs > expectedMs - 5000 && remainingMs <= expectedMs,
			`锁定时长应接近 ${LOCKOUT_MINUTES} 分钟，实际剩余 ${remainingMs}ms`,
		);
	});

	test("锁定过期后会被清除并重新放行", async () => {
		const kv = createFakeKv();
		const env = createEnv(kv);

		// 直接写入一个已过期的锁定状态
		await kv.put(
			`login-rate:${IP}`,
			JSON.stringify({
				attempts: MAX_ATTEMPTS,
				lockedUntil: new Date(Date.now() - 1000).toISOString(),
				lastAttempt: new Date().toISOString(),
			}),
		);

		let nextCalls = 0;
		await rateLimit(createContext(env, IP), async () => {
			nextCalls++;
		});

		assert.equal(nextCalls, 1, "锁定过期后应放行");
		assert.equal(kv.store.has(`login-rate:${IP}`), false, "过期状态应被清除，重新计数");
	});

	test("KV 故障时返回 503，而不是放行", async () => {
		const env = createEnv(createFakeKv({ failGet: true }));
		let nextCalls = 0;

		const response = await rateLimit(createContext(env, IP), async () => {
			nextCalls++;
		});

		// 关键安全取舍：读不到限流状态时**拒绝**，而不是当作"没有锁定"放行
		assert.equal(nextCalls, 0, "KV 故障时不能退化为无保护放行");
		assert.ok(response, "故障时必须返回响应（而不是 undefined）");
		assert.equal(response.status, 503);
		assert.match(await response.text(), /登录保护暂时不可用/u);
	});

	test("失败计数带 24 小时 TTL，避免 KV 里残留无限增长", async () => {
		const kv = createFakeKv();
		await recordFailedAttempt(createEnv(kv), IP);

		const entry = kv.store.get(`login-rate:${IP}`);
		assert.equal(entry?.expirationTtl, ATTEMPT_TTL_SECONDS);
	});

	test("登录成功后清除计数", async () => {
		const kv = createFakeKv();
		const env = createEnv(kv);
		await recordFailedAttempt(env, IP);
		assert.ok(kv.store.has(`login-rate:${IP}`));

		await clearAttempts(env, IP);

		assert.equal(kv.store.has(`login-rate:${IP}`), false);
	});

	test("按 IP 隔离：一个地址被锁定不影响其他地址", async () => {
		const env = createEnv(createFakeKv());
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			await recordFailedAttempt(env, IP);
		}

		let otherIpNextCalls = 0;
		await rateLimit(createContext(env, "198.51.100.9"), async () => {
			otherIpNextCalls++;
		});

		assert.equal(otherIpNextCalls, 1, "其他 IP 不应被连带锁定");
	});
});
