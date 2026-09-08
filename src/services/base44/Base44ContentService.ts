import type { Article, ContentPort, Testimonial } from "../ports";

/** The entity surface this adapter needs. */
export interface EntityReader {
  entities: {
    BlogPost: {
      filter(query: unknown, sort?: string, limit?: number): Promise<unknown[]>;
      get(id: string): Promise<unknown>;
    };
    Testimonial: { list(sort?: string, limit?: number): Promise<unknown[]> };
  };
}

/**
 * Read side of the content store.
 *
 * The `published: true` filter lives here rather than in the Blog page, so no
 * caller can accidentally list drafts — the rule belongs to the port, not to
 * whichever component happens to be reading.
 */
export class Base44ContentService implements ContentPort {
  constructor(private readonly client: EntityReader) {}

  async listArticles(limit = 50): Promise<Article[]> {
    const rows = await this.client.entities.BlogPost.filter(
      { published: true },
      "-created_date",
      limit
    );
    return rows as Article[];
  }

  async getArticle(id: string): Promise<Article> {
    return (await this.client.entities.BlogPost.get(id)) as Article;
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const rows = await this.client.entities.Testimonial.list("-created_date", limit);
    return rows as Testimonial[];
  }
}
