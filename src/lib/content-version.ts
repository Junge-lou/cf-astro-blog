// 内容缓存版本号：发文/改文/删文时递增，
// 边缘缓存键中包含该版本号，从而让所有节点的旧缓存立即失效。
// Env 为全局类型（见 env.d.ts）
const CONTENT_VERSION_KEY = "public-content-cache-version";

export async function getContentCacheVersion(env: Env): Promise<string> {
	try {
		const version = await env.SESSION.get(CONTENT_VERSION_KEY);
		return version || "0";
	} catch {
		return "0";
	}
}

export async function bumpContentCacheVersion(env: Env): Promise<string> {
	const version = String(Date.now());
	try {
		await env.SESSION.put(CONTENT_VERSION_KEY, version);
	} catch {
		// KV 写入失败时静默降级：缓存仍按 TTL 过期，仅刷新延迟变长
	}
	return version;
}
