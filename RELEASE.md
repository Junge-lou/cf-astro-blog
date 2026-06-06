# cf-astro-blog v0.1.0 发布说明

> 基于 Astro 6 + Hono + Cloudflare Workers 的全栈博客站点，内置管理后台、Markdown 写作流、友链审核、Webmention、AI 端点与 MCP 服务。

---

## 1. 项目简介

`cf-astro-blog` 是一个部署在 Cloudflare Workers 上的 **SSR 博客系统**，具备完整的后台管理能力。你可以通过 Markdown 文件编写文章，通过管理后台进行内容管理、媒体上传、友链审核与站点外观定制，无需搭建独立服务器。

**核心设计理念**：写作优先、界面克制、运维自动化。

---

## 2. 功能清单

### 📝 内容写作

- **Markdown 写作**：文章存储在 `content/posts/`，支持 YAML frontmatter（分类、标签、SEO、封面图、置顶、背景覆盖等）
- **本地同步脚本**：`npm run sync:posts` 将 Markdown 同步到远程 D1 数据库
- **内置管理后台**：`/admin` 路径提供文章 CRUD、富文本编辑、状态管理（草稿/已发布/定时发布）
- **KaTeX 数学公式**：行内与块级公式渲染
- **代码块增强**：语法高亮、行号、复制按钮
- **Mermaid 图表**：通过 `diagram-render.js` 支持

### 🎨 站点外观

- **全局背景**：支持上传背景图，可调不透明度、模糊、缩放与焦点
- **Hero 区域**：自定义标题、副标题、引导按钮、信号卡片
- **导航栏**：支持静态链接或动态链接配置
- **卡片表面**：Hero 卡片、文章卡片、侧边栏面板的独立透明度与模糊控制
- **文章级背景覆盖**：单篇文章可独立设置背景模式（跟随全局 / 使用封面图 / 自定义背景）
- **明暗主题**：自动跟随系统偏好，支持手动切换

### 🔗 友链与社交

- **友链申请页**：`/friends` 提供公开申请表单（Turnstile 人机验证）
- **后台审核**：通过/拒绝，支持审核备注
- **头像代理**：安全代理外部头像，防止隐私泄露与 SSRF
- **友链展示**：审核通过后在前台展示

### 💬 评论与互动

- **Momo 评论系统**：轻量级评论组件
- **Webmention**：支持接收与审核外部提及
- **Webmention 代理**：后端代理发送 Webmention 通知

### 📊 数据与分析

- **访问统计**：文章阅读量、页面 PV/UV（基于 IP + UA 去重）
- **后台看板**：`/admin/dashboard` 展示关键指标
- **公开分析端点**：可选的公开统计数据接口

### 🤖 AI 与 MCP

- **OpenAI 兼容 API**：`/api/public-ai` 提供公开 AI 调用端点（可配速率限制）
- **内部 AI 端点**：管理后台集成的 AI 能力
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
- **搜索页面**：`/search` 提供全站搜索

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
- **健康检查**：Worker 内置健康检查端点

---

## 3. 技术栈

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
| **类型** | TypeScript + `@astrojs/check` |

---

## 4. 环境要求

| 依赖 | 版本要求 |
|------|----------|
| **Node.js** | ≥ 18 |
| **npm** | ≥ 9 |
| **Cloudflare 账号** | 需开通 Workers Paid 计划（D1 / R2 / KV 均需） |
| **Wrangler CLI** | 建议最新版（`npx wrangler --version`） |

---

## 5. 快速部署

> **在开始之前**：请确保你已拥有 [Cloudflare 账号](https://dash.cloudflare.com/) 并开通 Workers Paid 计划（D1 / R2 / KV 均需付费计划）。

---

### 5.1 克隆与安装

```bash
git clone https://github.com/Junge-lou/cf-astro-blog my-blog
cd my-blog
npm install
```

---

### 5.2 创建 Cloudflare 基础资源

项目依赖 3 个 Cloudflare 资源绑定，需先在账号下创建，再将 ID 填入 `wrangler.jsonc`。

#### 5.2.1 创建 D1 数据库

```bash
npx wrangler d1 create blog
```

输出示例：

```
✅ Successfully created DB 'blog' in region APAC
database_id = 94446958-b781-48c0-913f-4003e54c3f99
```

将输出的 `database_id` 填入 `wrangler.jsonc` → `d1_databases[0].database_id`。

#### 5.2.2 创建 R2 存储桶

```bash
npx wrangler r2 bucket create blog-media
```

将 `wrangler.jsonc` → `r2_buckets[0].bucket_name` 设为 `"blog-media"`（与你创建的桶名一致）。

#### 5.2.3 创建 KV 命名空间

```bash
npx wrangler kv namespace create SESSION
```

输出示例：

```
✅ Successfully created namespace 'SESSION'
id = 6e47bbd68a64499c8f26106a30e8a55b
```

将输出的 `id` 填入 `wrangler.jsonc` → `kv_namespaces[0].id`。

#### 5.2.4 资源绑定摘要

修改后 `wrangler.jsonc` 中应包含：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "blog",
      "database_id": "<你的 D1 database_id>",
      "migrations_dir": "drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "blog-media"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "SESSION",
      "id": "<你的 KV namespace id>"
    }
  ]
}
```

> **注意**：`binding` 名称 `DB`、`MEDIA_BUCKET`、`SESSION`、`ASSETS` 为项目硬编码，不可修改。

---

### 5.3 完整配置清单

项目运行时需要读取大量环境变量。以下按配置方式分类列出 **所有变量**。

#### 5.3.1 配置方式说明

| 配置途径 | 适用场景 | 安全性 |
|----------|----------|--------|
| `wrangler.jsonc` → `vars` | 非敏感变量，可随代码提交 | 明文 |
| Cloudflare Dashboard → **Secrets** | 密钥、Token、密码哈希 | 加密存储 |
| `wrangler secret put` 命令 | 同上，命令行操作 | 加密存储 |
| 本地 `.dev.vars` 文件 | 仅本地开发，**已加入 .gitignore** | 明文（不提交） |

#### 5.3.2 全部变量一览

##### Cloudflare 资源绑定（在 `wrangler.jsonc` 中配置，非环境变量）

| 绑定名 | 类型 | 说明 | 必需 |
|--------|------|------|:----:|
| `DB` | D1Database | 文章、分类、标签、设置等数据存储 | ✅ |
| `MEDIA_BUCKET` | R2Bucket | 媒体文件（图片、封面图）存储 | ✅ |
| `SESSION` | KVNamespace | 后台会话 Token 存储与登录限流 | ✅ |
| `ASSETS` | Fetcher | Cloudflare Pages 自动注入，无需手动配置 | ✅ |

##### 普通环境变量（配置在 `wrangler.jsonc` → `vars`，可随代码提交）

| 变量名 | 类型 | 说明 | 示例值 | 必需 |
|--------|------|------|--------|:----:|
| `SITE_NAME` | string | 站点名称，显示在页面标题与 Header | `"My Blog"` | ✅ |
| `SITE_URL` | string | 站点完整 URL，用于 RSS / Sitemap / OAuth 回调 | `"https://ffaff.fun"` | ✅ |
| `TURNSTILE_SITE_KEY` | string | Turnstile 人机验证的 Site Key（公开） | `"0x4AAAAAAD..."` | 可选 |

##### 机密变量（通过 Dashboard Secrets 或 `wrangler secret put` 配置）

###### 🔑 后台认证（核心必需）

| 变量名 | 说明 | 生成方式 | 必需 |
|--------|------|----------|:----:|
| `JWT_SECRET` | JWT 签名密钥，长度必须 ≥ 32 字符 | `openssl rand -hex 32` | ✅ |
| `ADMIN_USERNAME` | 后台登录用户名 | 自定义，如 `"admin"` | ✅ |
| `ADMIN_PASSWORD_HASH` | 后台密码的 PBKDF2 哈希值 | `npm run hash:password -- 你的密码` | ✅ |

###### 🐙 GitHub OAuth 登录（可选，配置后可通过 GitHub 账号一键登录）

| 变量名 | 说明 | 生成方式 | 必需 |
|--------|------|----------|:----:|
| `ADMIN_GITHUB_LOGIN` | 允许登录的 GitHub 用户名 | 你的 GitHub 用户名 | 可选 |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App 的 Client ID | 在 GitHub 创建 OAuth App 获取 | 可选 |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App 的 Client Secret | 在 GitHub 创建 OAuth App 获取 | 可选 |
| `GITHUB_OAUTH_REDIRECT_URI` | OAuth 回调地址 | 默认自动构建设为 `https://你的域名/api/auth/github/callback`，通常无需手动配置 | 可选 |

> **GitHub OAuth App 创建步骤**：
>
> 1. 访问 [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
> 2. 点击 **New OAuth App**
> 3. 填写：
>    - **Application name**：任意名称，如 `My Blog Admin`
>    - **Homepage URL**：你的站点 URL，如 `https://ffaff.fun`
>    - **Authorization callback URL**：`https://你的域名/api/auth/github/callback`
> 4. 创建后获取 **Client ID**，再点击 **Generate a new client secret** 获取 **Client Secret**

###### 🛡️ Turnstile 人机验证（可选）

| 变量名 | 说明 | 生成方式 | 必需 |
|--------|------|----------|:----:|
| `TURNSTILE_SECRET_KEY` | Turnstile 的 Secret Key | 在 Cloudflare Dashboard → Turnstile 创建站点获取 | 可选 |

> **Turnstile 创建步骤**：
>
> 1. 访问 [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
> 2. 点击 **Add Site**
> 3. 填写域名，选择 Widget Type（推荐 **Managed**）
> 4. 获取 **Site Key**（填入 `vars.TURNSTILE_SITE_KEY`）和 **Secret Key**（填入 Secrets `TURNSTILE_SECRET_KEY`）

###### 🤖 AI 端点（可选，用于后台 AI 写作辅助与公开 API）

| 变量名 | 说明 | 必需 |
|--------|------|:----:|
| `AI_INTERNAL_API_KEY` | 后台内部 AI 调用的 API Key | 可选 |
| `AI_PUBLIC_API_KEY` | 公开 AI 端点 `/api/public-ai` 的鉴权 Key | 可选 |
| `PUBLIC_AI_RATE_LIMIT_PER_MINUTE` | 公开 AI 每分钟每 IP 限流次数（默认 10） | 可选 |
| `PUBLIC_AI_DAILY_LIMIT_PER_IP` | 公开 AI 每日每 IP 限额（默认 100） | 可选 |

> 公开 AI 端点提供 OpenAI 兼容的 Chat Completions 接口，可用于第三方客户端接入。

###### 🔌 MCP 服务（可选，Model Context Protocol 服务端）

| 变量名 | 说明 | 必需 |
|--------|------|:----:|
| `MCP_BEARER_TOKEN` | MCP 服务的 Bearer Token 鉴权密钥 | 可选 |
| `MCP_RATE_LIMIT_PER_MINUTE` | MCP 每分钟限流次数（默认 30） | 可选 |
| `MCP_AUTH_FAIL_LIMIT_PER_MINUTE` | MCP 认证失败限流阈值（默认 10） | 可选 |
| `MCP_AUTH_BLOCK_SECONDS` | MCP 认证失败封禁时长（秒，默认 300） | 可选 |

> MCP 服务部署在 `/api/mcp`，可通过 VS Code、Claude Desktop 等 MCP 客户端连接。Bearer Token 建议使用 `openssl rand -hex 32` 生成。

###### 🚀 自动部署 Webhook（可选，从管理后台触发 GitHub Actions 部署）

| 变量名 | 说明 | 必需 |
|--------|------|:----:|
| `AUTO_DEPLOY_WEBHOOK_URL` | GitHub Repository Dispatch 的 Webhook URL | 可选 |
| `AUTO_DEPLOY_WEBHOOK_SECRET` | Webhook 请求签名密钥 | 可选 |
| `AUTO_DEPLOY_GITHUB_EVENT_TYPE` | 自定义事件类型（默认 `rebuild-search-index`） | 可选 |

> 配置后可在管理后台一键触发重建与部署，无需推送代码。

---

### 5.4 密钥生成速查

在项目根目录执行以下命令生成所需密钥：

```bash
# ─── JWT 签名密钥（必需） ────────────────────────────────
openssl rand -hex 32

# ─── 后台密码哈希（必需） ────────────────────────────────
npm run hash:password -- 你的密码

# ─── MCP Bearer Token（可选） ─────────────────────────────
openssl rand -hex 32

# ─── Webhook Secret（可选） ──────────────────────────────
openssl rand -hex 32
```

---

### 5.5 配置评论系统（Momo）

项目使用 [Momo](https://github.com/Eric-Terminal/momo-comment) 作为评论系统，需独立部署评论服务。

#### 5.5.1 部署 Momo 评论后端

Momo 是一个轻量级评论系统，后端同样部署在 Cloudflare Workers + D1 上。请参考 [Momo 官方文档](https://github.com/Eric-Terminal/momo-comment) 完成以下步骤：

1. 创建独立的 D1 数据库（与博客数据库分开）
2. 部署 Momo Worker 到 `comments.你的域名.com`（或其他子域名）
3. 在 Momo 后台配置站点 origin 白名单

#### 5.5.2 配置评论代理

项目通过 `/api/comments` 反向代理转发到 Momo 评论服务，避免跨域问题。

编辑 `src/admin/routes/comments-proxy.ts` 中的 `COMMENTS_ORIGIN`：

```ts
const COMMENTS_ORIGIN = "https://comments.你的域名.com";
```

#### 5.5.3 配置前端评论组件

前端评论组件 `public/momo-comment.min.js` 在页面中加载。确保组件中配置正确的后端地址。

---

### 5.6 配置 GitHub Actions 自动部署

项目包含 `.github/workflows/auto-deploy-from-admin.yml`，用于在推送代码后自动构建并部署到 Cloudflare。

#### 5.6.1 创建 Cloudflare API Token

1. 访问 [Cloudflare Dashboard → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **Create Token** → 使用 **Edit Cloudflare Workers** 模板
3. 在 **Account Resources** 中选择你的账号
4. 在 **Zone Resources** 中选择你的域名（或设为 All zones）
5. 创建后将 Token 复制保存

#### 5.6.2 配置 GitHub Secrets

在 GitHub 仓库 → **Settings → Secrets and variables → Actions** 中添加：

| Secret 名 | 说明 | 必需 |
|-----------|------|:----:|
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 API Token | ✅ |
| `CLOUDFLARE_REFRESH_TOKEN` | Cloudflare OAuth Refresh Token（可选，备选认证方式） | 可选 |

> **获取 Refresh Token 的方法**：
>
> 1. 运行 `npx wrangler login` 在本地登录
> 2. 登录后 `~/.config/.wrangler/config/default.toml` 中包含 `refresh_token`
> 3. 将此值填入 `CLOUDFLARE_REFRESH_TOKEN`

#### 5.6.3 自动部署流程

工作流支持三种触发方式：

| 触发方式 | 说明 |
|----------|------|
| `push` 到 `main` 分支 | 推送代码自动部署 |
| `repository_dispatch`（`rebuild-search-index`） | 从管理后台触发 |
| `workflow_dispatch` | 在 GitHub Actions 页面手动触发 |

> 如果需要从管理后台触发自动部署，需额外配置 `AUTO_DEPLOY_WEBHOOK_URL` 和 `AUTO_DEPLOY_WEBHOOK_SECRET`（见 5.3.2 自动部署 Webhook 部分）。

---

### 5.7 初始化数据库

```bash
# 执行远程迁移（创建所有表）
npm run db:migrate:remote

# 可选：导入种子数据（初始化分类、标签等）
npm run db:seed:remote
```

---

### 5.8 本地开发环境配置

在项目根目录创建 `.dev.vars`（已加入 `.gitignore`，不会提交）：

```bash
# .dev.vars —— 仅用于本地 `wrangler dev` / `astro dev`
JWT_SECRET=你的JWT密钥
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=你的密码哈希
SITE_NAME=My Blog
SITE_URL=http://localhost:4321

# 以下均为可选，按需配置
# ADMIN_GITHUB_LOGIN=你的GitHub用户名
# GITHUB_OAUTH_CLIENT_ID=你的ClientID
# GITHUB_OAUTH_CLIENT_SECRET=你的ClientSecret
# TURNSTILE_SITE_KEY=
# TURNSTILE_SECRET_KEY=
# AI_INTERNAL_API_KEY=
# AI_PUBLIC_API_KEY=
# MCP_BEARER_TOKEN=
# AUTO_DEPLOY_WEBHOOK_URL=
# AUTO_DEPLOY_WEBHOOK_SECRET=
```

本地开发：

```bash
npm run dev        # 启动 Astro 开发服务器（http://localhost:4321）
```

---

### 5.9 修改站点配置

编辑 `astro.config.mjs` 中的 `site` 字段：

```js
site: "https://your-domain.com",
```

`wrangler.jsonc` 中 `vars` 的 `SITE_NAME` 和 `SITE_URL` 也应同步更新。

---

### 5.10 首次部署

```bash
npm run deploy
```

此命令将依次执行：

1. **远程数据库迁移** — `npm run db:migrate:remote`
2. **同步文章** — `npm run sync:posts`
3. **构建搜索索引** — `npm run search:index:remote`
4. **Astro 构建** — `astro build`
5. **构建分析** — 输出各模块体积
6. **部署到 Cloudflare** — `wrangler deploy`

---

### 5.11 配置自定义域名

1. 在 Cloudflare Dashboard → Workers & Pages → 你的项目 → **Custom Domains** 中添加域名
2. 确保域名已接入 Cloudflare DNS（NS 指向 Cloudflare）
3. 更新 `vars.SITE_URL` 为你的域名（如 `https://ffaff.fun`）
4. 重新部署使配置生效

---

### 5.12 部署检查清单

部署完成后，逐项验证以下功能：

- [ ] 首页正常加载（`https://你的域名/`）
- [ ] 后台登录页可访问（`https://你的域名/admin/login`）
- [ ] 使用配置的用户名/密码可成功登录
- [ ] 可在后台创建/编辑文章
- [ ] 可上传媒体文件（R2 存储桶正常）
- [ ] 文章列表页正常显示（`https://你的域名/blog`）
- [ ] 搜索功能可用（`https://你的域名/search`）
- [ ] RSS Feed 可访问（`https://你的域名/rss.xml`）
- [ ] Sitemap 可访问（`https://你的域名/sitemap.xml`）
- [ ] 友链申请页正常（`https://你的域名/friends`）
- [ ] GitHub Actions 自动部署正常（若已配置）
- [ ] 评论系统正常加载（若已部署 Momo）

---

## 6. 日常使用

### 6.1 写文章

在 `content/posts/` 下创建 `.md` 文件，参考 `_template.md` 的 frontmatter 格式：

```markdown
---
title: 我的第一篇文章
status: published
publishedAt: '2026-06-03'
excerpt: 这是一篇示例文章
authorName: Admin
category: 技术
tags: [Astro, Cloudflare]
---
文章正文...
```

同步到数据库：

```bash
npm run sync:posts
```

### 6.2 本地开发

```bash
npm run dev
```

本地开发时会自动同步 Markdown 文章到本地 D1 数据库。

### 6.3 管理后台

部署后访问 `https://your-domain.com/admin`，使用配置的用户名和密码登录。

后台功能包括：

- **仪表盘**：关键数据概览
- **文章管理**：新建、编辑、删除、状态管理
- **分类/标签**：分类管理（支持父子层级）
- **媒体库**：上传图片到 R2，获取引用路径
- **友链审核**：审核友链申请
- **Webmention**：管理外部提及
- **站点外观**：自定义背景、Hero、导航、卡片样式
- **说说**：发布短内容
- **AI 端点**：管理 AI 模型端点配置
- **MCP**：管理 MCP 开关与审计日志
- **分析**：查看访问统计

### 6.4 仅更新内容（不改数据库结构）

```bash
# 同步文章后直接推送，Cloudflare 自动部署
npm run sync:posts
git add . && git commit -m "content: 新增文章" && git push
```

### 6.5 更新数据库结构

```bash
# 生成迁移文件
npm run db:generate

# 部署后执行远程迁移
npm run db:migrate:remote
```

---

## 7. 项目结构速览

```
cf-astro-blog/
├── content/posts/        # Markdown 文章（写作入口）
├── src/
│   ├── pages/            # 前端页面（Astro）
│   │   ├── index.astro   # 首页
│   │   ├── blog/         # 文章列表 & 详情
│   │   ├── friends.astro # 友链页
│   │   ├── search.astro  # 搜索页
│   │   ├── api/          # 公开 API
│   │   └── rss.xml.ts    # RSS
│   ├── admin/
│   │   ├── app.ts        # Hono 管理后台应用
│   │   └── routes/       # 后台 API 路由
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

## 8. 注意事项

1. **D1 数据不会因部署被清空**，仅 migration 会修改表结构。
2. **机密变量请用 Dashboard Secrets 或 `wrangler secret put` 配置**，不要写入 `wrangler.jsonc` 或 `.dev.vars` 并提交到仓库（`.dev.vars` 已加入 `.gitignore`）。
3. **资源绑定名称 `DB`、`MEDIA_BUCKET`、`SESSION`、`ASSETS` 不可修改**，否则运行时会因绑定名不匹配而报错。
4. **Turnstile 为可选功能**：不配置时登录无验证码，友链申请页会显示提示但不阻止提交。
5. **首次部署前**务必执行 `npm run db:migrate:remote` 创建表结构。
6. **`content/posts/` 中的文章**不会自动同步到线上——需通过 `npm run sync:posts` 或管理后台手动操作。
7. **自定义域名**需在 Cloudflare Dashboard 中为 Pages 项目绑定，并更新 `SITE_URL` 与 `astro.config.mjs` 中的 `site`。
8. **GitHub OAuth 登录与密码登录互不排斥**：配置了 OAuth 后登录页会显示 GitHub 登录按钮，同时保留密码登录表单。
9. **Momo 评论系统是独立服务**，需单独部署。本项目仅包含前端组件与反向代理。如不需要评论功能，可移除评论相关组件。
10. **GitHub Actions 自动部署**需要在仓库 Secrets 中配置 `CLOUDFLARE_API_TOKEN`，否则工作流会跳过部署步骤。

---

## 9. 常见问题

### Q: 登录后台提示"密钥强度不足"

检查 `JWT_SECRET` 是否已配置且长度 ≥ 32 字符。使用 `openssl rand -hex 32` 生成。

### Q: 后台登录页显示"允许访问账号：未配置"

检查 `ADMIN_GITHUB_LOGIN` 或 `ADMIN_USERNAME` 是否已正确配置在 Secrets 中（非 vars）。如果变量名前后有多余空格也会导致此问题。

### Q: 后台登录页样式异常 / 资源 404

确认 `wrangler.jsonc` 的 `assets.directory` 指向正确的构建输出目录（通常为 `"./dist"`）。检查 `public/_routes.json` 中静态资源的 exclude 列表是否完整。

### Q: GitHub OAuth 登录回调报错

1. 确认 GitHub OAuth App 的 **Authorization callback URL** 与站点实际回调地址一致（`https://你的域名/api/auth/github/callback`）
2. 确认 `GITHUB_OAUTH_CLIENT_ID` 和 `GITHUB_OAUTH_CLIENT_SECRET` 均配置在 Secrets 中
3. 确认 `ADMIN_GITHUB_LOGIN` 的值是你的 GitHub 用户名（区分大小写）

### Q: 友链申请页提示"未配置 Turnstile"

在 Cloudflare Dashboard → Turnstile 创建站点，获取 Site Key 和 Secret Key，分别配置到 `TURNSTILE_SITE_KEY`（vars）和 `TURNSTILE_SECRET_KEY`（secrets）。

### Q: 媒体上传失败 / 图片不显示

1. 确认 R2 存储桶已创建且 `wrangler.jsonc` 中 `r2_buckets[0].bucket_name` 正确
2. 确认 `MEDIA_BUCKET` 绑定名未改动
3. 如使用自定义域名提供 R2 文件，检查 `public/_headers` 中的 CORS 和缓存配置

### Q: 搜索结果不显示最新文章

搜索索引在部署时构建。确保部署命令包含搜索索引步骤：

```bash
npm run search:index:remote
```

如果是 GitHub Actions 自动部署，检查工作流中的 `repository_dispatch` 事件类型是否与 `AUTO_DEPLOY_GITHUB_EVENT_TYPE` 一致。

### Q: GitHub Actions 部署报"缺少可用凭据"

检查 GitHub 仓库 → Settings → Secrets and variables → Actions 中是否已添加 `CLOUDFLARE_API_TOKEN`。确保 Token 具有 **Edit Cloudflare Workers** 权限。

### Q: 评论系统不加载

1. 确认 Momo 评论后端已独立部署且可访问
2. 确认 `comments-proxy.ts` 中的 `COMMENTS_ORIGIN` 指向正确的 Momo 服务地址
3. 检查浏览器控制台是否有 CORS 错误

### Q: 本地 `npm run dev` 报 D1 相关错误

本地开发需初始化本地 D1 数据库：

```bash
npx wrangler d1 execute DB --local --file=drizzle/0000_magical_hedge_knight.sql
npm run db:migrate:local
```

同时确保 `.dev.vars` 中已配置必需的 secrets 变量。

### Q: 如何更换字体

字体通过 `@fontsource` 包引入。在 `package.json` 中增删 `@fontsource/*` 依赖，修改 Astro 组件中对应的 CSS import 即可。

### Q: `npm run deploy` 报超时

部署命令包含多个步骤，在首次部署或依赖较多时可能较长。可单独执行各步骤排查具体失败位置：

```bash
npm run db:migrate:remote
npm run sync:posts
npm run build
npx wrangler deploy
```

---

## 10. 贡献与反馈

- 问题反馈：提交 GitHub Issue
- 功能建议：提交 GitHub Discussion

---

*版本 0.1.0 — 2026-06-03*
