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
const HE = { common: heCommon, pension: hePension, home: heHome, faq: heFaq };

export type Namespace = keyof typeof HE;
export type KeyOf<N extends Namespace> = keyof (typeof HE)[N] & string;
type Table = { [N in Namespace]: Record<KeyOf<N>, string> };

export const RESOURCES: Record<Locale, Table> = {
  he: HE,
  en: { common: enCommon, pension: enPension, home: enHome, faq: enFaq },
  fr: { common: frCommon, pension: frPension, home: frHome, faq: frFaq },
};
