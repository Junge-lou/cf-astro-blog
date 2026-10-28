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
