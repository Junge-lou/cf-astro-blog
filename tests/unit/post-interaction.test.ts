import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
	buildInteractionMarkup,
	normalizeInteraction,
	normalizeInteractionTarget,
	normalizeRsvp,
	rsvpLabel,
} from "../../src/lib/post-interaction";

/**
 * Webmention 互动类型的回归保护。
 *
 * 这里锁的是**官方类名**。写错的症状极其隐蔽：页面照常渲染，
 * 接收方也照常收到 Webmention，只是把它显示成普通「提及」而不是
 * 「喜欢 / 回复」，从现象几乎无法反推是哪个 class 写错了。
 *
 * 规范来源：
 * - h-entry：https://microformats.org/wiki/h-entry
 *   `u-in-reply-to` / `u-like-of` / `u-repost-of` / `p-rsvp`
 * - `p-rsvp` 必须挂在 `<data value>`（或 value-class-pattern）上
 * - `u-bookmark-of` 在 h-entry 里仍属 Proposed Additions，但 webmention.io 已接收
 */
describe("normalizeInteraction", () => {
	test("接受五种合法类型，大小写不敏感", () => {
		for (const value of ["like", "repost", "bookmark", "reply", "rsvp"]) {
			assert.equal(normalizeInteraction(value), value);
			assert.equal(normalizeInteraction(value.toUpperCase()), value);
			assert.equal(normalizeInteraction(` ${value} `), value);
		}
	});

	test("非法或空值一律当作未声明", () => {
		for (const value of ["", "   ", "favorite", "likes", "123", null, undefined, 42]) {
			assert.equal(normalizeInteraction(value), null);
		}
	});
});

describe("normalizeRsvp", () => {
	test("只接受四个规范取值", () => {
		for (const value of ["yes", "no", "maybe", "interested"]) {
			assert.equal(normalizeRsvp(value), value);
			assert.equal(normalizeRsvp(value.toUpperCase()), value);
		}
	});

	test("其它值不合法", () => {
		for (const value of ["", "y", "attend", "true", null, undefined]) {
			assert.equal(normalizeRsvp(value), null);
		}
	});
});

describe("normalizeInteractionTarget", () => {
	test("保留 http/https 绝对地址", () => {
		assert.equal(
			normalizeInteractionTarget("https://example.com/post"),
			"https://example.com/post",
		);
		assert.equal(
			normalizeInteractionTarget("http://example.com/post/"),
			"http://example.com/post/",
		);
	});

	test("相对地址与危险协议被拒绝", () => {
		for (const value of [
			"/blog/x",
			"example.com/x",
			"javascript:alert(1)",
			"mailto:a@b.c",
			"",
			null,
		]) {
			assert.equal(normalizeInteractionTarget(value), null);
		}
	});
});

describe("buildInteractionMarkup", () => {
	const target = "https://example.com/post";

	test("每种类型映射到规范里的类名", () => {
		const expected: Record<string, string> = {
			like: "u-like-of",
			repost: "u-repost-of",
			bookmark: "u-bookmark-of",
			reply: "u-in-reply-to",
			rsvp: "u-in-reply-to",
		};

		for (const [interaction, propertyClass] of Object.entries(expected)) {
			const markup = buildInteractionMarkup({
				interaction,
				interactionTarget: target,
				interactionRsvp: interaction === "rsvp" ? "yes" : undefined,
			});
			assert.ok(markup, `${interaction} 应该能生成标记`);
			assert.equal(markup.propertyClass, propertyClass);
			assert.equal(markup.href, target);
		}
	});

	test("只有 rsvp 带 p-rsvp 取值，其它类型忽略该字段", () => {
		const like = buildInteractionMarkup({
			interaction: "like",
			interactionTarget: target,
			interactionRsvp: "yes",
		});
		assert.equal(like?.rsvp, null);

		const rsvp = buildInteractionMarkup({
			interaction: "rsvp",
			interactionTarget: target,
			interactionRsvp: "maybe",
		});
		assert.equal(rsvp?.rsvp, "maybe");
	});

	test("半截声明一律返回 null，宁可当没声明", () => {
		// 有类型没目标
		assert.equal(buildInteractionMarkup({ interaction: "like", interactionTarget: "" }), null);
		// 目标非法
		assert.equal(
			buildInteractionMarkup({ interaction: "like", interactionTarget: "/relative" }),
			null,
		);
		// rsvp 缺取值
		assert.equal(buildInteractionMarkup({ interaction: "rsvp", interactionTarget: target }), null);
		// 类型非法
		assert.equal(
			buildInteractionMarkup({ interaction: "favorite", interactionTarget: target }),
			null,
		);
	});

	test("RSVP 中文文案覆盖四个取值", () => {
		assert.equal(rsvpLabel("yes"), "参加");
		assert.equal(rsvpLabel("no"), "不参加");
		assert.equal(rsvpLabel("maybe"), "可能参加");
		assert.equal(rsvpLabel("interested"), "感兴趣");
	});
});

describe("文章模板输出的是规范要求的元素", () => {
	test("p-rsvp 挂在 <data> 上，而不是 <span>", async () => {
		// h-entry 规范：p-rsvp 用 <data value> 或 value-class-pattern；
		// 挂到 <span> 上没有 value 属性，解析器读不到取值。
		const source = await readFile(new URL("../../src/layouts/Post.astro", import.meta.url), "utf8");
		assert.match(source, /<data[^>]*class="p-rsvp/u);
		assert.match(source, /value=\{interactionMarkup\.rsvp\}/u);
	});

	test("互动标记位于 h-entry 内、通过 propertyClass 输出类名", async () => {
		const source = await readFile(new URL("../../src/layouts/Post.astro", import.meta.url), "utf8");
		assert.match(source, /class:list=\{\[interactionMarkup\.propertyClass/u);
		// h-entry 根节点仍然存在（这是 mf2 解析的入口）
		assert.match(source, /"h-entry"/u);
	});
});
