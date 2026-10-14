import type { Article, ContentPort, Testimonial } from "../ports.js";
import { SLUG_PATTERN, UUID_PATTERN } from "../../lib/articlePath.js";
import { fetchRows, toPortRow, type SupabaseTableClient } from "./SupabaseTableClient.js";

// Relative imports carry `.js`: api/og/blog.ts uses this class, and api/ is
// compiled as Node ESM (nodenext), which resolves no extensionless path.

/**
 * Named columns, not `*`: the port's fields and the two the mapping needs.
 * `slug` is the article's address, `/blog/<slug>` — see src/lib/articlePath.ts.
 */
export const ARTICLE_COLUMNS =
  "id,base44_id,slug,title,excerpt,body,image_url,tags,action_time,cta_headline,og_image,published,created_at";
export const TESTIMONIAL_COLUMNS = "id,base44_id,name,role,quote,image_url,rating,source,created_at";

export const toArticle = (row: Record<string, unknown>): Article => toPortRow(row) as unknown as Article;

/** `rating` is a numeric column, and PostgREST sends numerics as strings. */
export const toTestimonial = (row: Record<string, unknown>): Testimonial => {
  const out = toPortRow(row);
  if (out.rating !== undefined) out.rating = Number(out.rating);
  return out as unknown as Testimonial;
};

/**
 * "No such article", shaped the way api/og/blog.ts and Base44's `get` both
 * spell it: a 404 status on the error. BlogPost.tsx reads any error as
 * "not found"; the server tells a 404 from a failed read by this.
 */
const notFound = (key: string) => Object.assign(new Error(`article ${key} not found`), { status: 404 });

/**
 * Read side of the content store, on Supabase.
 *
 * The `published` filter is in the query even though RLS already hides drafts
 * from an anonymous reader: a signed-in admin passes that policy, and the
 * public blog must not list drafts to her either. The rule belongs to the
 * port, as it did in Base44ContentService.
 */
export class SupabaseContentService implements ContentPort {
  constructor(private readonly client: SupabaseTableClient) {}

  async listArticles(limit = 50): Promise<Article[]> {
    const rows = await fetchRows(
      this.client
        .from("blog_posts")
        .select(ARTICLE_COLUMNS)
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(limit),
      "blog_posts",
    );
    return rows.map(toArticle);
  }

  /**
   * One article, by whatever followed `/blog/` in the address.
   *
   * That is a slug (every link the site builds now), a Base44 id (every link
   * before slugs: bookmarks, search results, the agents' answers), or Supabase's
   * uuid for a row that never had a Base44 id. One request asks for all three,
   * and the slug wins, then the Base44 id, then the uuid.
   *
   * The key goes into a PostgREST `or=(…)` filter, where a comma or a bracket
   * would change the filter itself. So a key that is not slug-shaped is never
   * sent: no slug, Base44 id or uuid can look like it. The uuid clause is sent
   * only for a uuid-shaped key, because PostgREST answers `id.eq.<not a uuid>`
   * with an error (22P02), not with an empty list.
   */
  async getArticle(key: string): Promise<Article> {
    if (!SLUG_PATTERN.test(key)) throw notFound(key);
    const clauses = [`slug.eq.${key}`, `base44_id.eq.${key}`];
    if (UUID_PATTERN.test(key)) clauses.push(`id.eq.${key}`);
    const rows = await fetchRows(
      this.client.from("blog_posts").select(ARTICLE_COLUMNS).or(clauses.join(",")).limit(3),
      "blog_posts",
    );
    const row =
      rows.find((r) => r.slug === key) ?? rows.find((r) => r.base44_id === key) ?? rows.find((r) => r.id === key);
    if (!row) throw notFound(key);
    return toArticle(row);
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const rows = await fetchRows(
      this.client
        .from("testimonials")
        .select(TESTIMONIAL_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit),
      "testimonials",
    );
    return rows.map(toTestimonial);
  }
}
