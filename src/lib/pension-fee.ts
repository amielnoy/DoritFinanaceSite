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
 * מודל חודשי: תשואה → הפקדה בניכוי דמי הפקדה → גביית דמי ניהול שוטפים.
 * `lostToFees` מושווה לתרחיש אידיאלי באותה תשואה וללא דמי ניהול כלל.
 */
export function computePensionFees(input: PensionFeeInput): PensionFeeResult {
  const monthly = num(input.monthlyDeposit);
  const depositFeeRate = num(input.depositFee) / 100;
  const annualFeeRate = num(input.annualFee) / 100;
  const years = num(input.years);
  const returnRate = num(input.annualReturn) / 100;

  const months = Math.max(0, Math.floor(years * 12));
  const monthlyReturn = returnRate / 12;
  const monthlyAnnualFee = annualFeeRate / 12;

  let balance = 0;
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

  let optimal = 0;
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
