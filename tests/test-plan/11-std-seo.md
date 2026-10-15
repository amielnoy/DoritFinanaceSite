# STD-11 — SEO Tests

**Suite:** `seo` · **Runners:** `npm run test:e2e:seo` (Playwright), `npm run test:unit` (helpers)
**Location:** `e2e/seo/`, `tests/unit/seo.dom.test.ts`
**Cases:** 19 unit + 48 e2e (× applicable platforms)

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
| The old Base44 host | `src/lib/legacy-host.ts` (the decision), `src/lib/legacy-host-boot.ts` (the boot step in `main.jsx`) — on `safe-arch-plan.base44.app` a page goes noindex, names production canonical, and moves to the same address on `govari-fin.co.il` |
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
| SEO-IDX-007..008 | "`/login` and `/admin/leads` are kept out of the index" | `noindex` present |
| SEO-IDX-011 | "a missing blog post is noindex, not a thin indexable page" | Not-found view sends `noindex` |
| SEO-IDX-012 | "the 404 page is noindex" | `noindex` present |

**The 404 status itself is not asserted here.** `vite preview`, which this
suite runs against, answers every unknown path with `index.html` and a 200; it
does not read vercel.json. On Vercel an address no rewrite claims gets
`dist/404.html` — the not-found page, prerendered — with a 404 status, and
`/login`, `/account`, `/masleka` and `/admin/*` carry `X-Robots-Tag: noindex`
(D-05, manual test 2026-10-14). Both are pinned on the config by
`tests/contract/spa-routes.contract.test.ts` (STD-03), and are checked on a
deployment with `curl -I`.

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
| SEO-CRW-001 | "robots.txt keeps private areas out of crawl budget" | `Disallow` for `/admin/`, `/login`, `/oauth/`; public site still allowed; AI crawlers still allowed |
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
| SEO-MOB-006 | "the LCP hero image is preloaded and eagerly fetched" | Mobile projects | One `link[rel=preload][as=image]` (`type=image/avif`, `fetchpriority=high`) whose `imagesrcset`/`imagesizes` equal the hero's AVIF `<source>`; every file it names answers `200 image/avif`; the hero `<img>` is `loading=eager`, `fetchpriority=high` |
| SEO-MOB-007 | "fonts are self-hosted and do not block the first paint" | Asserts on the **served HTML** | No `fonts.googleapis.com`/`fonts.gstatic.com`; no font stylesheet link; at least one `rel=preload as=font type=font/woff2` with `crossorigin`; each preloaded `/fonts/…` file answers 200 and starts with `wOF2` |

> SEO-MOB-007 asserts on the HTML source deliberately: that is what a crawler
> and the first paint see. The fonts are self-hosted since A-74, so the check
> is that nothing leaves for Google and the critical faces are preloaded.

## 5a. Prerender cases — `e2e/seo/prerender.spec.ts`

Every other spec here drives a browser, so it measures what **Google** sees —
Google runs JavaScript. These use `request` and never `page`: nothing may pass
because a browser repaired it afterwards, which is the entire point. They are
what fails if `scripts/prerender.mjs` silently stops running.

| ID | Title | Expected result |
|---|---|---|
| SEO-PRE-001..008 | "`<route>` is served with its own title and canonical" for the eight public routes and the fixture article (SEO-PRE-012) | The **served HTML** carries the route's own title, and a canonical whose path is the route — not `/` |
| SEO-PRE-009 | "no two routes are served the same title or canonical" | Eight distinct titles and canonicals. The regression this catches is the original defect returning wholesale: eight files, all of them the home page |
| SEO-PRE-010 | "the FAQ answers are in the HTML, not only in the JavaScript" | Every question **and answer** the served `FAQPage` markup declares appears as text in the same document — the property that makes `/faq` citable by an assistant |
| SEO-PRE-011 | "the prerendered pages carry no build-host URLs" | No `127.0.0.1` or `localhost` in any prerendered page. Vite's `modulepreload` hints arrive absolute from the preview server and would otherwise ship |
| SEO-PRE-012 | "`/blog/bdikat-maslul-e2e` is served with its own title and canonical" | The prebuilt article's title, and a canonical on its slug |
| SEO-PRE-013 | "an article is served as full HTML: its body, its canonical and its BlogPosting" | The body's first sentence is in the HTML; canonical and `BlogPosting.mainEntityOfPage` are `/blog/<slug>`; `headline` is the title |

> Published articles are prerendered too (`dist/blog/<slug>.html`). In this
> suite the build prebuilds one fixture article from
> `e2e/fixtures/prerender-articles.json` (`PRERENDER_ARTICLES_FIXTURE`), so the
> cases are hermetic; production lists the real ones from Supabase. SEO-PRE-009
> and SEO-PRE-011 include it.

**These cases test an artifact, so the artifact has to be the right one.** In CI
the e2e shards run with `SKIP_BUILD=1` against the `dist` uploaded by the `build`
job — they never build for themselves, so `playwright.config.ts`'s `webServer`
command governs the local run and nothing else. The first CI run after these
cases landed failed on seven routes for exactly that reason: the `build` job was
still running plain `npm run build`, and the suite correctly reported that the
files were not there.

Two guards came out of it, both worth keeping in mind when changing the build:

- The `build` job runs `npm run build:prerender` with `PRERENDER_REQUIRED=1`, so
  a missing browser fails **there** rather than as nine opaque failures in a
  later job.
- Without that variable the script warns and ships the plain SPA, which is the
  right behaviour for a host that cannot prerender and the reason Base44's build
  is unaffected.

To reproduce the failure deliberately: `rm -rf dist && npm run build`, then
`SKIP_BUILD=1 npx playwright test e2e/seo/prerender.spec.ts`.


## 5b. The generated sitemap, llms files and IndexNow

The sitemap, `llms.txt` and `llms-full.txt` that `build:prerender` writes, and the
IndexNow step after a production deploy, are not covered by the browser cases
above. Their cases live elsewhere: UNIT-SEOF-* in `01-std-unit.md` (section 4.28)
and the IndexNow unit cases (section 4.30), the build wiring, the ai-surface and
`indexnow.contract.test.ts` rows (CTR-INOW-*) in `03-std-contract.md`, and
API-HTP-013 and API-HTP-014 in `05-std-api.md` for the served files.

### The clearinghouse page stays out of search

| Route | How it is kept out | Pinned by |
|---|---|---|
| `/masleka` | `noindex` from SeoRouteGuard; `Disallow: /masleka` in the `*` group of robots.txt; absent from the sitemap, prerender `ROUTES` and `llms.txt`; the link's token rides in the fragment | CMP-MSK-016; `ai-surface.contract.test.ts` "keeps the private routes out for everyone"; E2E-MSK-001 |

## 5c. The old Base44 host — `tests/unit/legacy-host*.test.ts`, `e2e/seo/legacy-host.spec.ts`

Base44 keeps serving a copy of the site at `safe-arch-plan.base44.app` and cannot
`301` it (its site config has no redirects, and its CLI ignores `_redirects`). The
same host is the backend `/api/*` and `/ws-user-apps/*` are rewritten to, so the
cases pin both halves: what a page booted there does, and what is never touched.

| ID | Title | Expected result |
|---|---|---|
| SEO-OLD-001 | "defaults to exactly the old production host" / "is configurable, and `none` turns it off" | `VITE_LEGACY_HOSTS` replaces the list; `none` empties it |
| SEO-OLD-002 | "matches the exact host only — never the Builder's preview hosts or other base44.app apps" | `preview--…`, `preview-sandbox--…`, `*.modal.host`, production, localhost: not the old host |
| SEO-OLD-003 | "redirects to the same path, query and fragment on the production domain" | `/faq?utm_source=wa#q3` → `https://govari-fin.co.il/faq?utm_source=wa#q3` |
| SEO-OLD-004 | "moves sign-in and admin pages too, when no sign-in is in flight" | `/login`, `/admin/leads`, `/account` move |
| SEO-OLD-005 | "cannot be turned into a redirect to another host by the path" | `//evil.example/x` stays on production |
| SEO-OLD-006 | "never touches the backend paths that share the host" | `/api…`, `/ws-user-apps…` stay; `/apiary` is not a backend path |
| SEO-OLD-007 | "leaves a sign-in in flight on the origin that holds its state" | `code`, `error`, `#access_token`, `access_token`, `from_url`, `clear_access_token`, `token_hash` stay |
| SEO-OLD-008 | "leaves the platform's own auth pages where the platform sent them" | `/register`, `/forgot-password`, `/reset-password`, `/oauth/*` stay |
| SEO-OLD-009 | "stays inside a frame, which production refuses to be shown in" | Framed: stay |
| SEO-OLD-010 | "never redirects to itself, to another old host, or to a non-https origin" | Loop guard |
| SEO-OLD-011 | "production, its www alias, a Vercel preview, the Builder preview and localhost" | No change at all, framed or not |
| SEO-OLD-012 | DOM: "marks the page noindex, points canonical and og:url at production, and moves the visitor" | `robots`/`googlebot` `noindex`; canonical and `og:url` on production; one `location.replace` |
| SEO-OLD-013 | DOM: notice, sign-in in flight, frame, misconfigured origin, and three other hosts | Notice links to the target; staying pages are still noindex; other hosts' heads are byte-identical |
| SEO-OLD-014 | DOM: "applySeo keeps the old host out of the index after boot" | `noindex` (`noindex, nofollow` on private routes) there; unchanged on production |
| SEO-OLD-015 | e2e: "sends a visitor to the same address on the production domain" | The browser, told the old host is this build, lands on the production stub with path, query and fragment; no backend call on the way but Base44's own page-view log |
| SEO-OLD-016 | e2e: "keeps a page whose sign-in is in flight, marked noindex with the canonical on production" | After the route's own `useSeo`, still `noindex` with a production canonical |
| SEO-OLD-017 | e2e: "stays inside a frame, as in the Base44 dashboard, and is still noindex" | The frame renders the page on the old host |
| SEO-OLD-018 | e2e: "is left as it was: indexable, and not redirected" | The local host keeps `index, follow, …` |

The e2e cases play both hosts with `page.route`, so nothing reaches either real
one. With `VITE_LEGACY_HOSTS=none` in the build, SEO-OLD-015..017 fail and
SEO-OLD-018 passes — checked once when they were written.

## 6. Pass criteria

All 19 unit and 50 e2e cases pass, with SEO-MOB-005 reporting rather than
enforcing. SEO-MET-007 and SEO-LD-002 are the two that would fail first if the
per-route head regressed in the browser; SEO-PRE-009 is the one that fails if it
regressed in the HTML.
