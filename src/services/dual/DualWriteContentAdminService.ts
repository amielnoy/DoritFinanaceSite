import type {
  Article,
  ArticleDraft,
  ContentAdminPort,
  ShadowWritePort,
  Testimonial,
  TestimonialDraft,
} from "../ports";

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
    private readonly shadow: ShadowWritePort,
    private readonly onShadowFailure: ShadowFailure = report,
  ) {}

  listArticles(limit?: number): Promise<Article[]> {
    return this.primary.listArticles(limit);
  }

  listTestimonials(limit?: number): Promise<Testimonial[]> {
    return this.primary.listTestimonials(limit);
  }

  /**
   * The primary creates first and its id becomes the correlation key, so the
   * shadow is told which row it mirrors rather than minting an unrelated one.
   * Without this every row created during the migration would be uncorrelated —
   * and those are exactly the rows reconciliation exists to check.
   */
  async createArticle(draft: ArticleDraft): Promise<string> {
    const primaryId = await this.primary.createArticle(draft);
    await this.mirror("createArticle", () => this.shadow.createArticleMirroring(primaryId, draft));
    return primaryId;
  }

  updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void> {
    return this.both("updateArticle", (t) => t.updateArticle(id, draft));
  }

  removeArticle(id: string): Promise<void> {
    return this.both("removeArticle", (t) => t.removeArticle(id));
  }

  async createTestimonial(draft: TestimonialDraft): Promise<string> {
    const primaryId = await this.primary.createTestimonial(draft);
    await this.mirror("createTestimonial", () =>
      this.shadow.createTestimonialMirroring(primaryId, draft),
    );
    return primaryId;
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
    await this.mirror(op, () => run(this.shadow));
  }

  /**
   * The shadow half, which may fail without consequence to the caller. Ids
   * handed in here are the primary's; translating them is the shadow's job,
   * because only it knows how the two identities line up.
   */
  private async mirror(op: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.onShadowFailure(op, error);
    }
  }
}
