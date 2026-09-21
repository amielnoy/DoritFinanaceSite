# STD-04 — Security Tests

**Suite:** `security` · **Runners:** `npm run test:security` (static, Vitest) and
`npm run test:e2e:security` (runtime, Playwright)
**Location:** `tests/security/static-security.test.ts`,
`tests/security/agent-surface.security.test.ts`, `e2e/security/security.spec.ts`
**Cases:** 68 static (24 site + 44 agent surface) + 15 runtime (× 4 platforms)

---

## 1. Purpose

Cover the threats that actually apply to a public Hebrew marketing site that
collects personal data: stored/reflected XSS through admin-authored content,
open redirects on the auth pages, credential leakage into the bundle or the
URL, reverse tab-nabbing on outbound links, and RLS gaps that would expose the
lead inbox.

## 2. Threat model (abridged)

| Asset | Threat | Control | Covered by |
|---|---|---|---|
| Visitor's browser | Stored XSS via blog markdown / testimonials | `react-markdown` without `rehype-raw`; React escaping | SEC-XSS-001..005 |
| Visitor's session | Open redirect on `?returnTo=` | `safeReturnTo()` | SEC-RED-001, UNIT-RET-* |
| Access token | Leak into storage or a query string | SDK-managed storage; POST bodies only | SEC-TOK-001..003, API-CTR-006 |
| Outbound links | Reverse tab-nabbing | `rel="noopener noreferrer"` | SEC-LNK-001, SEC-STA-009/010 |
| Lead inbox (PII) | Anonymous read | Entity RLS `read: {role: admin}` | SEC-RLS-001, CTR-RLS-001 |
| Secrets | Committed or bundled | env-only config; scanners | SEC-STA-001..007, SEC-BND-001 |
| Visitor's browser | XSS via a model's reply in the chat | `react-markdown`, no `rehype-raw`, no `dangerouslySetInnerHTML` | SEC-AGT-XSS-001..008 |
| **A third party's inbox** | **Branded phishing via HTML injection into the confirmation email** | `escapeHtml()` at every binding in `buildClientHtml` | SEC-AGT-XSS-009..016 |
| Agency's reputation | Off-domain links or a look-alike sender in outbound mail | fixed recipients; template links restricted to the agency domain | SEC-AGT-PHI-001..007 |
| Agent's instructions | Prompt injection through the chat box | compliance block declared to override; escalate-on-doubt | SEC-AGT-INJ-001..011 |
| Backend state | Prompt injection through a tool payload the model composes | server-side enum clamping, phone validation, fixed field lists | SEC-AGT-API-001..009 |
| Personal data | Leaving in a summary, a sheet row, a log or a token | `redact()`, entity schema, column allowlist | SEC-AGT-DLP-001..014 |

## 3. Static test cases — `tests/security/static-security.test.ts`

| ID | Title | Expected result |
|---|---|---|
| SEC-STA-001..006 | "contains no `<secret type>`" (Stripe live key, AWS access key id, Google API key, private key block, hardcoded JWT, assigned secret literal) | No match in `src/**` or `index.html` |
| SEC-STA-007 | "keeps env files out of version control" | No `.env*` tracked by git (falls back to a filesystem check when `.git` is absent, e.g. inside the test image) |
| SEC-STA-008 | "gitignores the local env and the Base44 app pointer" | `.gitignore` covers `.env` and `base44/.app.jsonc` |
| SEC-STA-009 | "reads app configuration from `import.meta.env`, never from literals" | `app-params.js` uses `VITE_BASE44_APP_ID`; no inline app id |
| SEC-STA-010 | "never uses eval or the Function constructor" | No `eval(` / `new Function(` |
| SEC-STA-011 | "never injects raw HTML" | No `dangerouslySetInnerHTML` / `.innerHTML =` / `document.write` in first-party code |
| SEC-STA-012 | "renders blog markdown without enabling raw HTML passthrough" | No `rehype-raw`, `skipHtml={false}` or `remark-html` in `BlogPost.tsx` |
| SEC-STA-013 | "finds the site's new-tab links" | ≥1 `target="_blank"` anchor (guards against a vacuous pass below) |
| SEC-STA-014 | "every `target=_blank` link sets `rel=noopener`" | Zero offenders |
| SEC-STA-015 | "every `target=_blank` link also sets `noreferrer`" | Zero offenders |
| SEC-STA-016 | "no source file loads anything over plaintext `http://`" | Zero offenders (localhost excepted) |
| SEC-STA-017 | "`index.html` loads every external asset over https" | Zero `http://` in `href`/`src` |
| SEC-STA-018 | "only `app-params.js` touches the stored access token" | Exactly that one file |
| SEC-STA-019 | "pages that consume `?returnTo=` go through the shared guard" | `Login` imports `safeReturnTo` (`Register` went with email/password sign-in) |
| SEC-STA-020 | "no page reads `returnTo` out of the query string without the guard" | Zero offenders outside `authReturnTo.js` |
| SEC-STA-021 | "redirects derived from `returnTo` are assigned from the guarded value" | `Login` assigns `window.location.href` from `safeReturnTo()` |
| SEC-STA-022 | "admin routes stay behind a gate that requires both sign-in and the admin role" | `/admin/leads` and `/admin/blog` inside the `AdminRoute` block; `AdminRoute` falls back to `ProtectedRoute` when signed out and rejects `role !== "admin"` |
| SEC-STA-023 | "no entity that stores personal data is world-readable" | `Lead.rls.read !== true` |
| SEC-STA-024 | "every entity used by the app has an explicit definition" | Every `base44.entities.X` has a `.jsonc` |

## 4. Runtime test cases — `e2e/security/security.spec.ts`

Run on all four platforms. The XSS fixture (`e2e/fixtures/data.ts` → `XSS_POST`)
carries a `<script>`, an `<img onerror>`, a `javascript:` markdown link and a
`javascript:` anchor, in both the title and the body.

| ID | Title | Steps | Expected result |
|---|---|---|---|
| SEC-XSS-001 | "markdown from a blog post cannot execute script" | Serve `XSS_POST`, open `/blog/xss-post` | None of the four `window.__xss_*` flags is set |
| SEC-XSS-002 | "HTML in a post body is rendered as visible text, not as markup" | as above | Body text contains `<script>`; zero live `<script>` / `img[onerror]` nodes |
| SEC-XSS-003 | "a `javascript:` URL in markdown never becomes a live href" | as above | No anchor href starts with `javascript:` |
| SEC-XSS-004 | "a hostile post title is escaped in the heading" | as above | `h1` text contains `<img`; zero `<img>` children |
| SEC-XSS-005 | "a hostile testimonial cannot inject markup on the home page" | Serve a testimonial with script/img payloads | `window.__xss_t` unset |
| SEC-TOK-001 | "no access token is written to storage for an anonymous visitor" | Load `/` | No storage key matching `token\|secret\|password`; no JWT-shaped value |
| SEC-TOK-002 | "`?clear_access_token=true` wipes any stored token" | Seed both token keys, reload with the flag | Both keys `null` |
| SEC-RED-001 | "a hostile `?returnTo=` cannot bounce the visitor off-site" | 4 hostile values on `/login` | Page stays on the login screen and on the suite's own origin |
| SEC-LNK-001 | "every new-tab link is protected against reverse tabnabbing" | Load `/` | Every rendered `target=_blank` anchor has `noopener` |
| SEC-MIX-001 | "no mixed content: the page loads nothing over plain http" | Load `/`, scroll to the bottom | Zero non-localhost `http://` requests |
| SEC-BND-001 | "the shipped bundle contains no secret-shaped literals" | Fetch every `<script src>` | No Stripe/AWS/private-key/JWT patterns |
| SEC-RLS-001 | "admin data is never fetched before authentication" | Open `/admin/leads` anonymously | Redirected to `/login`; zero `GET /entities/Lead` |
| SEC-ERR-001 | "the app boots without any uncaught client-side error" | Load `/`, scroll | No `pageerror` |
| SEC-HDR-001 | "the document response carries the expected hardening headers" | — | **Skipped by default.** Enable with `E2E_ENFORCE_SECURITY_HEADERS=1` against a deployment; asserts `x-content-type-options`, `referrer-policy`, HSTS and a CSP |
| SEC-HDR-002 | "reports which hardening headers are present (informational)" | Fetch `/` | Always passes; records the missing headers as a test annotation |

## 4a. Agent surface — `tests/security/agent-surface.security.test.ts`

57 cases over the four surfaces the agents introduced. A model's behaviour
cannot be asserted, so none of them try: every case pins something that holds
whatever the model does.

| Group | Cases | What it holds |
|---|---|---|
| `SEC-AGT-XSS-*` | 8 + 8 | The chat renders replies through `react-markdown` with no raw-HTML plugin and no `dangerouslySetInnerHTML`; the confirmation email escapes every visitor-supplied binding. The escaping helper is **lifted out of the Deno source and executed** here, so these assert behaviour rather than the presence of a call. |
| `SEC-AGT-PHI-*` | 7 | No visitor value reaches an `href`; template links stay on the agency domain; recipients resolve from constants; every `tel:`/`mailto:` target binds from the contact config or the server's escalation receipt; the chat's contact block comes from the backend, not from a reply that merely claims a number. |
| `SEC-AGT-INJ-*` | 11 | Each prompt declares its compliance block to override any later instruction and routes doubt to `escalateToHuman`; the shell never parses a reply for commands; the consent stamp is the shell's, so a persuaded model cannot backdate what a visitor agreed to. |
| `SEC-AGT-API-*` | 9 | The reason is clamped with `hasOwnProperty` (so `__proto__` is not a reason); the clamped value is what gets written; phone format, required fields, pinned `status`/`source`, and no `...body` spread into an entity write. |
| `SEC-AGT-DLP-*` | 14 | `redact()` is **executed against real payloads** — ID numbers, spaced and hyphenated card numbers, an Israeli IBAN, account-length digits — and asserted to leave ordinary prose intact and cap its output. Plus: the `Lead` schema carries no sensitive field, the sheet has no sensitive column, no token is echoed or logged. |

Two findings came out of writing these, one of them a defect that is now fixed:

- **HTML injection into the confirmation email** (fixed). `buildClientHtml`
  interpolated the visitor's name, topic and preferred time into an HTML mail
  with no escaping. Because the recipient address is whatever the form was
  given and is never verified, that let anyone send a **Dorit-branded email
  carrying their own markup to a third party**. It is not browser XSS; it is a
  phishing vector riding the agency's verified domain. `escapeHtml()` now wraps
  each binding, and `SEC-AGT-XSS-009..016` fail if one is unwrapped.
- **`base44/functions/**` is checked by nothing.** `tsconfig.json` includes only
  `src/**`, and those files run on Deno inside Base44, so neither `tsc` nor the
  lint step sees them. These tests read the source as text, which is the only
  check that currently exists on the code holding the compliance logic.

## 5. Deviations

`SEC-HDR-001` is opt-in because transport hardening is set by the host
(Base44/CDN), not by the SPA, and the local `vite preview` sets none of it. See
[10-known-issues](10-known-issues.md).

## 6. Pass criteria

All static cases pass; all runtime cases pass on all four platforms, with
`SEC-HDR-001` skipped unless explicitly enabled.
