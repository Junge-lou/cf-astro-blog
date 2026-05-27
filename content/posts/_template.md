---
# ─── 必填字段 ─────────────────────────────────────────────────
title: 文章标题
slug: ''                    # 留空自动从标题生成（如 `wen-zhang-biao-ti`）
status: draft               # draft | published | scheduled
publishedAt: ''             # 发布日期（status=published 时生效，留空用同步时间）
excerpt: ''                 # 摘要，最多 200 字
authorName: Admin           # 作者署名
category: ''                # 分类名（不存在则自动创建）
tags: []                    # 标签列表（如 [物理, 光学]，不存在则自动创建）

# ─── 可选：SEO ────────────────────────────────────────────────
metaTitle: ''               # 自定义 SEO 标题（留空用文章标题）
metaDescription: ''         # SEO 描述，最多 160 字
metaKeywords: ''            # SEO 关键词，逗号分隔
canonicalUrl: ''            # 规范链接（跨站转载时填写原始 URL）

# ─── 可选：封面图 ──────────────────────────────────────────────
featuredImageKey: ''        # 封面图片的 R2 key（通过后台 /admin/media 上传）
featuredImageAlt: ''        # 封面替代文本，用于可访问性，最多 200 字

# ─── 可选：文章背景（覆盖站点全局背景）──────────────────────────
backgroundMode: global      # global（跟随站点）| cover（用封面图）| custom（上传独立背景）
backgroundImageKey: ''      # 自定义背景图的 R2 key（backgroundMode=custom 时生效）
backgroundOpacity: 72       # 背景不透明度 0-100（72 = 28% 透明）
backgroundBlur: 24          # 高斯模糊 0-60 px
backgroundScale: 112        # 背景缩放 100-180（112 = 放大 12%）
backgroundPositionX: 50     # 横向焦点 0-100（50 = 居中）
backgroundPositionY: 50     # 纵向焦点 0-100（50 = 居中）

# ─── 可选：置顶 ────────────────────────────────────────────────
isPinned: false             # 首页置顶
pinnedOrder: 100            # 置顶排序 1-9999（越小越靠前）

# ─── 以下由同步脚本 / 后台自动维护 ──────────────────────────────
# slug 最终值、createdAt、updatedAt、viewCount 等由系统管理
---

<!-- 正文开始，使用标准 Markdown 语法 -->


