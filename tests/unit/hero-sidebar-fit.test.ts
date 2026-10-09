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
	documentStub: Record<string, unknown>;
	windowStub: Record<string, unknown>;
	HTMLElementStub: new () => unknown;
	documentListeners: Record<string, (() => void)[]>;
	flushFrames(): void;
}

const visibleCards = (dom: FakeDom) => dom.cards.filter((card) => !card.hidden);

/** 桩里的高度公式，必须与 CSS/flex 行为一致。 */
function cardHeight(card: CardStub) {
	return Math.max(card.natural, card.baseline ?? 0);
}

function sidebarHeight(dom: FakeDom) {
	const items = dom.pinned.length + visibleCards(dom).length;
	const content =
		dom.pinned.reduce((sum, pinned) => sum + pinned.height, 0) +
		visibleCards(dom).reduce((sum, card) => sum + cardHeight(card), 0);
	return content + GAP * (items > 0 ? items - 1 : 0) + PADDING * 2;
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

	// 置顶卡：不带候选属性，永远显示，脚本靠它区分「参与计数的候选」与「固定占位」
	const pinned = Array.from({ length: PINNED_COUNT }, () => ({
		height: PINNED_HEIGHT,
		getBoundingClientRect() {
			return { height: PINNED_HEIGHT };
		},
	}));

	class FakeBody extends FakeHTMLElement {
		getBoundingClientRect() {
			return { height: options.bodyHeight };
		}
	}

	class FakeSidebar extends FakeHTMLElement {
		style = {
			setProperty() {},
			removeProperty() {},
		};

		get children() {
			// 置顶卡也要能被量高度：脚本按它们算出「随张数不变」的那部分高度
			return [
				...pinned.map(() => ({
					getBoundingClientRect() {
						return { height: PINNED_HEIGHT };
					},
				})),
				...cards,
			];
		}

		querySelectorAll(selector: string) {
			return selector === "[data-hero-sidebar-post]" ? cards : [];
		}

		getBoundingClientRect() {
			const dom = { cards, pinned } as FakeDom;
			return { height: sidebarHeight(dom) };
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
		// 置顶 214.4 + 每张候选 125.6：正文到 640 时三张卡刚好各分到 134.4px
		const dom = await runScript(createFakeDom({ bodyHeight: 640, cardCount: 3, wide: true }));
		const visible = visibleCards(dom);
		assert.equal(visible.length, 3);

		// 卡片高度是「正文高度 / 张数」的函数：三张卡等高，等于按可用高度均分的结果
		const top = PINNED_COUNT * PINNED_HEIGHT + PINNED_COUNT * GAP + PADDING * 2;
		const expected = (640 - top + GAP) / visible.length - GAP;
		const heights = visible.map((card) => cardHeight(card));
		assert.ok(
			heights.every((height) => Math.abs(height - expected) < 0.01),
			`每张卡都等于均分结果 ${expected.toFixed(1)}：${heights}`,
		);
		assert.ok(
			expected >= CARD_MIN_HEIGHT && expected <= CARD_MAX_HEIGHT,
			`均分结果在上限与下限之间：${expected}`,
		);
	});

	test("正文较矮时减少张数，而不是硬塞进去", async () => {
		// 3 张要 591.2 才放得下，500 只够 2 张
		const dom = await runScript(createFakeDom({ bodyHeight: 500, cardCount: 3, wide: true }));
		assert.equal(visibleCards(dom).length, 2);
	});

	test("正文再矮一点就只留一张", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 250, cardCount: 3, wide: true }));
		assert.equal(visibleCards(dom).length, 1);
	});

	test("正文极矮时回到自然高度，宁可侧栏略高也不截断标题", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 40, cardCount: 3, wide: true }));
		const visible = visibleCards(dom);
		assert.equal(visible.length, 1);
		assert.equal(cardHeight(visible[0]), CARD_NATURAL, "没写入基线时就用自然高度");
		assert.ok(sidebarHeight(dom) >= CARD_MIN_HEIGHT, "侧栏至少装得下一张有下限高度的卡");
	});

	test("窄屏固定只显示一张最新文章，且不拉伸高度", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 900, cardCount: 3, wide: false }));
		const visible = visibleCards(dom);
		assert.equal(visible.length, 1);
		assert.equal(cardHeight(visible[0]), CARD_NATURAL);
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
