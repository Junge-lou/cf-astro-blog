import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import matter from "gray-matter";

const POSTS_DIR = join(process.cwd(), "content", "posts");

// ─── CLI 参数解析 ────────────────────────────────────────────────────────────

function resolveMode() {
  const arg = process.argv.find((a) => a === "--local" || a === "--remote");
  return arg === "--local" ? "local" : "remote";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

// ─── D1 查询 ─────────────────────────────────────────────────────────────────

function runD1(query, mode) {
  const modeFlag = mode === "remote" ? "--remote" : "--local";

  const stdout = execSync(
    `npx wrangler d1 execute DB ${modeFlag} --command "${query.replaceAll('"', '\\"')}" --json`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
  );

  const jsonStart = stdout.indexOf("[");
  const jsonEnd = stdout.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error("wrangler 输出中未找到可解析的 JSON 结果: " + stdout.slice(0, 500));
  }

  const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
  const rows = Array.isArray(parsed) ? parsed[0]?.results : [];
  return Array.isArray(rows) ? rows : [];
}

// ─── YAML 值序列化 ───────────────────────────────────────────────────────────

function yamlValue(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return `${pad}''`;
  if (typeof value === "boolean") return `${pad}${value}`;
  if (typeof value === "number") return `${pad}${value}`;
  const str = String(value).trim();
  if (!str) return `${pad}''`;
  // 如果包含特殊字符或前导空格/引号，用引号包裹
  if (/[:\n#[\]{},"']/.test(str) || /^['" ]/.test(str)) {
    return `${pad}${JSON.stringify(str)}`;
  }
  return `${pad}${str}`;
}

// ─── 收集本地已有文件的 slug 集合（用于判重）────────────────────────────

function collectLocalSlugs() {
  if (!existsSync(POSTS_DIR)) return new Set();

  const files = readdirSync(POSTS_DIR).filter(
    (f) =>
      (extname(f) === ".md" || extname(f) === ".mdx") &&
      !basename(f).startsWith("_"),
  );

  const slugs = new Set();
  for (const file of files) {
    const filePath = join(POSTS_DIR, file);
    try {
      const { data } = matter(readFileSync(filePath, "utf8"));
      if (data.slug) slugs.add(data.slug);
    } catch {
      // 跳过解析失败的文件
    }
  }
  return slugs;
}

// ─── 将 DB 行转为 Frontmatter YAML ──────────────────────────────────────────

function buildFrontmatter(row) {
  const lines = ["---", ""];
  lines.push("# ─── 由 export-posts.mjs 从数据库导出 ────────────────");
  lines.push("");

  lines.push(`title: ${yamlValue(row.title)}`);
  lines.push(`slug: ${yamlValue(row.slug)}`);
  lines.push(`status: ${row.status || "draft"}`);

  if (row.published_at) {
    const d = new Date(row.published_at);
    lines.push(`publishedAt: ${yamlValue(d.toISOString().split("T")[0])}`);
  }
  if (row.publish_at) {
    const d = new Date(row.publish_at);
    lines.push(`publishAt: ${yamlValue(d.toISOString().split("T")[0])}`);
  }
  if (row.excerpt) {
    lines.push(`excerpt: ${yamlValue(row.excerpt)}`);
  }
  if (row.author_name) {
    lines.push(`authorName: ${yamlValue(row.author_name)}`);
  }
  if (row.category_name) {
    lines.push(`category: ${yamlValue(row.category_name)}`);
  }
  if (row.tag_names) {
    const tags = String(row.tag_names)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 0) {
      lines.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    }
  }

  lines.push("");
  // ─── SEO ────────────────────────────────────────────────
  if (row.meta_title || row.meta_description || row.meta_keywords || row.canonical_url) {
    lines.push("# ─── SEO ────────────────────────────────────────────────");
    if (row.meta_title) lines.push(`metaTitle: ${yamlValue(row.meta_title)}`);
    if (row.meta_description) lines.push(`metaDescription: ${yamlValue(row.meta_description)}`);
    if (row.meta_keywords) lines.push(`metaKeywords: ${yamlValue(row.meta_keywords)}`);
    if (row.canonical_url) lines.push(`canonicalUrl: ${yamlValue(row.canonical_url)}`);
    lines.push("");
  }

  // ─── 封面图 ─────────────────────────────────────────────
  if (row.featured_image_key || row.featured_image_alt) {
    lines.push("# ─── 封面图 ──────────────────────────────────────────────");
    if (row.featured_image_key) lines.push(`featuredImageKey: ${yamlValue(row.featured_image_key)}`);
    if (row.featured_image_alt) lines.push(`featuredImageAlt: ${yamlValue(row.featured_image_alt)}`);
    lines.push("");
  }

  // ─── 文章背景 ───────────────────────────────────────────
  if (
    row.background_mode !== "global" ||
    row.background_image_key ||
    row.background_opacity !== 72 ||
    row.background_blur !== 24 ||
    row.background_scale !== 112 ||
    row.background_position_x !== 50 ||
    row.background_position_y !== 50
  ) {
    lines.push("# ─── 文章背景 ───────────────────────────────────────────");
    lines.push(`backgroundMode: ${row.background_mode || "global"}`);
    if (row.background_image_key) lines.push(`backgroundImageKey: ${yamlValue(row.background_image_key)}`);
    if (row.background_opacity !== 72) lines.push(`backgroundOpacity: ${row.background_opacity}`);
    if (row.background_blur !== 24) lines.push(`backgroundBlur: ${row.background_blur}`);
    if (row.background_scale !== 112) lines.push(`backgroundScale: ${row.background_scale}`);
    if (row.background_position_x !== 50) lines.push(`backgroundPositionX: ${row.background_position_x}`);
    if (row.background_position_y !== 50) lines.push(`backgroundPositionY: ${row.background_position_y}`);
    lines.push("");
  }

  // ─── 置顶 ───────────────────────────────────────────────
  if (row.is_pinned) {
    lines.push("# ─── 置顶 ────────────────────────────────────────────────");
    lines.push(`isPinned: ${Boolean(row.is_pinned)}`);
    if (row.pinned_order && row.pinned_order !== 100) {
      lines.push(`pinnedOrder: ${row.pinned_order}`);
    }
    lines.push("");
  }

  lines.push("---");
  return lines.join("\n");
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

function exportPosts() {
  const mode = resolveMode();
  const modeLabel = mode === "remote" ? "远程 D1" : "本地 D1";
  const dryRun = hasFlag("--dry-run");
  const forceOverwrite = hasFlag("--force");
  const statusFilter = hasFlag("--all") ? "" : "WHERE p.status IN ('published', 'scheduled')";

  console.log(`导出模式: ${modeLabel}`);
  if (dryRun) console.log("⚠ 预览模式（--dry-run）：不会实际写入文件");
  if (forceOverwrite) console.log("⚠ 强制覆盖模式（--force）：覆盖本地已有的文件");
  if (hasFlag("--all")) console.log("⚠ 导出全部文章模式（--all）：包含草稿");

  // 查询文章（使用较短列列表避免 Windows 命令行长度限制）
  const rows = runD1(
    "SELECT id, title, slug, content, excerpt, status, publish_at, published_at, author_name, category_id, featured_image_key, featured_image_alt, background_mode, background_image_key, background_opacity, background_blur, background_scale, background_position_x, background_position_y, is_pinned, pinned_order, meta_title, meta_description, meta_keywords, canonical_url FROM blog_posts p " +
      statusFilter +
      " ORDER BY p.created_at DESC",
    mode,
  );

  if (rows.length === 0) {
    console.log("数据库中没有找到需要导出的文章。");
    return;
  }

  console.log(`从数据库读取到 ${rows.length} 篇文章\n`);

  // 分类名单独查询（JOIN 会使命令过长）
  const categoryIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))];
  let categoryMap = {};
  if (categoryIds.length > 0) {
    const catRows = runD1(
      `SELECT id, name FROM blog_categories WHERE id IN (${categoryIds.join(",")})`,
      mode,
    );
    for (const cr of catRows) categoryMap[cr.id] = cr.name;
  }

  // 收集每篇文章的标签
  const postIds = rows.map((r) => r.id).filter(Boolean);
  let tagMap = {};
  if (postIds.length > 0) {
    const tagRows = runD1(
      `SELECT pt.post_id, t.name FROM blog_post_tags pt JOIN blog_tags t ON t.id = pt.tag_id WHERE pt.post_id IN (${postIds.join(",")})`,
      mode,
    );
    for (const tr of tagRows) {
      const pid = tr.post_id;
      if (!tagMap[pid]) tagMap[pid] = [];
      tagMap[pid].push(tr.name);
    }
  }

  // 收集本地已有 slug
  const localSlugs = collectLocalSlugs();

  // 确保输出目录存在
  if (!existsSync(POSTS_DIR)) {
    mkdirSync(POSTS_DIR, { recursive: true });
  }

  let created = 0;
  let skipped = 0;
  let overwritten = 0;

  for (const row of rows) {
    const slug = (row.slug || "").trim();
    if (!slug) {
      console.warn(`  [跳过] 文章 #${row.id}「${row.title}」slug 为空`);
      skipped++;
      continue;
    }

    // 检查本地是否已存在
    const exists = localSlugs.has(slug);
    if (exists && !forceOverwrite) {
      console.warn(`  [跳过] ${slug}.md —— 本地已存在，使用 --force 覆盖`);
      skipped++;
      continue;
    }

    // 构建 frontmatter
    row.tag_names = (tagMap[row.id] || []).join(",");
    row.category_name = categoryMap[row.category_id] || null;
    const frontmatter = buildFrontmatter(row);
    const content = (row.content || "").trim();
    const fileContent = `${frontmatter}\n\n${content}\n`;

    const fileName = `${slug}.md`;
    const filePath = join(POSTS_DIR, fileName);

    if (dryRun) {
      const action = exists ? "[预览-覆盖]" : "[预览-新建]";
      console.log(`  ${action} ${fileName}`);
      if (exists) overwritten++;
      else created++;
      continue;
    }

    writeFileSync(filePath, fileContent, "utf8");
    const action = exists ? "[覆盖]" : "[新建]";
    console.log(`  ${action} ${fileName}`);
    if (exists) overwritten++;
    else created++;
  }

  console.log(
    `\n完成: ${created} 篇新建, ${overwritten} 篇覆盖, ${skipped} 篇跳过, 共 ${rows.length} 篇`,
  );
  if (dryRun) {
    console.log("💡 这是预览模式（--dry-run），文件未被修改。确认无误后去掉 --dry-run 执行。");
  }
}

try {
  exportPosts();
} catch (err) {
  console.error("导出失败:", err);
  process.exit(1);
}
