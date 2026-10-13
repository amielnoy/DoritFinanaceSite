/**
 * `post-<id>`: the address of an article nobody gave one. This is the JS twin
 * of `public.blog_posts_fallback_slug(base44_id, id)` in
 * supabase/migrations/20261014000000_blog_slug.sql and must produce what it
 * does: 'post-' plus the lowercased base44_id with every run of characters
 * outside [a-z0-9] turned into one hyphen and trimmed of hyphens at both
 * ends, or plus the row's uuid when nothing is left. Only ASCII letters are
 * lowercased, so the result never depends on a locale's idea of "lower".
 */
export function fallbackSlug(base44Id, uuid) {
  const cleaned = String(base44Id ?? "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const tail = cleaned || (uuid ? String(uuid) : "");
  if (!tail) throw new Error("no id to make a slug from");
  return `post-${tail}`;
}
