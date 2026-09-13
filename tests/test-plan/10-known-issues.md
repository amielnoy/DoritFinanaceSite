# Known Issues & Deviations

Findings surfaced while building this suite, and the deliberate deviations in
how the suite is gated. Each entry says what it is, where it lives, and what
closing it would take.

---

## A. Defects found and fixed

| # | Finding | Fix |
|---|---|---|
| A-1 | `index.html` linked `/manifest.json`, which did not exist. The SPA fallback answered with `index.html` and a `200`, so nothing ever appeared broken. Found by `API-HTP-010`. | Added `public/manifest.json` with the site's existing name, description, `theme_color` (`#F9F7F2`), RTL/`he` and icon. |
| A-2 | The mobile burger button was a 38 × 38 px tap target (`p-2` around a 22 px icon), under the WCAG 2.5.5 / iOS HIG 44 px minimum. Found by `E2E-MOB-006`. | `FloatingHeader.tsx` → `p-3` (46 px). |
| A-3 | Star ratings used `aria-label` on a bare `<div>`, which is prohibited — screen readers ignored the rating entirely. 5 nodes on the home page. Found by `A11Y-AXE-001` (`aria-prohibited-attr`). | `role="img"` added in `Stars.tsx` and `ReviewsWidget.tsx`. |
| A-4 | The horizontally scrollable proof carousel had no keyboard access. Found by `A11Y-AXE-001` (`scrollable-region-focusable`). | `ProofCarousel.tsx` → `tabIndex={0}`, `role="region"`, `aria-label`, and a visible focus ring. |
| A-5 | **Every route served the same `<title>`, description and `<link rel="canonical">`, the canonical hard-pointing at the home page.** For a client-rendered SPA with one static `<head>` this is the most damaging SEO defect available: it tells search engines that `/blog`, `/claims` and every article *are* the home page, so they are dropped from the index. Found by writing `SEO-MET-007`. | Per-route metadata engine in `src/lib/seo.ts`; every public page now declares its own head. |
| A-6 | `FAQPage` structured data sat in `index.html`, so all thirteen routes claimed an FAQ they did not display — a structured-data policy violation ("content must be visible on the page"). | Moved to `src/lib/structured-data.ts` and injected by the home page alone (`SEO-LD-002`). Organisation-level `FinancialService` and `Person` stay static, where they are valid site-wide. |
| A-7 | The login, registration, password-reset, OAuth-consent, admin and 404 routes were all indexable, inheriting `index, follow` from the static head — thin duplicate pages that dilute ranking and can surface an admin URL in results. | `src/components/SeoRouteGuard.tsx` sends `noindex, nofollow`; `robots.txt` also disallows them (`SEO-IDX-007..012`, `SEO-CRW-001`). |
| A-8 | The sitemap listed only three URLs, omitting `/blog` and `/claims` — two of the site's three content pillars. | Both added, with `changefreq`/`priority` reflecting how often each actually changes (`SEO-CRW-002`). |
| A-9 | The Base44 Vite plugin's analytics beacon (`/api/apps/:id/analytics/track/batch`) was unstubbed, producing console errors that failed console-clean assertions non-deterministically (it reproduced in the container, not on macOS). | Stubbed in `e2e/fixtures/app.ts`. |

## B. Open findings — decisions for the owner

### B-1 · Colour contrast below WCAG AA

The brand accent `#7D6B5D` on the parchment background `#F9F7F2` measures about
**4.4:1**, just under the 4.5:1 AA floor for body-size text. axe flags 41 nodes
on the home page, 5–7 on `/blog` and `/claims`, and 2 in the footer on every
page (the muted grey copyright line).

Most failures are 11 px uppercase eyebrow text, which needs the full 4.5:1.
Options: darken `--accent` from `26 14% 39%` to roughly `26 14% 34%`, or raise
those specific labels to `--foreground` at reduced opacity. Both are palette
decisions, so the suite **reports** contrast on every run and enforces it only
on request:

```bash
E2E_ENFORCE_CONTRAST=1 npx playwright test e2e/a11y
```

Flip the `CONTRAST_RULE` handling in `e2e/a11y/axe.spec.ts` to unconditional
once the palette is settled.

### B-2 · Per-route metadata is applied by JavaScript, not served in the HTML

`src/lib/seo.ts` sets each route's title, description, canonical and structured
data at runtime. Google executes JavaScript before indexing, so it sees the
correct per-route head — and the SEO suite asserts exactly that.

What it does **not** fix: a crawler that does not render JavaScript (Bing's
lighter passes, most social-preview scrapers, `curl`) still receives the static
head from `index.html`, whose canonical points at the home page. So a link to
`/blog/some-post` pasted into a chat app may preview as the home page.

Closing it properly needs pre-rendering or SSR, which the Base44 SPA build does
not do today. The two options, in increasing order of effort:

1. A build step that pre-renders the five static routes to real HTML files
   (`vite-plugin-prerender` or a small Playwright-based script) — covers
   everything except individual blog posts.
2. Moving the app to an SSR-capable host.

Until then the runtime layer is the right trade: it fixes the case that governs
search ranking, and it is fully tested.

### B-3 · `npm run typecheck` has 93 inherited errors, now held on a ratchet

`tsc` fails on the current `main`, unchanged by this work (verified by running
it on a clean tree). The distribution is the whole story: **all 93 errors are in
`.tsx` files — none in the `.jsx` files at all.** 95 of the reported lines name
the same signature, `IntrinsicAttributes & RefAttributes<any>`, which is what an
untyped `forwardRef` component looks like from TypeScript's side. A typed page
imports an untyped shadcn primitive (`button`, `input`, `label`, `input-otp`,
`image`, the accordion) and every prop it passes is rejected; the 10 `TS7006`
implicit-`any` parameters are knock-on from the same cause, since an untyped
component supplies no event type to its own handler.

So this is a boundary problem, not a file-count problem. **Porting more
application code to TypeScript fixes none of it** — the fix is to type the ~8
primitives that are actually consumed, or to declare them in one `.d.ts`.

`noEmit` means nothing is broken at runtime, and `npm run build` succeeds
because Vite strips types without checking them.

**Since 2026-09-13 the step blocks.** What it cost while advisory was that a
genuinely new type error landed silently among the 93 and nobody had to fix it.
`npm run typecheck:gate` (`scripts/typecheck-gate.mjs`) allows for exactly the
inherited set, recorded in `tests/typecheck-baseline.json` keyed by file and
error code — never by line, so unrelated edits that shift lines do not trip it.
It fails on a new file/code pair, or on more errors of a known kind in a known
file. Fixing some and running `npm run typecheck:baseline` lowers the bar
permanently; the raw list is still `npm run typecheck`.

### B-4 · Structured-data email disagrees with the rest of the site

`index.html`'s JSON-LD (both the `FinancialService` and the `Person` block)
publishes `dorit@govari-fin.co.il`, while every visible surface — the footer,
the contact form copy, the SDK error fallbacks and `src/config/contact.js` —
uses `doritg@fsfp-fin.co.il`. Search engines and AI crawlers read the JSON-LD,
so this is the address a prospect may be handed.

**Not changed**, because which address is canonical is a business fact, not a
code decision. Once you confirm it, the fix is two string edits in `index.html`,
and the assertion below can be added to `e2e/api/http-surface.spec.ts` to keep
them in step:

```ts
expect(JSON.parse(ldBlock).email).toBe(CONTACT.email);
```

### B-5 · Transport security headers are not asserted by default

The SPA cannot set CSP, HSTS, `X-Content-Type-Options` or `Referrer-Policy` —
those come from the Base44/CDN edge, and the local `vite preview` sets none of
them. `SEC-HDR-002` reports which are missing on every run; `SEC-HDR-001`
enforces them only against a real deployment:

```bash
E2E_ENFORCE_SECURITY_HEADERS=1 PLAYWRIGHT_BASE_URL=https://<site> npx playwright test e2e/security
```

### B-6 · Display labels are set at 11px on mobile

Fourteen eyebrow labels and stat captions (`INSURANCE ARCHITECT`, `שנות ניסיון`,
`LIFE & VITALITY` …) render at 11px uppercase with heavy letter-spacing. Google's
mobile-usability report flags "text too small to read" around 12px, and 11px
uppercase Hebrew with 0.35em tracking is genuinely hard to read on a phone.

Sentence-length body copy is enforced at ≥12px (`SEO-MOB-004`); the labels are
reported rather than enforced (`SEO-MOB-005`), because moving the type scale is a
design decision in the same class as the contrast finding in B-1, not an SEO fix.
Raising them to 12px would close it.

### B-7 · `src/lib/utils.js` touches `window` at module scope

`export const isIframe = window.self !== window.top` runs on import, so the
module cannot be loaded in any non-browser context. It forces `cn()`'s unit
tests into jsdom (`tests/unit/utils.dom.test.ts`) and would break SSR or any
future prerender step. A one-line guard (`typeof window !== "undefined"`) would
close it; left alone as it is outside the scope of this work.

## C. Deliberate deviations in the suite

| Deviation | Reason |
|---|---|
| `A11Y-STR-005` skipped on WebKit | Safari only tabs to links when the OS "Press Tab to highlight each item" preference is on — a browser preference, not an app defect |
| Live-backend API cases skipped unless `E2E_LIVE_API_URL` is set | So CI can never write to production data |
| Third-party requests (GA, Google Fonts, `media.base44.com`) intercepted | Hermetic, offline-capable, deterministic runs |
| `framer-motion` stubbed in component tests | jsdom has no layout engine; the animation library is not the system under test |
| e2e runs against `vite preview`, not `vite dev` | The production bundle is what ships; this also proves the build boots |
