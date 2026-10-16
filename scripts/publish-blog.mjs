#!/usr/bin/env node
/**
 * Publishes specific blog drafts by exact title — never "every current
 * draft" — the same write the eye button makes in /admin/blog, run from the
 * CLI (or GitHub Actions) instead of a click in the browser.
 *
 *   TITLES=$'כותרת ראשונה\nכותרת שנייה' node --env-file=.env.local scripts/publish-blog.mjs
 *   TITLES=$'כותרת ראשונה\nכותרת שנייה' node --env-file=.env.local scripts/publish-blog.mjs --apply
 *
 * `TITLES` is newline-separated so a GitHub Actions multiline input maps onto
 * it directly. Dry run by default, same convention as seed-blog.mjs and
 * prune-vercel.mjs: it reports what each title resolves to and changes
 * nothing until `--apply` is given.
 *
 * Supabase's `blog_posts` is the only store — the site and /admin/blog
 * (VITE_CONTENT_WRITES=supabase) read and write it, and Base44's BlogPost is
 * no longer written. Both the preview and `--apply` need SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY: `blog_posts` holds drafts only an admin or the
 * service role can see.
 */

const apply = process.argv.includes("--apply");

/**
 * What each requested title resolves to, against the posts `blog_posts` holds.
 *
 * Pure, so the outcomes — found and draft, found and already published, not
 * found, and found more than once — are testable without a database. A title
 * that matches nothing is reported, never silently skipped: a typo in the
 * input must not look like a successful run that published nothing. Titles
 * are not unique in the table, and a title two posts share is refused rather
 * than publishing whichever comes first.
 */
export function planPublish(titles, existing) {
  return titles.map((title) => {
    const matches = existing.filter((p) => p.title === title);
    if (matches.length === 0) return { title, found: false };
    if (matches.length > 1) return { title, found: false, ambiguous: matches.map((p) => p.slug) };
    const [match] = matches;
    return { title, found: true, id: match.id, slug: match.slug, alreadyPublished: Boolean(match.published) };
  });
}

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

/** Every post's id, slug, title and state — drafts included, which needs the service role. */
export async function listPosts(url, key, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/rest/v1/blog_posts?select=id,slug,title,published&limit=1000`, {
    headers: headers(key),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("blog_posts answered with something that is not a list");
  return rows;
}

/**
 * Publish one post in place.
 *
 * A PATCH by id that changes `published` and nothing else, and never creates a
 * row. An empty answer means no row had this id — reported as a failure,
 * never counted as published.
 */
export async function publishInSupabase(url, key, id, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/rest/v1/blog_posts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(key, { Prefer: "return=representation" }),
    body: JSON.stringify({ published: true }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no blog_posts row has this id");
}

function loadTitles() {
  const raw = process.env.TITLES ?? "";
  const titles = raw.split("\n").map((t) => t.trim()).filter(Boolean);
  if (!titles.length) throw new Error("TITLES is empty — nothing to publish. Set it to a newline-separated list of exact article titles.");
  return titles;
}

async function main() {
  const titles = loadTitles();

  const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!url || !key) {
    console.error("חסרים משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const steps = planPublish(titles, await listPosts(url, key));

  console.log(`${steps.length} כותרת/ות התבקשו:\n`);
  for (const s of steps) {
    if (s.ambiguous) console.log(`  ✗ כמה מאמרים בכותרת הזו (${s.ambiguous.join(", ")}): ${s.title}`);
    else if (!s.found) console.log(`  ✗ לא נמצא: ${s.title}`);
    else if (s.alreadyPublished) console.log(`  = כבר פורסם: ${s.title} (/blog/${s.slug})`);
    else console.log(`  → טיוטה, יפורסם: ${s.title} (/blog/${s.slug})`);
  }

  const notFound = steps.filter((s) => !s.found);
  const toPublish = steps.filter((s) => s.found && !s.alreadyPublished);

  if (!apply) {
    console.log("\nהרצה יבשה. לפרסום בפועל: node --env-file=.env.local scripts/publish-blog.mjs --apply");
    if (notFound.length) process.exitCode = 1;
    return;
  }

  if (!toPublish.length) {
    console.log("\nאין מה לפרסם.");
    if (notFound.length) process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const s of toPublish) {
    try {
      await publishInSupabase(url, key, s.id);
      console.log(`פורסם: ${s.title}`);
    } catch (e) {
      failed++;
      console.error(`נכשל — ${s.title}: ${e.message}`);
    }
  }

  if (notFound.length || failed) process.exitCode = 1;
}

// Importable for tests; only runs when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) await main();
