export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
	comments: CommentConfig;
}

export interface CommentConfig {
	provider: "giscus";
	repo: string;
	repoId: string;
	category: string;
	categoryId: string;
	mapping: "pathname" | "url" | "title" | "og:title";
	strict: boolean;
	reactionsEnabled: boolean;
	inputPosition: "top" | "bottom";
	lang: string;
}

export const siteConfig: SiteConfig = {
	name: "Kiwi 的博客",
	url: "https://astro-blog.momo-chatme.workers.dev",
	description: "记录 生活",
	author: "KIWI",
	language: "zh-CN",
	comments: {
		provider: "giscus",
		repo: "Junge-lou/cf-astro-blog",
		repoId: "R_kgDOSQlLhw",
		category: "Announcements",
		categoryId: "DIC_kwDOSQlLh84C8CRN",
		mapping: "pathname",
		strict: false,
		reactionsEnabled: true,
		inputPosition: "top",
		lang: "zh-CN",
	},
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
