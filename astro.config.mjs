// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "server",
	compressHTML: true,
	// prefetchAll 会在链接进入视口的 300ms 后预取**每一个**站内链接：
	// /blog 一屏 10 张卡片、每张最多 4 个链接，等于每次浏览归档页都预取
	// 10 个完整 SSR 文档（每个都查一次 D1）。hover 策略只预取用户真正
	// 指向的链接，配合 max-age=300 的缓存已足够消除点击延迟。
	prefetch: {
		defaultStrategy: "hover",
	},
	adapter: cloudflare({}),
	site: "https://ffaff.fun",
	vite: {
		resolve: {
			alias: {
				"@": "/src",
			},
		},
		build: {
			// 低于此大小的资源内联为 base64，减少额外 HTTP 请求
			assetsInlineLimit: 4096,
			// 启用 CSS 代码分割 (Astro 默认已开启，显式声明确保)
			cssCodeSplit: true,
			minify: "esbuild",
			// 说明：这里曾有一段 manualChunks，把 katex / marked / drizzle / hono
			// 拆成独立 chunk。该配置对 Cloudflare Workers 的 SSR 产物无效——Worker
			// 是一个整体 bundle，拆 chunk 既不减少上传体积也不减少解析量，只会让
			// astro.config 看起来在做优化。故移除。
		},
	},
});
