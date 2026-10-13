// Server-side answers for an article address that has no prebuilt page.
//
// Two kinds of request arrive here, both by `vercel.json` rewrite:
//
//   - `/blog/<24 hex>` — a Base44 id, the form every article link had before
//     slugs: bookmarks, search results, the agents' answers. From anyone, bot
//     or person. Answered with a 301 to `/blog/<slug>`, so the address shared
//     and indexed from now on is the readable one.
//   - `/blog/<slug>` from a crawler, for an article published since the last
//     build. Prebuilt articles are files (scripts/prerender.mjs), and Vercel
//     serves a file before any rewrite, so only the not-yet-built ones get
//     here. Answered with the SPA shell and the article's own <head>.
//
// Anything else — no such article, or a draft — is a 404 with noindex.
//
// The article is read from Supabase with the publishable key: the same
// anonymous read the site makes, so row-level security returns published rows
// only. And the same resolution (`SupabaseContentService.getArticle`: slug,
// then Base44 id, then uuid) the page itself uses, so the two never disagree.
//
// The key arrives as `?id=`, not as a `[id]` path segment: Vercel matches a
// dynamic function path only after vercel.json's rewrites, and its `/api/*`
// and `/(.*)` catch-alls took every such request first — the function
// deployed and was never once reached. A fixed path is a file on disk, which
// is checked before any rewrite.
//
// Relative imports carry `.js` because `"type": "module"` makes @vercel/node
// compile this as Node ESM, which resolves no extensionless path.
//
// `computeBlogSeoConfig` and `renderSeoHtml` are the same functions the client
// route uses (via `useSeo`), so this can never describe a post differently
// than the page a visitor who followed the link actually sees.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderSeoHtml } from "../../src/lib/seo.js";
import { BLOG_POST_NOT_FOUND_SEO, computeBlogSeoConfig } from "../../src/lib/blogSeo.js";
import { articlePath } from "../../src/lib/articlePath.js";
import { RestTableClient } from "../../src/services/supabase/RestTableClient.js";
import { SupabaseContentService } from "../../src/services/supabase/SupabaseContentService.js";

/** The request/response surface this handler needs — Vercel's Node runtime
 *  supplies both regardless of which `@vercel/node` types are installed. */
interface OgRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
}
interface OgResponse {
  status(code: number): OgResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_KEY = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

const content: SupabaseContentService | null =
  SUPABASE_URL && SUPABASE_KEY
    ? new SupabaseContentService(new RestTableClient(SUPABASE_URL, SUPABASE_KEY))
    : null;

// The shell is our own build output, bundled with this function
// (`vercel.json` -> `functions["api/og/blog.ts"].includeFiles`) and read from
// disk. It is never fetched: a self-fetch of the deployment URL hits Vercel's
// deployment protection (a redirect to SSO, so every shell-needing path
// answered 500), and fetching an origin named by the request's Host header
// would let a visitor point the outbound request, and the shell cached for
// every later request on this warm instance, at a server they control.
const SHELL_PATH = join(process.cwd(), "dist", "app.html");

let shellHtml: string | null = null;
let shellFailureLogged = false;

/**
 * The untouched SPA shell `scripts/prerender.mjs` writes as `dist/app.html`
 * beside the prerendered routes. Read once and kept in module scope. `null`
 * when it cannot be read (logged once): callers answer their status with a
 * minimal body instead of crashing.
 */
async function loadShell(): Promise<string | null> {
  if (shellHtml !== null) return shellHtml;
  try {
    shellHtml = await readFile(SHELL_PATH, "utf8");
    return shellHtml;
  } catch (err) {
    if (!shellFailureLogged) {
      shellFailureLogged = true;
      console.error("[api/og/blog] cannot read the app shell", SHELL_PATH, err);
    }
    return null;
  }
}

const MINIMAL_BODY = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>המאמר לא נמצא</title></head><body></body></html>`;

/** An error page: the not-found head on the shell, or a bare noindex page without it. */
function errorPage(shell: string | null): string {
  return shell === null ? MINIMAL_BODY : renderSeoHtml(shell, BLOG_POST_NOT_FOUND_SEO);
}

/**
 * The visitor's own query string (utm_* tags and the like), without the `id`
 * the rewrite added. Vercel passes the original query through a rewrite, so a
 * link shared as `/blog/<id>?utm_source=whatsapp` keeps its attribution.
 */
function forwardedQuery(query: OgRequest["query"]): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (name === "id" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default async function handler(req: OgRequest, res: OgResponse): Promise<void> {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const key = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!key || !content) {
    if (!content) console.error("[api/og/blog] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    res.status(500).send(errorPage(await loadShell()));
    return;
  }

  try {
    const post = await content.getArticle(key);
    // Row-level security already hides drafts from this anonymous read. The
    // check stays so a change there cannot turn a draft into a public page,
    // or leak its slug through a redirect.
    if (post.published !== true) throw Object.assign(new Error("not published"), { status: 404 });

    if (post.slug && post.slug !== key) {
      res.setHeader("Location", `${articlePath(post)}${forwardedQuery(req.query)}`);
      // A day, not forever: a 301 with no lifetime is kept by browsers
      // indefinitely, and a slug can still be renamed from /admin/blog.
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
      res.status(301).send("");
      return;
    }

    const shell = await loadShell();
    if (shell === null) throw new Error("app shell unavailable");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).send(renderSeoHtml(shell, computeBlogSeoConfig(post)));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) console.error("[api/og/blog] failed to load post", key, err);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    res.setHeader("X-Robots-Tag", "noindex");
    res.status(status === 404 ? 404 : 502).send(errorPage(await loadShell()));
  }
}
