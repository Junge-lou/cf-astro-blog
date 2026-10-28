# cf-astro-blog v1.7 — 视觉层级重构（表面 / 字体 / 信息架构）

**2026-10-28**

## 表面体系

- 浅色主题页面底色改为更饱和的钴白 `#dbe6f7`，卡片玻璃基色改为**纯白**：
  此前两者同为 `228,238,253`，卡片只能靠 1px 边框区分
- 面板不透明度设下限 `clamp(0.45, …)`，外观设置里的滑块只能让卡片"更实"，不会"消失"
- 圆角从 6 档（18/24/28/32/34/40）收敛为 10/14/18/24 四档
- 文章页标题区去掉玻璃面板：标题区与正文同处一张纸，层级靠字号与留白表达

## 字体分工

- `body` 默认改为无衬线（导航、按钮、胶囊、日期等 UI 全部受益于更高的 x-height）
- 正文 `.prose`、页面标题、文章标题显式使用衬线体，保留原有阅读气质
- 页内标题行高 1.02→1.14、字距 -0.05em→-0.02em（中文标题不再上下粘连）

## 首页信息架构

- 移除 Hero 右侧栏与 `hero-sidebar-fit.js`：同一篇文章此前会在侧栏、置顶、最近更新里**出现三次**
- 首页改为：Hero → 分类 → 置顶（≤3 张大卡）→ 最近更新（≤6 条）
- Hero 高度：手机 884px（超过一屏）→ **416px**，首屏即可看到第一张卡片
- "已发布 N 篇"改用独立 `count(*)`，与归档页数字一致（此前只统计首页渲染出来的卡片数）

## 其它修复

- 品牌头像改为自托管 WebP：原来引用腾讯云 COS 的 **1.79 MB / 76 帧 GIF**，跨域加体积都可能被
  浏览器判成异常响应（ORB）而显示破图；现改为 `public/brand-avatar.webp`（96px 动画版 99 KB）
  与 `brand-avatar-static.webp`（静态帧 2.7 KB），`prefers-reduced-motion` 时由 `<picture>`
  自动退回静态帧。图标保持指向 `/api/auth/login`（全站唯一可见的后台入口），站点标题链接负责回首页；
  同时加 `data-astro-prefetch="false"`，避免划过图标就预取登录页、白白签发一个 CSRF token
- 正文 `# 标题` 自动降级为 `h2`：此前文章页存在两个 `h1`（SEO / 屏幕阅读器问题）
- 站点日期统一 `zh-CN`：`local-time.js` 原用浏览器语言，英文环境下会渲染成 `October 27, 2026`
- "取消透明度"按钮改名为「专注阅读 / 退出专注」
- 窄屏导航不再裁掉激活态胶囊、不再常驻横向滚动条
- 删除从未被 import 的 `src/styles/claude.css`（3755 行死代码）
- 窄屏（≤720px）关闭 `backdrop-filter`，改用已提高下限的纯色玻璃

---

# cf-astro-blog v1.6 — 工具链大扫除（TypeScript 7 + Node 26 LTS）

**2026-10-28**

## TypeScript

- **TypeScript 7.0.2**（Go 原生重写）接管 CLI：新增 `npm run typecheck`，冷启动 1.5s（原 5.5s）
- TS 7 不提供编程 API，`@astrojs/check` 仍需 TS 6：以 npm 别名并存
  `@typescript/native → typescript@7`（提供 `tsc`）、`typescript → @typescript/typescript6`（提供 `tsc6` + API）
- `tsconfig.json` 移除 TS 7 已废弃的 `baseUrl`，`paths` 改为相对 tsconfig 书写；补入 `.astro/types.d.ts`
- 源码零改动（`tsc --noEmit` 与 `astro check` 均 0 error）

## 依赖

- 全部直接依赖升到最新：astro 7.4.2、@astrojs/cloudflare 14.4.2、biome 2.6.3、wrangler 4.154.0 等
- `biome.json` 通过 `biome migrate` 升到 2.6.3 schema（`recommended` → `preset`）

## 安全

- 新增 override `miniflare → undici@^7.30.1`，消除 Cloudflare 适配器链路 5 项告警
- `npm audit`：13 项（9 moderate / 4 high）→ 8 项（5 moderate / 3 high）
- 剩余告警集中在 `@remy/webmention → cheerio@0.22`（无上游修复）与 `drizzle-kit` 的旧 esbuild，均为仅开发期依赖

## 运行时与 CI

- Node **26 LTS**：CI / 部署工作流 / 新增 `.nvmrc` 统一；`engines.node` 提到 `>=24`
- GitHub Actions：`checkout@v6 → v7`、`setup-node@v5 → v7`、`cache@v4 → v6`

---

# cf-astro-blog v1.5 — Astro 7 + BBC-style Homepage + Golden Ratio Typography

**2026-08-03**

## Framework

- **Astro 6.4.3 → 7.1.6**: Rust compiler, Rolldown (Vite 8), Sätteri Markdown
- **@astrojs/cloudflare 13 → 14**, **@cloudflare/workers-types 4.x → 5.x**

## Homepage

- Flat structure: removed atmosphere/media/sidebar/signal/metric layers
- Dual-column Hero with sidebar (pinned compact + recent list) on desktop
- BBC-style compact cards: vertical, 240:134, no cover radius, reduced glass
- Category tag navigation + archive filtering (`/blog?category=...`)
- Golden ratio typography from section-head h2 (φ=1.618 descending)

## Features

- `Ctrl+K` global search, container queries, `:has()` selector
- Global `:focus-visible`, `prefers-reduced-motion`, `text-wrap: pretty`
- Dark mode contrast boost

## Admin

- Removed Hero layout toggle, signal card, hero image uploader forms

## Changelog

- ~400 lines dead CSS removed, `--space-2xs` aligned to 4px grid

---

## 关于本文档

本文件**只记录发布变更**。

**安装、配置、部署、常见问题请看 [`README.md`](../README.md)；发文流程见
[`posting-workflows.md`](./posting-workflows.md)；上线后的发布与迁移规范见
[`maintenance-guide.md`](./maintenance-guide.md)。**
