import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runInBackground } from "../../src/lib/background";

/**
 * `runInBackground` 的行为测试。
 *
 * 测试环境是 Node，拿不到 `cloudflare:workers` 的 `ExecutionContext`，
 * 因此这里覆盖的正是**降级路径**——而这条路径在真实运行中同样重要：
 * `astro build` 的预渲染阶段、以及任何非请求上下文都会走到它。
 *
 * Workers 里"真的调用了 waitUntil"这一半无法在此验证，它只是一行对文档化 API 的
 * 调用；但"调用方不被阻塞""失败不会炸掉进程"这两条契约是可以在本地守住的。
 */
describe("后台任务调度", () => {
	test("同步返回，不阻塞调用方", async () => {
		let taskFinished = false;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const task = gate.then(() => {
			taskFinished = true;
		});

		runInBackground(task);

		// 关键契约：调用方立刻拿回控制权，即使任务还没完成
		assert.equal(taskFinished, false, "runInBackground 必须同步返回");

		release();
		await task;
		assert.equal(taskFinished, true, "任务最终必须被执行，不能被丢弃");
	});

	test("任务成功完成，结果不丢", async () => {
		const seen: string[] = [];
		runInBackground(
			(async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				seen.push("done");
			})(),
		);

		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.deepEqual(seen, ["done"]);
	});

	test("任务失败不会抛出，也不会变成未处理的 rejection", async () => {
		const logged: unknown[][] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};

		let unhandled: unknown = null;
		const onUnhandled = (reason: unknown) => {
			unhandled = reason;
		};
		process.on("unhandledRejection", onUnhandled);

		try {
			assert.doesNotThrow(() => runInBackground(Promise.reject(new Error("模拟后台任务失败"))));
			// 给微任务与 unhandledRejection 的判定留出时间
			await new Promise((resolve) => setTimeout(resolve, 30));
		} finally {
			console.error = originalError;
			process.off("unhandledRejection", onUnhandled);
		}

		assert.equal(unhandled, null, "后台任务失败不应产生 unhandledRejection");
		assert.ok(logged.length > 0, "后台任务失败应被记录，而不是静默吞掉");
	});
});
