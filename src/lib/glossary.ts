import { GLOSSARY } from "@/content/glossary";
import type { Locale } from "@/i18n/locales";

/** A run of plain text, or a term to show with its tooltip. */
export type GlossSegment = string | { id: string; text: string };

// Hebrew attaches ו, ה, ב, ל, מ, ש, כ to the word that follows ("ובקרן
// השתלמות"); the prefix is underlined with the term, so the tooltip covers the
// word the reader actually sees.
const HE_PREFIX = "[ובהלמשכ]{0,3}";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Matcher {
  re: RegExp;
  idOf: Map<string, string>;
}
const cache = new Map<Locale, Matcher>();

function matcherFor(locale: Locale): Matcher {
  const hit = cache.get(locale);
  if (hit) return hit;
  const idOf = new Map<string, string>();
  for (const entry of GLOSSARY) {
    for (const form of entry[locale].match) idOf.set(form.toLowerCase(), entry.id);
  }
  // Longest first, so "קרן פנסיה" wins over "פנסיה" and "management fees" over "management fee".
  const forms = [...idOf.keys()].sort((a, b) => b.length - a.length).map(escape);
  const prefix = locale === "he" ? HE_PREFIX : "";
  // A term starts and ends at a word edge: never inside a longer word
  // ("פנסיונית" does not contain "פנסיה" as a term).
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${prefix}(${forms.join("|")}))(?=$|[^\\p{L}\\p{N}])`, "giu");
  const m = { re, idOf };
  cache.set(locale, m);
  return m;
}

/**
 * Shared by several texts that should mark each term only once between them
 * (an article's paragraphs). Results are kept per text, so a re-render returns
 * the same split instead of finding every term already "seen".
 */
export interface GlossScope {
  seen: Set<string>;
  done: Map<string, GlossSegment[]>;
}
export const newGlossScope = (): GlossScope => ({ seen: new Set(), done: new Map() });

/**
 * Splits `text` into plain runs and glossary terms. Each entry is marked once
 * per text — the first time it appears — so a paragraph that says "פנסיה" five
 * times carries one underline, not five. `seen` lets a caller share that rule
 * across several texts.
 */
export function glossSegments(text: string, locale: Locale, scope?: GlossScope): GlossSegment[] {
  if (!text) return [text];
  const kept = scope?.done.get(text);
  if (kept) return kept;
  const seen = scope?.seen ?? new Set<string>();
  const result = split(text, locale, seen);
  scope?.done.set(text, result);
  return result;
}

function split(text: string, locale: Locale, seen: Set<string>): GlossSegment[] {
  const { re, idOf } = matcherFor(locale);
  const out: GlossSegment[] = [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = idOf.get(m[3].toLowerCase());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    out.push({ id, text: m[2] });
    last = start + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}
