import type { Article, ContentPort, Testimonial } from "../ports";
import { fetchRows, toPortRow, type SupabaseTableClient } from "./SupabaseTableClient";

/** Named columns, not `*`: the port's fields and the two the mapping needs. */
export const ARTICLE_COLUMNS =
  "id,base44_id,title,excerpt,body,image_url,tags,action_time,published,created_at";
export const TESTIMONIAL_COLUMNS = "id,base44_id,name,role,quote,image_url,rating,source,created_at";

export const toArticle = (row: Record<string, unknown>): Article => toPortRow(row) as unknown as Article;

/** `rating` is a numeric column, and PostgREST sends numerics as strings. */
export const toTestimonial = (row: Record<string, unknown>): Testimonial => {
  const out = toPortRow(row);
  if (out.rating !== undefined) out.rating = Number(out.rating);
  return out as unknown as Testimonial;
};

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

  /** `id` is a Base44 id — see toPortRow — so the filter is on `base44_id`. */
  async getArticle(id: string): Promise<Article> {
    const [row] = await fetchRows(
      this.client.from("blog_posts").select(ARTICLE_COLUMNS).eq("base44_id", id).limit(1),
      "blog_posts",
    );
    // Base44's `get` threw on a missing id, and BlogPost.tsx reads that error as
    // "not found". An empty result has to say the same thing.
    if (!row) throw new Error(`article ${id} not found`);
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
