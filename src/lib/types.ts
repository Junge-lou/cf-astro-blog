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
		// 使用同源代理避免跨域 CORS 问题：
		// momo 评论组件以 apiUrl 为基准发起 fetch(`${apiUrl}/api/comments?…`)，
		// Astro catch‑all 路由 /api/[...route] 将其转发至 Hono 应用，
		// 后者再反向代理到 comments.ffaff.fun 实际 API 服务器。
		apiUrl: "https://ffaff.fun",
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
