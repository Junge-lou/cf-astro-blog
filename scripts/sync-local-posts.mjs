import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import matter from "gray-matter";

const POSTS_DIR = join(process.cwd(), "content", "posts");
const SLUG_SEGMENT_RE = /[^\p{Letter}\p{Number}]+/gu;
const SLUG_VALID_RE = /^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u;
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

function resolveMode() {
  const arg = process.argv.find((a) => a === "--local" || a === "--remote");
  return arg === "--local" ? "local" : "remote";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function runD1(command, mode) {
  const modeFlag = mode === "remote" ? "--remote" : "--local";
  const stdout = execFileSync(
    NPX,
    ["wrangler", "d1", "execute", "DB", modeFlag, "--command", command, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
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

function escapeSql(value) {
  return String(value ?? "").replaceAll("'", "''");
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${escapeSql(value)}'`;
}

function sqlInt(value, fallback = "NULL") {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : fallback;
}

function buildSlug(title) {
  const normalized = String(title ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replaceAll(SLUG_SEGMENT_RE, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  if (SLUG_VALID_RE.test(normalized)) {
    return normalized.slice(0, 120).replaceAll(/-+$/g, "") || "post";
  }

  const uuid = crypto.randomUUID().slice(0, 8);
  return `post-${uuid}`;
}

function resolveSlug(slug, title, existingSlugs) {
  let base = slug || buildSlug(title);
  base = base.slice(0, 116);
  let candidate = base;
  let suffix = 2;
  while (existingSlugs.has(candidate) && suffix < 120) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  if (existingSlugs.has(candidate)) {
    candidate = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }
  existingSlugs.add(candidate);
  return candidate;
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function collectPosts() {
  if (!existsSync(POSTS_DIR)) {
    console.log(`目录不存在: ${POSTS_DIR}`);
    return [];
  }

  const files = readdirSync(POSTS_DIR).filter(
    (f) =>
      (extname(f) === ".md" || extname(f) === ".mdx") &&
      !basename(f).startsWith("_"), // 跳过模板、草稿等内部文件
  );

  if (files.length === 0) {
    console.log("content/posts/ 中没有找到 .md 文件。");
    return [];
  }

  const posts = [];
  const localSlugSet = new Set();

  for (const file of files) {
    const filePath = join(POSTS_DIR, file);
    const raw = readFileSync(filePath, "utf8");
    let data, content;
    try {
      const parsed = matter(raw);
      data = parsed.data;
      content = parsed.content;
    } catch (err) {
      console.error(`[跳过] ${file}: YAML frontmatter 解析失败 — ${err.message}`);
      continue;
    }

    const title =
      data.title?.trim() ||
      (content.match(/^#\s+(.+)$/m)?.[1]?.trim()) ||
      basename(file, extname(file));

    const slug = resolveSlug(data.slug || null, title, localSlugSet);

    let status = ["draft", "published", "scheduled"].includes(data.status)
      ? data.status
      : "draft";

    let publishedAt = null;
    let publishAt = null;

    if (status === "published") {
      publishedAt = parseDate(data.publishedAt || data.date) || new Date().toISOString();
      publishAt = publishedAt;
    } else if (status === "scheduled") {
      publishAt = parseDate(data.publishAt);
      if (!publishAt) {
        console.warn(`[警告] ${file}: status=scheduled 但缺少有效的 publishAt，降级为 published`);
        status = "published";
        publishedAt = new Date().toISOString();
        publishAt = publishedAt;
      }
    }

    const tagNames = Array.isArray(data.tags)
      ? data.tags.map((t) => String(t).trim()).filter(Boolean)
      : [];

    const backgroundMode = ["global", "cover", "custom"].includes(data.backgroundMode?.trim())
      ? data.backgroundMode.trim()
      : "global";

    posts.push({
      file,
      fileMtimeMs: statSync(filePath).mtimeMs,
      slug,
      title,
      content: content.trim() || "",
      status,
      publishedAt,
      publishAt,
      excerpt: data.excerpt?.trim().slice(0, 200) || null,
      authorName: data.authorName?.trim().slice(0, 120) || "Admin",
      categoryName: data.category?.trim() || null,
      tagNames,
      metaTitle: data.metaTitle?.trim().slice(0, 200) || null,
      metaDescription: data.metaDescription?.trim().slice(0, 160) || null,
      metaKeywords: data.metaKeywords?.trim().slice(0, 200) || null,
      canonicalUrl: data.canonicalUrl?.trim() || null,
      featuredImageKey: data.featuredImageKey?.trim() || null,
      featuredImageAlt: data.featuredImageAlt?.trim().slice(0, 200) || null,
      backgroundMode,
      backgroundImageKey: data.backgroundImageKey?.trim() || null,
      backgroundOpacity: clampInt(data.backgroundOpacity, 0, 100, 72),
      backgroundBlur: clampInt(data.backgroundBlur, 0, 60, 24),
      backgroundScale: clampInt(data.backgroundScale, 100, 180, 112),
      backgroundPositionX: clampInt(data.backgroundPositionX, 0, 100, 50),
      backgroundPositionY: clampInt(data.backgroundPositionY, 0, 100, 50),
      isPinned: data.isPinned === true ? 1 : 0,
      pinnedOrder: Number.isInteger(data.pinnedOrder) && data.pinnedOrder >= 1 && data.pinnedOrder <= 9999
        ? data.pinnedOrder
        : 100,
    });
  }

  return posts;
}

function lookupOrCreateCategory(name, mode) {
  const escaped = escapeSql(name);
  let rows = runD1(`SELECT id FROM blog_categories WHERE name = '${escaped}' LIMIT 1`, mode);
  if (rows.length > 0) return rows[0].id;

  const slug = buildSlug(name);
  const now = new Date().toISOString();
  runD1(
    `INSERT INTO blog_categories (name, slug, created_at, updated_at) VALUES ('${escapeSql(name)}', '${escapeSql(slug)}', '${escapeSql(now)}', '${escapeSql(now)}')`,
    mode,
  );
  rows = runD1(`SELECT id FROM blog_categories WHERE name = '${escaped}' LIMIT 1`, mode);
  if (rows.length > 0) {
    console.log(`  [创建分类] "${name}" (slug: ${slug})`);
    return rows[0].id;
  }
  return null;
}

function lookupOrCreateTag(name, mode) {
  const escaped = escapeSql(name);
  let rows = runD1(`SELECT id FROM blog_tags WHERE name = '${escaped}' LIMIT 1`, mode);
  if (rows.length > 0) return rows[0].id;

  const slug = buildSlug(name);
  const now = new Date().toISOString();
  runD1(
    `INSERT INTO blog_tags (name, slug, created_at) VALUES ('${escapeSql(name)}', '${escapeSql(slug)}', '${escapeSql(now)}')`,
    mode,
  );
  rows = runD1(`SELECT id FROM blog_tags WHERE name = '${escaped}' LIMIT 1`, mode);
  if (rows.length > 0) {
    console.log(`  [创建标签] "${name}" (slug: ${slug})`);
    return rows[0].id;
  }
  return null;
}

function syncPostTags(postId, tagNames, mode) {
  // Delete existing tag associations
  runD1(`DELETE FROM blog_post_tags WHERE post_id = ${postId}`, mode);

  // Insert new tag associations
  for (const name of tagNames) {
    const tagId = lookupOrCreateTag(name, mode);
    if (tagId !== null) {
      runD1(
        `INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (${postId}, ${tagId})`,
        mode,
      );
    }
  }
}

function sync() {
  const mode = resolveMode();
  const modeLabel = mode === "remote" ? "远程 D1" : "本地 D1";
  const dryRun = hasFlag("--dry-run");
  const forceOverwrite = hasFlag("--force");

  console.log(`同步模式: ${modeLabel}`);
  if (dryRun) console.log("⚠ 预览模式（--dry-run）：不会实际修改数据库");
  if (forceOverwrite) console.log("⚠ 强制覆盖模式（--force）：将覆盖数据库中已有的同名文章");
  console.log(`目录: ${POSTS_DIR}\n`);

  const posts = collectPosts();
  if (posts.length === 0) {
    console.log("没有需要同步的文章。");
    return;
  }

  // Batch-check which slugs already exist in D1, with updated_at for merge
  const slugList = posts.map((p) => `'${escapeSql(p.slug)}'`).join(", ");
  const existingRows = runD1(
    `SELECT slug, updated_at FROM blog_posts WHERE slug IN (${slugList})`,
    mode,
  );
  const dbInfoMap = new Map(
    existingRows.map((r) => [r.slug, { updatedAt: r.updated_at || "" }]),
  );

  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    const dbInfo = dbInfoMap.get(post.slug);
    const exists = !!dbInfo;

    // Resolve category ID
    const categoryId = post.categoryName
      ? lookupOrCreateCategory(post.categoryName, mode)
      : null;

    if (exists) {
      // ── 时间戳智能合并 ──────────────────────────────────────────────
      // 比较本地文件的修改时间 vs 数据库中该文章的 updated_at：
      //   本地更新 → 正常覆盖（日常写作场景）
      //   DB 更新  → 跳过并警告（后台修改过的文章，避免覆盖丢失）
      //   --force  → 跳过时间戳检查，强制覆盖
      const dbUpdatedMs = parseDate(dbInfo.updatedAt)
        ? new Date(parseDate(dbInfo.updatedAt)).getTime()
        : 0;
      const localNewer = post.fileMtimeMs > dbUpdatedMs;

      if (!forceOverwrite && !localNewer && !Number.isNaN(dbUpdatedMs) && dbUpdatedMs > 0) {
        const dbTime = new Date(dbUpdatedMs).toLocaleString("zh-CN", { hour12: false });
        const fileTime = new Date(post.fileMtimeMs).toLocaleString("zh-CN", { hour12: false });
        console.warn(
          `  [跳过] ${post.file} → slug="${post.slug}" —— DB 更新较新（DB: ${dbTime} / 文件: ${fileTime}），可能已在后台修改。使用 --force 强制覆盖`,
        );
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  [预览-更新] ${post.file} → slug="${post.slug}" (${post.status})`);
        updated++;
        continue;
      }

      // UPDATE existing post — 包含所有字段
      runD1(
        [
          "UPDATE blog_posts SET",
          `title = ${sqlString(post.title)},`,
          `content = ${sqlString(post.content)},`,
          `excerpt = ${sqlString(post.excerpt)},`,
          `status = ${sqlString(post.status)},`,
          `publish_at = ${sqlString(post.publishAt)},`,
          `published_at = ${sqlString(post.publishedAt)},`,
          `featured_image_key = ${sqlString(post.featuredImageKey)},`,
          `featured_image_alt = ${sqlString(post.featuredImageAlt)},`,
          `background_mode = ${sqlString(post.backgroundMode)},`,
          `background_image_key = ${sqlString(post.backgroundImageKey)},`,
          `background_opacity = ${post.backgroundOpacity},`,
          `background_blur = ${post.backgroundBlur},`,
          `background_scale = ${post.backgroundScale},`,
          `background_position_x = ${post.backgroundPositionX},`,
          `background_position_y = ${post.backgroundPositionY},`,
          `is_pinned = ${post.isPinned},`,
          `pinned_order = ${post.pinnedOrder},`,
          `meta_title = ${sqlString(post.metaTitle)},`,
          `meta_description = ${sqlString(post.metaDescription)},`,
          `meta_keywords = ${sqlString(post.metaKeywords)},`,
          `canonical_url = ${sqlString(post.canonicalUrl)},`,
          `category_id = ${categoryId !== null ? categoryId : "NULL"},`,
          `author_name = ${sqlString(post.authorName)},`,
          `updated_at = ${sqlString(now)}`,
          `WHERE slug = ${sqlString(post.slug)}`,
        ].join(" "),
        mode,
      );
      updated++;
    } else {
      if (dryRun) {
        console.log(`  [预览-新建] ${post.file} → slug="${post.slug}" (${post.status})`);
        inserted++;
        continue;
      }

      // INSERT new post — 包含所有字段
      runD1(
        [
          "INSERT INTO blog_posts",
          "(title, slug, content, excerpt, status, publish_at, published_at, featured_image_key, featured_image_alt, background_mode, background_image_key, background_opacity, background_blur, background_scale, background_position_x, background_position_y, is_pinned, pinned_order, meta_title, meta_description, meta_keywords, canonical_url, category_id, author_name, created_at, updated_at)",
          "VALUES",
          `(${sqlString(post.title)}, ${sqlString(post.slug)}, ${sqlString(post.content)}, ${sqlString(post.excerpt)}, ${sqlString(post.status)}, ${sqlString(post.publishAt)}, ${sqlString(post.publishedAt)}, ${sqlString(post.featuredImageKey)}, ${sqlString(post.featuredImageAlt)}, ${sqlString(post.backgroundMode)}, ${sqlString(post.backgroundImageKey)}, ${post.backgroundOpacity}, ${post.backgroundBlur}, ${post.backgroundScale}, ${post.backgroundPositionX}, ${post.backgroundPositionY}, ${post.isPinned}, ${post.pinnedOrder}, ${sqlString(post.metaTitle)}, ${sqlString(post.metaDescription)}, ${sqlString(post.metaKeywords)}, ${sqlString(post.canonicalUrl)}, ${categoryId !== null ? categoryId : "NULL"}, ${sqlString(post.authorName)}, ${sqlString(now)}, ${sqlString(now)})`,
        ].join(" "),
        mode,
      );
      inserted++;
    }

    // Fetch post ID for tag sync (only if tags are present)
    if (post.tagNames.length > 0 && !dryRun) {
      const rows = runD1(
        `SELECT id FROM blog_posts WHERE slug = ${sqlString(post.slug)}`,
        mode,
      );
      if (rows.length > 0) {
        syncPostTags(rows[0].id, post.tagNames, mode);
      }
    }

    const action = exists
      ? (dryRun ? "[预览-更新]" : "[更新]")
      : (dryRun ? "[预览-新建]" : "[新建]");
    console.log(`  ${action} ${post.file} → slug="${post.slug}" (${post.status})`);
  }

  console.log(
    `\n完成: ${inserted} 篇新建, ${updated} 篇更新, ${skipped} 篇跳过, 共 ${posts.length} 篇`,
  );
  if (skipped > 0) {
    console.log(
      "💡 以上跳过的文章，数据库中的版本比本地文件更新（可能已在后台修改），",
    );
    console.log(
      "   如需强制覆盖请使用 --force。未跳过的文章已正常同步。",
    );
  }
  if (dryRun) {
    console.log("💡 这是预览模式（--dry-run），数据库未被修改。确认无误后去掉 --dry-run 执行。");
  }
}

try {
  sync();
} catch (err) {
  console.error("同步失败:", err);
  process.exit(1);
}
