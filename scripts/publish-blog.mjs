#!/usr/bin/env node
/**
 * Publishes specific BlogPost drafts by exact title — never "every current
 * draft" — the same two-store write `contentAdmin` makes from /admin/blog,
 * run from the CLI (or GitHub Actions) instead of a click in the browser.
 *
 *   TITLES=$'כותרת ראשונה\nכותרת שנייה' node scripts/publish-blog.mjs
 *   TITLES=$'כותרת ראשונה\nכותרת שנייה' node --env-file=.env.local scripts/publish-blog.mjs --apply
 *
 * `TITLES` is newline-separated so a GitHub Actions multiline input maps onto
 * it directly. Dry run by default, same convention as seed-blog.mjs and
 * prune-vercel.mjs: it reports what each title resolves to and changes
 * nothing until `--apply` is given.
 *
 * Needs `base44 login` (once, as the app owner) and, for `--apply`,
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — the same two stores seed-blog.mjs
 * writes, kept in sync for the same reason: a post nobody can see on the site
 * is worse than one not yet marked published.
 */
import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");

/**
 * What each requested title resolves to, against what Base44 already holds.
 *
 * Pure, so the three outcomes — found and draft, found and already
 * published, not found at all — are testable without a database. A title
 * that matches nothing is reported, never silently skipped: a typo in the
 * input must not look like a successful run that published nothing.
 */
export function planPublish(titles, existing) {
  return titles.map((title) => {
    const match = existing.find((p) => p.title === title);
    if (!match) return { title, found: false };
    return { title, found: true, id: match.id, alreadyPublished: Boolean(match.published) };
  });
}

/** Precedes the one line of JSON an exec script prints, among the CLI's own output. */
const RESULT = "@@publish-blog@@";

/** The JSON an exec script printed, out of everything else on stdout. */
export function readExecResult(stdout) {
  const line = stdout.split("\n").find((l) => l.startsWith(RESULT));
  if (!line) throw new Error("base44 exec printed no result — is the CLI signed in? (`base44 login`)");
  return JSON.parse(line.slice(RESULT.length));
}

/** Run a script against production data as the CLI's signed-in user. */
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

function loadTitles() {
  const raw = process.env.TITLES ?? "";
  const titles = raw.split("\n").map((t) => t.trim()).filter(Boolean);
  if (!titles.length) throw new Error("TITLES is empty — nothing to publish. Set it to a newline-separated list of exact article titles.");
  return titles;
}

async function main() {
  const titles = loadTitles();

  const existing = base44Exec(
    `const rows = await base44.entities.BlogPost.list("-created_date", 200);
     console.log(${JSON.stringify(RESULT)} + JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title, published: r.published }))));`
  );
  const steps = planPublish(titles, existing);

  console.log(`${steps.length} כותרת/ות התבקשו:\n`);
  for (const s of steps) {
    if (!s.found) console.log(`  ✗ לא נמצא: ${s.title}`);
    else if (s.alreadyPublished) console.log(`  = כבר פורסם: ${s.title} (${s.id})`);
    else console.log(`  → טיוטה, יפורסם: ${s.title} (${s.id})`);
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

  const { SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("חסרים משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const ids = toPublish.map((s) => s.id);
  base44Exec(
    `const ids = ${JSON.stringify(ids)};
     for (const id of ids) { await base44.entities.BlogPost.update(id, { published: true }); }
     console.log(${JSON.stringify(RESULT)} + "ok");`
  );

  let failed = 0;
  for (const s of toPublish) {
    try {
      await upsertSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { base44_id: s.id, published: true });
      console.log(`פורסם: ${s.title}`);
    } catch (e) {
      failed++;
      console.error(`Base44 פורסם, Supabase נכשל — ${s.title}: ${e.message}`);
    }
  }

  if (notFound.length || failed) process.exitCode = 1;
}

// Importable for tests; only runs when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) await main();
