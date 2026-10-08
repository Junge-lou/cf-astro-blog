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

这里原本还抄了一份完整的部署说明（约 700 行），与 `README.md` 逐字重复，
结果是任何一处修正都要改两遍——实际上 `README.md` 里的过期内容（"Astro 6"、
不存在的 `npm run search:index:remote`）在这份拷贝里同样存在。为避免继续分叉，
重复段落已删除。

**安装、配置、部署、常见问题请看 [`README.md`](./README.md)；上线后的发布与迁移规范见
[`docs/maintenance-guide.md`](./docs/maintenance-guide.md)；性能与优化路线见
[`docs/optimization-plan.md`](./docs/optimization-plan.md)。**
