---
name: new-post
description: 'Create a new blog post markdown file with standard frontmatter for this Astro blog. Use when: user wants to write, create, add, or generate a new blog post, article, or markdown file.'
argument-hint: 'Provide the article title to generate frontmatter'
---

# New Blog Post

## When to Use
- User says "create a new post" / "write an article" / "新建文章" / "新建博客" / "写文章" / "写博客"
- User provides an article title and wants a `.md` file created in `content/posts/`
- User wants proper YAML frontmatter matching the project's blog schema

## Procedure

### 1. Ask for Required Info

Only ask for the **title** (required). If the user volunteers tags, category, or status, include them.
- **status** defaults to `draft` (user can request `published` or `scheduled`)
- **authorName** defaults to `Admin`
- **tags** and **category** left empty — the sync script auto-creates missing tags/categories in D1

### 2. Generate Slug

From title to slug:

1. Normalize with `NFKC`
2. Convert to lowercase
3. Replace every run of non-letter/non-number characters with a single hyphen
4. Remove leading/trailing hyphens
5. Truncate to 120 characters, then strip any trailing hyphen
6. If the result is empty or invalid, fall back to `post-<uuid-first-8>`

Examples:
- `"Hello World! 2024"` → `hello-world-2024`
- `"三家分晋"` → `post-a1b2c3d4` (no Latin letters, falls back to UUID)
- `"魏文侯立相 李克应对"` → `post-a1b2c3d4`

### 3. Generate Frontmatter

Generate ALL 15 fields. Auto-generated defaults:

| Field | Auto-generated value |
|-------|---------------------|
| `title` | User-provided title |
| `slug` | Auto-generated from title (see slug rules above) |
| `status` | `draft` (unless user says otherwise) |
| `publishedAt` | Empty string `''` (sync script sets this at sync time) |
| `excerpt` | Empty string `''` |
| `authorName` | `Admin` |
| `category` | Empty string `''` |
| `tags` | Empty list `[]` |
| `metaTitle` | Empty string `''` |
| `metaDescription` | Empty string `''` |
| `metaKeywords` | Empty string `''` |
| `canonicalUrl` | Empty string `''` |
| `featuredImageKey` | Empty string `''` |
| `isPinned` | `false` |
| `pinnedOrder` | `100` |

### 4. Create the File

- Path: `content/posts/<slug>.md`
- Include ALL 15 frontmatter fields — do not omit any
- Keep empty fields as empty strings (`''`), empty arrays as `[]`
- Add a body skeleton with `<!-- more -->` as the excerpt separator
- Suggest the user fill in the content, then run `npm run sync:posts:local` to sync to the database

### 5. Template

```markdown
---
title: {{title}}
slug: {{slug}}
status: draft
publishedAt: ''
excerpt: ''
authorName: Admin
category: ''
tags: []
metaTitle: ''
metaDescription: ''
metaKeywords: ''
canonicalUrl: ''
featuredImageKey: ''
isPinned: false
pinnedOrder: 100
---

Write your introduction here.

<!-- more -->

Write the rest of your content here.
```

### 6. After File Creation

Remind the user of the sync workflow:
- **Local preview**: `npm run sync:posts:local` syncs `content/posts/*.md` → local D1, then `npm run dev`
- **Deploy**: `npm run deploy` syncs to remote D1, builds, and deploys to Cloudflare

## Frontmatter Field Reference

For context, the complete frontmatter schema (from `sync-local-posts.mjs` and `db/schema.ts`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | string | — (required) | Article title |
| `slug` | string | auto from title | URL path segment |
| `status` | `draft` / `published` / `scheduled` | `draft` | Publication status |
| `publishedAt` | ISO date string | set at sync | Publication date (`YYYY-MM-DDTHH:mm:ss.sssZ`) |
| `excerpt` | string | `''` | Article excerpt (auto-truncated to 200 chars at sync) |
| `authorName` | string | `Admin` | Author display name (truncated to 120 chars) |
| `category` | string | `''` | Category name — auto-created in D1 if it doesn't exist |
| `tags` | string[] | `[]` | Tag list — each tag auto-created in D1 if it doesn't exist |
| `metaTitle` | string | `''` | Custom SEO title (truncated to 200 chars) |
| `metaDescription` | string | `''` | Custom SEO description (truncated to 160 chars) |
| `metaKeywords` | string | `''` | SEO keywords (truncated to 200 chars) |
| `canonicalUrl` | string | `''` | Canonical URL for SEO |
| `featuredImageKey` | string | `''` | R2 object key for featured image |
| `isPinned` | boolean | `false` | Pin to homepage |
| `pinnedOrder` | number | `100` | Pin sort order (1–9999, lower = first) |
