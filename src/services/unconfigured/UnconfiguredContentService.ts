import type { Article, ContentPort, Testimonial } from "../ports";

/**
 * Published content for a build with no Supabase credentials: nothing is
 * published, so the lists are empty and every article is not found — the same
 * 404 shape as SupabaseContentService, so the article page shows its own
 * not-found state rather than an error.
 */
export class UnconfiguredContentService implements ContentPort {
  async listArticles(): Promise<Article[]> {
    return [];
  }

  async getArticle(id: string): Promise<Article> {
    throw Object.assign(new Error(`article ${id} not found`), { status: 404 });
  }

  async listTestimonials(): Promise<Testimonial[]> {
    return [];
  }
}
