export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
}

/**
 * 站点静态信息。
 *
 * 互动只走 Webmention（`WebmentionPanel.astro` + webmention.io 收、
 * `scripts/send-webmentions.mjs` 发）。本站不内置评论区，因此也没有
 * "评论服务地址 / 语言 / 提供商"这类开关。
 */
export const siteConfig: SiteConfig = {
	name: "Kiwi 的博客",
	url: "https://ffaff.fun",
	description: "记录 生活",
	author: "KIWI",
	language: "zh-CN",
};

export interface PaginationParams {
	page: number;
	limit: number;
}

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export type PostStatus = "draft" | "published" | "scheduled";
