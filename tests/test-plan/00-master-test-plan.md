# Master Test Plan — Dorit Gov-Ari Finance Site

**Document ID:** MTP-01 · **Version:** 1.0 · **Status:** Baseline

---

## 1. Scope

The system under test (SUT) is a Base44 application: a React 18 + Vite
single-page marketing and lead-generation site for an insurance and financial
adviser, in Hebrew (RTL), backed by Base44 entities, Core integrations and one
Deno backend function.

In scope:

| Layer | What is tested |
|---|---|
| Pure logic | Pension fee maths, URL/class helpers, the open-redirect guard, contact config |
| Components | Every first-party component in `src/components/dorit/` that carries behaviour |
| Contracts | Frontend payloads ↔ `base44/entities/*.jsonc`, the `createConsultationEvent` function, RLS rules |
| API / HTTP | The site's own HTTP surface (SPA fallback, SEO files, assets) and observed Base44 traffic |
| UI e2e | Landing page, routing, calculator, three lead forms, blog |
| Mobile web | iOS Safari and Android Chrome behaviour and layout |
| Security | XSS, open redirect, token handling, tab-nabbing, secret leakage, RLS |
| Accessibility | WCAG 2.1 AA via axe-core, plus structural RTL/labelling checks |

Out of scope: native iOS/Android applications (none exist in this repo — the
"iOS" and "Android" suites are mobile **web**), Base44 platform internals,
third-party services (Google Calendar, Google Analytics, WhatsApp), visual
regression, and load/performance testing.

## 2. Test levels and strategy

```
        ╱╲          e2e  — 4 platforms × UI/API/security/a11y     (Playwright)
       ╱  ╲
      ╱────╲        contract — payloads vs entity schemas          (Vitest)
     ╱      ╲       component — RTL render + interaction           (Vitest + RTL)
    ╱────────╲      unit — pure functions                          (Vitest)
```

Everything is **sanity/smoke depth**: broad coverage of the paths a visitor or
an admin actually takes, with adversarial input where a defect would be
expensive (money maths, redirects, untrusted markdown), rather than exhaustive
enumeration.

The e2e suites are **hermetic**: `e2e/fixtures/app.ts` intercepts the whole
`/api/**` surface plus third-party beacons, so no test needs credentials,
a linked Base44 app, or network access, and no test can touch production data.
An opt-in block (`E2E_LIVE_API_URL`) runs the same contract against a real
backend when one is available.

## 3. Test items

| Item | Version reference |
|---|---|
| Application source | `src/**` at the commit under test |
| Backend definitions | `base44/entities/*.jsonc`, `base44/functions/createConsultationEvent` |
| Static assets | `index.html`, `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, `public/manifest.json` |
| Build output | `dist/` produced by `npm run build` |

## 4. Environment

| | |
|---|---|
| Node | 22.x (CI) / 26.x (verified locally) |
| Unit/component/contract/security | Vitest 3, jsdom |
| e2e | Playwright 1.62, Chromium + WebKit |
| Platforms | `web-chromium` (desktop Chrome), `web-webkit` (desktop Safari), `ios-safari` (iPhone 14 / WebKit), `android-chrome` (Pixel 7 / Chromium) |
| SUT under e2e | Production build served by `vite preview` on `127.0.0.1:4173`, or any `PLAYWRIGHT_BASE_URL` |
| Locale | `he-IL`, timezone `Asia/Jerusalem` |
| Container | `Dockerfile.test` / `docker-compose.test.yml`, pinned to the Playwright image matching the installed version |

## 5. Entry criteria

1. `npm ci` completes.
2. `npm run build` produces `dist/`.
3. Playwright browsers installed (`npx playwright install chromium webkit`) — or the container image is used.

## 6. Exit criteria

| Suite | Criterion |
|---|---|
| lint | zero errors |
| typecheck | **advisory** — see [10-known-issues](10-known-issues.md) |
| unit, component, contract, security | 100% pass |
| e2e (all four platforms) | 100% pass, no more than the documented skips |
| accessibility | zero `serious`/`critical` axe violations except the tracked colour-contrast finding |

## 7. Suspension and resumption

Suspend the run if the build fails, if the preview server does not come up
within 180 s, or if more than 25% of e2e cases fail identically — that pattern
means an environment fault (missing browser, wrong base URL), not a regression.
Resume after the environment is corrected; no partial sign-off.

## 8. Deliverables

| Artefact | Path |
|---|---|
| JUnit XML (Vitest) | `test-results/vitest-junit.xml` |
| JUnit XML (Playwright) | `test-results/e2e-junit.xml` |
| HTML report | `playwright-report/` |
| Failure screenshots, video, traces | `test-results/<test>/` |
| CI artefacts | uploaded per job in `.github/workflows/ci.yml` |

## 9. Responsibilities and schedule

The suites run on every pull request and every push to `main`
(`.github/workflows/ci.yml`), and again as a post-deploy smoke test against the
production URL. Locally: `./scripts/run-tests.sh`.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Hebrew/RTL string selectors are brittle | Prefer roles and `id`s; regex only where copy is stable |
| Stubbed backend drifts from the real one | `tests/contract/` reads the real entity/function definitions; an opt-in live suite re-checks against a running backend |
| Animation timing flakiness | `framer-motion` is stubbed in component tests; e2e waits on assertions, never on sleeps |
| Third-party beacons cause noise | Analytics, fonts and media hosts are intercepted in the e2e fixture |
| Colour-contrast debt masks new regressions | Contrast is reported on every run and can be enforced with one env var |
