// חישוב דמי ניהול פנסיוניים — לוגיקה טהורה, מופרדת מהרכיב כדי שתהיה ניתנת לבדיקה.
// Pure pension-fee math, kept out of the component so it can be unit tested.

export interface PensionFeeInput {
  /** הפקדה חודשית בש״ח */
  monthlyDeposit: number | string;
  /** דמי ניהול מהפקדה, באחוזים */
  depositFee: number | string;
  /** דמי ניהול שוטפים, באחוזים לשנה */
  annualFee: number | string;
  /** שנות חיסכון */
  years: number | string;
  /** תשואה שנתית צפויה, באחוזים */
  annualReturn: number | string;
  /** יתרה פתיחה בש״ח — חיסכון קיים. ברירת מחדל 0, כמו במחשבון. */
  startingBalance?: number;
}

export interface PensionFeeResult {
  /** סך ההפקדות ברוטו */
  totalDeposited: number;
  /** צבירת דמי הניהול מההפקדות */
  totalDepositFees: number;
  /** צבירת דמי הניהול השוטפים */
  totalAnnualFees: number;
  /** סך כל דמי הניהול */
  totalFees: number;
  /** היתרה הצפויה בסוף התקופה */
  balance: number;
  /** ההפרש מול תרחיש ללא דמי ניהול כלל */
  lostToFees: number;
}

/** ערך מספרי בטוח: מחרוזת ריקה, NaN או ערך חסר נחשבים 0. */
const num = (v: number | string | undefined | null): number => Number(v) || 0;

/**
 * הטווחים שהחישוב מקבל — כמו RANGES ב-retirement-projection.ts: ערך שהוקלד מעבר להם נחתך.
 * What the math takes (review 2026-10-15): 1e9 years looped for minutes and a
 * 500% fee went negative. Anything typed past a range is clamped to it.
 */
export const PENSION_FEE_RANGES = {
  years: { min: 0, max: 60 },
  depositFee: { min: 0, max: 100 },
  annualFee: { min: 0, max: 100 },
  annualReturn: { min: 0, max: 100 },
} as const;

const clamp = (v: number, { min, max }: { min: number; max: number }): number => Math.min(max, Math.max(min, v));

/**
 * מודל חודשי: תשואה → הפקדה בניכוי דמי הפקדה → גביית דמי ניהול שוטפים.
 * `lostToFees` מושווה לתרחיש אידיאלי באותה תשואה וללא דמי ניהול כלל.
 */
export function computePensionFees(input: PensionFeeInput): PensionFeeResult {
  const monthly = Math.max(0, num(input.monthlyDeposit));
  const depositFeeRate = clamp(num(input.depositFee), PENSION_FEE_RANGES.depositFee) / 100;
  const annualFeeRate = clamp(num(input.annualFee), PENSION_FEE_RANGES.annualFee) / 100;
  const years = clamp(num(input.years), PENSION_FEE_RANGES.years);
  const returnRate = clamp(num(input.annualReturn), PENSION_FEE_RANGES.annualReturn) / 100;

  const months = Math.max(0, Math.floor(years * 12));
  const monthlyReturn = returnRate / 12;
  const monthlyAnnualFee = annualFeeRate / 12;

  const opening = Math.max(0, num(input.startingBalance));
  let balance = opening;
  let totalDeposited = 0;
  let totalDepositFees = 0;
  let totalAnnualFees = 0;

  for (let m = 1; m <= months; m++) {
    balance *= 1 + monthlyReturn;
    const feeOnDeposit = monthly * depositFeeRate;
    totalDeposited += monthly;
    totalDepositFees += feeOnDeposit;
    balance += monthly - feeOnDeposit;
    const mgmtFee = balance * monthlyAnnualFee;
    balance -= mgmtFee;
    totalAnnualFees += mgmtFee;
  }

  let optimal = opening;
  for (let m = 1; m <= months; m++) {
    optimal *= 1 + monthlyReturn;
    optimal += monthly;
  }

  return {
    totalDeposited,
    totalDepositFees,
    totalAnnualFees,
    totalFees: totalDepositFees + totalAnnualFees,
    balance,
    lostToFees: optimal - balance,
  };
}

/** תצוגת שקלים בעברית, ללא אגורות. */
export function formatIls(n: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));
}
