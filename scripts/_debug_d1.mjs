import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const t = join(tmpdir(), "debug.sql");
writeFileSync(t, "SELECT id, title, slug, status, publish_at, published_at FROM blog_posts LIMIT 1", "utf8");
try {
  const r = execSync('npx.cmd wrangler d1 execute DB --remote --file="' + t + '" --json', { encoding: "utf8" });
  const start = r.indexOf("[");
  const end = r.lastIndexOf("]");
  const jsonStr = r.slice(start, end + 1);
  const j = JSON.parse(jsonStr);
  const row = j[0]?.results?.[0];
  console.log("Keys:", Object.keys(row || {}).join(", "));
  console.log("Row:", JSON.stringify(row));
} finally {
  try { unlinkSync(t); } catch {}
}
