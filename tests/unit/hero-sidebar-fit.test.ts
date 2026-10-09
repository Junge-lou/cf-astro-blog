import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import vm from "node:vm";

/**
 * `public/hero-sidebar-fit.js` 的行为验证。
 *
 * 这里没有浏览器可用，所以用一个足够小的 DOM 桩把**真实脚本**跑起来。
 * 桩里模拟浏览器对侧栏的布局规则 ——
 *   卡片高度 = max(自然高度, 脚本写下的 --hero-sidebar-card-row)
 *   侧栏高度 = Σ卡片高度 + gap × (卡片数 − 1) + 上下 padding
 * 于是断言的是「张数与卡片高度真的按 .hero-body 的高度算出来」，而不是靠肉眼。
 *
 * 桩里的常量与 index.astro / 脚本里的 CSS 取值保持一致：
 *   PINNED_HEIGHT / CARD_NATURAL  置顶卡与一张最新文章卡的自然高度
 *   PINNED_COUNT                  置顶卡数量
 *   GAP / PADDING                 宽屏 gap 0.35rem / padding 0.45rem
 *   CARD_MIN_HEIGHT / CARD_MAX_HEIGHT  单张卡高度区间（脚本里同为 76px / 208px）
 */

const PINNED_HEIGHT = 100;
const CARD_NATURAL = 120;
const PINNED_COUNT = 2;
const GAP = 5.6;
const PADDING = 7.2;
const CARD_MIN_HEIGHT = 76;
const CARD_MAX_HEIGHT = 208;

interface CardStub {
	natural: number;
	baseline: number | null;
	hidden: boolean;
	style: {
		setProperty(name: string, value: string): void;
		removeProperty(name: string): void;
	};
	hasAttribute(name: string): boolean;
	setAttribute(name: string): void;
	removeAttribute(name: string): void;
	getBoundingClientRect(): { height: number };
}

interface FakeDom {
	cards: CardStub[];
	pinned: { height: number }[];
	/** 容器上的基线（脚本给所有卡写的那份）；null 表示没有拉伸 */
	sidebarBaseline: number | null;
	documentStub: Record<string, unknown>;
	windowStub: Record<string, unknown>;
	HTMLElementStub: new () => unknown;
	documentListeners: Record<string, (() => void)[]>;
	flushFrames(): void;
}

/** 计算侧栏高度只需要这几项；单独命名，避免为了传参去伪造整个 FakeDom。 */
type SidebarMetrics = Pick<FakeDom, "cards" | "pinned" | "sidebarBaseline">;

const visibleCards = (dom: SidebarMetrics) => dom.cards.filter((card) => !card.hidden);

/**
 * 取唯一那张可见卡。
 *
 * tsconfig 开了 noUncheckedIndexedAccess，`visible[0]` 是 `CardStub | undefined`；
 * 直接传进 cardHeight 过不了类型检查，所以在这里显式收窄一次。
 */
function firstVisibleCard(dom: SidebarMetrics): CardStub {
	const card = visibleCards(dom)[0];

	if (!card) {
		throw new Error("预期至少有一张可见的候选卡");
	}

	return card;
}

/**
 * 桩里的高度公式，必须与 CSS 行为一致：
 * 脚本写下的基线会被 CSS 的 min-height / max-height 夹一次，
 * 且只有候选卡会被拉伸（置顶卡也写基线，但它们的自然高就是内容高）。
 */
function cardHeight(card: CardStub) {
	// 基线为 null（没写）或 0（脚本的校准状态）都表示「不被拉伸」
	if (card.baseline === null || card.baseline === 0) {
		return card.natural;
	}

	return Math.min(Math.max(card.baseline, CARD_MIN_HEIGHT), CARD_MAX_HEIGHT);
}

/**
 * 侧栏高度，与 CSS/flex 行为对齐：
 * - 容器变量为 0（脚本的校准状态）→ 卡片都是自然高度；
 * - 否则所有卡等高，高度就是容器变量那一个值。
 */
function sidebarHeight(dom: SidebarMetrics) {
	const items = dom.pinned.length + visibleCards(dom).length;

	if (items === 0) {
		return PADDING * 2;
	}

	const stretching = dom.sidebarBaseline !== null && dom.sidebarBaseline > 0;
	const cardHeightValue = stretching
		? Math.min(Math.max(dom.sidebarBaseline ?? 0, CARD_MIN_HEIGHT), CARD_MAX_HEIGHT)
		: (dom.pinned[0]?.height ?? CARD_NATURAL);

	return cardHeightValue * items + GAP * (items - 1) + PADDING * 2;
}

function createFakeDom(options: { bodyHeight: number; cardCount: number; wide: boolean }): FakeDom {
	const documentListeners: Record<string, (() => void)[]> = {};
	const frames: (() => void)[] = [];

	// 脚本里对目标节点做了 `x instanceof HTMLElement` 判断，桩必须是同一个类的实例
	class FakeHTMLElement {
		parentElement: { querySelector: () => unknown } | null = null;
	}

	const makeCard = (natural: number, initiallyHidden: boolean): CardStub => {
		const attributes = new Set(initiallyHidden ? ["data-sidebar-hidden"] : []);
		const card: CardStub = {
			natural,
			baseline: null,
			hidden: initiallyHidden,
			style: {
				setProperty(name: string, value: string) {
					if (name === "--hero-sidebar-card-row") {
						card.baseline = Number.parseFloat(value);
					}
				},
				removeProperty(name: string) {
					if (name === "--hero-sidebar-card-row") {
						card.baseline = null;
					}
				},
			},
			getBoundingClientRect() {
				return { height: cardHeight(card) };
			},
			hasAttribute(name: string) {
				return attributes.has(name);
			},
			setAttribute(name: string) {
				attributes.add(name);
				if (name === "data-sidebar-hidden") {
					card.hidden = true;
				}
			},
			removeAttribute(name: string) {
				attributes.delete(name);
				if (name === "data-sidebar-hidden") {
					card.hidden = false;
				}
			},
		};

		return card;
	};

	const cards: CardStub[] = [];
	for (let index = 0; index < options.cardCount; index += 1) {
		cards.push(makeCard(CARD_NATURAL, true));
	}

	// 置顶卡：不带候选属性，永远显示，脚本靠它区分「参与计数的候选」与「固定占位」；
	// 它也带 style（脚本会给每张卡写高度基线）
	const pinned = Array.from({ length: PINNED_COUNT }, () => {
		const entry = {
			height: PINNED_HEIGHT,
			baseline: null as number | null,
			style: {
				setProperty(name: string, value: string) {
					if (name === "--hero-sidebar-card-row") {
						entry.baseline = Number.parseFloat(value);
					}
				},
				removeProperty(name: string) {
					if (name === "--hero-sidebar-card-row") {
						entry.baseline = null;
					}
				},
			},
			getBoundingClientRect() {
				return { height: PINNED_HEIGHT };
			},
		};

		return entry;
	});

	class FakeBody extends FakeHTMLElement {
		getBoundingClientRect() {
			return { height: options.bodyHeight };
		}
	}

	let sidebarBaseline: number | null = null;

	class FakeSidebar extends FakeHTMLElement {
		style = {
			setProperty(name: string, value: string) {
				if (name === "--hero-sidebar-card-row") {
					sidebarBaseline = Number.parseFloat(value);
				}
			},
			removeProperty(name: string) {
				if (name === "--hero-sidebar-card-row") {
					sidebarBaseline = null;
				}
			},
		};

		get children() {
			// 置顶卡也要能被量高度、被写高度基线：直接返回同一批对象
			return [...pinned, ...cards];
		}

		querySelectorAll(selector: string) {
			return selector === "[data-hero-sidebar-post]" ? cards : [];
		}

		getBoundingClientRect() {
			return { height: sidebarHeight({ cards, pinned, sidebarBaseline }) };
		}
	}

	const body = new FakeBody();
	const sidebar = new FakeSidebar();
	sidebar.parentElement = { querySelector: () => body };

	const mediaQuery = {
		matches: options.wide,
		addEventListener() {},
	};

	const documentStub = {
		readyState: "loading",
		querySelector: (selector: string) => (selector === "[data-hero-sidebar-fit]" ? sidebar : null),
		addEventListener(type: string, listener: () => void) {
			const listeners = documentListeners[type] ?? [];
			listeners.push(listener);
			documentListeners[type] = listeners;
		},
	};

	const windowStub = {
		matchMedia: () => mediaQuery,
		requestAnimationFrame(callback: () => void) {
			frames.push(callback);
			return frames.length;
		},
		addEventListener() {},
		removeEventListener() {},
	};

	return {
		cards,
		pinned,
		// 脚本写给容器的那份基线，读的时候取最新值（写高度后又被校准清掉过）
		get sidebarBaseline() {
			return sidebarBaseline;
		},
		documentStub,
		windowStub,
		documentListeners,
		HTMLElementStub: FakeHTMLElement,
		flushFrames() {
			// 脚本里的 schedule 每次只排一帧，这里连续抽干直到没有新的排队
			for (let guard = 0; frames.length > 0 && guard < 30; guard += 1) {
				frames.shift()?.();
			}
		},
	};
}

async function runScript(dom: FakeDom): Promise<FakeDom> {
	const source = await readFile("public/hero-sidebar-fit.js", "utf8");
	const context = vm.createContext({
		document: dom.documentStub,
		window: dom.windowStub,
		ResizeObserver: class {
			observe() {}
			disconnect() {}
		},
		HTMLElement: dom.HTMLElementStub,
		console,
	});

	vm.runInContext(source, context);

	for (const listener of dom.documentListeners.DOMContentLoaded ?? []) {
		listener();
	}

	dom.flushFrames();
	return dom;
}

describe("首页 Hero 侧栏测量脚本", () => {
	test("正文很高时放满候选卡，并给每张卡算出拉伸后的高度", async () => {
		// 全部卡片等高：置顶 2 张 + 候选 3 张，正文 640 时每张分到 (640-25.2)/5 - 5.6
		const dom = await runScript(createFakeDom({ bodyHeight: 640, cardCount: 3, wide: true }));
		const visible = visibleCards(dom);
		assert.equal(visible.length, 3);

		// 置顶卡保持自然高（里面是固定比例的封面），只有候选卡吃剩余空间：
		// 卡高 = (正文高度 - 置顶卡高 - gap - padding×2 - gap×(n-1)) / n
		const fixed = PINNED_HEIGHT * PINNED_COUNT + GAP + PADDING * 2;
		const expected = (640 - fixed - GAP * (visible.length - 1)) / visible.length;
		const heights = visible.map((card) => cardHeight(card));
		assert.ok(
			heights.every((height) => Math.abs(height - expected) < 0.01),
			`每张候选卡都等于均分结果 ${expected.toFixed(1)}：${heights}`,
		);
		assert.ok(
			expected >= CARD_MIN_HEIGHT && expected <= CARD_MAX_HEIGHT,
			`均分结果在上限与下限之间：${expected}`,
		);
	});

	test("正文较矮时减少张数，而不是硬塞进去", async () => {
		// 置顶 2 张占 200 + gap + padding = 220：380 只够 2 张候选（每张 77.2px），
		// 3 张时每张只剩 49.6px，跌破 76px 下限
		const dom = await runScript(createFakeDom({ bodyHeight: 380, cardCount: 3, wide: true }));
		assert.equal(visibleCards(dom).length, 2);
	});

	test("正文再矮一点就只留一张", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 250, cardCount: 3, wide: true }));
		assert.equal(visibleCards(dom).length, 1);
	});

	test("正文极矮时回到自然高度，宁可侧栏略高也不截断标题", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 40, cardCount: 3, wide: true }));
		assert.equal(visibleCards(dom).length, 1);
		assert.equal(cardHeight(firstVisibleCard(dom)), CARD_NATURAL, "没写入基线时就用自然高度");
		assert.ok(sidebarHeight(dom) >= CARD_MIN_HEIGHT, "侧栏至少装得下一张有下限高度的卡");
	});

	test("窄屏固定只显示一张最新文章，且不拉伸高度", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 900, cardCount: 3, wide: false }));
		assert.equal(visibleCards(dom).length, 1);
		assert.equal(cardHeight(firstVisibleCard(dom)), CARD_NATURAL);
	});

	test("可见总数夹在 5 张以内：候选再多也不超过置顶 2 + 最新 3", async () => {
		// 正文足够高，8 张候选也只该放出 3 张
		const dom = await runScript(createFakeDom({ bodyHeight: 9999, cardCount: 8, wide: true }));
		assert.equal(visibleCards(dom).length, 3);
	});

	test("正文高到分不完时把高度夹在上限，而不是减张数留空壳", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 9999, cardCount: 3, wide: true }));
		const visible = visibleCards(dom);
		assert.equal(visible.length, 3, "张数取满");
		assert.ok(
			visible.every((card) => cardHeight(card) <= CARD_MAX_HEIGHT),
			`高度不超过上限：${visible.map((card) => cardHeight(card))}`,
		);
	});
});
