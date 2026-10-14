import { totals } from "@/lib/clearinghouse/analysis";
import { DEFAULT_FUND_FEES, PROJECTION, SAVINGS_FEE_WORTH_RAISING } from "@/lib/clearinghouse/reference";
import type { Account, Snapshot } from "@/lib/clearinghouse/snapshot";
import { projectRetirement } from "@/lib/retirement-projection";
import type { PublishedRecommendation } from "@/services/ports";

/**
 * What the client's "תמונת מצב" tab shows, computed from the published
 * snapshot — pure, so the tab and Dorit's preview of it cannot disagree.
 * Every projection is an estimate, and the tab says so.
 */

export interface ClientTiles {
  totalSavings: number;
  /** The pension funds' projected monthly pension at 67; null without an age. */
  pensionAt67: number | null;
  yearlyFees: number;
  /** The part of this year's fees above the yardsticks (reference.ts); 0 when none. */
  feesAboveUsual: number;
  openRecommendations: number;
}

/**
 * A pension fund above the default funds' fees, a provident or study fund
 * above Dorit's threshold: the yearly cost of the difference. The same
 * yardsticks as the analysis's findings.
 */
function aboveUsual(a: Account): number {
  const balance = (a.balance * Math.max(0, (a.feeFromBalance ?? 0) - usualBalanceFee(a))) / 100;
  const deposits =
    a.kind === "pension"
      ? ((a.monthlyDeposit ?? 0) * 12 * Math.max(0, (a.feeFromDeposits ?? 0) - DEFAULT_FUND_FEES.fromDeposits)) / 100
      : 0;
  return balance + deposits;
}

function usualBalanceFee(a: Account): number {
  if (a.kind === "pension") return DEFAULT_FUND_FEES.fromBalance;
  if (a.kind === "provident" || a.kind === "study") return SAVINGS_FEE_WORTH_RAISING;
  // Managers' insurance has no single yardstick (reference.ts): never "above".
  return Number.POSITIVE_INFINITY;
}

/** Each pension fund carried to 67 on its own fee and deposit, as the retirement calculator does. */
function pensionAt67(s: Snapshot): number | null {
  const age = s.client.age;
  if (age === null) return null;
  return s.accounts
    .filter((a) => a.kind === "pension")
    .reduce(
      (sum, a) =>
        sum +
        projectRetirement({
          currentAge: age,
          retirementAge: PROJECTION.retirementAge,
          currentBalance: a.balance,
          monthlyDeposit: a.active ? a.monthlyDeposit ?? 0 : 0,
          feeOnBalance: a.feeFromBalance ?? 0,
          annualReturn: PROJECTION.annualReturn,
        }).monthlyPension,
      0,
    );
}

export function clientTiles(s: Snapshot, items: PublishedRecommendation[]): ClientTiles {
  const t = totals(s);
  return {
    totalSavings: t.balance,
    pensionAt67: pensionAt67(s),
    yearlyFees: t.yearlyFees,
    feesAboveUsual: s.accounts.reduce((sum, a) => sum + aboveUsual(a), 0),
    openRecommendations: items.filter((i) => i.clientStatus === "open").length,
  };
}

export type CoverageStatus = "covered" | "partial" | "duplicate" | "not_found";

export interface CoverageLine {
  kind: "death" | "disability";
  label: string;
  status: CoverageStatus;
}

/**
 * Survivors' and disability cover across the products: one active product
 * covers it; two or more is a possible duplicate; only a dormant one is
 * partial (cover in a fund without deposits may be lapsing); none is not
 * found — in the clearinghouse report, which does not show private policies.
 */
export function coverageLines(s: Snapshot): CoverageLine[] {
  const lines: [CoverageLine["kind"], string][] = [
    ["death", "ביטוח למקרה מוות (שארים)"],
    ["disability", "אובדן כושר עבודה / נכות"],
  ];
  return lines.map(([kind, label]) => {
    const covering = s.accounts.filter((a) => a.coverage[kind]);
    const active = covering.filter((a) => a.active);
    const status: CoverageStatus =
      active.length >= 2 ? "duplicate" : active.length === 1 ? "covered" : covering.length > 0 ? "partial" : "not_found";
    return { kind, label, status };
  });
}

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  covered: "מכוסה",
  partial: "חלקי — רק במוצר לא פעיל",
  duplicate: "כפל אפשרי",
  not_found: "לא נמצא בדוח",
};
