---
title: 「cf-astro-blog v0.1.0」发布说明
slug: cf-astro-blog-v0-1-0-release
status: published
publishedAt: '2026-06-03'
excerpt: 基于 Astro 6 + Hono + Cloudflare Workers 的全栈博客站点正式发布，内置管理后台、Markdown 写作流、友链审核、Webmention、AI 端点与 MCP 服务。
authorName: Admin
category: 项目
tags: [Astro, Cloudflare, 开源, 博客, 全栈]
metaTitle: cf-astro-blog v0.1.0 发布说明
metaDescription: 基于 Astro 6 + Hono + Cloudflare Workers 的全栈博客站点正式发布，内置管理后台、Markdown 写作流、友链审核、Webmention、AI 端点与 MCP 服务，附完整部署指南。
metaKeywords: Astro, Cloudflare Workers, D1, R2, Hono, 博客, 开源, SSR, MCP, Webmention
---

`cf-astro-blog` 是一个部署在 Cloudflare Workers 上的 **SSR 博客系统**，具备完整的后台管理能力。你可以通过 Markdown 文件编写文章，通过管理后台进行内容管理、媒体上传、友链审核与站点外观定制，无需搭建独立服务器。

**核心设计理念**：写作优先、界面克制、运维自动化。

---

## 功能清单

### 📝 内容写作

- **Markdown 写作**：文章存储在 `content/posts/`，支持 YAML frontmatter（分类、标签、SEO、封面图、置顶、背景覆盖等）
- **本地同步脚本**：`npm run sync:posts` 将 Markdown 同步到远程 D1 数据库
- **内置管理后台**：`/admin` 路径提供文章 CRUD、富文本编辑、状态管理（草稿/已发布/定时发布）
- **KaTeX 数学公式**：行内与块级公式渲染
- **代码块增强**：语法高亮、行号、复制按钮
- **Mermaid 图表**：支持

### 🎨 站点外观

- **全局背景**：支持上传背景图，可调不透明度、模糊、缩放与焦点
- **Hero 区域**：自定义标题、副标题、引导按钮、信号卡片
- **导航栏**：支持静态链接或动态链接配置
- **卡片表面**：Hero 卡片、文章卡片、侧边栏面板的独立透明度与模糊控制
- **文章级背景覆盖**：单篇文章可独立设置背景模式
- **明暗主题**：自动跟随系统偏好，支持手动切换

### 🔗 友链与社交

- **友链申请页**：`/friends` 提供公开申请表单（Turnstile 人机验证）
- **后台审核**：通过/拒绝，支持审核备注
- **头像代理**：安全代理外部头像，防止隐私泄露与 SSRF

### 💬 评论与互动

- **Momo 评论系统**：轻量级评论组件
- **Webmention**：支持接收与审核外部提及
- **Webmention 代理**：后端代理发送 Webmention 通知

### 📊 数据与分析

- **访问统计**：文章阅读量、页面 PV/UV（基于 IP + UA 去重）
- **后台看板**：`/admin/dashboard` 展示关键指标

### 🤖 AI 与 MCP

- **OpenAI 兼容 API**：`/api/public-ai` 提供公开 AI 调用端点（可配速率限制）
- **MCP 服务器**：`/api/mcp` 提供 Model Context Protocol 服务端，支持 Bearer Token 认证与审计日志

### 🔐 安全

- **JWT 鉴权**：基于 `jose` 的密钥校验，启动时强制检测弱密钥
- **PBKDF2 密码哈希**：通过 `npm run hash:password` 生成
- **Turnstile 人机验证**：登录页与友链申请页可选启用
- **速率限制**：登录限流、AI 端点限流、MCP 限流
- **CSRF 防护**：管理后台 API 全部校验 Origin / Referer
- **安全头**：CSP、X-Content-Type-Options 等
- **Markdown 安全渲染**：使用 `sanitize-html` 过滤 XSS

### 🔍 搜索

- **Pagefind 静态搜索**：构建时生成索引，支持中文分词

### 📡 SEO 与 Feed

- **Sitemap**：`/sitemap.xml` 自动生成
- **RSS**：`/rss.xml` 提供全文订阅
- **Meta 标签**：每篇文章支持自定义 title / description / keywords
- **Canonical URL**：支持跨站转载规范链接

### 🛠️ 运维工具

- **自动部署 Webhook**：支持 GitHub / 外部触发自动部署
- **构建分析**：`npm run build:analyze` 输出各模块体积
- **数据库迁移**：Drizzle Kit 管理 D1 schema 版本
- **种子数据**：`npm run db:seed:remote` 初始化基础数据

---

## 技术栈

| 层次 | 技术 |
|------|------|
| **框架** | Astro 6（SSR mode） |
| **API 层** | Hono（集成于 Astro 中间件） |
| **数据库** | Cloudflare D1（SQLite）+ Drizzle ORM |
| **文件存储** | Cloudflare R2 |
| **会话/KV** | Cloudflare Workers KV |
| **部署** | Cloudflare Workers + Pages |
| **样式** | 原生 CSS（无框架依赖） |
| **字体** | Lora、Cormorant Garamond、思源宋体、Space Grotesk、霞鹜文楷 |
| **数学** | KaTeX |
| **搜索** | Pagefind |
| **检查** | Biome（lint + format） |
| **类型** | TypeScript + @astrojs/check |

---

## 快速部署

### 环境要求

| 依赖 | 版本要求 |
|------|----------|
| **Node.js** | ≥ 18 |
| **npm** | ≥ 9 |
| **Cloudflare 账号** | 需开通 Workers Paid 计划（D1 / R2 / KV 均需） |

### 安装

```bash
git clone https://github.com/Junge-lou/cf-astro-blog my-blog
cd my-blog
npm install
```

### 创建 Cloudflare 资源

项目依赖 3 个 Cloudflare 资源绑定：

1. **创建 D1 数据库**：`npx wrangler d1 create blog`
2. **创建 R2 存储桶**：`npx wrangler r2 bucket create blog-media`
3. **创建 KV 命名空间**：`npx wrangler kv namespace create SESSION`

将输出的 ID 填入 `wrangler.jsonc` 对应位置。

### 配置环境变量

核心必需的 Secrets：

- `JWT_SECRET`：JWT 签名密钥（`openssl rand -hex 32`）
- `ADMIN_USERNAME`：后台登录用户名
- `ADMIN_PASSWORD_HASH`：密码哈希（`npm run hash:password -- 你的密码`）

可选功能：GitHub OAuth 登录、Turnstile 人机验证、AI 端点、MCP 服务、自动部署 Webhook。

### 初始化与部署

```bash
npm run db:migrate:remote   # 创建数据库表
npm run db:seed:remote       # 可选：初始化种子数据
npm run deploy               # 构建并部署
```

---

## 项目结构速览

```
cf-astro-blog/
├── content/posts/        # Markdown 文章（写作入口）
├── src/
│   ├── pages/            # 前端页面（Astro）
│   ├── admin/            # Hono 管理后台
│   ├── components/       # Astro 组件
│   ├── db/schema.ts      # Drizzle 数据库 Schema
│   ├── lib/              # 工具库
│   ├── layouts/          # 页面布局
│   └── styles/           # 全局样式
├── public/               # 静态资源 & 客户端 JS
├── drizzle/              # 数据库迁移文件
├── scripts/              # 运维脚本
├── wrangler.jsonc        # Cloudflare 部署配置
└── astro.config.mjs      # Astro 配置
```

---

## 注意事项

1. **D1 数据不会因部署被清空**，仅 migration 会修改表结构。
2. **机密变量请用 Dashboard Secrets 配置**，不要写入 `wrangler.jsonc` 并提交。
3. **资源绑定名称不可修改**，否则运行时会因绑定名不匹配而报错。
4. **Turnstile 为可选功能**，不配置时登录无验证码。
5. **首次部署前**务必执行 `npm run db:migrate:remote`。
6. **文章不会自动同步**，需通过 `npm run sync:posts` 或管理后台操作。
7. **Momo 评论系统是独立服务**，需单独部署。
8. **GitHub Actions 自动部署**需要在仓库 Secrets 中配置 `CLOUDFLARE_API_TOKEN`。

---

## 常见问题

### Q: 登录后台提示"密钥强度不足"

检查 `JWT_SECRET` 是否已配置且长度 ≥ 32 字符。使用 `openssl rand -hex 32` 生成。

### Q: GitHub OAuth 登录回调报错

确认 GitHub OAuth App 的 Authorization callback URL 与站点实际回调地址一致（`https://你的域名/api/auth/github/callback`）。

### Q: 媒体上传失败 / 图片不显示

1. 确认 R2 存储桶已创建且 `wrangler.jsonc` 配置正确
2. 确认 `MEDIA_BUCKET` 绑定名未改动

### Q: 搜索结果不显示最新文章

搜索索引在部署时构建。确保部署命令包含 `npm run search:index:remote`。

### Q: GitHub Actions 部署报"缺少可用凭据"

检查 GitHub 仓库 Secrets 中是否已添加 `CLOUDFLARE_API_TOKEN`。

### Q: 如何更换字体

字体通过 `@fontsource` 包引入。在 `package.json` 中增删依赖，修改 Astro 组件中对应的 CSS import 即可。

---

## 参与贡献

- 问题反馈：提交 [GitHub Issue](https://github.com/Junge-lou/cf-astro-blog/issues)
- 功能建议：提交 GitHub Discussion

---

*版本 0.1.0 — 2026-06-03*
