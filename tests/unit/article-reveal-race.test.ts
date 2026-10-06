import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

/**
 * 行为级回归测试：用最小 DOM 桩执行 public/ 里真实的
 * code-block-enhance.js 与 article-reveal.js，覆盖两种执行时序。
 *
 * 背景（“刷新后代码块变透明”的根因）：
 * - article-reveal.js 无 readyState 守卫，脚本一执行就立即收集
 *   .article-prose 的直接子元素并标记 data-reveal / 观察；
 * - code-block-enhance.js 在硬刷新（readyState=loading）时等
 *   DOMContentLoaded 才把 <pre> 包装成 <figure class="prose-code-block">；
 * - 于是硬刷新时 reveal 先标记 <pre>，随后 <pre> 被移入 figure 内层，
 *   新的直接子元素 <figure> 从未被标记/观察，CSS 的
 *   `.article-prose.js-reveal > * { opacity: 0 }` 使其永久透明。
 *
 * 修复：enhance 包装完成后派发 prose:restructured 事件并清理 pre 上的
 * 失效标记；reveal 的扫描改为可重入（跳过已标记子元素）并监听该事件。
 */

// ── 最小 DOM 桩 ────────────────────────────────────────────────────────────

class FakeClassList {
	set: Set<string>;

	constructor() {
		this.set = new Set();
	}

	contains(name: string): boolean {
		return this.set.has(name);
	}

	add(...names: string[]): void {
		for (const name of names) this.set.add(name);
	}

	remove(...names: string[]): void {
		for (const name of names) this.set.delete(name);
	}

	toggle(name: string): boolean {
		if (this.set.has(name)) {
			this.set.delete(name);
			return false;
		}
		this.set.add(name);
		return true;
	}

	*[Symbol.iterator](): Iterator<string> {
		yield* this.set;
	}
}

class FakeStyle {
	map: Map<string, string>;

	constructor() {
		this.map = new Map();
	}

	setProperty(name: string, value: string): void {
		this.map.set(name, value);
	}

	getPropertyValue(name: string): string {
		return this.map.get(name) ?? "";
	}

	removeProperty(name: string): void {
		this.map.delete(name);
	}
}

interface FakeNode {
	tagName: string;
	matches?: (selector: string) => boolean;
}

class FakeElement {
	tagName: string;
	children: Array<FakeElement | FakeNode>;
	parentNode: FakeElement | null;
	attrs: Map<string, string>;
	dataset: Record<string, string>;
	style: FakeStyle;
	listeners: Record<string, Array<() => void>>;
	textContentValue?: string;
	_classList: FakeClassList;

	constructor(tag: string) {
		this.tagName = tag.toUpperCase();
		this.children = [];
		this.parentNode = null;
		this.attrs = new Map();
		this.dataset = {};
		this.style = new FakeStyle();
		this.listeners = {};
		this._classList = new FakeClassList();
	}

	get classList(): FakeClassList {
		return this._classList;
	}

	get className(): string {
		return [...this._classList.set].join(" ");
	}

	set className(value: string) {
		this._classList.set = new Set(value.split(/\s+/).filter(Boolean));
	}

	get parentElement(): FakeElement | null {
		return this.parentNode;
	}

	get textContent(): string {
		return this.textContentValue ?? "";
	}

	set textContent(value: string) {
		this.textContentValue = value;
	}

	hasAttribute(name: string): boolean {
		return this.attrs.has(name);
	}

	setAttribute(name: string, value: string): void {
		this.attrs.set(name, String(value));
	}

	removeAttribute(name: string): void {
		this.attrs.delete(name);
	}

	appendChild<T extends FakeElement | FakeNode>(child: T): T {
		if (child instanceof FakeElement && child.parentNode) {
			child.parentNode.removeChild(child);
		}
		if (child instanceof FakeElement) child.parentNode = this;
		this.children.push(child);
		return child;
	}

	append(...nodes: Array<FakeElement | FakeNode>): void {
		for (const node of nodes) this.appendChild(node);
	}

	insertBefore(node: FakeElement, ref: FakeElement): FakeElement {
		if (node.parentNode) node.parentNode.removeChild(node);
		node.parentNode = this;
		const idx = this.children.indexOf(ref);
		if (idx === -1) this.children.push(node);
		else this.children.splice(idx, 0, node);
		return node;
	}

	removeChild(child: FakeElement): FakeElement {
		const idx = this.children.indexOf(child);
		if (idx !== -1) this.children.splice(idx, 1);
		child.parentNode = null;
		return child;
	}

	matches(selector: string): boolean {
		// 支持 ".cls" / "tag" / "tag.cls" / ".a.b" 及一段后代组合
		const parts = selector.trim().split(/\s+/);
		const last = parts[parts.length - 1] ?? "";
		const matchOne = (el: FakeElement, sel: string): boolean => {
			const segs = sel.split(".");
			const tag = segs[0];
			if (tag && el.tagName !== tag.toUpperCase()) return false;
			for (let i = 1; i < segs.length; i++) {
				if (!el._classList.set.has(segs[i] ?? "")) return false;
			}
			return true;
		};
		if (!matchOne(this, last)) return false;
		if (parts.length === 2) {
			let p: FakeElement | null = this.parentNode;
			while (p) {
				if (matchOne(p, parts[0] ?? "")) return true;
				p = p.parentNode;
			}
			return false;
		}
		return true;
	}

	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		const out: FakeElement[] = [];
		const walk = (el: FakeElement): void => {
			for (const child of el.children) {
				if (child instanceof FakeElement) {
					if (child.matches(selector)) out.push(child);
					walk(child);
				}
			}
		};
		walk(this);
		return out;
	}

	addEventListener(type: string, fn: () => void): void {
		let list = this.listeners[type];
		if (!list) {
			list = [];
			this.listeners[type] = list;
		}
		list.push(fn);
	}
}

class FakeHTMLElement extends FakeElement {}
class FakeHTMLPreElement extends FakeHTMLElement {}
class FakeHTMLButtonElement extends FakeHTMLElement {}

class FakeDocument {
	documentElement: FakeHTMLElement;
	body: FakeHTMLElement;
	listeners: Record<string, Array<(event: { type: string }) => void>>;
	readyState: string;

	constructor(readyState: string) {
		this.documentElement = new FakeHTMLElement("html");
		this.body = new FakeHTMLElement("body");
		this.listeners = {};
		this.readyState = readyState;
		this.documentElement.appendChild(this.body);
	}

	createElement(tag: string): FakeElement {
		if (tag === "pre") return new FakeHTMLPreElement(tag);
		if (tag === "button") return new FakeHTMLButtonElement(tag);
		return new FakeHTMLElement(tag);
	}

	querySelector(selector: string): FakeElement | null {
		return this.documentElement.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		return this.documentElement.querySelectorAll(selector);
	}

	addEventListener(type: string, fn: (event: { type: string }) => void): void {
		let list = this.listeners[type];
		if (!list) {
			list = [];
			this.listeners[type] = list;
		}
		list.push(fn);
	}

	dispatchEvent(event: { type: string }): boolean {
		for (const fn of this.listeners[event.type] ?? []) fn(event);
		return true;
	}
}

/** 立即触发的 IntersectionObserver 桩：元素一被观察即视为进入视口 */
class ImmediateObserver {
	static lastInstance: ImmediateObserver | null = null;
	observed: Set<FakeElement>;
	fire: (target: FakeElement) => void;

	constructor(
		callback: (entries: Array<{ target: FakeElement; isIntersecting: boolean }>) => void,
	) {
		this.observed = new Set();
		ImmediateObserver.lastInstance = this;
		this.fire = (target: FakeElement) => {
			callback([{ target, isIntersecting: true }]);
		};
	}

	observe(target: FakeElement): void {
		this.observed.add(target);
		this.fire(target);
	}

	unobserve(target: FakeElement): void {
		this.observed.delete(target);
	}
}

interface ScriptEnv {
	window: { matchMedia: () => { matches: boolean } };
	document: FakeDocument;
	CustomEvent: new (type: string) => { type: string };
	IntersectionObserver: typeof ImmediateObserver;
	HTMLPreElement: typeof FakeHTMLPreElement;
	HTMLElement: typeof FakeHTMLElement;
	HTMLButtonElement: typeof FakeHTMLButtonElement;
}

function loadScript(source: string, env: ScriptEnv): void {
	const keys = Object.keys(env) as Array<keyof ScriptEnv>;
	const fn = new Function(...keys, source);
	fn(...Object.values(env));
}

/** 构建文章 DOM：.article-prose 下有 p / pre>code / p 三个直接子元素 */
function buildArticleDom(doc: FakeDocument): { prose: FakeHTMLElement; pre: FakeHTMLPreElement } {
	const prose = new FakeHTMLElement("div");
	prose.classList.add("prose", "article-prose");

	const p1 = new FakeHTMLElement("p");
	p1.textContent = "第一段";

	const pre = new FakeHTMLPreElement("pre");
	const code = new FakeHTMLElement("code");
	code.classList.add("language-markdown");
	code.textContent = "if (a == 1) {}";
	pre.appendChild(code);

	const p2 = new FakeHTMLElement("p");
	p2.textContent = "第二段";

	prose.append(p1, pre, p2);
	doc.body.appendChild(prose);
	return { prose, pre };
}

async function runTimingScenario(readyState: "loading" | "complete") {
	const [enhanceSource, revealSource] = await Promise.all([
		readFile("public/code-block-enhance.js", "utf8"),
		readFile("public/article-reveal.js", "utf8"),
	]);

	const doc = new FakeDocument(readyState);
	const { prose, pre } = buildArticleDom(doc);

	const env: ScriptEnv = {
		window: { matchMedia: () => ({ matches: false }) },
		document: doc,
		CustomEvent: class {
			type: string;
			constructor(type: string) {
				this.type = type;
			}
		},
		IntersectionObserver: ImmediateObserver,
		HTMLPreElement: FakeHTMLPreElement,
		HTMLElement: FakeHTMLElement,
		HTMLButtonElement: FakeHTMLButtonElement,
	};

	// 按 Post.astro 的加载顺序执行：enhance 在前，reveal 在后
	loadScript(enhanceSource, env);
	loadScript(revealSource, env);

	if (readyState === "loading") {
		// 硬刷新：DOMContentLoaded 之后 enhance 才开始包装
		doc.readyState = "complete";
		doc.dispatchEvent({ type: "DOMContentLoaded" });
	}

	return { prose, pre };
}

describe("代码块包装与 reveal 动画的时序竞态", () => {
	test("硬刷新时序（reveal 先标记 pre，enhance 后包装 figure）", async () => {
		const { prose, pre } = await runTimingScenario("loading");

		const figures = prose.querySelectorAll("figure.prose-code-block");
		assert.equal(figures.length, 1, "<pre> 应被包装为 figure.prose-code-block");
		const figure = figures[0];
		assert.ok(figure, "figure 应存在");

		assert.ok(
			!pre.hasAttribute("data-reveal") && !pre.classList.contains("is-revealed"),
			"包装后 pre 上的失效 reveal 标记应被清理",
		);
		assert.ok(
			figure.hasAttribute("data-reveal"),
			"figure（正文直接子元素）必须被 reveal 重新标记，否则会永久 opacity:0",
		);
		assert.ok(figure.classList.contains("is-revealed"), "figure 进入视口后必须被揭示（不透明）");
		assert.ok(prose.classList.contains("js-reveal"), "隐藏态应正常激活");
		const unmarked = [...prose.children].filter(
			(child) => child instanceof FakeElement && !child.hasAttribute("data-reveal"),
		);
		assert.equal(unmarked.length, 0, "所有正文直接子元素都应被标记");
	});

	test("客户端导航时序（enhance 先包装，reveal 后标记 figure）", async () => {
		const { prose } = await runTimingScenario("complete");

		const figures = prose.querySelectorAll("figure.prose-code-block");
		assert.equal(figures.length, 1);
		const figure = figures[0];
		assert.ok(figure, "figure 应存在");
		assert.ok(figure.hasAttribute("data-reveal"));
		assert.ok(figure.classList.contains("is-revealed"));
		const unmarked = [...prose.children].filter(
			(child) => child instanceof FakeElement && !child.hasAttribute("data-reveal"),
		);
		assert.equal(unmarked.length, 0);
	});
});
