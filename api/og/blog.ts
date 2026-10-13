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

import { renderSeoHtml, SITE_URL } from "../../src/lib/seo.js";
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

// `VERCEL_URL` — the platform-assigned hostname of *this* deployment, never a
// client-supplied value — not `req.headers.host`: a request can carry any
// Host header it likes, and fetching whatever that names would let a visitor
// point this function's outbound request (and the shell it then caches for
// every later request on this warm instance) at a server they control.
const SELF_ORIGIN = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE_URL;

let shellHtml: string | null = null;

/**
 * The untouched SPA shell `scripts/prerender.mjs` writes alongside the
 * prerendered routes — the same file every unrecognised path already falls
 * back to via `vercel.json`'s catch-all rewrite. Fetched from this
 * deployment's own origin rather than bundled in: bundling it required
 * `vercel.json`'s `functions.includeFiles`, which points at a path
 * (`dist/app.html`) that does not survive from `vercel build` into
 * `vercel deploy --prebuilt` — the deploy step tried to `readlink` it and
 * failed with ENOENT. A same-origin fetch has no such handoff to get wrong:
 * if `/app` were missing, every other route on the site would already be
 * broken too. The address is `/app`, not `/app.html`: `cleanUrls` answers the
 * literal `.html` with a 308, and `redirect: "error"` would throw on it.
 */
async function loadShell(): Promise<string> {
  if (shellHtml !== null) return shellHtml;
  const res = await fetch(`${SELF_ORIGIN}/app`, { redirect: "error" });
  if (!res.ok) throw new Error(`fetching /app: ${res.status}`);
  shellHtml = await res.text();
  return shellHtml;
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
    res.status(500).send(renderSeoHtml(await loadShell(), BLOG_POST_NOT_FOUND_SEO));
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
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).send(renderSeoHtml(shell, computeBlogSeoConfig(post)));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) console.error("[api/og/blog] failed to load post", key, err);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    res.setHeader("X-Robots-Tag", "noindex");
    res.status(status === 404 ? 404 : 502).send(renderSeoHtml(await loadShell(), BLOG_POST_NOT_FOUND_SEO));
  }
}
