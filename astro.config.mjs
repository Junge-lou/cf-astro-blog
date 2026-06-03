// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "server",
	compressHTML: true,
	prefetch: {
		prefetchAll: true,
		defaultStrategy: "viewport",
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
			// 小于此大小的模块合并到父 chunk
			minify: "esbuild",
			rollupOptions: {
				output: {
					// 手动分包策略：将大型依赖独立为可缓存 chunk
					manualChunks(id) {
						if (id.includes("node_modules/katex")) {
							return "katex";
						}
						if (id.includes("node_modules/marked")) {
							return "marked";
						}
						if (id.includes("node_modules/drizzle-orm")) {
							return "drizzle";
						}
						if (id.includes("node_modules/hono")) {
							return "hono";
						}
					},
				},
			},
		},
	},
});
