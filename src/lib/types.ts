export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
}

export const siteConfig: SiteConfig = {
	name: "Eric 的技术博客",
	url: "https://cf-astro-blog-starter.h1n054ur.dev",
	description: "记录 Cloudflare、前端工程、系统设计与长期有效的技术经验。",
	author: "Eric",
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
