// מחשבון → ליד: ההודעה שנפתחת בוואטסאפ עם התוצאה של כל כלי ב-/tools.
// The calculator → lead box: the WhatsApp message each tool pre-fills.
//
// The message carries what the visitor typed and what the tool showed, from
// their own phone to Dorit, and they see it before it is sent. None of it goes
// to GA4: `calculator_result` carries the tool's name and nothing else.

import { CONTACT } from "@/config/contact";
import { formatIls, type PensionFeeInput, type PensionFeeResult } from "@/lib/pension-fee";
import type { Recommendation } from "@/lib/insurance-assessment";

/**
 * How long the fee calculator's inputs must stay still before its result
 * counts as one the visitor saw: long enough to outlast typing "3000" one
 * digit at a time, short enough to catch someone who reads and moves on.
 */
export const RESULT_SETTLE_MS = 1500;

/** A chat with Dorit on WhatsApp, `text` already written. The number is config's. */
export function whatsappHref(text: string): string {
  return `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}`;
}

const finite = (v: number | string | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const FEE_FALLBACK = "שלום דורית, השתמשתי במחשבון דמי הניהול באתר. אשמח לבדיקה של הנתונים האמיתיים שלי.";

/**
 * The fee calculator's result as one sentence: a year's fees on average, the
 * total over the saving years, and the monthly deposit it was worked out for.
 * With no result to speak of — an empty field, zero years, a figure too large
 * to print — it asks for a check without numbers.
 */
export function feeCalculatorMessage(
  input: Pick<PensionFeeInput, "monthlyDeposit" | "years">,
  result: Pick<PensionFeeResult, "totalFees">
): string {
  const years = finite(input.years);
  const deposit = finite(input.monthlyDeposit);
  const total = result.totalFees;
  if (!(years > 0) || !(deposit > 0) || !Number.isFinite(total) || !(total > 0)) return FEE_FALLBACK;
  return (
    `שלום דורית, מחשבון דמי הניהול באתר הראה שאני משלם/ת כ-${formatIls(total / years)} בשנה דמי ניהול בממוצע — ` +
    `כ-${formatIls(total)} לאורך ${years} שנות חיסכון, בהפקדה חודשית של ${formatIls(deposit)}. ` +
    `אשמח לבדיקה של הנתונים האמיתיים שלי.`
  );
}

const ASSESSMENT_CLOSE = "אשמח לבדיקה של מה שיש לי היום בפועל.";

/**
 * The insurance self-check's result: the kinds of insurance it listed, and how
 * many of them it marked high priority — the tool's own words, not advice.
 */
export function assessmentMessage(recs: ReadonlyArray<Pick<Recommendation, "title" | "priority">>): string {
  if (recs.length === 0) return `שלום דורית, מילאתי באתר את הבדיקה העצמית לביטוח. ${ASSESSMENT_CLOSE}`;
  const opening = 'שלום דורית, מילאתי באתר את הבדיקה העצמית "איזה ביטוח באמת מתאים לך?"';
  const titles = recs.map((r) => r.title).join(", ");
  const listed =
    recs.length === 1
      ? `ויצא סוג ביטוח אחד לבחון: ${titles}`
      : `ויצאו ${recs.length} סוגי ביטוח לבחון: ${titles}`;
  const priority = recs.filter((r) => r.priority).length;
  const clause = priority === 0 ? "" : recs.length === 1 ? " (בעדיפות גבוהה)" : ` (${priority} מהם בעדיפות גבוהה)`;
  return `${opening} ${listed}${clause}. ${ASSESSMENT_CLOSE}`;
}

const RETIREMENT_FALLBACK = "שלום דורית, השתמשתי במחשבון הפרישה באתר. אשמח לחישוב לפי הנתונים האמיתיים שלי.";

/**
 * The retirement calculator's result as one sentence: the estimated monthly
 * pension at the retirement age it was worked out for. With nothing to speak
 * of — no years ahead, no balance — it asks for a check without numbers.
 */
export function retirementMessage(input: { retirementAge: number }, result: { monthlyPension: number; finalBalance: number }): string {
  const pension = result.monthlyPension;
  if (!Number.isFinite(pension) || !(pension > 0) || !(result.finalBalance > 0)) return RETIREMENT_FALLBACK;
  return (
    `שלום דורית, מחשבון הפרישה באתר העריך קצבה חודשית של כ-${formatIls(pension)} בגיל ${input.retirementAge}. ` +
    `אשמח לחישוב לפי הנתונים האמיתיים שלי.`
  );
}
