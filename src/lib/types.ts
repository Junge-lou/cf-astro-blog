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
	scriptUrl: string;
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
		repo: "Junge-lou/cf-astro-blog",
		repoId: "R_kgDOSQlLhw",
		category: "Announcements",
		categoryId: "DIC_kwDOSQlLh84C8CRN",
		mapping: "pathname",
		strict: false,
		reactionsEnabled: true,
		inputPosition: "top",
		lang: "zh-CN",
		scriptUrl: "https://cdn.jsdelivr.net/npm/@motues/momo-comment@1.2.1/dist/momo-comment.min.js",
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
