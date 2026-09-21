import type { Article, ArticleDraft, ContentAdminPort, Testimonial, TestimonialDraft } from "../ports";

/** Told about a shadow write that failed. Never throws; the request already succeeded. */
export type ShadowFailure = (op: string, error: unknown) => void;

const report: ShadowFailure = (op, error) => {
  // Deliberately console, not a thrown error: the visitor's write already
  // landed in the authoritative store, and reconciliation is what closes this
  // gap. Failing here would turn a bookkeeping problem into a lost enquiry.
  console.warn(`[dual-write] shadow ${op} failed`, error);
};

/**
 * Writes to both stores, reads from one.
 *
 * This is the whole of the cutover mechanism for the browser-written content.
 * It exists because the composition root already treats the backend as
 * replaceable — the components underneath never learn there are two.
 *
 * Reads come from the primary alone. Reading from both and comparing sounds
 * appealing and is not this class's job: divergence is found by the
 * reconciliation pass, which can look at everything rather than only at rows
 * someone happened to open.
 */
export class DualWriteContentAdminService implements ContentAdminPort {
  constructor(
    private readonly primary: ContentAdminPort,
    private readonly shadow: ContentAdminPort,
    private readonly onShadowFailure: ShadowFailure = report,
  ) {}

  listArticles(limit?: number): Promise<Article[]> {
    return this.primary.listArticles(limit);
  }

  listTestimonials(limit?: number): Promise<Testimonial[]> {
    return this.primary.listTestimonials(limit);
  }

  createArticle(draft: ArticleDraft): Promise<void> {
    return this.both("createArticle", (t) => t.createArticle(draft));
  }

  updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void> {
    return this.both("updateArticle", (t) => t.updateArticle(id, draft));
  }

  removeArticle(id: string): Promise<void> {
    return this.both("removeArticle", (t) => t.removeArticle(id));
  }

  createTestimonial(draft: TestimonialDraft): Promise<void> {
    return this.both("createTestimonial", (t) => t.createTestimonial(draft));
  }

  removeTestimonial(id: string): Promise<void> {
    return this.both("removeTestimonial", (t) => t.removeTestimonial(id));
  }

  /**
   * Primary first, and its failure is the caller's failure. The shadow follows
   * and its failure is only recorded — in that order, so a shadow that is down
   * can never stop the authoritative write from happening.
   */
  private async both(op: string, run: (target: ContentAdminPort) => Promise<void>): Promise<void> {
    await run(this.primary);
    try {
      await run(this.shadow);
    } catch (error) {
      this.onShadowFailure(op, error);
    }
  }
}
