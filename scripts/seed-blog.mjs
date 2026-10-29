#!/usr/bin/env node
/**
 * Publishes the Markdown articles in `content/blog/` into Supabase's `blog_posts`.
 *
 * The articles live in the repo rather than only in the database so they are
 * reviewable: a post by a licensed agency carries a mandatory disclosure, and a
 * disclosure that exists only inside a database row is one nobody reviews.
 *
 *   node --env-file=.env.local scripts/seed-blog.mjs                 # dry run — prints what it would write
 *   node --env-file=.env.local scripts/seed-blog.mjs --apply         # writes
 *
 * Supabase is the only store: the site, /admin/blog and the blog recommender
 * all read and write `blog_posts`. `blog_posts` accepts
 * writes only from an admin or the service role, so this needs:
 *
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      (e.g. in .env.local)
 *
 * The dry run reads the table too, when the two are set, so it shows which
 * articles would be created and which updated before anything is written.
 *
 * `--only a.md,b.md` takes just those articles (the `.md` may be left out). A
 * new article goes up without re-writing every other one: a re-run updates
 * each existing post from its file, which would put back over an edit made in
 * /admin/blog. A name with no file is refused, so a typo seeds nothing.
 *
 * Posts are matched by slug — the file name — and then by title, so a post
 * whose title was edited in /admin/blog is still the same post and not a
 * second one. An existing post is updated, a new one created. New posts are
 * drafts — publishing is דורית's call, from /admin/blog — and a re-run never
 * touches `published` on a post that already exists, so correcting an article
 * cannot take down one she has published. Nor does it touch the slug of an
 * existing post: a post found by its title keeps the address it has.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSlug } from "./published-articles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = join(ROOT, "content/blog");
const apply = process.argv.includes("--apply");

/** `--only <list>` or `--only=<list>`, if given. */
function onlyFromArgv(argv) {
  const eq = argv.find((a) => a.startsWith("--only="));
  if (eq) return eq.slice("--only=".length);
  const at = argv.indexOf("--only");
  return at >= 0 ? (argv[at + 1] ?? "") : undefined;
}

/**
 * The articles `--only` names — all of them without it. Throws on a name no
 * article file has, and on an empty list, so a mistake seeds nothing.
 */
export function selectArticles(articles, only) {
  if (only === undefined) return articles;
  const names = only
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.endsWith(".md") ? n : `${n}.md`));
  if (names.length === 0) throw new Error("--only: no article named");
  const missing = names.filter((n) => !articles.some((a) => a.file === n));
  if (missing.length) throw new Error(`--only: no such article in content/blog: ${missing.join(", ")}`);
  return articles.filter((a) => names.includes(a.file));
}

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
    action_time: meta.action_time ?? "",
    image_url: meta.image_url ?? "",
    cta_headline: meta.cta_headline ?? "",
    og_image: meta.og_image ?? "",
    published: meta.published === "true",
    body: m[2].trim(),
  };
}

export { parseArticle };

/**
 * The article's address, `/blog/<slug>`: its file name. A file name that
 * could not be an address is refused before anything is written.
 */
export function slugFromFile(file) {
  const slug = file.replace(/\.md$/, "");
  if (!isValidSlug(slug)) {
    throw new Error(`${file}: the file name is the article's address (/blog/<name>) and must be Latin kebab-case`);
  }
  return slug;
}

/** The columns an article's file sets on every write. */
const FIELDS = ["title", "excerpt", "body", "tags", "action_time", "image_url"];

/**
 * What to do with each article, given the posts `blog_posts` already holds
 * (`id`, `slug`, `title`, `published`).
 *
 * Pure, so a re-run's dangerous cases — unpublishing a live post, adding a
 * second copy of one — are testable without a database. The slug is the
 * file name and unique, so it decides first; the title catches a post whose
 * slug was changed in /admin/blog.
 */
export function planSeed(articles, existing) {
  return articles.map((a) => {
    const match = existing.find((p) => p.slug === a.slug) ?? existing.find((p) => p.title === a.title);
    if (!match) return { op: "create", article: a };
    return { op: "update", id: match.id, slug: match.slug, article: a, published: Boolean(match.published) };
  });
}

/**
 * The `blog_posts` columns a step writes.
 *
 * A create carries the slug and the file's `published` (a draft, for every
 * repo article). An update carries neither, so the post keeps its address and
 * the state Dorit gave it.
 */
export function rowFor(step) {
  const { article } = step;
  const row = {
    ...Object.fromEntries(FIELDS.map((f) => [f, article[f]])),
    // null, not "": the columns refuse an empty string (20261020000000_blog_cta_og.sql).
    cta_headline: article.cta_headline || null,
    og_image: article.og_image || null,
  };
  if (step.op === "create") Object.assign(row, { slug: article.slug, published: article.published });
  return row;
}

function loadArticles() {
  const articles = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ file: f, slug: slugFromFile(f), ...parseArticle(readFileSync(join(CONTENT_DIR, f), "utf8")) }));

  for (const a of articles) {
    if (!a.title || !a.body) throw new Error(`${a.file}: BlogPost requires title and body`);
    // The disclosure is the reason these live in the repo. Refuse to ship without it.
    if (!a.body.includes("גילוי נאות")) {
      throw new Error(`${a.file}: article carries no גילוי נאות block — refusing to publish`);
    }
  }
  return articles;
}

/** A PostgREST call as the service role; throws on any non-2xx. */
async function rest(url, key, path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function existingPosts(url, key) {
  const res = await rest(url, key, "blog_posts?select=id,slug,title,published&limit=1000");
  return res.json();
}

async function writeStep(url, key, step) {
  const body = JSON.stringify(rowFor(step));
  if (step.op === "update") {
    await rest(url, key, `blog_posts?id=eq.${encodeURIComponent(step.id)}`, { method: "PATCH", body });
  } else {
    await rest(url, key, "blog_posts", { method: "POST", body });
  }
}

async function main() {
  const articles = selectArticles(loadArticles(), onlyFromArgv(process.argv));
  const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");

  // Without the env a dry run still lists the files; it just cannot say
  // which of them are new.
  const steps = url && key ? planSeed(articles, await existingPosts(url, key)) : null;

  console.log(`נמצאו ${articles.length} מאמרים ב-content/blog:\n`);
  for (const [i, a] of articles.entries()) {
    const step = steps?.[i];
    const what = !step ? "" : step.op === "create" ? " · ייווצר כטיוטה" : ` · יעודכן (/blog/${step.slug})`;
    console.log(`  • ${a.title}`);
    console.log(`    קובץ: ${a.file} · תגיות: ${a.tags}${what}`);
    console.log(`    ${a.body.length} תווים\n`);
  }

  if (!apply) {
    console.log("הרצה יבשה. להעלאה בפועל: node --env-file=.env.local scripts/seed-blog.mjs --apply --only <קובץ>.md");
    return;
  }
  if (!steps) {
    console.error("חסרים משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  let failed = 0;
  for (const step of steps) {
    const { title } = step.article;
    try {
      await writeStep(url, key, step);
      console.log(`${step.op === "update" ? "עודכן" : "נוצר כטיוטה"}: ${title}`);
    } catch (e) {
      // Not fatal for the rest: each post is its own write, and the exit code
      // says a re-run is needed.
      failed++;
      console.error(`נכשל: ${title}: ${e.message}`);
    }
  }

  console.log("\nמאמרים חדשים נשמרו כטיוטה. לפרסום — /admin/blog באתר.");
  if (failed) {
    console.error(`${failed} מאמרים לא נשמרו — יש להריץ שוב.`);
    process.exitCode = 1;
  }
}

// Importable for tests; only seeds when run directly.
if (import.meta.url === `file://${process.argv[1]}`) await main();
