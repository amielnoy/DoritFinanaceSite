/**
 * The site's questions and answers — the one copy.
 *
 * Three components used to carry their own: the home page's six "tips"
 * (FAQ.tsx), its "common questions" accordion (DetailedFAQ.tsx) and the /faq
 * page's four categories (FAQPage.tsx). They had already drifted — the
 * annual-review answer said one thing on the home page and another on /faq —
 * and since /faq builds its FAQPage JSON-LD from its copy, what Google indexed
 * and what a visitor read on the home page could disagree. For a regulated
 * business that is a correctness problem, not a tidiness one.
 *
 * Every surface now selects from this list. Edit an answer here and it
 * changes everywhere at once, structured data included.
 * `tests/unit/faq-content.test.ts` pins the invariants.
 *
 * The words live in the resource files, one per language
 * (`src/i18n/locales/<lang>/faq.json`: `<id>.q`, `<id>.a`, `<id>.tip`,
 * `cat.<id>`); this file keeps the structure — which entries exist, their
 * category and tip number. `FAQ_ENTRIES` is the Hebrew, as it always was;
 * `localizeFaq` (src/i18n/faq.ts) gives an entry in another language.
 */

// Relative, with the attribute, and nothing else imported: the build's
// scripts/build-seo-files.mjs loads this file under plain Node (llms-full.txt),
// which resolves neither the "@/" alias nor a JSON import without it.
import heFaq from "../i18n/locales/he/faq.json" with { type: "json" };

export type FaqCategoryId = "tax" | "pension" | "insurance" | "general";

export interface FaqCategory {
  id: FaqCategoryId;
  label: string;
  labelEn: string;
}

export interface FaqEntry {
  /** Stable key — used for React keys, accordion values and cross-references. */
  id: string;
  category: FaqCategoryId;
  q: string;
  a: string;
  /**
   * Set on the entries the home page shows as numbered tips. `title` is the
   * imperative phrasing ("אל תוותרו על…") that the tips list uses instead of
   * the question; the answer is shared.
   */
  tip?: { n: number; title: string };
}

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  { id: "tax", label: heFaq["cat.tax"], labelEn: "Income Tax" },
  { id: "pension", label: heFaq["cat.pension"], labelEn: "Pension & Savings" },
  { id: "insurance", label: heFaq["cat.insurance"], labelEn: "Insurance" },
  { id: "general", label: heFaq["cat.general"], labelEn: "General" },
];

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: "tax-planning",
    category: "tax",
    q: heFaq["tax-planning.q"],
    a: heFaq["tax-planning.a"],
  },
  {
    id: "amendment-190",
    category: "tax",
    q: heFaq["amendment-190.q"],
    a: heFaq["amendment-190.a"],
  },
  {
    id: "marginal-tax",
    category: "tax",
    q: heFaq["marginal-tax.q"],
    a: heFaq["marginal-tax.a"],
  },
  {
    id: "severance-lump-or-annuity",
    category: "tax",
    q: heFaq["severance-lump-or-annuity.q"],
    a: heFaq["severance-lump-or-annuity.a"],
  },
  {
    id: "pension-tax-refund",
    category: "tax",
    q: heFaq["pension-tax-refund.q"],
    a: heFaq["pension-tax-refund.a"],
  },
  {
    id: "rights-fixing",
    category: "tax",
    q: heFaq["rights-fixing.q"],
    a: heFaq["rights-fixing.a"],
  },
  {
    id: "pension-vs-gemel-vs-hishtalmut",
    category: "pension",
    q: heFaq["pension-vs-gemel-vs-hishtalmut.q"],
    a: heFaq["pension-vs-gemel-vs-hishtalmut.a"],
  },
  {
    id: "lower-management-fees",
    category: "pension",
    q: heFaq["lower-management-fees.q"],
    a: heFaq["lower-management-fees.a"],
  },
  {
    id: "fees-in-every-product",
    category: "pension",
    q: heFaq["fees-in-every-product.q"],
    a: heFaq["fees-in-every-product.a"],
    tip: { n: 1, title: heFaq["fees-in-every-product.tip"] },
  },
  {
    id: "improve-returns",
    category: "pension",
    q: heFaq["improve-returns.q"],
    a: heFaq["improve-returns.a"],
  },
  {
    id: "merge-funds",
    category: "pension",
    q: heFaq["merge-funds.q"],
    a: heFaq["merge-funds.a"],
  },
  {
    id: "child-savings",
    category: "pension",
    q: heFaq["child-savings.q"],
    a: heFaq["child-savings.a"],
    tip: { n: 4, title: heFaq["child-savings.tip"] },
  },
  {
    id: "self-employed-pension",
    category: "pension",
    q: heFaq["self-employed-pension.q"],
    a: heFaq["self-employed-pension.a"],
    tip: { n: 6, title: heFaq["self-employed-pension.tip"] },
  },
  {
    id: "supplementary-health",
    category: "insurance",
    q: heFaq["supplementary-health.q"],
    a: heFaq["supplementary-health.a"],
    tip: { n: 5, title: heFaq["supplementary-health.tip"] },
  },
  {
    id: "disability-cover",
    category: "insurance",
    q: heFaq["disability-cover.q"],
    a: heFaq["disability-cover.a"],
    tip: { n: 2, title: heFaq["disability-cover.tip"] },
  },
  {
    id: "switch-agent",
    category: "insurance",
    q: heFaq["switch-agent.q"],
    a: heFaq["switch-agent.a"],
  },
  {
    id: "life-changes",
    category: "insurance",
    q: heFaq["life-changes.q"],
    a: heFaq["life-changes.a"],
  },
  {
    id: "first-meeting-cost",
    category: "general",
    q: heFaq["first-meeting-cost.q"],
    a: heFaq["first-meeting-cost.a"],
  },
  {
    id: "independent-agent",
    category: "general",
    q: heFaq["independent-agent.q"],
    a: heFaq["independent-agent.a"],
  },
  {
    id: "lifelong-service",
    category: "general",
    q: heFaq["lifelong-service.q"],
    a: heFaq["lifelong-service.a"],
  },
  {
    id: "claims-support",
    category: "general",
    q: heFaq["claims-support.q"],
    a: heFaq["claims-support.a"],
  },
  {
    id: "remote-meetings",
    category: "general",
    q: heFaq["remote-meetings.q"],
    a: heFaq["remote-meetings.a"],
  },
  {
    id: "confidentiality",
    category: "general",
    q: heFaq["confidentiality.q"],
    a: heFaq["confidentiality.a"],
  },
  {
    id: "annual-review",
    category: "general",
    q: heFaq["annual-review.q"],
    a: heFaq["annual-review.a"],
    tip: { n: 3, title: heFaq["annual-review.tip"] },
  },
];

/**
 * The home page's "common questions" — a hand-picked subset in a deliberate
 * order (what a first-time visitor asks before booking), not a category.
 */
export const HOME_COMMON_QUESTION_IDS: readonly string[] = [
  "first-meeting-cost",
  "independent-agent",
  "lifelong-service",
  "claims-support",
  "switch-agent",
  "life-changes",
  "remote-meetings",
  "confidentiality",
];

export const faqByCategory = (category: FaqCategoryId): FaqEntry[] =>
  FAQ_ENTRIES.filter((e) => e.category === category);

/** The numbered tips, in tip order. */
export const faqTips = (): (FaqEntry & { tip: NonNullable<FaqEntry["tip"]> })[] =>
  FAQ_ENTRIES.filter((e): e is FaqEntry & { tip: NonNullable<FaqEntry["tip"]> } => !!e.tip).sort(
    (x, y) => x.tip.n - y.tip.n
  );

export const faqByIds = (ids: readonly string[]): FaqEntry[] =>
  ids.map((id) => {
    const entry = FAQ_ENTRIES.find((e) => e.id === id);
    if (!entry) throw new Error(`Unknown FAQ entry: ${id}`);
    return entry;
  });
