import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * 字号刻度的一致性保护。
 *
 * 背景：迁移前全站有 **46 个不同的 font-size 取值**（13 处 0.78rem、9 处 0.82rem、
 * 8 处 0.88rem…），彼此相差 1–2px 却没有任何依据。现在收敛成 7 档黄金比例刻度，
 * 下面的测试就是防止它重新长回去的闸门。
 *
 * 允许的例外只有两类，都在下面显式放行：
 *   1. `html` 上的 `1rem` —— 刻度本身的锚点，且是 rem 的参照，不能写成变量；
 *   2. `em` 相对单位 —— 行内 code、sup/sub、聊天气泡等必须跟随父级字号。
 */

const GLOBAL_CSS = "src/styles/global.css";
const PHI = (1 + Math.sqrt(5)) / 2;

/** Windows 下 readdir/join 会给出反斜杠，统一成正斜杠再比较。 */
function normalizePath(file: string): string {
	return file.replaceAll("\\", "/");
}

/** 刻度必须正好是这 7 个，顺序 = 从最小到最大。 */
const EXPECTED_TOKENS = [
	"--text-sm",
	"--text-md",
	"--text-lg",
	"--text-xl",
	"--text-2xl",
	"--text-3xl",
	"--text-4xl",
];

async function readScale(): Promise<Map<string, string>> {
	const css = await readFile(GLOBAL_CSS, "utf8");
	const scale = new Map<string, string>();

	for (const token of EXPECTED_TOKENS) {
		const match = css.match(new RegExp(`${token}:\\s*([^;]+);`, "u"));
		assert.ok(match, `global.css 缺少刻度 ${token}`);
		scale.set(token, (match[1] as string).trim());
	}

	return scale;
}

/** 递归收集需要检查的样式文件。 */
async function collectStyleFiles(dir = "src"): Promise<string[]> {
	const out: string[] = [];

	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await collectStyleFiles(full)));
			continue;
		}
		if (/\.(?:css|astro)$/u.test(entry.name)) {
			out.push(full);
		}
	}

	return out;
}

/** 取出每个 `font-size: <值>;` 声明，带上文件与行号，方便报错定位。 */
function extractFontSizes(
	source: string,
	file: string,
): { file: string; line: number; value: string }[] {
	const found: { file: string; line: number; value: string }[] = [];
	const lines = source.split(/\r?\n/u);

	lines.forEach((text, index) => {
		const match = text.match(/font-size:\s*([^;]+);/u);
		if (match) {
			found.push({ file, line: index + 1, value: (match[1] as string).trim() });
		}
	});

	return found;
}

describe("字号黄金比例刻度", () => {
	test("global.css 正好定义 7 档刻度", async () => {
		const scale = await readScale();

		assert.deepEqual([...scale.keys()], EXPECTED_TOKENS);
		assert.equal(scale.size, 7);
	});

	test("固定档位严格按 √φ 递进（每两档 = φ，每四档 = φ²）", async () => {
		const scale = await readScale();

		// 前四档是固定值；后四档是 clamp，取上界参与比值校验
		const fixed = ["--text-sm", "--text-md", "--text-lg", "--text-xl"] as const;
		const [sm, md, lg, xl] = fixed.map((token) =>
			Number.parseFloat(scale.get(token) as string),
		) as [number, number, number, number];

		const step = Math.sqrt(PHI);
		const pairs: [string, number, number][] = [
			["sm→md", sm, md],
			["md→lg", md, lg],
			["lg→xl", lg, xl],
		];

		for (const [label, lower, upper] of pairs) {
			const ratio = upper / lower;
			assert.ok(
				Math.abs(ratio - step) < 1e-3,
				`${label} 的比值是 ${ratio.toFixed(4)}，应为 √φ ≈ ${step.toFixed(4)}`,
			);
		}

		// 隔 1 档 = √φ（上面已校验），隔 2 档 = φ
		assert.ok(Math.abs(lg / sm - PHI) < 1e-3, "sm→lg 应等于 φ");
		assert.ok(Math.abs(xl / md - PHI) < 1e-3, "md→xl 应等于 φ");

		// 从 sm 往上数 4 档（--text-2xl 的上界）应为 φ²
		const topRem = (scale.get("--text-2xl") as string).match(/([0-9.]+)rem\)$/u)?.[1];
		assert.ok(topRem, "--text-2xl 的 clamp 上界解析失败");
		assert.ok(
			Math.abs(Number.parseFloat(topRem) / sm - PHI ** 2) < 5e-3,
			"sm→2xl 的上界应约等于 φ²",
		);
	});

	test("clamp 档位的上下界都落在刻度上", async () => {
		const scale = await readScale();
		const ladder = [...scale.values()].flatMap((value) =>
			[...value.matchAll(/([0-9.]+)rem/gu)].map((match) => Number.parseFloat(match[1] as string)),
		);
		const known = new Set(ladder.map((value) => value.toFixed(4)));

		for (const token of ["--text-2xl", "--text-3xl", "--text-4xl"]) {
			const value = scale.get(token) as string;
			assert.ok(value.includes("clamp("), `${token} 应为 clamp`);

			const bounds = [...value.matchAll(/([0-9.]+)rem/gu)].map((m) =>
				Number.parseFloat(m[1] as string),
			);
			const min = bounds[0];
			const max = bounds.at(-1);
			assert.ok(min !== undefined && max !== undefined, `${token} 的 clamp 边界解析失败`);

			for (const bound of [min, max]) {
				assert.ok(
					known.has(bound.toFixed(4)),
					`${token} 的边界 ${bound}rem 不在刻度上（可用值：${[...known].join(", ")}）`,
				);
			}
		}
	});

	test("源码里不再有裸字号（em 与 html 锚点除外）", async () => {
		const files = await collectStyleFiles();
		const offenders: string[] = [];

		/**
		 * 410 页面是一个完全自包含的 HTML 文档（在 Worker 里直接 `new Response` 出去，
		 * 不经过 Base 布局，因此拿不到站点的 CSS 变量），内联字号只能写字面量。
		 */
		const SELF_CONTAINED_PAGES = new Set(["src/pages/blog/[slug].astro"]);

		for (const file of files) {
			const source = await readFile(file, "utf8");
			const isSelfContained = SELF_CONTAINED_PAGES.has(normalizePath(file));

			for (const { line, value } of extractFontSizes(source, file)) {
				const isToken = value.startsWith("var(--text-");
				// 只放行 em（跟随父级字号）；rem/px 都不算"相对"
				const isRelative = /^[0-9.]+em$/u.test(value);
				// html 的根字号是刻度锚点，必须保持字面量
				const isRootAnchor = normalizePath(file) === GLOBAL_CSS && value === "1rem";

				if (isSelfContained) {
					continue;
				}

				if (!isToken && !isRelative && !isRootAnchor) {
					offenders.push(`${normalizePath(file)}:${line}  font-size: ${value}`);
				}
			}
		}

		assert.deepEqual(
			offenders,
			[],
			`以下字号脱离了刻度，请改用 var(--text-*)，或用 em 表达相对关系：\n${offenders.join("\n")}`,
		);
	});
});
