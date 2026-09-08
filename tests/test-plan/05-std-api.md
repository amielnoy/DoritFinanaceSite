# STD-05 — API Tests

**Suite:** `api` · **Runner:** `npm run test:e2e:api` (Playwright)
**Location:** `e2e/api/` · **Cases:** 11 HTTP-surface + 7 observed-traffic + 4 opt-in live

---

## 1. Purpose

Two things sit under "API" for this app:

1. **The site's own HTTP surface** — what a browser, a crawler or a monitor gets
   back from the deployment: the SPA shell, the SEO files, the hashed assets.
   Tested with Playwright's `request` fixture, no browser involved.
2. **The Base44 API contract as actually exercised** — the requests the running
   app puts on the wire, validated against the entity schemas.

## 2. Environment

Runs against `PLAYWRIGHT_BASE_URL` when set (a deployment, used by the CI smoke
job), otherwise against the local production preview. The observed-traffic cases
use the stubbed backend from `e2e/fixtures/app.ts`.

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
| API-HTP-008 | "client-side routes fall back to the SPA shell with a 200" | `/blog`, `/claims`, `/privacy`, `/accessibility`, `/blog/:id` all 200 HTML |
| API-HTP-009 | "the built JS and CSS bundles are reachable and non-empty" | Every `/assets/*` reference returns 200 with a body |
| API-HTP-010 | "every same-origin file referenced by index.html actually exists" | 200 **and not `text/html`** — a missing static file is otherwise masked by the SPA fallback |
| API-HTP-011 | "HEAD on the document does not error" | 200, 204 or 405 |

> API-HTP-010 found a real defect on the first run: `index.html` referenced
> `/manifest.json`, which did not exist and was silently answered with the SPA
> shell. The file was added; see [10-known-issues](10-known-issues.md).

## 4. Test cases — observed Base44 traffic (`base44-contract.spec.ts`)

| ID | Title | Expected result |
|---|---|---|
| API-CTR-001 | "bootstraps through the documented public-settings endpoint" | `GET /api/apps/public/prod/public-settings/by-id/:appId` |
| API-CTR-002 | "lists testimonials with a bounded, sorted query" | `sort=-created_date`, `0 < limit ≤ 100` |
| API-CTR-003 | "POSTs a Lead that validates against the Lead entity schema" | JSON content type; zero validation issues against `Lead.jsonc` |
| API-CTR-004 | "invokes the consultation function on the documented path and shape" | `POST /api/apps/:id/functions/createConsultationEvent`; body keys exactly `{email,name,notes,phone,timing,topic}` |
| API-CTR-005 | "every API call is same-origin and relative to /api" | Every observed request shares the page origin and starts with `/api/` |
| API-CTR-006 | "never puts personal data or tokens in a query string" | No phone, email, `access_token`, `password` or `api_key` in any query string |
| API-CTR-007 | "an anonymous visitor never triggers an authenticated user fetch" | Zero requests to `/entities/User/me` |

## 5. Test cases — live backend (opt-in)

Enabled with `E2E_LIVE_API_URL` **and** `E2E_LIVE_APP_ID`; skipped otherwise so
CI never touches production data.

| ID | Title | Expected result |
|---|---|---|
| API-LIV-001 | "public settings are served for the linked app" | 200 with a `public_settings` key |
| API-LIV-002 | "published blog posts are readable without authentication" | 200, array |
| API-LIV-003 | "leads are NOT readable without an admin session (RLS)" | 401 or 403 |
| API-LIV-004 | "the consultation function rejects a body without name/phone" | 400 with an `error` key |

## 6. Pass criteria

All HTTP-surface and observed-traffic cases pass. The live block is expected to
be skipped in CI; when run, all four must pass — API-LIV-003 in particular is a
production RLS verification.
