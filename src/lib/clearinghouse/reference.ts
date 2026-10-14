/**
 * The numbers the analysis compares a report against, each with its source and
 * the day it was checked. When one changes, change it here and the date with
 * it; the findings quote these, so a stale number is a wrong recommendation.
 */

export interface FeePair {
  /** Percent of each deposit. */
  fromDeposits: number;
  /** Percent of the balance, a year. */
  fromBalance: number;
}

/**
 * The legal maximum. Pension: Regulation 3 (new comprehensive fund); provident
 * and study funds: Regulation 2 — תקנות הפיקוח על שירותים פיננסיים (קופות גמל)
 * (דמי ניהול), התשע"ב-2012, as amended 2022
 * (https://www.nevo.co.il/law_html/law01/500_714.htm), checked 2026-10-14.
 *
 * Managers' insurance has no single cap — it depends on the year the policy
 * was sold — so the analysis never calls an insurance fee "above the cap".
 */
export const LEGAL_MAX: Record<"pension" | "provident", FeePair> = {
  pension: { fromDeposits: 6, fromBalance: 0.5 },
  provident: { fromDeposits: 4, fromBalance: 1.05 },
};

/**
 * What the selected default funds (קרנות פנסיה נבחרות) may charge anyone who
 * joins them: the fourth selection, published 19.9.2024, in force from
 * 1.11.2024 to the end of October 2028; a member's rate is locked for ten
 * years. Checked 2026-10-14 against the Capital Market Authority's results as
 * reported (kolzchut "קרנות פנסיה נבחרות", calcalist, bizportal).
 *
 * This is the yardstick for "a pension fund that costs more than it has to":
 * any saver can get it without negotiating.
 */
export const DEFAULT_FUND_FEES: FeePair = { fromDeposits: 1, fromBalance: 0.22 };
export const DEFAULT_FUND_SELECTION_ENDS = "2028-10-31";

/** Assumptions for "what the difference costs by retirement". Shown on the finding. */
export const PROJECTION = {
  /** Gross yearly return. Below /tools' default of 5% on purpose: a lower return
   *  makes a fee's cost smaller, so a finding never overstates it. */
  annualReturn: 4,
  retirementAge: 67,
} as const;

/**
 * Agency policy, not regulation — Dorit's thresholds for what is worth raising.
 *
 * A provident or study fund charging more than this from the balance gets a
 * finding. Negotiated rates for these funds commonly sit well below the legal
 * 1.05%; a fee above this one is worth a phone call.
 */
export const SAVINGS_FEE_WORTH_RAISING = 0.7;

/** An inactive account below this balance, ₪, still charged a fee, is worth consolidating. */
export const SMALL_INACTIVE_BALANCE = 20_000;
