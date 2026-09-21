import type {
  Article,
  ArticleDraft,
  ContentAdminPort,
  Testimonial,
  TestimonialDraft,
} from "../ports";

/**
 * Just enough of the SDK to call a backend function with our own header.
 *
 * `fetch`, not `invoke`. `invoke(name, data)` takes exactly two arguments, so a
 * third carrying headers is accepted by nobody and dropped in silence — the
 * function would then refuse every call as unauthenticated, which looks like a
 * permissions problem rather than a wiring one. `fetch` takes a RequestInit and
 * merges Base44's own auth headers into it.
 */
export interface FunctionsClient {
  functions: { fetch(path: string, init?: RequestInit): Promise<Response> };
}

/**
 * Content writes, performed by the backend rather than the browser.
 *
 * The browser used to write both stores itself. That stopped working the moment
 * identity moved: Base44's rules require a Base44 admin session, and a browser
 * holding a Supabase one is refused with 403 before the shadow write is even
 * attempted. Signing into both systems at once would restore it, and would mean
 * two identities for one person for the duration of a migration.
 *
 * So the writes go where the lead and contact writes already go. The function
 * holds `asServiceRole` for Base44 and the service key for Supabase, writes
 * both, and needs no browser identity at all — only proof of who is asking.
 *
 * That proof is the visitor's Supabase access token, sent in a header of its
 * own because `Authorization` is already spoken for by Base44's client. The
 * function verifies it and checks the role itself, because `asServiceRole`
 * bypasses the rules that used to be the gate.
 *
 * Reads stay on Base44 and stay anonymous: posts and testimonials are readable
 * by anyone, which is the point of a public site.
 */
export class FunctionContentAdminService implements ContentAdminPort {
  constructor(
    private readonly client: FunctionsClient,
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

  async createArticle(draft: ArticleDraft): Promise<string> {
    return this.call("createArticle", { draft });
  }

  async updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void> {
    await this.call("updateArticle", { id, draft });
  }

  async removeArticle(id: string): Promise<void> {
    await this.call("removeArticle", { id });
  }

  async createTestimonial(draft: TestimonialDraft): Promise<string> {
    return this.call("createTestimonial", { draft });
  }

  async removeTestimonial(id: string): Promise<void> {
    await this.call("removeTestimonial", { id });
  }

  private async call(op: string, payload: Record<string, unknown>): Promise<string> {
    const token = await this.accessToken();
    if (!token) throw new Error("נדרשת התחברות.");

    const res = await this.client.functions.fetch("contentAdmin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Supabase-Auth": token },
      body: JSON.stringify({ op, ...payload }),
    });

    // A refusal arrives as a status, not as a thrown error. Reading the body
    // without checking `ok` would let "you are not an admin" land as a silent
    // success and the caller redraw as though the write had happened.
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `הפעולה נכשלה (${res.status}).`);
    return data.id ?? "";
  }
}
