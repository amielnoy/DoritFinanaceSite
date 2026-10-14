import type { Finding } from "@/lib/clearinghouse/analysis";
import type { FindingReview } from "@/services/ports";

export type ReviewState = "draft" | "approved" | "rejected";

export interface ReviewedFinding extends Finding {
  state: ReviewState;
  /** What the printout says: Dorit's wording when she edited it, else the draft. */
  text: string;
  /** She changed the draft's wording. */
  edited: boolean;
}

/**
 * Each finding with Dorit's decision on it, in the analysis's order. A
 * decision whose finding is gone — the client's report changed, or a rule was
 * retired — is simply not shown; it stays in the table until the snapshot goes.
 */
export function withReviews(findings: Finding[], reviews: FindingReview[]): ReviewedFinding[] {
  const byKey = new Map(reviews.map((r) => [r.findingKey, r]));
  return findings.map((f) => {
    const review = byKey.get(f.key);
    const edited = !!review?.finalText && review.finalText !== f.body;
    return { ...f, state: review?.status ?? "draft", text: edited ? review!.finalText! : f.body, edited };
  });
}

/** What goes on the printout: approved findings only, in order. */
export const forPrint = (findings: ReviewedFinding[]): ReviewedFinding[] =>
  findings.filter((f) => f.state === "approved");

export const pendingCount = (findings: ReviewedFinding[]): number =>
  findings.filter((f) => f.state === "draft").length;
