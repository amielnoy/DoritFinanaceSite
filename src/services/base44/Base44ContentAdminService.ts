import type {
  Article,
  ArticleDraft,
  ContentAdminPort,
  Testimonial,
  TestimonialDraft,
} from "../ports";

/** The entity surface this adapter needs. Note `list`, not `filter`: the admin
 *  screens must see drafts, which the published-only read path never returns. */
export interface ContentAdminClient {
  entities: {
    BlogPost: {
      list(sort?: string, limit?: number): Promise<unknown[]>;
      /** Base44 returns the created row; dual-write needs its id to correlate. */
      create(payload: Record<string, unknown>): Promise<{ id?: string } | null>;
      update(id: string, patch: Record<string, unknown>): Promise<unknown>;
      delete(id: string): Promise<unknown>;
    };
    Testimonial: {
      list(sort?: string, limit?: number): Promise<unknown[]>;
      /** Base44 returns the created row; dual-write needs its id to correlate. */
      create(payload: Record<string, unknown>): Promise<{ id?: string } | null>;
      delete(id: string): Promise<unknown>;
    };
  };
}

export class Base44ContentAdminService implements ContentAdminPort {
  constructor(private readonly client: ContentAdminClient) {}

  async listArticles(limit = 100): Promise<Article[]> {
    const rows = await this.client.entities.BlogPost.list("-created_date", limit);
    return (rows ?? []) as Article[];
  }

  async createArticle(draft: ArticleDraft): Promise<string> {
    const row = await this.client.entities.BlogPost.create({ ...draft, published: !!draft.published });
    return String(row?.id ?? "");
  }

  async updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void> {
    await this.client.entities.BlogPost.update(id, { ...draft });
  }

  async removeArticle(id: string): Promise<void> {
    await this.client.entities.BlogPost.delete(id);
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const rows = await this.client.entities.Testimonial.list("-created_date", limit);
    return (rows ?? []) as Testimonial[];
  }

  async createTestimonial(draft: TestimonialDraft): Promise<string> {
    const row = await this.client.entities.Testimonial.create({
      ...draft,
      // The form offers a 1–5 star control and a source selector; both have a
      // sensible answer when the field arrives empty, and defaulting here keeps
      // that decision out of the component.
      rating: Number(draft.rating) || 5,
      source: draft.source || "google",
    });
    return String(row?.id ?? "");
  }

  async removeTestimonial(id: string): Promise<void> {
    await this.client.entities.Testimonial.delete(id);
  }
}
