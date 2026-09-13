#!/usr/bin/env node
/**
 * Publishes the Markdown articles in `content/blog/` into the BlogPost entity.
 *
 * The articles live in the repo rather than only in the Builder so they are
 * reviewable: a post by a licensed agency carries a mandatory disclosure, and a
 * disclosure that exists only inside a database row is one nobody reviews.
 *
 *   node scripts/seed-blog.mjs                 # dry run — prints what it would write
 *   node scripts/seed-blog.mjs --apply         # writes, needs the env below
 *
 * Writing requires an admin sign-in, because BlogPost.create is admin-only by
 * RLS (see base44/entities/BlogPost.jsonc):
 *
 *   BASE44_APP_ID, BASE44_ADMIN_EMAIL, BASE44_ADMIN_PASSWORD
 *
 * Posts are matched by title: an existing post is updated, a new one created.
 * `published` stays false — publishing is דורית's call, from /admin/blog.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = join(ROOT, "content/blog");
const apply = process.argv.includes("--apply");

/** Minimal front-matter reader — `key: "value"` pairs, one per line. */
function parseArticle(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("article is missing a front-matter block");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return {
    title: meta.title,
    excerpt: meta.excerpt ?? "",
    tags: meta.tags ?? "",
    image_url: meta.image_url ?? "",
    published: meta.published === "true",
    body: m[2].trim(),
  };
}

const articles = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ file: f, ...parseArticle(readFileSync(join(CONTENT_DIR, f), "utf8")) }));

for (const a of articles) {
  if (!a.title || !a.body) throw new Error(`${a.file}: BlogPost requires title and body`);
  // The disclosure is the reason these live in the repo. Refuse to ship without it.
  if (!a.body.includes("גילוי נאות")) {
    throw new Error(`${a.file}: article carries no גילוי נאות block — refusing to publish`);
  }
}

console.log(`נמצאו ${articles.length} מאמרים ב-content/blog:\n`);
for (const a of articles) {
  console.log(`  • ${a.title}`);
  console.log(`    קובץ: ${a.file} · תגיות: ${a.tags} · פרסום: ${a.published ? "כן" : "טיוטה"}`);
  console.log(`    ${a.body.length} תווים\n`);
}

if (!apply) {
  console.log("הרצה יבשה. להעלאה בפועל: node scripts/seed-blog.mjs --apply");
  console.log("לחלופין — אפשר להעתיק את גוף המאמר ישירות למסך /admin/blog באתר.");
  process.exit(0);
}

const { BASE44_APP_ID, BASE44_ADMIN_EMAIL, BASE44_ADMIN_PASSWORD } = process.env;
if (!BASE44_APP_ID || !BASE44_ADMIN_EMAIL || !BASE44_ADMIN_PASSWORD) {
  console.error(
    "חסרים משתני סביבה: BASE44_APP_ID, BASE44_ADMIN_EMAIL, BASE44_ADMIN_PASSWORD.\n" +
      "יצירת BlogPost מותרת למנהלים בלבד (RLS), ולכן נדרשת התחברות."
  );
  process.exit(1);
}

const { createClient } = await import("@base44/sdk");
const base44 = createClient({ appId: BASE44_APP_ID });
await base44.auth.loginViaEmailPassword(BASE44_ADMIN_EMAIL, BASE44_ADMIN_PASSWORD);

const existing = await base44.entities.BlogPost.list("-created_date", 200);
for (const a of articles) {
  const payload = {
    title: a.title,
    excerpt: a.excerpt,
    body: a.body,
    tags: a.tags,
    image_url: a.image_url,
    published: a.published,
  };
  const match = existing.find((p) => p.title === a.title);
  if (match) {
    await base44.entities.BlogPost.update(match.id, payload);
    console.log(`עודכן: ${a.title} (${match.id})`);
  } else {
    const created = await base44.entities.BlogPost.create(payload);
    console.log(`נוצר: ${a.title} (${created.id})`);
  }
}
console.log("\nהמאמרים נשמרו כטיוטה. לפרסום — /admin/blog באתר.");
