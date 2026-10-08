/**
 * 把「响应已经决定之后才需要完成的工作」移出请求关键路径。
 *
 * 为什么需要它：Workers 的计费与延迟都取决于请求何时返回。像发送部署钩子
 * （最长 6 秒超时）、统计数据保留清理（KV 读 + 最多 3 条 DELETE）这类工作，
 * 结果既不影响响应内容、也不影响状态码，却一直被 `await` 在关键路径上。
 * `ExecutionContext.waitUntil()` 正是为这种场景提供的 API。
 *
 * 实现说明（两点都是必需的，不是保守写法）：
 *
 * 1. **必须动态 `import("cloudflare:workers")`**。`tests/integration/api.test.ts`
 *    直接 `import { app } from "../../src/admin/app"`，会连带加载用到本模块的
 *    后台路由；静态 import `cloudflare:workers` 会让整个测试套件在 Node 下加载失败。
 *    项目里 `src/middleware.ts` 早已用同样的动态引入 + try/catch 处理这件事。
 * 2. **失败必须被接住**。后台任务抛错不该变成 unhandled rejection，也不该让调用方
 *    以为自己还需要处理它——所以这里统一 catch 并打日志。
 *
 * 拿不到 `waitUntil` 时（本地单元测试、`astro build` 的预渲染阶段）退化为
 * **就地等待**：宁可慢一点，也不静默丢任务。
 */
export function runInBackground(task: Promise<unknown>): void {
	void scheduleInBackground(task);
}

/** 记忆化模块加载：避免每次调用都走一次动态 import。 */
let waitUntilPromise: Promise<((promise: Promise<unknown>) => void) | null> | null = null;

function loadWaitUntil(): Promise<((promise: Promise<unknown>) => void) | null> {
	if (!waitUntilPromise) {
		waitUntilPromise = import("cloudflare:workers")
			.then((module) => module.waitUntil ?? null)
			.catch(() => null);
	}
	return waitUntilPromise;
}

async function scheduleInBackground(task: Promise<unknown>): Promise<void> {
	const settled = task.catch((error) => {
		console.error("[background] 后台任务失败", error);
	});

	const waitUntil = await loadWaitUntil();
	if (waitUntil) {
		waitUntil(settled);
		return;
	}

	// 非请求上下文：没有 ExecutionContext 可以挂载，就地等待而不是丢弃。
	await settled;
}
