import { assessmentMessage, feeCalculatorMessage } from "@/lib/calculator-lead";
import { formatIls, type PensionFeeInput, type PensionFeeResult } from "@/lib/pension-fee";
import type { Recommendation } from "@/lib/insurance-assessment";
import { translate } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/locales";
import type { KeyOf } from "@/i18n/resources";

/*
 * The calculators' WhatsApp messages in the page's language. The visitor sends
 * them from their own phone, in their own name, and sees them first — so an
 * English page offers an English message. Hebrew is the existing wording,
 * unchanged: src/lib/calculator-lead.ts. tools.json's `msg.*` keys hold the
 * same sentences as templates, and tests/unit/i18n-tools.test.ts checks that
 * the Hebrew templates read exactly as calculator-lead.ts writes them.
 */

const t = (locale: Locale, key: KeyOf<"tools">, vars?: Record<string, string | number>) => translate(locale, "tools", key, vars);

const INTL: Record<Exclude<Locale, "he">, string> = { en: "en-IL", fr: "fr-FR" };

/**
 * Shekels in the page's language: Hebrew exactly as before (formatIls, with its
 * right-to-left marks); "₪123,456" in English and "123 456 ₪" in French, with
 * no direction marks inside a left-to-right sentence.
 */
export function formatIlsIn(locale: Locale, n: number): string {
  if (locale === "he") return formatIls(n);
  return new Intl.NumberFormat(INTL[locale], { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

/** The fee calculator's message, from the templates — for any language. */
export function feeMessageFromTemplates(
  locale: Locale,
  input: Pick<PensionFeeInput, "monthlyDeposit" | "years">,
  result: Pick<PensionFeeResult, "totalFees">,
): string {
  const years = Number(input.years);
  const deposit = Number(input.monthlyDeposit);
  const total = result.totalFees;
  if (!(years > 0) || !(deposit > 0) || !Number.isFinite(total) || !(total > 0)) return t(locale, "msg.feeFallback");
  const ils = (n: number) => formatIlsIn(locale, n);
  return t(locale, "msg.fee", { perYear: ils(total / years), total: ils(total), years, deposit: ils(deposit) });
}

/** The insurance self-check's message, from the templates — for any language. */
export function assessmentMessageFromTemplates(locale: Locale, recs: ReadonlyArray<Pick<Recommendation, "id" | "priority">>): string {
  const close = t(locale, "msg.assessClose");
  if (recs.length === 0) return `${t(locale, "msg.assessNone")} ${close}`;
  const titles = recs.map((r) => t(locale, `assess.rec.${r.id}` as KeyOf<"tools">)).join(", ");
  const listed = recs.length === 1 ? t(locale, "msg.assessOne", { titles }) : t(locale, "msg.assessMany", { n: recs.length, titles });
  const priority = recs.filter((r) => r.priority).length;
  const clause = priority === 0 ? "" : ` ${recs.length === 1 ? t(locale, "msg.assessPriorityOne") : t(locale, "msg.assessPriorityMany", { n: priority })}`;
  return `${t(locale, "msg.assessOpening")} ${listed}${clause}. ${close}`;
}

export function feeCalculatorMessageIn(
  locale: Locale,
  input: Pick<PensionFeeInput, "monthlyDeposit" | "years">,
  result: Pick<PensionFeeResult, "totalFees">,
): string {
  return locale === "he" ? feeCalculatorMessage(input, result) : feeMessageFromTemplates(locale, input, result);
}

export function assessmentMessageIn(locale: Locale, recs: ReadonlyArray<Recommendation>): string {
  return locale === "he" ? assessmentMessage(recs) : assessmentMessageFromTemplates(locale, recs);
}
