import type { Article, ContentAdminPort, Testimonial } from "../ports";
import { ARTICLE_COLUMNS, TESTIMONIAL_COLUMNS, toArticle, toTestimonial } from "./SupabaseContentService";
import { fetchRows, type SupabaseTableClient } from "./SupabaseTableClient";

const WRITES_ELSEWHERE = "writes go through FunctionContentAdminService";

/**
 * The admin's content lists, on Supabase.
 *
 * No `published` filter: the signed-in admin satisfies the `... or is_admin()`
 * half of the blog_posts read policy, so drafts come back, which is the one
 * thing this list must do that ContentPort.listArticles must never do.
 *
 * Only the reads are real. This class is only ever the `reads` argument of
 * FunctionContentAdminService, which sends every write to the `contentAdmin`
 * function, where the admin check lives. The write methods exist to satisfy
 * the port and throw, so a future wiring mistake fails loudly instead of
 * writing past that check.
 */
export class SupabaseContentAdminService implements ContentAdminPort {
  constructor(private readonly client: SupabaseTableClient) {}

  async listArticles(limit = 100): Promise<Article[]> {
    const rows = await fetchRows(
      this.client.from("blog_posts").select(ARTICLE_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "blog_posts",
    );
    return rows.map(toArticle);
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

  async createArticle(): Promise<string> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async updateArticle(): Promise<void> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async removeArticle(): Promise<void> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async createTestimonial(): Promise<string> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async removeTestimonial(): Promise<void> {
    throw new Error(WRITES_ELSEWHERE);
  }
}
