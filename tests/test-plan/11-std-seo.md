# STD-11 — SEO Tests

**Suite:** `seo` · **Runners:** `npm run test:e2e:seo` (Playwright), `npm run test:unit` (helpers)
**Location:** `e2e/seo/`, `tests/unit/seo.dom.test.ts`
**Cases:** 19 unit + 47 e2e (× applicable platforms)

---

## 1. Purpose

The site is a client-rendered SPA with a single static `<head>`. Before this
work every one of the thirteen routes served the same title, the same
description and — most damagingly — the same `<link rel="canonical">` pointing
at the home page, which tells search engines that `/blog`, `/claims` and every
article *are* the home page and should be dropped from the index.

This suite proves each route now ships its own metadata, that private routes
stay out of the index, that structured data is valid and correctly scoped, and
that the mobile render — the one Google actually ranks — matches the desktop
one.

## 2. Test items

| Item | Source |
|---|---|
| Per-route metadata engine | `src/lib/seo.ts` |
| Home-only FAQ markup | `src/lib/structured-data.ts` |
| Private-route noindex guard | `src/components/SeoRouteGuard.tsx` |
| Static head | `index.html` |
| Build-time prerender | `scripts/prerender.mjs`, wired in as `npm run build:prerender` (the `buildCommand` in `vercel.json`) |
| Crawl directives | `public/robots.txt`, `public/sitemap.xml` |
| Host rewriting | `scripts/vite-site-url-plugin.mjs` — rewrites the origin in `index.html`, `sitemap.xml`, `robots.txt` and `llms.txt` when `VITE_SITE_URL` names a different one |
| Page-level declarations | `src/pages/{Home,Blog,BlogPost,Claims,PrivacyPolicy,Accessibility}.tsx`, `src/lib/PageNotFound.jsx` |

## 3. Unit cases — `tests/unit/seo.dom.test.ts`

| ID | Title | Expected result |
|---|---|---|
| SEO-URL-001 | "resolves a route path against the canonical origin" | `/blog` → `<origin>/blog` |
| SEO-URL-002 | "keeps the root's trailing slash but strips it elsewhere" | `/blog` and `/blog/` collapse to one URL, so ranking never splits |
| SEO-URL-003 | "tolerates a path without a leading slash" | `claims` → `<origin>/claims` |
| SEO-URL-004 | "passes an already-absolute URL through untouched" | CDN image URLs survive |
| SEO-URL-005 | "never emits a protocol-relative or doubled-slash URL" | No `//` after the origin |
| SEO-DSC-001..003 | `clampDescription` — leaves short text, collapses whitespace, truncates on a word boundary ≤161 chars | Search engines render ~160 |
| SEO-APL-001 | "sets the title, description and a canonical for the route" | All three present |
| SEO-APL-002 | "gives each route its own canonical" | Canonical changes with the route |
| SEO-APL-003 | "populates the Open Graph and Twitter cards" | og:title/url/type/image/image:alt/locale + twitter:card/image |
| SEO-APL-004 | "marks a public route as indexable" | `index, follow, …` |
| SEO-APL-005 | "marks a private route noindex, nofollow" | Exactly `noindex, nofollow` |
| SEO-APL-006 | "emits article metadata only for articles" | `og:type=article`, published time, one `article:tag` per tag |
| SEO-APL-007 | "clears the previous article's tags when navigating to a plain page" | Zero stale `article:tag` / `article:published_time` |
| SEO-APL-008 | "injects route-scoped JSON-LD and removes the previous route's" | Only the current route's blocks remain |
| SEO-APL-009 | "never duplicates a tag across repeated navigations" | Exactly one of each tag after 5 navigations |
| SEO-APL-010 | "truncates an over-long description before it reaches the tag" | ≤161 chars |
| SEO-BRD-001 | "builds a positioned BreadcrumbList with absolute item URLs" | Sequential `position`, absolute `item` |

## 4. e2e cases — `e2e/seo/metadata.spec.ts`

### 4.1 Per-route metadata

| ID | Title | Expected result |
|---|---|---|
| SEO-MET-001..006 | "`<route>` has its own title, description and canonical" for `/`, `/blog`, `/blog/:id`, `/claims`, `/privacy`, `/accessibility` | Title ≤75 chars and route-specific; description 50–161 chars; canonical path equals the route |
| SEO-MET-007 | "every public route's title and canonical are unique" | Six distinct titles, canonicals and descriptions — the regression that would return if the static head came back |
| SEO-MET-008 | "navigating between routes replaces the metadata instead of stacking it" | Exactly one description, canonical, og:title and robots tag after navigation |

### 4.2 Indexability

| ID | Title | Expected result |
|---|---|---|
| SEO-IDX-001..006 | "`<route>` is indexable" | `robots` contains `index`, never `noindex` |
| SEO-IDX-007..010 | "`/login`, `/register`, `/forgot-password`, `/admin/leads` are kept out of the index" | `noindex` present |
| SEO-IDX-011 | "a missing blog post is noindex, not a thin indexable page" | Not-found view sends `noindex` |
| SEO-IDX-012 | "the 404 page is noindex" | `noindex` present |

### 4.3 Social sharing

| ID | Title | Expected result |
|---|---|---|
| SEO-OG-001 | "the home page ships a complete Open Graph card" | og:title/description/type/locale/image/image:alt + `summary_large_image` |
| SEO-OG-002 | "a blog post shares as an article with its own image and date" | `og:type=article`, the post's own image, its published time, its tags |
| SEO-OG-003 | "a post without its own image falls back to the site card" | An https image is always present |

### 4.4 Structured data

| ID | Title | Expected result |
|---|---|---|
| SEO-LD-001 | "every JSON-LD block on every route is valid schema.org" | Every block parses with `@context` and `@type` |
| SEO-LD-002 | "FAQPage markup appears only where the questions are rendered" | Present on `/` (which renders `#faq`); **absent** on `/privacy`, `/blog`, `/accessibility` |
| SEO-LD-003 | "inner pages carry a breadcrumb trail back to the home page" | `BreadcrumbList` starting at "ראשי" and ending at the current path |
| SEO-LD-004 | "a blog post publishes BlogPosting markup with author and publisher" | Headline, date, Person author, Organization publisher, `mainEntityOfPage`, and a description free of markdown syntax |
| SEO-LD-005 | "the claims page describes itself as a Service" | `Service` type present |

### 4.5 Crawl directives

| ID | Title | Expected result |
|---|---|---|
| SEO-CRW-001 | "robots.txt keeps private areas out of crawl budget" | `Disallow` for `/admin/`, `/login`, `/register`, `/oauth/`; public site still allowed; AI crawlers still allowed |
| SEO-CRW-002 | "the sitemap lists every public content route" | `/`, `/blog`, `/claims`, `/faq`, `/privacy`, `/accessibility` |
| SEO-CRW-003 | "the sitemap lists no route that is marked noindex" | No contradiction between the two signals |
| SEO-CRW-004 | "sitemap URLs share the canonical origin the pages declare" | One origin across both |

## 5. Mobile SEO cases — `e2e/seo/mobile-parity.spec.ts`

Google indexes and ranks from the mobile render, so a phone viewport that shows
less content than the desktop one loses the desktop version's rankings.

| ID | Title | Method | Expected result |
|---|---|---|---|
| SEO-MOB-001 | "phone and desktop serve identical metadata and structured data" | Opens a Pixel 7 and a desktop context in one test and compares five routes | Title, description, canonical, robots and JSON-LD types match exactly |
| SEO-MOB-002 | "the phone render is not a stripped-down version of the desktop one" | Compares content text with header/footer/nav removed | Mobile ≥98% of desktop content |
| SEO-MOB-003 | "declares a responsive viewport that permits zoom" | Mobile projects | `width=device-width`, `initial-scale=1`, no `user-scalable=no`, no `maximum-scale=1` |
| SEO-MOB-004 | "body copy is legible without pinch-zooming" | Sentence-length prose only (≥60 chars) | No body copy under 12px |
| SEO-MOB-005 | "reports sub-12px display labels (informational)" | All short labels | Always passes; records the count as an annotation — see [10-known-issues](10-known-issues.md) |
| SEO-MOB-006 | "the LCP hero image is preloaded and eagerly fetched" | Mobile projects | One `link[rel=preload][as=image]` with `fetchpriority=high` |
| SEO-MOB-007 | "fonts do not block the first paint" | Asserts on the **served HTML**, not the post-load DOM | The only plain font stylesheet link is inside `<noscript>`; a `rel=preload as=style` is present |

> SEO-MOB-007 asserts on the HTML source deliberately: the async pattern
> promotes its own `preload` to `rel="stylesheet"` once loaded, so a post-load
> DOM check would always see a "render-blocking" link that never blocked.

## 5a. Prerender cases — `e2e/seo/prerender.spec.ts`

Every other spec here drives a browser, so it measures what **Google** sees —
Google runs JavaScript. These use `request` and never `page`: nothing may pass
because a browser repaired it afterwards, which is the entire point. They are
what fails if `scripts/prerender.mjs` silently stops running.

| ID | Title | Expected result |
|---|---|---|
| SEO-PRE-001..008 | "`<route>` is served with its own title and canonical" for the eight public routes | The **served HTML** carries the route's own title, and a canonical whose path is the route — not `/` |
| SEO-PRE-009 | "no two routes are served the same title or canonical" | Eight distinct titles and canonicals. The regression this catches is the original defect returning wholesale: eight files, all of them the home page |
| SEO-PRE-010 | "the FAQ answers are in the HTML, not only in the JavaScript" | Every question **and answer** the served `FAQPage` markup declares appears as text in the same document — the property that makes `/faq` citable by an assistant |
| SEO-PRE-011 | "the prerendered pages carry no build-host URLs" | No `127.0.0.1` or `localhost` in any prerendered page. Vite's `modulepreload` hints arrive absolute from the preview server and would otherwise ship |

> Blog posts are deliberately not prerendered: they come from the Base44 backend
> at runtime, so a prerender would bake a snapshot into the bundle and go stale
> the moment a post is edited. They keep the SPA shell, and `useSeo` keeps
> governing their head for crawlers that execute JavaScript.


## 6. Pass criteria

All 19 unit and 47 e2e cases pass, with SEO-MOB-005 reporting rather than
enforcing. SEO-MET-007 and SEO-LD-002 are the two that would fail first if the
per-route head regressed in the browser; SEO-PRE-009 is the one that fails if it
regressed in the HTML.
