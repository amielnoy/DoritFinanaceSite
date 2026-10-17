# STD-05 — API Tests

**Suite:** `api` · **Runner:** `npm run test:e2e:api` (Playwright)
**Location:** `e2e/api/` · **Cases:** 14 HTTP-surface + 5 observed-traffic (`backend-contract.spec.ts`) + the opt-in live Supabase probes (`supabase-live.spec.ts`)

---

## 1. Purpose

Two things sit under "API" for this app:

1. **The site's own HTTP surface** — what a browser, a crawler or a monitor gets
   back from the deployment: the SPA shell, the SEO files, the hashed assets.
   Tested with Playwright's `request` fixture, no browser involved.
2. **The backend contract as actually exercised** — the requests the running
   app puts on the wire to Supabase, checked against what the backend accepts:
   the fields `submit-lead` reads off its body and the values `leads.source`
   allows, both read from their own source. (Until 2026-10-18 this was the Base44
   API contract, checked against `base44/entities`; the e2e build then ran on
   Base44's adapters.)

## 2. Environment

Runs against `PLAYWRIGHT_BASE_URL` when set (a deployment, used by the CI smoke
job), otherwise against the local production preview. The observed-traffic cases
use the Supabase fake from `e2e/fixtures/app.ts`, which answers the e2e build's
fake host (`e2e/build-env.ts`). Against a deployment only the functions are
stubbed — the reads are the live project's — so the cases that need seeded reads
skip there, and the lead cases still run (no real lead is filed).

## 3. Test cases — HTTP surface (`http-surface.spec.ts`)

| ID | Title | Expected result |
|---|---|---|
| API-HTP-001 | "GET / returns HTML with the Hebrew RTL shell" | 200, `text/html`, `lang="he"`, `dir="rtl"`, `<div id="root">` |
| API-HTP-002 | "the HTML head carries the SEO and social contract" | Title contains the adviser's name; description ≥50 chars; canonical https; `og:title`, `og:image`; `twitter:card=summary_large_image`; responsive viewport |
| API-HTP-003 | "structured data blocks are valid JSON-LD" | ≥2 blocks, all parse, all `@context = https://schema.org`; the static head carries `FinancialService` and `Person`, and **not** `FAQPage` — that block is injected at runtime by the home page only, since `index.html` is served for every route (covered by `e2e/seo/metadata.spec.ts`) |
| API-HTP-004 | "robots.txt is served as text and points at the sitemap" | 200, `text/plain`, has `User-agent: *` and a `Sitemap:` line, no blanket `Disallow: /` |
| API-HTP-005 | "sitemap.xml is well-formed and lists only https URLs" | 200, XML content type, correct namespace, every `<loc>` is https |
| API-HTP-006 | "every sitemap URL resolves on this deployment" | Each listed path returns 200 |
| API-HTP-007 | "llms.txt is published for generative crawlers" | 200, `text/plain`, non-trivial length |
| API-HTP-008 | "client-side routes fall back to the SPA shell with a 200" | `/blog`, `/claims`, `/privacy`, `/accessibility` all 200 HTML; `/blog/:slug` is the article's prebuilt HTML (200), and a 24-hex `/blog/:id` is a 301 to the slug (`api/og/blog.ts`) |
| API-HTP-009 | "the built JS and CSS bundles are reachable and non-empty" | Every `/assets/*` reference returns 200 with a body |
| API-HTP-010 | "every same-origin file referenced by index.html actually exists" | 200 **and not `text/html`** — a missing static file is otherwise masked by the SPA fallback |
| API-HTP-011 | "HEAD on the document does not error" | 200, 204 or 405 |
| API-HTP-012 | "the sitemap lists the prebuilt articles" | At least one `/blog/<slug>` `<loc>`, and every one is followed by a `<lastmod>` (written by `scripts/build-seo-files.mjs`). Asserts no fixture slug, because the post-deploy smoke runs it against production |
| API-HTP-013 | "llms.txt lists the articles and points at the full text" | Has the `## מאמרים` section and the `/llms-full.txt` link; its article links are exactly the sitemap's `/blog/<slug>` URLs |
| API-HTP-014 | "llms-full.txt carries the questions and the articles as text" | 200, `text/plain`, the `## שאלות ותשובות` and `## מאמרים` sections and the licence number; after `## מאמרים` there is no top-level `## ` heading (article headings are demoted), at least one `### ` title, and no root-relative link |

> API-HTP-010 found a real defect on the first run: `index.html` referenced
> `/manifest.json`, which did not exist and was silently answered with the SPA
> shell. The file was added; see [10-known-issues](10-known-issues.md).

## 4. Test cases — observed backend traffic (`backend-contract.spec.ts`)

`e2e/api/base44-contract.spec.ts` was renamed to `backend-contract.spec.ts` on
2026-10-18 and its cases re-pointed at the Supabase path; the ids are kept.

| ID | Title | Expected result |
|---|---|---|
| API-CTR-001 | (retired 2026-10-18: "bootstraps through the documented public-settings endpoint", latterly "no longer calls the retired public-settings endpoint" — a Base44 endpoint; the fixture now fails any test whose page reaches Base44's `/api`) | — |
| API-CTR-002 | "lists testimonials with a bounded, sorted query" | `GET /rest/v1/testimonials` with `order=created_at.desc`, `0 < limit ≤ 100`; the publishable key as `apikey` and as the bearer (it read `sort=-created_date` until 2026-10-18). Hermetic only |
| API-CTR-003 | "POSTs a lead that submit-lead accepts" | `POST /functions/v1/submit-lead`, JSON; no body field outside those `supabase/functions/submit-lead/handler.ts` destructures; `source` is a value the `leads.source` CHECK allows (`20260921000000_initial_schema.sql`). Was "POSTs a Lead that validates against the Lead entity schema", against `base44/entities/Lead.jsonc` and a hand-kept field list. Runs against a deployment too |
| API-CTR-005 | "every request stays on the site, its Supabase host and the allowed third parties" | Every request the page starts goes to the site, the e2e Supabase host, or the aborted Google Analytics hosts; none of the site's goes to `/api/` but the Vercel functions and the Base44 SDK's telemetry (which goes with the SDK, Base44 cleanup 2 part B). Was "every API call is same-origin and relative to /api". Hermetic only |
| API-CTR-006 | "never puts personal data or tokens in a query string" | No phone, email, `access_token`, `password`, `api_key` or `apikey` in the query string of any request the page made, to any host (it checked the stubbed `/api` and `/functions/v1/` requests only, until 2026-10-18). Runs against a deployment too |
| API-CTR-007 | "an anonymous visitor never triggers an authenticated user fetch" | Zero `/auth/v1/` requests and zero `profiles` reads (it counted `/entities/User/me` until 2026-10-18). Hermetic only |

> `API-CTR-004` observed the consultation function being invoked from the
> three-step booking wizard. That wizard was removed from the site (see
> [STD-06 §3.4](06-std-ui-e2e.md)), so there is no longer browser traffic to
> observe. The function itself is still covered statically by `CTR-FN-*` in
> [STD-03](03-std-contract.md). Ids are not reused.

## 5. Test cases — live Base44 backend (retired)

| ID | Title | Expected result |
|---|---|---|
| API-LIV-001 | (retired 2026-10-18: "public settings are served for the linked app" — Base44's own API) | — |
| API-LIV-002 | (retired 2026-10-18: "published blog posts are readable without authentication" — Base44's `BlogPost`; the site reads `blog_posts`, probed by `supabase-live.spec.ts`) | — |
| API-LIV-003 | (retired 2026-10-18: "leads are NOT readable without an admin session (RLS)" — Base44's `Lead`; the Supabase RLS probes are in `supabase-live.spec.ts`) | — |
| API-LIV-004 | (retired 2026-10-18: "the consultation function rejects a body without name/phone" — a Base44 function) | — |
| API-LIV-005..007 | (retired 2026-10-18: "\<agent\> opens a conversation for a signed-out visitor" — Base44's `createConversation`; production's chats are on the `chat` Edge Function since 2026-10-14) | — |

The block needed `E2E_LIVE_APP_ID`, which the production smoke stopped setting on
2026-10-17 (production does not use Base44); it had not run since. `API-LIV-005..007`
were the checks that would have caught A-42 on Base44 — a signed-out visitor
refused by the running backend while the repo was correct. The same class on the
chat function is the live Supabase block's to catch.

## 6. Pass criteria

All HTTP-surface and observed-traffic cases pass.
