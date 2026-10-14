import type { Finding } from "@/lib/clearinghouse/analysis";
import type { FindingReview, PublishItem, RecommendationPriority } from "@/services/ports";

export type ReviewState = "draft" | "approved" | "rejected";

/** A rule's finding with Dorit's decision — or a recommendation she wrote herself (`rule: "custom"`). */
export interface ReviewedFinding extends Omit<Finding, "rule"> {
  rule: Finding["rule"] | "custom";
  state: ReviewState;
  /** What the printout says: Dorit's wording when she edited it, else the draft. */
  text: string;
  /** She changed the draft's wording. */
  edited: boolean;
  /** "חשוב" or "כדאי לבדוק": hers when she set one, else the finding's severity (high → important). */
  priority: RecommendationPriority;
}

/** A recommendation Dorit wrote herself is stored as a review under this prefix. */
export const CUSTOM_PREFIX = "custom:";
export const isCustomKey = (key: string): boolean => key.startsWith(CUSTOM_PREFIX);

/** A finding's own priority, before Dorit sets one: high severity is "important". */
export const priorityOfSeverity = (severity: Finding["severity"]): RecommendationPriority =>
  severity === "high" ? "important" : "check";

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
    return {
      ...f,
      title: review?.title || f.title,
      state: review?.status ?? "draft",
      text: edited ? review!.finalText! : f.body,
      edited,
      priority: review?.priority ?? priorityOfSeverity(f.severity),
    };
  });
}

/**
 * Dorit's own recommendations, in the order she wrote them (by review time).
 * Each is approved by being written; deleting one is putting it back to draft.
 */
export function customRecommendations(reviews: FindingReview[]): ReviewedFinding[] {
  return reviews
    .filter((r) => isCustomKey(r.findingKey) && r.status === "approved" && r.title && r.finalText)
    .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
    .map((r) => ({
      key: r.findingKey,
      rule: "custom" as const,
      severity: r.priority === "important" ? ("high" as const) : ("medium" as const),
      title: r.title!,
      body: r.finalText!,
      accountIds: [],
      costToRetirement: null,
      state: "approved" as const,
      text: r.finalText!,
      edited: false,
      priority: r.priority ?? "check",
    }));
}

/** What a publish sends: every approved recommendation — the rules' first, then hers — in order. */
export const publishItems = (findings: ReviewedFinding[], custom: ReviewedFinding[]): PublishItem[] =>
  [...forPrint(findings), ...custom].map((f) => ({ title: f.title, body: f.text, priority: f.priority }));

/** What goes on the printout: approved findings only, in order. */
export const forPrint = (findings: ReviewedFinding[]): ReviewedFinding[] =>
  findings.filter((f) => f.state === "approved");

export const pendingCount = (findings: ReviewedFinding[]): number =>
  findings.filter((f) => f.state === "draft").length;
