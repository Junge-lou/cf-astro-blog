/**
 * 部署前把「内容缓存版本号」往前推一格。
 *
 * 背景：公共页面（`/`、`/blog*`、`/friends`）在边缘缓存 300s，缓存键里带一个
 * KV 版本号（`src/lib/content-version.ts`）。这个版本号原先只在**发文/改文**时递增，
 * 于是「只改代码、不发文」的部署会留下一个最长 5 分钟的空窗：新 Worker 已经在跑，
 * 边缘还在发旧 HTML（实测踩过：评论组件已换成自托管路径，访客拿到的旧 HTML 仍指向
 * jsDelivr，表现为「第一次进文章评论区不加载，刷新后才有」）。
 *
 * 所以部署流程里显式推一次版本号，让所有旧缓存键立刻失效。
 *
 * 失败不阻断部署：KV 写入失败时退回原本的 TTL 行为（最多陈旧 300s），
 * 这比让一次发版整体失败要好。
 */
import { execFileSync } from "node:child_process";

const KEY = "public-content-cache-version";
const version = String(Date.now());

if (process.env.SKIP_CACHE_VERSION_BUMP === "1") {
	console.log("[bump-content-version] SKIP_CACHE_VERSION_BUMP=1，跳过");
	process.exit(0);
}

try {
	execFileSync(
		"npx",
		["wrangler", "kv", "key", "put", KEY, version, "--binding", "SESSION", "--remote"],
		{ stdio: "inherit", shell: process.platform === "win32" },
	);
	console.log(`[bump-content-version] ${KEY} -> ${version}`);
} catch (error) {
	// 不 exit(1)：缓存陈旧 300s 也比部署失败好
	console.warn(
		`[bump-content-version] 推进版本号失败（继续部署，旧缓存将在 TTL 后自然过期）：${error?.message ?? error}`,
	);
}
