import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import vm from "node:vm";

/**
 * `public/hero-sidebar-fit.js` 的行为验证。
 *
 * 这里没有浏览器可用，所以用一个足够小的 DOM 桩把**真实脚本**跑起来：
 * 断言「显示几张」是真的按 .hero-body 的高度算出来的，而不是靠肉眼。
 * 桩里模拟的高度关系是固定的（见下面的常量），脚本读到的就是这些值。
 */

const PINNED_HEIGHT = 100;
const CARD_HEIGHT = 40;
const GAP = 10;

interface FakeElement {
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
}

interface FakeDom {
	cards: FakeElement[];
	hidden: Set<FakeElement>;
	documentStub: Record<string, unknown>;
	windowStub: Record<string, unknown>;
	HTMLElementStub: new () => unknown;
	documentListeners: Record<string, (() => void)[]>;
	flushFrames(): void;
}

function createFakeDom(options: { bodyHeight: number; cardCount: number; wide: boolean }): FakeDom {
	const hidden = new Set<FakeElement>();
	const documentListeners: Record<string, (() => void)[]> = {};
	const frames: (() => void)[] = [];

	// 脚本里对目标节点做了 `x instanceof HTMLElement` 判断，桩必须是同一个类的实例
	class FakeHTMLElement {
		parentElement: { querySelector: () => unknown } | null = null;
	}

	const makeElement = (attributes: Record<string, string>): FakeElement => {
		const attrs = new Set(Object.keys(attributes));
		const element: FakeElement = {
			setAttribute(name: string) {
				attrs.add(name);
				if (name === "data-sidebar-hidden") {
					hidden.add(element);
				}
			},
			removeAttribute(name: string) {
				attrs.delete(name);
				if (name === "data-sidebar-hidden") {
					hidden.delete(element);
				}
			},
		};

		if (attrs.has("data-sidebar-hidden")) {
			hidden.add(element);
		}

		return element;
	};

	const cards: FakeElement[] = [];
	for (let index = 0; index < options.cardCount; index += 1) {
		cards.push(
			makeElement({ "data-hero-sidebar-post": String(index), "data-sidebar-hidden": "true" }),
		);
	}

	// 置顶卡：不带候选属性，永远显示，脚本用它判断「侧栏不能只剩置顶」
	const pinned = makeElement({ class: "post-compact" });

	class FakeBody extends FakeHTMLElement {
		getBoundingClientRect() {
			return { height: options.bodyHeight };
		}
	}

	class FakeSidebar extends FakeHTMLElement {
		querySelectorAll(selector: string) {
			if (selector === "[data-hero-sidebar-post]") {
				return cards;
			}

			if (selector === ":scope > article") {
				return [pinned, ...cards];
			}

			return [];
		}

		getBoundingClientRect() {
			const visible = cards.filter((card) => !hidden.has(card)).length;
			return { height: PINNED_HEIGHT + visible * (CARD_HEIGHT + GAP) };
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
		hidden,
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

const visibleCount = (dom: FakeDom) => dom.cards.filter((card) => !dom.hidden.has(card)).length;

describe("首页 Hero 侧栏测量脚本", () => {
	test("正文很高时会把候选卡尽量显示出来", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 400, cardCount: 3, wide: true }));
		assert.equal(visibleCount(dom), 3);
	});

	test("正文较矮时只显示能塞进去的张数", async () => {
		// 置顶 100 + 每张 (40 + 10)：150 只装得下 1 张
		const dom = await runScript(createFakeDom({ bodyHeight: 150, cardCount: 3, wide: true }));
		assert.equal(visibleCount(dom), 1);
	});

	test("正文再高一点就显示 2 张，不会一步跳到 3 张", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 200, cardCount: 3, wide: true }));
		assert.equal(visibleCount(dom), 2);
	});

	test("即使正文极矮也至少留一张最新文章，不让侧栏只剩置顶", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 10, cardCount: 3, wide: true }));
		assert.equal(visibleCount(dom), 1);
	});

	test("窄屏固定只显示一张最新文章", async () => {
		const dom = await runScript(createFakeDom({ bodyHeight: 900, cardCount: 3, wide: false }));
		assert.equal(visibleCount(dom), 1);
	});
});
