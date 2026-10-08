// Server-rendered HTML for a single blog post — what `scripts/prerender.mjs`
// deliberately does not do (a post's content is live in Base44 and would go
// stale the moment it is baked into a build), for the crawlers that cannot
// run the JavaScript `useSeo` depends on to write the per-post head at all.
//
// `vercel.json` rewrites a bot's request for `/blog/:id` here by User-Agent;
// a human's request for the same path keeps hitting the SPA shell.
//
// `computeBlogSeoConfig` and `renderSeoHtml` are the same functions the client
// route uses (via `useSeo`), so this can never describe a post differently
// than the page a visitor who followed the link actually sees.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@base44/sdk";
import { renderSeoHtml, SITE_URL } from "../../../src/lib/seo";
import { BLOG_POST_NOT_FOUND_SEO, computeBlogSeoConfig } from "../../../src/lib/blogSeo";
import type { Article } from "../../../src/services/ports";

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

interface EntityReader {
  entities: { BlogPost: { get(id: string): Promise<unknown> } };
}

const APP_ID = process.env.VITE_BASE44_APP_ID;
// Not `SITE_URL` directly: that reads `import.meta.env.VITE_SITE_URL`, which a
// visitor may point at a custom domain the Base44 backend itself knows nothing
// about. This is the backend's own origin — the same one `vite preview`'s
// local proxy uses (`scripts/vite-base44-backend-plugin.mjs`) — and it falls
// back to the same production host `SITE_URL` does when unset.
const BASE44_ORIGIN = (process.env.VITE_BASE44_APP_BASE_URL || SITE_URL).replace(/\/+$/, "");

const client: EntityReader | null = APP_ID
  ? (createClient({ appId: APP_ID, serverUrl: BASE44_ORIGIN }) as unknown as EntityReader)
  : null;

let shellHtml: string | null = null;

/** The untouched SPA shell `scripts/prerender.mjs` writes alongside the
 *  prerendered static routes — bundled into this function via `vercel.json`'s
 *  `functions.includeFiles`, read once per cold start. */
function loadShell(): string {
  if (shellHtml === null) {
    shellHtml = readFileSync(join(process.cwd(), "dist/app.html"), "utf8");
  }
  return shellHtml;
}

export default async function handler(req: OgRequest, res: OgResponse): Promise<void> {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!id || !client) {
    if (!client) console.error("[api/og/blog] VITE_BASE44_APP_ID is not set");
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send(renderSeoHtml(loadShell(), BLOG_POST_NOT_FOUND_SEO));
    return;
  }

  try {
    const post = (await client.entities.BlogPost.get(id)) as Article;
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).send(renderSeoHtml(loadShell(), computeBlogSeoConfig(post)));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) console.error("[api/og/blog] failed to load post", id, err);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    res.setHeader("X-Robots-Tag", "noindex");
    res.status(status === 404 ? 404 : 502).send(renderSeoHtml(loadShell(), BLOG_POST_NOT_FOUND_SEO));
  }
}
