import type { Locale } from "@/i18n/locales";
import heCommon from "@/i18n/locales/he/common.json";
import enCommon from "@/i18n/locales/en/common.json";
import frCommon from "@/i18n/locales/fr/common.json";
import hePension from "@/i18n/locales/he/pension.json";
import enPension from "@/i18n/locales/en/pension.json";
import frPension from "@/i18n/locales/fr/pension.json";
import heHome from "@/i18n/locales/he/home.json";
import enHome from "@/i18n/locales/en/home.json";
import frHome from "@/i18n/locales/fr/home.json";
import heFaq from "@/i18n/locales/he/faq.json";
import enFaq from "@/i18n/locales/en/faq.json";
import frFaq from "@/i18n/locales/fr/faq.json";
import heYearend from "@/i18n/locales/he/yearend.json";
import enYearend from "@/i18n/locales/en/yearend.json";
import frYearend from "@/i18n/locales/fr/yearend.json";
import heClaims from "@/i18n/locales/he/claims.json";
import enClaims from "@/i18n/locales/en/claims.json";
import frClaims from "@/i18n/locales/fr/claims.json";
import heTools from "@/i18n/locales/he/tools.json";
import enTools from "@/i18n/locales/en/tools.json";
import frTools from "@/i18n/locales/fr/tools.json";

/**
 * The resource files, one per namespace and language
 * (src/i18n/locales/<lang>/<namespace>.json). Hebrew is the source: its keys
 * are the type, so `t("nav.tols")` fails to compile, and
 * tests/unit/i18n-resources.test.ts holds English and French to the same keys
 * and the same {placeholders}.
 *
 * Only what a visitor reads is here. Values the site sends — a
 * questionnaire's answers, a lead's topic, GA4's closed values, the summary
 * Dorit reads — stay Hebrew in code, whatever the page's language.
 */
const HE = { common: heCommon, pension: hePension, home: heHome, faq: heFaq, yearend: heYearend, claims: heClaims, tools: heTools };

export type Namespace = keyof typeof HE;
export type KeyOf<N extends Namespace> = keyof (typeof HE)[N] & string;
type Table = { [N in Namespace]: Record<KeyOf<N>, string> };

export const RESOURCES: Record<Locale, Table> = {
  he: HE,
  en: { common: enCommon, pension: enPension, home: enHome, faq: enFaq, yearend: enYearend, claims: enClaims, tools: enTools },
  fr: { common: frCommon, pension: frPension, home: frHome, faq: frFaq, yearend: frYearend, claims: frClaims, tools: frTools },
};
