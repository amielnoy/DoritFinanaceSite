import type { Article, ContentAdminPort, Testimonial } from "../ports";

const NO_DATABASE = "אין חיבור למאגר.";

/** Content admin for a build with no Supabase credentials: nothing to list, and every write refused. */
export class UnconfiguredContentAdminService implements ContentAdminPort {
  async listArticles(): Promise<Article[]> {
    return [];
  }

  async createArticle(): Promise<string> {
    throw new Error(NO_DATABASE);
  }

  async updateArticle(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async removeArticle(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async listTestimonials(): Promise<Testimonial[]> {
    return [];
  }

  async createTestimonial(): Promise<string> {
    throw new Error(NO_DATABASE);
  }

  async removeTestimonial(): Promise<void> {
    throw new Error(NO_DATABASE);
  }
}
