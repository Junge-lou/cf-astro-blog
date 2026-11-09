import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { siteConfig } from "../../src/lib/types";
import {
	buildMentionsUrl,
	WEBMENTION_API,
	WEBMENTION_ENDPOINT,
	WEBMENTION_PINGBACK,
	WEBMENTION_SITE,
} from "../../src/lib/webmention";

/**
 * Webmention 端点的回归保护。
 *
 * 这里锁的两件事都曾经出过错，而且都是**静默**的：
 *
 * 1. 多个 target 必须写成 `target[]=A&target[]=B`。写成 `target=A&target=B`
 *    时 PHP 只保留最后一个值（实测 `target=https://indieweb.org/&target=
 *    https://bogus.invalid/x` 返回 total=0），于是「再查一次尾斜杠变体」
 *    会把规范 URL 顶掉，面板永远显示 0 条。
 * 2. 端点由 `siteConfig.url` 的主机名推导。写死域名时，换域名只会表现为
 *    「面板空着」或「提交后 404」，无法从现象反推。
 */
describe("buildMentionsUrl", () => {
	const target = "https://ffaff.fun/blog/astro-islands-vs-ssr";

	test("多个 target 用 target[] 重复，不用裸 target", () => {
		const url = buildMentionsUrl(target);
		const params = new URL(url).searchParams;

		assert.deepEqual(params.getAll("target[]"), [target, `${target}/`]);
		assert.deepEqual(params.getAll("target"), [], "裸 target 会被 PHP 折叠成最后一个值");
	});

	test("裸 target 不出现在查询串里", () => {
		const query = new URL(buildMentionsUrl(target)).search.slice(1);

		assert.match(query, /target\[\]=/u);
		assert.doesNotMatch(query, /(^|&)target=/u);
	});

	test("已带尾斜杠时只查一个目标，不重复拼接", () => {
		const withSlash = `${target}/`;
		const params = new URL(buildMentionsUrl(withSlash)).searchParams;

		assert.deepEqual(params.getAll("target[]"), [withSlash]);
	});

	test("分页参数有默认值，且可覆盖", () => {
		assert.equal(new URL(buildMentionsUrl(target)).searchParams.get("per-page"), "100");
		assert.equal(new URL(buildMentionsUrl(target, 20)).searchParams.get("per-page"), "20");
	});

	test("目标 URL 会被正确编码", () => {
		const tricky = "https://ffaff.fun/blog/中文 标题?x=1&y=2";
		const params = new URL(buildMentionsUrl(tricky)).searchParams;

		assert.deepEqual(params.getAll("target[]"), [tricky, `${tricky}/`]);
	});

	test("接口基址就是官方 JF2 端点", () => {
		assert.equal(WEBMENTION_API, "https://webmention.io/api/mentions.jf2");
		assert.ok(buildMentionsUrl(target).startsWith(`${WEBMENTION_API}?`));
	});
});

describe("webmention.io 账号与端点", () => {
	const host = new URL(siteConfig.url).hostname;

	test("账号名等于站点域名，不写死", () => {
		assert.equal(WEBMENTION_SITE, host);
	});

	test("收件端点与 pingback 端点由账号名拼出", () => {
		assert.equal(WEBMENTION_ENDPOINT, `https://webmention.io/${host}/webmention`);
		assert.equal(WEBMENTION_PINGBACK, `https://webmention.io/${host}/xmlrpc`);
	});
});
