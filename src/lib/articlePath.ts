// Where an article lives, and what may name it.
//
// Every link to an article is built by `articlePath`: the blog's cards and
// featured row, the blog's JSON-LD, the post's own canonical (blogSeo.ts), the
// admin form's preview and the server's redirect for old links
// (api/og/blog.ts). One builder, so no two of them can disagree about an
// article's address. tests/contract/article-slug.contract.test.ts fails on an
// article link built by hand anywhere in src/ or api/.
//
// Compiled under api/tsconfig.json (nodenext) as well as the app's, through
// blogSeo.ts and api/og/blog.ts, so relative imports carry `.js`.
//
// The slug rule is spelled in four places that cannot import one another:
// here, the CHECK in supabase/migrations/20261014000000_blog_slug.sql,
// base44/functions/contentAdmin/entry.ts and scripts/published-articles.mjs.
// The same contract test fails when they drift.

import type { Article } from "../services/ports.js";

/** Latin kebab-case: lowercase letters and digits, one hyphen between words. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A Base44 record id. `/blog/<one of these>` is an address from before slugs. */
export const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/;

/** A Supabase row id. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the admin form says about a slug it cannot use. */
export const SLUG_PROBLEMS = {
  missing: "חסרה כתובת למאמר.",
  format:
    "הכתובת יכולה לכלול רק אותיות לטיניות קטנות (a–z), ספרות ומקף בודד בין מילים — בלי רווחים, בלי עברית ובלי מקף בהתחלה או בסוף.",
  base44Id: "כתובת של 24 תווים מ-0–9 ו-a–f שמורה לקישורים הישנים של האתר. בחרו כתובת אחרת.",
} as const;

/** A slug another article already has. The form checks its own list; contentAdmin answers 409 with the same words. */
export const SLUG_TAKEN = "הכתובת כבר בשימוש במאמר אחר.";

/**
 * Why `slug` cannot be an article's address, or null when it can.
 *
 * A slug shaped like a Base44 id is refused even though it is kebab-case:
 * vercel.json sends every `/blog/<24 hex>` to the redirect for old links, so an
 * article with that address could never be reached.
 */
export function slugProblem(slug: string): string | null {
  if (!slug) return SLUG_PROBLEMS.missing;
  if (!SLUG_PATTERN.test(slug)) return SLUG_PROBLEMS.format;
  if (BASE44_ID_PATTERN.test(slug)) return SLUG_PROBLEMS.base44Id;
  return null;
}

export const isValidSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && slugProblem(slug) === null;

/**
 * The article's address: `/blog/<slug>`.
 *
 * Only the Supabase store holds slugs. A build that reads Base44 instead (no
 * Supabase configured) links by id, which is what every address was before.
 */
export function articlePath(post: Pick<Article, "id" | "slug">): string {
  return `/blog/${post.slug || post.id}`;
}
