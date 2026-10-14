import React, { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, dirOf, localePath, type Locale } from "@/i18n/locales";
import { RESOURCES, type Namespace, type KeyOf } from "@/i18n/resources";

/**
 * The language a page is rendered in. Set once per route tree (LocaleLayout
 * in App.jsx: "/" Hebrew, "/en/*" English, "/fr/*" French); a component reads
 * it through useT / useLocalePath and never parses the address itself.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // The document's language and direction follow the page: screen readers
  // pronounce by `lang`, and `dir` turns the whole layout for English and French.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** "Hello, {name}" with { name: "Dana" } → "Hello, Dana". A missing value leaves its placeholder. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * The text of a key in the page's language. A key missing from English or
 * French falls back to the Hebrew rather than showing the key — a unit test
 * (i18n-resources.test.ts) keeps the three files in step, so this is a guard,
 * not a feature.
 */
export function translate<N extends Namespace>(locale: Locale, ns: N, key: KeyOf<N>, vars?: Record<string, string | number>): string {
  const own = (RESOURCES[locale][ns] as Record<string, string>)[key as string];
  const he = (RESOURCES[DEFAULT_LOCALE][ns] as Record<string, string>)[key as string];
  return interpolate(own || he || String(key), vars);
}

export function useT<N extends Namespace>(ns: N) {
  const locale = useLocale();
  return useMemo(
    () => (key: KeyOf<N>, vars?: Record<string, string | number>) => translate(locale, ns, key, vars),
    [locale, ns],
  );
}

/** Internal links in the page's language: "/tools" → "/en/tools" on an English page. */
export function useLocalePath(): (path: string) => string {
  const locale = useLocale();
  return useMemo(() => (path: string) => localePath(locale, path), [locale]);
}
