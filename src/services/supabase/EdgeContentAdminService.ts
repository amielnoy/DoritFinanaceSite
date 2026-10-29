import type { Article, ArticleDraft, ContentAdminPort, Testimonial, TestimonialDraft } from "../ports";

/** The one call this adapter makes — narrowed for the reason SupabaseAuthClient is. */
export interface ContentFunctionsClient {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown>; headers?: Record<string, string> },
    ): Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
  };
}

/**
 * Content writes on the `content-admin` Edge Function, Supabase only — the
 * successor of FunctionContentAdminService, which went through Base44's
 * `contentAdmin` and also wrote Base44's copy.
 *
 * The session's token travels on `Authorization`, where the function reads
 * it. supabase-js would attach it unasked; naming it here keeps "signed out"
 * a refusal in the browser instead of an anon-key call the function rejects.
 */
export class EdgeContentAdminService implements ContentAdminPort {
  constructor(
    private readonly client: ContentFunctionsClient,
    private readonly reads: ContentAdminPort,
    /** The signed-in visitor's Supabase access token, or null when signed out. */
    private readonly accessToken: () => Promise<string | null>,
  ) {}

  listArticles(limit?: number): Promise<Article[]> {
    return this.reads.listArticles(limit);
  }

  listTestimonials(limit?: number): Promise<Testimonial[]> {
    return this.reads.listTestimonials(limit);
  }

  createArticle(draft: ArticleDraft): Promise<string> {
    return this.call({ op: "createArticle", draft });
  }

  async updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void> {
    await this.call({ op: "updateArticle", id, draft });
  }

  async removeArticle(id: string): Promise<void> {
    await this.call({ op: "removeArticle", id });
  }

  createTestimonial(draft: TestimonialDraft): Promise<string> {
    return this.call({ op: "createTestimonial", draft });
  }

  async removeTestimonial(id: string): Promise<void> {
    await this.call({ op: "removeTestimonial", id });
  }

  private async call(body: Record<string, unknown>): Promise<string> {
    const token = await this.accessToken();
    if (!token) throw new Error("נדרשת התחברות.");

    const { data, error } = await this.client.functions.invoke("content-admin", {
      body,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) {
      // The function's own message, verbatim, with its status: BlogAdmin tells
      // a refusal it can explain (400 invalid slug, 409 taken) by exactly these.
      const res = error.context instanceof Response ? error.context : null;
      const answer = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      const status = res?.status;
      throw Object.assign(new Error(answer?.error ?? `הפעולה נכשלה (${status ?? "ללא תשובה"}).`), { status });
    }
    return String((data as { id?: unknown } | null)?.id ?? "");
  }
}
