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
 * Each article is written to both stores, as `contentAdmin` does for edits
 * made from /admin/blog: Base44 first, because the site and the blog
 * recommender still read it, then a copy in Supabase's `blog_posts` keyed on
 * `base44_id`, so the two are one row and not two unrelated ones. Supabase
 * alone would hold articles nobody can see until the migration flips reads.
 *
 * BlogPost.create is admin-only by RLS (see base44/entities/BlogPost.jsonc), so
 * Base44 is written through `base44 exec --privileged`, as whoever the CLI is
 * signed in as — the app owner, on the machine this runs from. No admin
 * password is kept anywhere. `blog_posts` accepts writes only from an admin or
 * the service role, so Supabase needs the service-role key:
 *
 *   base44 login                                 (once, as the app owner)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      (e.g. in .env.local)
 *
 *   node --env-file=.env.local scripts/seed-blog.mjs --apply
 *
 * Posts are matched by title: an existing post is updated, a new one created.
 * New posts are drafts — publishing is דורית's call, from /admin/blog — and a
 * re-run never touches `published` on a post that already exists, so
 * correcting an article cannot take down one she has published.
 */
import { execFileSync } from "node:child_process";
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

export { parseArticle };

/** Fields both stores hold for a post, in the shape both accept. */
const FIELDS = ["title", "excerpt", "body", "tags", "image_url", "published"];

/**
 * What to do with each article, given what Base44 already holds.
 *
 * Pure, so a re-run's one dangerous case — unpublishing a live post — is
 * testable without a database. `published` is the state the post will have in
 * Base44 afterwards; the mirror copies it so the stores agree.
 */
export function planSeed(articles, existing) {
  return articles.map((a) => {
    const payload = Object.fromEntries(FIELDS.map((f) => [f, a[f]]));
    const match = existing.find((p) => p.title === a.title);
    if (!match) return { op: "create", article: a, payload, published: a.published };
    delete payload.published;
    return { op: "update", id: match.id, article: a, payload, published: Boolean(match.published) };
  });
}

/** The Supabase row for a step, once Base44 has given it an id. */
export function mirrorRow(step, base44Id) {
  return { ...step.payload, published: step.published, base44_id: base44Id };
}

function loadArticles() {
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
  return articles;
}

/** Precedes the one line of JSON an exec script prints, among the CLI's own output. */
const RESULT = "@@seed-blog@@";

/**
 * The JSON an exec script printed, out of everything else on stdout.
 *
 * `base44 exec` shares stdout with npm's notices and its own update banner, so
 * the result is marked rather than assumed to be the whole stream.
 */
export function readExecResult(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith(RESULT));
  if (!line) throw new Error("base44 exec printed no result — is the CLI signed in? (`base44 login`)");
  return JSON.parse(line.slice(RESULT.length));
}

/**
 * Run a script against production data as the CLI's signed-in user.
 *
 * `--data-env prod` is explicit: the site and the blog recommender read the
 * published app's data, and a default that changed under us would seed a
 * store nobody reads.
 */
function base44Exec(code) {
  const stdout = execFileSync("npx", ["base44", "exec", "--privileged", "--data-env", "prod"], {
    input: code,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  return readExecResult(stdout);
}

async function upsertSupabase(url, key, row) {
  const res = await fetch(`${url}/rest/v1/blog_posts?on_conflict=base44_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const articles = loadArticles();

  console.log(`נמצאו ${articles.length} מאמרים ב-content/blog:\n`);
  for (const a of articles) {
    console.log(`  • ${a.title}`);
    console.log(`    קובץ: ${a.file} · תגיות: ${a.tags} · פרסום: ${a.published ? "כן" : "טיוטה"}`);
    console.log(`    ${a.body.length} תווים\n`);
  }

  if (!apply) {
    console.log("הרצה יבשה. להעלאה בפועל: node --env-file=.env.local scripts/seed-blog.mjs --apply");
    console.log("לחלופין — אפשר להעתיק את גוף המאמר ישירות למסך /admin/blog באתר.");
    return;
  }

  const { SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Both stores or neither. Writing only Base44 is how they drift apart, and
    // writing only Supabase hides the article from the site and the agent.
    console.error("חסרים משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const existing = base44Exec(
    `const rows = await base44.entities.BlogPost.list("-created_date", 200);
     console.log(${JSON.stringify(RESULT)} + JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title, published: r.published }))));`
  );
  const steps = planSeed(articles, existing);

  // One exec for every write: each call starts the CLI afresh, and the ids
  // come back in step order for the mirror below.
  const ids = base44Exec(
    `const steps = ${JSON.stringify(steps.map(({ op, id, payload }) => ({ op, id, payload })))};
     const ids = [];
     for (const s of steps) {
       if (s.op === "update") { await base44.entities.BlogPost.update(s.id, s.payload); ids.push(s.id); }
       else ids.push((await base44.entities.BlogPost.create(s.payload)).id);
     }
     console.log(${JSON.stringify(RESULT)} + JSON.stringify(ids));`
  );

  let failed = 0;
  for (const [i, step] of steps.entries()) {
    const { title } = step.article;
    const id = ids[i];
    console.log(`Base44 — ${step.op === "update" ? "עודכן" : "נוצר"}: ${title} (${id})`);
    try {
      await upsertSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, mirrorRow(step, id));
      console.log(`Supabase — נשמר: ${title}`);
    } catch (e) {
      // Not fatal for the rest: Base44 is authoritative and holds the post. A
      // re-run repairs the copy, and the exit code says one is needed.
      failed++;
      console.error(`Supabase — נכשל: ${title}: ${e.message}`);
    }
  }

  console.log("\nמאמרים חדשים נשמרו כטיוטה. לפרסום — /admin/blog באתר.");
  if (failed) {
    console.error(`${failed} מאמרים לא הגיעו ל-Supabase — יש להריץ שוב.`);
    process.exitCode = 1;
  }
}

// Importable for tests; only seeds when run directly.
if (import.meta.url === `file://${process.argv[1]}`) await main();
