// ניהול תגיות SEO לפי עמוד. Per-route document metadata for the SPA.
//
// index.html ships one static head, so without this every route served the same
// title, description and — worst — the same canonical pointing at the homepage,
// which tells search engines that /blog, /claims and every post *are* the
// homepage. This module gives each route its own head.

import { useEffect } from "react";

// tsconfig sets `types: []`, so Vite's ImportMeta augmentation is not loaded.
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

/** Canonical origin. Override per environment with VITE_SITE_URL. */
export const SITE_URL: string = (
  viteEnv?.VITE_SITE_URL ?? "https://safe-arch-plan.base44.app"
).replace(/\/+$/, "");

export const SITE_NAME = "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח";

// A photograph of Dorit, not the generated stock image it used to be: the
// card a shared link unfurls into is the first face of the business.
export const DEFAULT_OG_IMAGE = absoluteUrl("/images/dorit-office-portrait.png");

/** Resolve a path or absolute URL to an absolute, canonical URL. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  // Trailing slash only for the root, so /blog and /blog/ never split ranking.
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path.replace(/\/+$/, "")}`;
}

/** Clamp a description to the ~160 chars search engines actually render. */
export function clampDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export interface SeoConfig {
  /** Full <title>. Keep under ~60 chars so it is not truncated in results. */
  title: string;
  description: string;
  /** Route path, e.g. "/blog". Becomes the canonical and og:url. */
  path: string;
  /** og:type — "website" for pages, "article" for blog posts. */
  type?: "website" | "article";
  image?: string;
  imageAlt?: string;
  /** Keep this route out of the index (auth screens, admin). */
  noIndex?: boolean;
  /** ISO date for article:published_time. */
  publishedTime?: string;
  /** article:tag entries. */
  tags?: string[];
  /** JSON-LD objects to inject for this route only. */
  jsonLd?: Array<Record<string, unknown>>;
}

const MANAGED = "data-seo";

function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute(MANAGED, "");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

const meta = (name: string, content: string) =>
  upsertMeta(`meta[name="${name}"]`, "name", name, content);

const og = (property: string, content: string) =>
  upsertMeta(`meta[property="${property}"]`, "property", property, content);

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    el.setAttribute(MANAGED, "");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Drop the previous route's multi-valued and route-scoped tags. */
function clearRouteScoped() {
  const stale = document.head.querySelectorAll(
    `meta[property="article:tag"], meta[property="article:published_time"], script[${MANAGED}-jsonld]`
  );
  Array.from(stale).forEach((el) => el.remove());
}

/**
 * Applies a route's metadata to <head>. Every public page calls this, so each
 * route carries its own title, description, canonical, social cards and
 * structured data.
 */
export function applySeo(config: SeoConfig): void {
  if (typeof document === "undefined") return;

  const {
    title,
    description,
    path,
    type = "website",
    image = DEFAULT_OG_IMAGE,
    imageAlt = SITE_NAME,
    noIndex = false,
    publishedTime,
    tags,
    jsonLd,
  } = config;

  const url = absoluteUrl(path);
  const desc = clampDescription(description);

  clearRouteScoped();

  document.title = title;
  meta("description", desc);
  upsertLink("canonical", url);

  meta(
    "robots",
    noIndex
      ? "noindex, nofollow"
      : "index, follow, max-image-preview:large, max-snippet:-1"
  );

  og("og:title", title);
  og("og:description", desc);
  og("og:url", url);
  og("og:type", type);
  og("og:image", image);
  og("og:image:alt", imageAlt);
  og("og:site_name", SITE_NAME);
  og("og:locale", "he_IL");

  meta("twitter:card", "summary_large_image");
  meta("twitter:title", title);
  meta("twitter:description", desc);
  meta("twitter:image", image);
  meta("twitter:image:alt", imageAlt);

  if (publishedTime) {
    const el = document.createElement("meta");
    el.setAttribute("property", "article:published_time");
    el.setAttribute("content", publishedTime);
    document.head.appendChild(el);
  }
  for (const tag of tags ?? []) {
    const el = document.createElement("meta");
    el.setAttribute("property", "article:tag");
    el.setAttribute("content", tag);
    document.head.appendChild(el);
  }

  for (const block of jsonLd ?? []) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(`${MANAGED}-jsonld`, "");
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  }
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A JSON-LD block serialized for a `<script>` element's text content.
 *
 * `JSON.stringify` alone is not safe to inline there: a post's own body can
 * legitimately contain the substring `</script>` (a code sample, a quoted
 * snippet), and the HTML parser closes the script element the moment it sees
 * that sequence — whatever text follows in the document then renders as raw
 * markup. `<`, `>` and `&` are escaped as their Unicode equivalents (valid
 * inside a JSON string, invisible to `JSON.parse`) rather than as HTML
 * entities, which would corrupt the JSON itself. U+2028/U+2029 are escaped
 * too — valid in a JSON string but treated as line terminators by some JS
 * parsers, which has broken inline JSON elsewhere on the web.
 */
function jsonLdScript(block: Record<string, unknown>): string {
  return JSON.stringify(block)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * `applySeo`'s server-side twin: the same `SeoConfig` in, but patches a raw
 * HTML document string instead of `document.head` — for the one context
 * `applySeo` cannot reach, a server response to a crawler that never runs the
 * app's JavaScript (see `api/og/blog/[id].ts`).
 *
 * Targeted replacements on the tags `index.html` already ships, in the same
 * spirit as `scripts/prerender.mjs`'s own string patches — not a template
 * engine, because the shell already has every tag this needs to overwrite.
 * Route-scoped additions (article:*, JSON-LD) are appended before `</head>`,
 * since the shell has no placeholder for them.
 */
export function renderSeoHtml(html: string, config: SeoConfig): string {
  const {
    title,
    description,
    path,
    type = "website",
    image = DEFAULT_OG_IMAGE,
    imageAlt = SITE_NAME,
    noIndex = false,
    publishedTime,
    tags,
    jsonLd,
  } = config;

  const url = absoluteUrl(path);
  const desc = clampDescription(description);
  const t = escapeHtmlAttr(title);
  const d = escapeHtmlAttr(desc);
  const u = escapeHtmlAttr(url);
  const img = escapeHtmlAttr(image);

  // A replacer *function* is required, not a template string: a title or
  // description is free text (plausibly "השקיעי $200 בחודש" on this site), and
  // a literal `$1`, `$&`, `` $` `` or `$'` in a string replacement is
  // special-cased by `String.replace` as a backreference or match-insertion —
  // which can itself corrupt the surrounding tag. A function's return value is
  // always inserted literally.
  const robots = noIndex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large, max-snippet:-1";

  let out = html;
  out = out.replace(/<title>.*?<\/title>/s, () => `<title>${t}</title>`);
  out = out.replace(/(<meta name="description" content=")[^"]*(")/, (_m, a, b) => `${a}${d}${b}`);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => `${a}${u}${b}`);
  out = out.replace(/(<meta name="robots" content=")[^"]*(")/, (_m, a, b) => `${a}${robots}${b}`);
  out = out.replace(/(<meta property="og:type" content=")[^"]*(")/, (_m, a, b) => `${a}${type}${b}`);
  out = out.replace(/(<meta property="og:title" content=")[^"]*(")/, (_m, a, b) => `${a}${t}${b}`);
  out = out.replace(/(<meta property="og:description" content=")[^"]*(")/, (_m, a, b) => `${a}${d}${b}`);
  out = out.replace(/(<meta property="og:url" content=")[^"]*(")/, (_m, a, b) => `${a}${u}${b}`);
  out = out.replace(/(<meta property="og:image" content=")[^"]*(")/, (_m, a, b) => `${a}${img}${b}`);
  out = out.replace(/(<meta name="twitter:title" content=")[^"]*(")/, (_m, a, b) => `${a}${t}${b}`);
  out = out.replace(/(<meta name="twitter:description" content=")[^"]*(")/, (_m, a, b) => `${a}${d}${b}`);
  out = out.replace(/(<meta name="twitter:image" content=")[^"]*(")/, (_m, a, b) => `${a}${img}${b}`);

  const extra: string[] = [`<meta property="og:image:alt" content="${escapeHtmlAttr(imageAlt)}" />`];
  if (publishedTime) {
    extra.push(`<meta property="article:published_time" content="${escapeHtmlAttr(publishedTime)}" />`);
  }
  for (const tag of tags ?? []) {
    extra.push(`<meta property="article:tag" content="${escapeHtmlAttr(tag)}" />`);
  }
  for (const block of jsonLd ?? []) {
    extra.push(`<script type="application/ld+json">${jsonLdScript(block)}</script>`);
  }
  out = out.replace("</head>", () => `${extra.join("\n")}\n</head>`);

  return out;
}

/** Route-level SEO. Re-applies whenever the described content changes. */
export function useSeo(config: SeoConfig | null): void {
  const key = config ? JSON.stringify(config) : "";
  useEffect(() => {
    if (!config) return;
    applySeo(config);
    // No cleanup: the next route applies its own head. Removing tags here would
    // blank the metadata for the instant between two routes rendering.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Breadcrumb structured data — helps search engines show a page's context. */
export function breadcrumbLd(
  trail: Array<{ name: string; path: string }>
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
