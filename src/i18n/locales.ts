/**
 * The site's languages (user, 2026-10-15): Hebrew at the unprefixed address,
 * English at /en and French at /fr — the public pages only. English and
 * French ship dark: off unless the build's VITE_LOCALES names them ("en,fr"),
 * because the translations — and the licence and pension-marketing lines in
 * them — wait for a native speaker and the compliance adviser.
 */

export const LOCALES = ["he", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "he";

/** The languages a build serves, Hebrew always first; anything else in the list is ignored. */
export function enabledLocales(raw: string | undefined): Locale[] {
  const named = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Locale => (LOCALES as readonly string[]).includes(s) && s !== DEFAULT_LOCALE);
  return [DEFAULT_LOCALE, ...LOCALES.filter((l) => named.includes(l))];
}

// Read defensively: seo.ts imports this, and the build's SEO scripts compile it
// under Node, where `import.meta.env` does not exist.
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const ENABLED_LOCALES: Locale[] = enabledLocales(env?.VITE_LOCALES);

export const dirOf = (locale: Locale): "rtl" | "ltr" => (locale === "he" ? "rtl" : "ltr");

/**
 * What Dorit reads stays Hebrew whatever the page's language — a lead's
 * summary, a message's text. This is the note that says the visitor wrote
 * from the English or French site ("" for Hebrew), so she answers in kind.
 */
export function filledInNote(locale: Locale): string {
  return { he: "", en: "מולא באנגלית", fr: "מולא בצרפתית" }[locale];
}

/**
 * A visitor's free text as Dorit receives it: exactly as typed from the
 * Hebrew site, and with the note on a line of its own from English or French.
 */
export function withFilledInNote(text: string, locale: Locale): string {
  const note = filledInNote(locale);
  return note ? [text.trim(), `(${note})`].filter(Boolean).join("\n") : text;
}

/** The language a pathname is in, and the path without its prefix. */
export function splitLocale(pathname: string): { locale: Locale; rest: string } {
  const m = pathname.match(/^\/(en|fr)(?=\/|$|#|\?)/);
  if (!m) return { locale: DEFAULT_LOCALE, rest: pathname || "/" };
  return { locale: m[1] as Locale, rest: pathname.slice(m[0].length) || "/" };
}

/**
 * An internal address in a language: "/tools" → "/en/tools", "/" → "/en",
 * "/#start" → "/en/#start". A bare anchor ("#start") stays on the page it is
 * on, and Hebrew is unprefixed, so both come back unchanged; so does anything
 * that is not an internal path (https:, tel:, mailto:).
 */
export function localePath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE || !path.startsWith("/")) return path;
  if (path === "/") return `/${locale}`;
  if (path.startsWith("/#") || path.startsWith("/?")) return `/${locale}/${path.slice(1)}`;
  return `/${locale}${path}`;
}
