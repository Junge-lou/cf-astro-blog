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
