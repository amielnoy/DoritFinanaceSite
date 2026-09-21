import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Article,
  ArticleDraft,
  ShadowWritePort,
  Testimonial,
  TestimonialDraft,
} from "../ports";

/**
 * Which column an incoming id refers to.
 *
 * As the primary, this store hands out its own uuids and gets them back. As the
 * shadow it is handed the *primary's* ids, which mean nothing to Postgres —
 * they live in `base44_id`. Matching on the wrong column does not error: the
 * update or delete simply affects zero rows, the caller is told everything
 * worked, and the two stores drift apart in exactly the place the migration
 * promises they agree. That silence is why this is a constructor argument and
 * not a default.
 */
export type KeyBy = "id" | "base44_id";

const article = (r: Record<string, unknown>): Article => ({
  id: String(r.id),
  title: String(r.title ?? ""),
  excerpt: (r.excerpt as string) ?? undefined,
  body: (r.body as string) ?? undefined,
  image_url: (r.image_url as string) ?? undefined,
  tags: (r.tags as string) ?? undefined,
  published: Boolean(r.published),
  // The column is `created_at`; the port has always said `created_date`.
  // Translating here keeps every existing caller untouched.
  created_date: String(r.created_at ?? ""),
});

const testimonial = (r: Record<string, unknown>): Testimonial => ({
  id: String(r.id),
  name: String(r.name ?? ""),
  role: (r.role as string) ?? undefined,
  quote: String(r.quote ?? ""),
  image_url: (r.image_url as string) ?? undefined,
  rating: r.rating == null ? undefined : Number(r.rating),
  source: (r.source as string) ?? undefined,
  created_date: String(r.created_at ?? ""),
});

export class SupabaseContentAdminService implements ShadowWritePort {
  constructor(
    private readonly db: SupabaseClient,
    private readonly keyBy: KeyBy = "id",
  ) {}

  async listArticles(limit = 100): Promise<Article[]> {
    const { data, error } = await this.db
      .from("blog_posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(article);
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const { data, error } = await this.db
      .from("testimonials")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(testimonial);
  }

  async createArticle(draft: ArticleDraft): Promise<string> {
    return this.insert("blog_posts", { ...draft, published: !!draft.published });
  }

  async createArticleMirroring(primaryId: string, draft: ArticleDraft): Promise<void> {
    await this.insert("blog_posts", {
      ...draft,
      published: !!draft.published,
      base44_id: primaryId,
    });
  }

  async createTestimonial(draft: TestimonialDraft): Promise<string> {
    return this.insert("testimonials", this.testimonialRow(draft));
  }

  async createTestimonialMirroring(primaryId: string, draft: TestimonialDraft): Promise<void> {
    await this.insert("testimonials", { ...this.testimonialRow(draft), base44_id: primaryId });
  }

  async updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void> {
    const { error } = await this.db.from("blog_posts").update(draft).eq(this.keyBy, id);
    if (error) throw error;
  }

  async removeArticle(id: string): Promise<void> {
    const { error } = await this.db.from("blog_posts").delete().eq(this.keyBy, id);
    if (error) throw error;
  }

  async removeTestimonial(id: string): Promise<void> {
    const { error } = await this.db.from("testimonials").delete().eq(this.keyBy, id);
    if (error) throw error;
  }

  /** Same defaults the Base44 adapter applies, so the two stores agree on blanks. */
  private testimonialRow(draft: TestimonialDraft): Record<string, unknown> {
    return { ...draft, rating: Number(draft.rating) || 5, source: draft.source || "google" };
  }

  private async insert(table: string, row: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.db.from(table).insert(row).select("id").single();
    if (error) throw error;
    return String((data as { id?: string } | null)?.id ?? "");
  }
}
