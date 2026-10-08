import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * 公开页面热点查询的**查询计划**回归保护。
 *
 * 为什么需要这个测试：D1 的查询性能问题不会让任何功能测试失败——查询照样返回
 * 正确结果，只是每次都要全表扫描 + 把整个结果集排序一遍才取 LIMIT。这类退化只有
 * 看 `EXPLAIN QUERY PLAN` 才能发现。
 *
 * 做法：用 node:sqlite 建内存库 → 按顺序执行 drizzle/ 下全部迁移（**包括被测的
 * 索引迁移与其中的 ANALYZE**，因此测的是真正发布的 SQL，而不是抄一份）→
 * 灌入合成数据 → 断言计划里既没有裸全表扫描，也没有全量排序。
 *
 * ⚠ 这些部分索引依赖 ANALYZE 统计：以 `published_at DESC` 打头的索引只有在
 * sqlite_stat1 有数据时才会被规划器选中。实测（4000 行）：
 *   有统计 → 归档列表 0.15ms、搜索 0.67ms、RSS 0.07ms
 *   无统计 → 归档列表 3.9ms、搜索 25.9ms、RSS 3.6ms（退回全量排序，索引形同不存在）
 * 因此迁移 0025 末尾必须保留 `ANALYZE`，下面的测试会守住这一点。
 *
 * 环境要求：`node:sqlite` 在 Node 24+ 默认可用，Node 22 需要 --experimental-sqlite。
 * 不可用时本测试会明确跳过，而不是静默通过。
 */
const ROOT = join(import.meta.dirname, "..", "..");
const DRIZZLE_DIR = join(ROOT, "drizzle");

/** 索引迁移文件名（含 ANALYZE 的那个）。 */
const INDEX_MIGRATION = "0025_public_query_indexes.sql";

/** 与 src/lib/public-content.ts 的 getPublicPostVisibilityCondition() 等价。 */
const VISIBILITY = `(
	blog_posts.deleted_at IS NULL
	AND (blog_posts.status = 'published' OR (blog_posts.status = 'scheduled' AND blog_posts.publish_at IS NOT NULL AND blog_posts.publish_at <= '2098-01-01T00:00:00.000Z'))
)`;

const POST_JOIN =
	"blog_posts LEFT JOIN blog_categories ON blog_posts.category_id = blog_categories.id";
const POST_COLUMNS = [
	"blog_posts.title",
	"blog_posts.slug",
	"blog_posts.content",
	"blog_posts.excerpt",
	"blog_posts.published_at",
	"blog_posts.author_name",
	"blog_posts.featured_image_key",
	"blog_posts.featured_image_alt",
].join(", ");

/** 与 src/pages、src/lib 中真实查询一一对应（列名与排序方向都不能改）。 */
const HOT_QUERIES: Array<{ name: string; source: string; sql: string }> = [
	{
		name: "归档列表",
		source: "src/pages/blog/index.astro",
		sql: `SELECT ${POST_COLUMNS} FROM ${POST_JOIN}
			WHERE ${VISIBILITY} ORDER BY blog_posts.published_at DESC LIMIT 10 OFFSET 0`,
	},
	{
		name: "归档深分页",
		source: "src/pages/blog/index.astro",
		sql: `SELECT ${POST_COLUMNS} FROM ${POST_JOIN}
			WHERE ${VISIBILITY} ORDER BY blog_posts.published_at DESC LIMIT 10 OFFSET 40`,
	},
	{
		name: "首页置顶",
		source: "src/pages/index.astro",
		sql: `SELECT ${POST_COLUMNS} FROM ${POST_JOIN}
			WHERE ${VISIBILITY} AND blog_posts.is_pinned = 1
			ORDER BY blog_posts.pinned_order ASC, blog_posts.published_at DESC, blog_posts.created_at DESC LIMIT 6`,
	},
	{
		name: "首页最新",
		source: "src/pages/index.astro",
		sql: `SELECT ${POST_COLUMNS} FROM ${POST_JOIN}
			WHERE ${VISIBILITY} AND blog_posts.is_pinned = 0
			ORDER BY blog_posts.published_at DESC, blog_posts.created_at DESC LIMIT 3`,
	},
	{
		name: "搜索关键词",
		source: "src/pages/search.astro",
		sql: `SELECT ${POST_COLUMNS} FROM ${POST_JOIN}
			WHERE ${VISIBILITY} AND (blog_posts.title LIKE '%astro%' OR blog_posts.content LIKE '%astro%' OR blog_posts.excerpt LIKE '%astro%')
			ORDER BY blog_posts.published_at DESC LIMIT 50`,
	},
	{
		name: "搜索按标签",
		source: "src/pages/search.astro",
		sql: `SELECT count(*) FROM ${POST_JOIN}
			WHERE ${VISIBILITY} AND blog_posts.id IN (
				SELECT blog_post_tags.post_id FROM blog_post_tags
				INNER JOIN blog_tags ON blog_post_tags.tag_id = blog_tags.id
				WHERE blog_tags.slug IN ('tag-3', 'tag-7')
			)`,
	},
	{
		name: "RSS",
		source: "src/pages/rss.xml.ts",
		sql: `SELECT blog_posts.slug, blog_posts.published_at FROM blog_posts
			WHERE ${VISIBILITY} ORDER BY blog_posts.published_at DESC, blog_posts.updated_at DESC LIMIT 30`,
	},
	{
		name: "Sitemap",
		source: "src/pages/sitemap.xml.ts",
		sql: `SELECT blog_posts.slug, blog_posts.updated_at FROM blog_posts
			WHERE ${VISIBILITY} ORDER BY blog_posts.updated_at DESC`,
	},
	{
		name: "说说列表",
		source: "src/pages/shuoshuo.astro",
		sql: `SELECT content, created_at FROM shuoshuo_posts
			WHERE status = 'published' ORDER BY created_at DESC LIMIT 20`,
	},
];

/** 大表：对它们做裸扫描或全量排序才是问题（blog_categories 只有几行，无所谓）。 */
const BIG_TABLES = ["blog_posts", "shuoshuo_posts", "blog_post_tags"];

type SqliteDb = {
	exec: (sql: string) => void;
	prepare: (sql: string) => {
		all: () => Array<Record<string, unknown>>;
		run: (...args: unknown[]) => unknown;
	};
};

async function loadSqlite(): Promise<null | (new (path: string) => SqliteDb)> {
	try {
		const mod = (await import("node:sqlite")) as unknown as {
			DatabaseSync: new (path: string) => SqliteDb;
		};
		return mod.DatabaseSync;
	} catch {
		return null;
	}
}

async function applyMigrations(db: SqliteDb): Promise<void> {
	const files = (await readdir(DRIZZLE_DIR)).filter((name) => name.endsWith(".sql")).sort();
	for (const file of files) {
		const sql = await readFile(join(DRIZZLE_DIR, file), "utf8");
		db.exec("BEGIN");
		try {
			db.exec(sql);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw new Error(`迁移 ${file} 执行失败：${(error as Error).message}`);
		}
	}
}

function seed(db: SqliteDb): void {
	const now = "2026-05-01T00:00:00.000Z";
	db.exec("BEGIN");

	const insertCategory = db.prepare(
		"INSERT INTO blog_categories (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
	);
	insertCategory.run(1, "技术", "tech", now, now);
	insertCategory.run(2, "随笔", "essay", now, now);

	// 4000 篇：5% 草稿、5% 定时未到、5% 已软删除，其余已发布。
	// 数据量要足够大，否则规划器可能选别的路径，测不出真实退化。
	const insertPost = db.prepare(
		`INSERT INTO blog_posts (title, slug, content, excerpt, status, publish_at, published_at, is_pinned, pinned_order, category_id, created_at, updated_at, deleted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const body = "正文内容 ".repeat(200);
	for (let i = 0; i < 4000; i++) {
		const bucket = i % 20;
		const status = bucket === 0 ? "draft" : bucket === 1 ? "scheduled" : "published";
		const publishAt =
			bucket === 1
				? "2099-01-01T00:00:00.000Z"
				: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`;
		const day = String((i % 28) + 1).padStart(2, "0");
		insertPost.run(
			`文章标题 ${i}`,
			`post-${i}`,
			body,
			`摘要 ${i} astro 相关`,
			status,
			publishAt,
			publishAt,
			i % 50 === 0 ? 1 : 0,
			i % 100,
			i % 2 === 0 ? 1 : 2,
			`2026-02-${day}T00:00:00.000Z`,
			`2026-03-${day}T00:00:00.000Z`,
			bucket === 2 ? now : null,
		);
	}

	const insertTag = db.prepare(
		"INSERT INTO blog_tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
	);
	const insertPostTag = db.prepare("INSERT INTO blog_post_tags (post_id, tag_id) VALUES (?, ?)");
	for (let t = 1; t <= 50; t++) {
		insertTag.run(t, `标签 ${t}`, `tag-${t}`, now);
	}
	for (let i = 0; i < 4000; i++) {
		insertPostTag.run(i + 1, (i % 50) + 1);
		if (i % 10 === 0) {
			insertPostTag.run(i + 1, 3);
			insertPostTag.run(i + 1, 7);
		}
	}

	const insertShuoshuo = db.prepare(
		"INSERT INTO shuoshuo_posts (content, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
	);
	for (let i = 0; i < 500; i++) {
		insertShuoshuo.run(
			`说说 ${i}`,
			i % 10 === 0 ? "draft" : "published",
			`2026-04-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
			now,
		);
	}

	db.exec("COMMIT");
}

function readPlan(db: SqliteDb, sql: string): string {
	return db
		.prepare(`EXPLAIN QUERY PLAN ${sql}`)
		.all()
		.map((row) => String(row.detail))
		.join("\n");
}

function planProblems(plan: string): string[] {
	const problems: string[] = [];
	const lines = plan.split("\n").map((line) => line.trim());

	for (const line of lines) {
		// 裸 `SCAN <大表>` = 逐行读表。`SCAN <大表> USING INDEX x` 不是问题：
		// 那是按索引顺序遍历，正是我们要的计划。
		if (BIG_TABLES.some((table) => line === `SCAN ${table}`)) {
			problems.push(`全表扫描：${line}`);
		}
	}

	if (plan.includes("USE TEMP B-TREE FOR ORDER BY")) {
		problems.push("排序全结果集（USE TEMP B-TREE FOR ORDER BY）");
	}

	return problems;
}

/** 建库 + 灌数据只做一次。 */
let cached: SqliteDb | null = null;

async function getSeededDb(DatabaseSync: new (path: string) => SqliteDb): Promise<SqliteDb> {
	if (!cached) {
		const db = new DatabaseSync(":memory:");
		await applyMigrations(db);
		seed(db);
		// 迁移里的 ANALYZE 是在**空表**上执行的（部署顺序：先迁移、后有数据），
		// 那种统计没有意义。这里在灌完数据后再 ANALYZE 一次，模拟生产库的真实
		// 状态：表里有数据、统计已生成。生产侧对应"迁移后对已有数据的库执行
		// ANALYZE"，以及大量导入内容后重跑一次。
		db.exec("ANALYZE");
		cached = db;
	}
	return cached;
}

describe("公开页面热点查询的查询计划", async () => {
	const DatabaseSync = await loadSqlite();

	if (!DatabaseSync) {
		test("node:sqlite 不可用，跳过查询计划检查", (t) => {
			t.skip("当前 Node 不支持 node:sqlite（需要 Node 24+，或 Node 22 加 --experimental-sqlite）");
		});
		return;
	}

	test("迁移序列已建立全部公开查询索引", async () => {
		const db = await getSeededDb(DatabaseSync);

		// 直接查 sqlite_master，而不是数迁移文件个数——文件数达标并不代表索引建成了
		const existing = new Set(
			(
				db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
					name: string;
				}>
			).map((row) => row.name),
		);
		const required = [
			"posts_public_rss_idx",
			"posts_public_home_idx",
			"posts_public_pinned_idx",
			"posts_public_sitemap_idx",
			"blog_post_tags_tag_idx",
			"shuoshuo_status_created_idx",
		];
		const missing = required.filter((name) => !existing.has(name));

		assert.deepEqual(
			missing,
			[],
			`以下索引不存在，${INDEX_MIGRATION} 可能没有被应用或被改名：\n${missing.join("\n")}`,
		);
	});

	test("索引迁移末尾保留 ANALYZE（否则部分索引不会被采用）", async () => {
		const source = await readFile(join(DRIZZLE_DIR, INDEX_MIGRATION), "utf8");

		assert.match(
			source,
			/^\s*ANALYZE\s*;/mu,
			`${INDEX_MIGRATION} 缺少 ANALYZE。删除它会让以 published_at DESC 打头的部分索引\n` +
				"完全不被规划器采用（实测归档列表会从 0.15ms 退回 3.9ms、搜索从 0.67ms 退回 25.9ms）。\n" +
				"相关说明见文件开头的注释。",
		);
	});

	test("热点查询全部走索引，不做全表扫描或全量排序", async () => {
		const db = await getSeededDb(DatabaseSync);

		// 迁移里包含 ANALYZE，但那是在空表上跑的；这里确认灌数据后的统计确实存在，
		// 避免"索引在、统计没了"这种静默退化被误判为通过。
		const statRows = Number(
			(
				db
					.prepare("SELECT count(*) AS c FROM sqlite_master WHERE name = 'sqlite_stat1'")
					.all()[0] as {
					c: number;
				}
			).c,
		);
		assert.equal(statRows, 1, "缺少 sqlite_stat1：统计未生成，部分索引不会被采用");

		const failures: string[] = [];
		for (const query of HOT_QUERIES) {
			const problems = planProblems(readPlan(db, query.sql));
			if (problems.length > 0) {
				failures.push(`${query.name}（${query.source}）：\n    ${problems.join("\n    ")}`);
			}
		}

		assert.deepEqual(
			failures,
			[],
			`以下查询缺少可用索引或排序无法走索引：\n\n${failures.join("\n\n")}`,
		);
	});
});
