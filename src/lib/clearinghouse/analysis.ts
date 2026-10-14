import { computePensionFees, formatIls } from "@/lib/pension-fee";
import type { Account, Snapshot } from "@/lib/clearinghouse/snapshot";
import {
  DEFAULT_FUND_FEES,
  LEGAL_MAX,
  PROJECTION,
  SAVINGS_FEE_WORTH_RAISING,
  SMALL_INACTIVE_BALANCE,
  type FeePair,
} from "@/lib/clearinghouse/reference";

/**
 * The draft recommendations for one client's report: fixed rules, fixed
 * wording, the client's numbers filled in. Nothing here is advice until Dorit
 * approves it — every finding is a draft she approves, edits or rejects on the
 * review screen, and only approved ones reach the printout.
 *
 * Pure and deterministic: the same snapshot always gives the same findings in
 * the same order, so a decision stored against a finding's `key` finds it
 * again tomorrow. Drafts are never stored; improving a rule improves every
 * client's drafts, and Dorit's decisions stay attached by key.
 */

export type RuleId =
  | "fee_above_legal_max"
  | "pension_fee_above_default"
  | "savings_fee_high"
  | "no_disability_cover"
  | "no_survivors_cover"
  | "duplicate_cover"
  | "several_active_pensions"
  | "small_inactive_accounts";

export type Severity = "high" | "medium" | "low";

export interface Finding {
  /** `rule:accountId,accountId` — what a review decision is stored against. */
  key: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  /** The draft recommendation, in Dorit's voice to the client. */
  body: string;
  accountIds: string[];
  /** What the difference costs by retirement, ₪, when the rule can estimate it. */
  costToRetirement: number | null;
}

export interface Totals {
  balance: number;
  /** This year's fees, ₪: balance × balance fee + 12 deposits × deposit fee. */
  yearlyFees: number;
  accounts: number;
  activeAccounts: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** A fee as people read it: "0.22%", "1%", never "0.2200%". */
export const pct = (n: number): string => `${Number(n.toFixed(2))}%`;

const KIND_NAME: Record<Account["kind"], string> = {
  pension: "קרן הפנסיה",
  provident: "קופת הגמל",
  study: "קרן ההשתלמות",
  insurance: "ביטוח המנהלים",
};

const label = (a: Account): string => `${KIND_NAME[a.kind]} ב${a.provider}`;
const keyOf = (rule: RuleId, accounts: Account[]): string =>
  `${rule}:${accounts.map((a) => a.id).sort().join(",")}`;

export function totals(snapshot: Snapshot): Totals {
  let balance = 0;
  let yearlyFees = 0;
  for (const a of snapshot.accounts) {
    balance += a.balance;
    yearlyFees += (a.balance * (a.feeFromBalance ?? 0)) / 100;
    yearlyFees += ((a.monthlyDeposit ?? 0) * 12 * (a.feeFromDeposits ?? 0)) / 100;
  }
  return {
    balance,
    yearlyFees,
    accounts: snapshot.accounts.length,
    activeAccounts: snapshot.accounts.filter((a) => a.active).length,
  };
}

/** Years to retirement, or null when the report has no age or the client is past it. */
function yearsLeft(snapshot: Snapshot): number | null {
  const age = snapshot.client.age;
  if (age === null) return null;
  const years = PROJECTION.retirementAge - age;
  return years > 0 ? years : null;
}

/**
 * The balance at retirement under the account's fees, minus the same under
 * `target`; never negative. Null when the age is unknown.
 */
function costVersus(account: Account, target: FeePair, years: number | null): number | null {
  if (years === null) return null;
  const at = (fees: FeePair) =>
    computePensionFees({
      monthlyDeposit: account.active ? account.monthlyDeposit ?? 0 : 0,
      depositFee: fees.fromDeposits,
      annualFee: fees.fromBalance,
      years,
      annualReturn: PROJECTION.annualReturn,
      startingBalance: account.balance,
    }).balance;
  const current = { fromDeposits: account.feeFromDeposits ?? 0, fromBalance: account.feeFromBalance ?? 0 };
  return Math.max(0, Math.round(at(target) - at(current)));
}

/**
 * How much a fee finding matters, from what it costs by retirement.
 *
 * TODO(user): the thresholds are Dorit's call — see the request in chat.
 */
export function costSeverity(cost: number | null): Severity {
  void cost;
  return "medium";
}

const assumption = (years: number) =>
  `(הערכה: ${years} שנים עד גיל ${PROJECTION.retirementAge}, תשואה שנתית של ${PROJECTION.annualReturn}%, ההפקדה החודשית הנוכחית.)`;

function aboveLegalMax(snapshot: Snapshot): Finding[] {
  return snapshot.accounts.flatMap((a) => {
    const max = a.kind === "pension" ? LEGAL_MAX.pension : a.kind === "provident" ? LEGAL_MAX.provident : null;
    if (!max) return [];
    const overDeposits = (a.feeFromDeposits ?? 0) > max.fromDeposits;
    const overBalance = (a.feeFromBalance ?? 0) > max.fromBalance;
    if (!overDeposits && !overBalance) return [];
    return [{
      key: keyOf("fee_above_legal_max", [a]),
      rule: "fee_above_legal_max" as const,
      severity: "high" as const,
      title: `דמי ניהול מעל התקרה החוקית — ${label(a)}`,
      body:
        `בדוח מופיעים דמי ניהול של ${pct(a.feeFromDeposits ?? 0)} מההפקדות ו־${pct(a.feeFromBalance ?? 0)} מהצבירה, ` +
        `והתקרה בחוק היא ${pct(max.fromDeposits)} ו־${pct(max.fromBalance)}. ` +
        "ייתכן שזו טעות בנתונים — נבדוק מול הגוף המנהל, ואם נגבה יותר מהמותר נבקש החזר.",
      accountIds: [a.id],
      costToRetirement: null,
    }];
  });
}

function pensionAboveDefault(snapshot: Snapshot): Finding[] {
  const years = yearsLeft(snapshot);
  return snapshot.accounts.flatMap((a) => {
    if (a.kind !== "pension" || !a.active) return [];
    const deposits = a.feeFromDeposits ?? 0;
    const balance = a.feeFromBalance ?? 0;
    if (deposits <= DEFAULT_FUND_FEES.fromDeposits && balance <= DEFAULT_FUND_FEES.fromBalance) return [];
    const cost = costVersus(a, DEFAULT_FUND_FEES, years);
    const costLine =
      cost !== null && years !== null
        ? ` ההפרש מצטבר לכ־${formatIls(cost)} עד הפרישה ${assumption(years)}`
        : "";
    return [{
      key: keyOf("pension_fee_above_default", [a]),
      rule: "pension_fee_above_default" as const,
      severity: costSeverity(cost),
      title: `דמי ניהול גבוהים מקרן ברירת מחדל — ${label(a)}`,
      body:
        `${label(a)} גובה ${pct(deposits)} מההפקדות ו־${pct(balance)} מהצבירה. ` +
        `קרנות ברירת המחדל גובות כל מי שמצטרף אליהן עד ${pct(DEFAULT_FUND_FEES.fromDeposits)} ו־${pct(DEFAULT_FUND_FEES.fromBalance)}, בלי משא ומתן.` +
        costLine +
        " נבקש מהקרן הנוכחית להשוות את דמי הניהול, ואם תסרב — נשקול מעבר, אחרי בדיקה של המסלול והכיסוי הביטוחי.",
      accountIds: [a.id],
      costToRetirement: cost,
    }];
  });
}

function savingsFeeHigh(snapshot: Snapshot): Finding[] {
  const years = yearsLeft(snapshot);
  return snapshot.accounts.flatMap((a) => {
    if (a.kind !== "provident" && a.kind !== "study") return [];
    const fee = a.feeFromBalance ?? 0;
    if (fee <= SAVINGS_FEE_WORTH_RAISING) return [];
    const target = { fromDeposits: 0, fromBalance: SAVINGS_FEE_WORTH_RAISING };
    const cost = costVersus(a, target, years);
    const costLine =
      cost !== null && years !== null
        ? ` ההפרש מול ${pct(SAVINGS_FEE_WORTH_RAISING)} מצטבר לכ־${formatIls(cost)} עד הפרישה ${assumption(years)}`
        : "";
    return [{
      key: keyOf("savings_fee_high", [a]),
      rule: "savings_fee_high" as const,
      severity: costSeverity(cost),
      title: `דמי ניהול גבוהים — ${label(a)}`,
      body:
        `${label(a)} גובה ${pct(fee)} מהצבירה בשנה, על יתרה של ${formatIls(a.balance)}.` +
        costLine +
        " אפשר לבקש הפחתה מהגוף המנהל או להעביר את הכסף לגוף זול יותר, בלי אירוע מס ובלי לאבד ותק.",
      accountIds: [a.id],
      costToRetirement: cost,
    }];
  });
}

function noDisabilityCover(snapshot: Snapshot): Finding[] {
  const age = snapshot.client.age;
  if (age !== null && age >= PROJECTION.retirementAge) return [];
  if (snapshot.accounts.some((a) => a.coverage.disability)) return [];
  return [{
    key: keyOf("no_disability_cover", []),
    rule: "no_disability_cover",
    severity: "high",
    title: "אין כיסוי לאובדן כושר עבודה",
    body:
      "באף אחד מהמוצרים בדוח לא מופיע כיסוי לנכות או לאובדן כושר עבודה. " +
      "אם אין כיסוי כזה בפוליסה פרטית או דרך המעסיק, נבדוק איך להוסיף אותו — בדרך כלל הכי זול בתוך קרן הפנסיה.",
    accountIds: [],
    costToRetirement: null,
  }];
}

function noSurvivorsCover(snapshot: Snapshot): Finding[] {
  if (!snapshot.client.hasDependants) return [];
  if (snapshot.accounts.some((a) => a.coverage.death)) return [];
  return [{
    key: keyOf("no_survivors_cover", []),
    rule: "no_survivors_cover",
    severity: "high",
    title: "יש תלויים ואין כיסוי שארים",
    body:
      "בדוח מופיעים בן או בת זוג או ילדים, אבל באף מוצר אין כיסוי למקרה מוות (שארים). " +
      "נבדוק אם יש ביטוח חיים פרטי, ואם לא — נשקול להוסיף כיסוי שארים בקרן הפנסיה.",
    accountIds: [],
    costToRetirement: null,
  }];
}

function duplicateCover(snapshot: Snapshot): Finding[] {
  const out: Finding[] = [];
  const pairs: [keyof Pick<Account["coverage"], "death" | "disability">, string][] = [
    ["disability", "נכות ואובדן כושר עבודה"],
    ["death", "מוות (שארים)"],
  ];
  for (const [field, name] of pairs) {
    const covered = snapshot.accounts.filter((a) => a.coverage[field]);
    if (covered.length < 2) continue;
    const cost = covered.reduce((sum, a) => sum + (a.coverage.monthlyCost ?? 0), 0);
    out.push({
      key: keyOf("duplicate_cover", covered) + `:${field}`,
      rule: "duplicate_cover",
      severity: "medium",
      title: `כיסוי כפול ל${name}`,
      body:
        `כיסוי ל${name} מופיע ב־${covered.length} מוצרים: ${covered.map(label).join(", ")}. ` +
        (cost > 0 ? `העלות החודשית של הכיסויים במוצרים האלה יחד היא כ־${formatIls(cost)}. ` : "") +
        (field === "disability"
          ? "בכיסוי לאובדן כושר עבודה התגמול מכמה מקורות מוגבל, כך שייתכן שמשלמים על כיסוי שלא ישולם. נבדוק איזה כיסוי להשאיר."
          : "כיסוי שארים משולם מכל מקור, אבל ייתכן שהסכום הכולל גבוה ממה שהמשפחה צריכה. נבדוק כמה כיסוי נחוץ ואיפה הכי זול להחזיק אותו."),
      accountIds: covered.map((a) => a.id).sort(),
      costToRetirement: null,
    });
  }
  return out;
}

function severalActivePensions(snapshot: Snapshot): Finding[] {
  const active = snapshot.accounts.filter((a) => a.kind === "pension" && a.active);
  if (active.length < 2) return [];
  return [{
    key: keyOf("several_active_pensions", active),
    rule: "several_active_pensions",
    severity: "medium",
    title: `${active.length} קרנות פנסיה פעילות`,
    body:
      `יש הפקדות שוטפות ל־${active.length} קרנות פנסיה: ${active.map(label).join(", ")}. ` +
      "בדרך כלל עדיף לרכז את ההפקדות בקרן אחת — כך משלמים פעם אחת על הכיסוי הביטוחי, ודמי הניהול נקבעים על יתרה גדולה יותר. " +
      "לפני איחוד נבדוק את דמי הניהול, את המסלולים ואת התנאים של כל קרן.",
    accountIds: active.map((a) => a.id).sort(),
    costToRetirement: null,
  }];
}

function smallInactive(snapshot: Snapshot): Finding[] {
  const small = snapshot.accounts.filter(
    (a) => !a.active && a.balance > 0 && a.balance < SMALL_INACTIVE_BALANCE && (a.feeFromBalance ?? 0) > 0,
  );
  if (small.length === 0) return [];
  const yearly = small.reduce((sum, a) => sum + (a.balance * (a.feeFromBalance ?? 0)) / 100, 0);
  return [{
    key: keyOf("small_inactive_accounts", small),
    rule: "small_inactive_accounts",
    severity: "low",
    title: small.length === 1 ? "חשבון קטן לא פעיל" : `${small.length} חשבונות קטנים לא פעילים`,
    body:
      `${small.map((a) => `${label(a)} (${formatIls(a.balance)})`).join(", ")} — בלי הפקדות, ועדיין גובים דמי ניהול ` +
      `של כ־${formatIls(yearly)} בשנה יחד. ` +
      "אפשר לאחד אותם לחשבון פעיל מאותו סוג, בלי אירוע מס.",
    accountIds: small.map((a) => a.id).sort(),
    costToRetirement: null,
  }];
}

const RULES = [
  aboveLegalMax,
  pensionAboveDefault,
  savingsFeeHigh,
  noDisabilityCover,
  noSurvivorsCover,
  duplicateCover,
  severalActivePensions,
  smallInactive,
];

/** Every finding, the most serious first; within a severity, the costliest first. */
export function analyse(snapshot: Snapshot): Finding[] {
  return RULES.flatMap((rule) => rule(snapshot)).sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.costToRetirement ?? 0) - (a.costToRetirement ?? 0) ||
      a.key.localeCompare(b.key),
  );
}
