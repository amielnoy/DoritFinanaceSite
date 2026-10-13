/**
 * Trusted Types: the policies this site's own code needs.
 *
 * vercel.json asks for `require-trusted-types-for 'script'`, report-only for
 * now. Under it the browser refuses a plain string at an injection sink —
 * `script.src`, `innerHTML`, `DOMParser.parseFromString` — and reports each
 * one. Three sinks are hit on page loads, and all are ours to vouch for:
 *
 *   - Vercel Analytics sets `script.src = "/_vercel/insights/script.js"`. The
 *     `default` policy, which the browser consults for any sink given a plain
 *     string, accepts a script URL only when it is same-origin — the same line
 *     `script-src 'self'` already draws. It defines nothing for HTML or script
 *     text, so those sinks stay refused.
 *   - The stale-tab check (freshness.ts) parses the server's index.html to read
 *     one attribute. A document from `DOMParser` is inert — its scripts never
 *     run — so `freshnessHtml` hands the text through under its own name.
 *   - seo.ts writes structured data into `<script type="application/ld+json">`,
 *     and a script's text is a sink whatever its type. `jsonLdText` takes the
 *     data, not a string, and serialises it itself, so only JSON goes through
 *     — into a block the browser reads and never runs.
 *
 * Browsers without Trusted Types get plain strings, exactly as before.
 */

interface TrustedTypePolicyLike {
  createHTML?(input: string): unknown;
  createScript?(input: string): unknown;
}

interface TrustedTypesFactory {
  createPolicy(
    name: string,
    rules: {
      createHTML?: (s: string) => string;
      createScript?: (s: string) => string;
      createScriptURL?: (s: string) => string;
    },
  ): TrustedTypePolicyLike;
}

function factory(): TrustedTypesFactory | undefined {
  return (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
}

/** A script URL is trusted only if it resolves to this origin. */
export function sameOriginScriptUrl(url: string, origin = window.location.origin): string {
  const resolved = new URL(url, origin);
  if (resolved.origin !== origin) throw new TypeError(`script URL refused by Trusted Types: ${resolved.origin}`);
  return url;
}

let htmlPolicy: TrustedTypePolicyLike | null = null;
let jsonLdPolicy: TrustedTypePolicyLike | null = null;

/** Create the policies once, before anything renders. Safe to call again. */
export function installTrustedTypes(): void {
  const tt = factory();
  if (!tt || htmlPolicy) return;
  try {
    tt.createPolicy("default", { createScriptURL: (s) => sameOriginScriptUrl(s) });
    htmlPolicy = tt.createPolicy("freshness", { createHTML: (s) => s });
    jsonLdPolicy = tt.createPolicy("jsonld", { createScript: (s) => s });
  } catch (e) {
    // A policy of that name already exists (a second bundle on the page), or
    // an enforced `trusted-types` allow-list leaves ours out. Either way the
    // sinks fall back to reporting; nothing here should stop the page.
    console.warn("Trusted Types policies not installed:", e);
  }
}

/** The fetched index.html, as something `DOMParser` accepts under Trusted Types. */
export function freshnessHtml(text: string): string {
  return (htmlPolicy?.createHTML?.(text) as string | undefined) ?? text;
}

/** Structured data for an `application/ld+json` script's text — serialised here, never a caller's string. */
export function jsonLdText(data: unknown): string {
  const json = JSON.stringify(data);
  return (jsonLdPolicy?.createScript?.(json) as string | undefined) ?? json;
}
