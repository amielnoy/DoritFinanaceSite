import type { FaqCategoryId, FaqEntry } from "@/content/faq";
import { translate } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/locales";

/*
 * The FAQ in a language. Kept apart from src/content/faq.ts, which the build's
 * SEO script loads under plain Node and so may import nothing but its JSON.
 */
/** An entry in a language: the same entry, with its question, answer and tip title translated. */
export function localizeFaq<E extends FaqEntry>(entry: E, locale: Locale): E {
  if (locale === "he") return entry;
  const text = (field: string) => translate(locale, "faq", `${entry.id}.${field}` as never);
  return {
    ...entry,
    q: text("q"),
    a: text("a"),
    ...(entry.tip ? { tip: { ...entry.tip, title: text("tip") } } : {}),
  };
}

/** A category's name in a language. */
export const faqCategoryLabel = (id: FaqCategoryId, locale: Locale): string =>
  translate(locale, "faq", `cat.${id}` as never);
