export interface CommentConfig {
	lang: string;
	apiUrl: string;
}

export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
	comments: CommentConfig;
}

export const siteConfig: SiteConfig = {
	name: "Kiwi 的博客",
	url: "https://ffaff.fun",
	description: "记录 生活",
	author: "KIWI",
	language: "zh-CN",
	comments: {
		lang: "zh-CN",
		apiUrl: "https://comments.ffaff.fun",
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
