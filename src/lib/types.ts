export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
	comments: CommentConfig;
}

export interface CommentConfigBase {
	provider: "giscus" | "momo";
	lang: string;
}

export interface GiscusCommentConfig extends CommentConfigBase {
	provider: "giscus";
	repo: string;
	repoId: string;
	category: string;
	categoryId: string;
	mapping: "pathname" | "url" | "title" | "og:title";
	strict: boolean;
	reactionsEnabled: boolean;
	inputPosition: "top" | "bottom";
}

export interface MomoCommentConfig extends CommentConfigBase {
	provider: "momo";
	apiUrl: string;
}

export type CommentConfig = GiscusCommentConfig | MomoCommentConfig;

export const siteConfig: SiteConfig = {
	name: "Kiwi 的博客",
	url: "https://ffaff.fun",
	description: "记录 生活",
	author: "KIWI",
	language: "zh-CN",
	comments: {
		provider: "momo",
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
