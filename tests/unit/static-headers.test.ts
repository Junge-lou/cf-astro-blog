import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

/**
 * `public/_headers` 的一致性保护。
 *
 * 背景：这个文件只在**资源层直接下发**的文件上生效（Worker 渲染的路由不经过它）。
 * 它对 public/ 下的手写脚本逐条声明了缓存策略——而不是写一条 `/*.js`，因为
 * `*` 会跨越 `/`，会与 `/_astro/*` 的 immutable 规则重叠，而平台对多条规则命中
 * 同一响应头时的取舍顺序没有明确文档。
 *
 * 代价是：**新增/删除 public/ 脚本时必须同步这个列表**。下面的测试就是那道闸门。
 */
const HEADERS_PATH = "public/_headers";

/** 解析 `_headers` 的路径行（非缩进、非空、非注释行）。 */
async function readDeclaredPaths(): Promise<string[]> {
	const source = await readFile(HEADERS_PATH, "utf8");

	return source
		.split(/\r?\n/u)
		.filter((line) => line.trim() !== "" && !line.startsWith("#") && !/^\s/u.test(line))
		.map((line) => line.trim());
}

describe("public/_headers 与静态资源保持一致", () => {
	test("public/ 下每个脚本都在 _headers 中有缓存声明", async () => {
		const entries = await readdir("public", { withFileTypes: true });
		const scripts = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
			.map((entry) => `/${entry.name}`)
			.sort();

		assert.ok(scripts.length > 0, "应当能发现 public/ 下的脚本");

		const declared = new Set(await readDeclaredPaths());
		const missing = scripts.filter((path) => !declared.has(path));

		assert.deepEqual(
			missing,
			[],
			`以下脚本缺少缓存声明，请补进 ${HEADERS_PATH}（否则每次导航都会回源校验）：\n${missing.join("\n")}`,
		);
	});

	test("_headers 不声明不存在的路径或目录（避免留下失效规则）", async () => {
		const declared = await readDeclaredPaths();
		const entries = await readdir("public", { withFileTypes: true });
		const existing = new Set(entries.map((entry) => `/${entry.name}`));

		// 构建期生成的产物目录不在 public/ 中，单独放行
		const buildOutputPrefixes = ["/_astro/"];

		const dangling = declared.filter((path) => {
			if (buildOutputPrefixes.some((prefix) => path.startsWith(prefix))) {
				return false;
			}

			if (path.includes("*")) {
				// 形如 `/fonts/*`：必须存在同名目录，否则这条规则永远不会生效。
				// 这正是修复前的问题——文件里留着 /assets/*、/fonts/*、/images/*、
				// /pagefind/* 四条规则，而 public/ 下这四个目录都不存在。
				const dir = path.slice(0, path.indexOf("*")).replace(/\/$/u, "");
				return !existing.has(dir);
			}

			return !existing.has(path);
		});

		assert.deepEqual(
			dangling,
			[],
			`以下规则指向不存在的路径或目录（永远不会生效，应删除）：\n${dangling.join("\n")}`,
		);
	});

	test("指纹化构建产物使用 immutable 长缓存", async () => {
		const source = await readFile(HEADERS_PATH, "utf8");

		assert.match(
			source,
			/\/_astro\/\*[\s\S]*?Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/u,
			"/_astro/* 必须声明 immutable；否则适配器会自行注入，两处容易产生分歧",
		);
	});

	test("每个路径都紧跟自己的缩进头块（否则平台会静默丢弃该规则）", async () => {
		// 这条断言来自一次真实事故：曾经把 15 个脚本路径写在一起、下面共享一个缩进块，
		// 文件看起来没问题、之前的测试也通过，但 `wrangler dev` 启动时打印
		//   "Parsed 3 valid header rules" + "Found 14 invalid header rules: No headers specified"
		// —— 除最后一个路径外全部被静默丢弃。平台要求每个路径**紧接着**自己的头块。
		const source = await readFile(HEADERS_PATH, "utf8");
		const lines = source.split(/\r?\n/u);
		const offenders: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			// tsconfig 开了 noUncheckedIndexedAccess，索引访问是 string | undefined
			const line = lines[i] ?? "";
			// 跳过空行、注释、以及缩进的头行
			if (line.trim() === "" || line.startsWith("#") || /^\s/u.test(line)) {
				continue;
			}

			// 到这里说明这是一个路径行，它的**下一行**必须是缩进的头行
			const next = lines[i + 1];
			if (next === undefined || !/^\s/u.test(next)) {
				offenders.push(line.trim());
			}
		}

		assert.deepEqual(
			offenders,
			[],
			`以下路径后面没有紧跟缩进的头块，平台会判为 "No headers specified" 并静默丢弃该规则：\n` +
				`${offenders.join("\n")}\n` +
				"（每个路径必须写自己的缩进块，多个路径不能共享一个）",
		);
	});
});
