/**
 * Webmention 相关外部地址的唯一来源。
 *
 * 这些地址都由 `siteConfig.url` 的主机名推导：webmention.io 用**域名**作为账号名，
 * 站点在它的 Sites 页登记的正是这个域名。
 *
 * 为什么收敛到一个模块：`ffaff.fun` 此前在 `BaseHead.astro`（`rel="webmention"`）、
 * `WebmentionPanel.astro` 的表单 `action` 和 `extractContext()` 的主机判断里
 * 各硬编码了一次。换域名时必然漏改一处，而症状只是「面板永远空着」或
 * 「提交后回到 404」，从现象几乎不可能反推到硬编码。
 */
import { siteConfig } from "./types";

const siteHost = new URL(siteConfig.url).hostname;

/** webmention.io 的账号名，等于站点域名。 */
export const WEBMENTION_SITE = siteHost;

/** `rel="webmention"` 的收件端点，同时也是「发送 Webmention」表单的 action。 */
export const WEBMENTION_ENDPOINT = `https://webmention.io/${WEBMENTION_SITE}/webmention`;

/** `rel="pingback"` 的 XML-RPC 端点。 */
export const WEBMENTION_PINGBACK = `https://webmention.io/${WEBMENTION_SITE}/xmlrpc`;

/** 读取某个页面 mention 列表的 JF2 接口。 */
export const WEBMENTION_API = "https://webmention.io/api/mentions.jf2";

/** 单次查询最多取多少条（接口上限 1000，默认 20）。 */
const MENTIONS_PER_PAGE = 100;

/**
 * 拼出查询某个页面 mention 列表的完整 URL。
 *
 * 两个必须遵守的细节，都来自 webmention.io 的 API 文档与实测：
 *
 * 1. **多个 target 只能用 `target[]=` 重复**。文档示例是
 *    `?target[]=A&target[]=B`；写成 `?target=A&target=B` 时 PHP 解析只保留
 *    最后一个值（实测：`target=indieweb&target=bogus` 返回 total=0）。旧的
 *    实现正是后者，于是「补一个尾斜杠变体」会把规范 URL 顶掉，反而永远查不到。
 * 2. **尾斜杠不是等价形式**。文档明确说 http/https 与尾斜杠都"由站点自己决定
 *    （靠重定向）"，webmention.io 只把真正跳转过的地址记成别名。本站不做
 *    跳转，所以要主动把两种写法都查一遍。
 */
export function buildMentionsUrl(targetUrl: string, perPage: number = MENTIONS_PER_PAGE): string {
	const targets = [targetUrl];
	if (!targetUrl.endsWith("/")) {
		targets.push(`${targetUrl}/`);
	}

	const query = targets.map((target) => `target[]=${encodeURIComponent(target)}`).join("&");
	return `${WEBMENTION_API}?${query}&per-page=${perPage}`;
}
