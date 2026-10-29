# Master Test Plan — Dorit Gov-Ari Finance Site

**Document ID:** MTP-01 · **Version:** 1.2 · **Status:** Maintained · **Updated:** 2026-10-29

---

## 1. Scope

The system under test (SUT) is a React 18 + Vite
single-page marketing and lead-generation site for an insurance and financial
adviser, in Hebrew (RTL), hosted on Vercel and backed by Supabase auth, tables,
storage and Edge Functions; the chat agents run on the Supabase chat function. A
Cloudflare Pages Function sends outbound mail. The wiring is documented in
[the current-state guide](../../docs/current-state.md).

In scope:

| Layer | What is tested |
|---|---|
| Pure logic | Pension fee maths, URL/class helpers, the open-redirect guard, contact config, the submission state machine, the admin data services, published FAQ and self-assessment content, and maintenance scripts |
| Components | Every first-party component in `src/components/dorit/` that carries behaviour |
| Contracts | Frontend payloads, Supabase schemas and function configuration, agency permissions and RLS, prompt sources, release gates and generated artifacts |
| Integration | The Supabase Edge Function handlers and the mailer executed in-process against recording dependencies — what is stored, who is mailed, what each recipient sees, and what survives a failure |
| Eval | The deployed `chat` function's interview, FAQ, procedures and blog agents played by a model persona (`npm run test:eval:chat`, by hand) — whether the model obeys the prompt, as opposed to whether the prompt contains the clause. No Vitest cases; see [13-std-eval](13-std-eval.md), and [14-procedures-zones](14-procedures-zones.md) for the scenario bank behind the procedures personas |
| Agent compliance | The four agent prompts, the consent gate and handoff path in the chat shell, and the disclosure carried by repo-held articles |
| API / HTTP | The site's own HTTP surface (SPA fallback, SEO files, assets), the backend requests the bundle makes, and opt-in live Supabase probes |
| UI e2e | Landing page, routing, calculator, the quick contact form and the claim report, blog, the agent chat's regulatory shell |
| Mobile web | iOS Safari and Android Chrome behaviour and layout |
| Security | XSS (page and chat), HTML injection into outbound mail, phishing vectors, prompt injection via UI and via tool payloads, DLP, open redirect, token handling, tab-nabbing, secret leakage, RLS |
| Accessibility | WCAG 2.1 AA via axe-core, plus structural RTL/labelling checks |

Out of scope: native iOS/Android applications (none exist in this repo — the
"iOS" and "Android" suites are mobile **web**),
third-party services (Google Calendar, Resend, Vercel Analytics, WhatsApp),
visual regression, and load/performance testing.

## 2. Test levels and strategy

```
        ╱╲          e2e  — 4 platforms × UI/API/security/a11y     (Playwright)
       ╱  ╲
      ╱────╲        contract — payloads vs entity schemas          (Vitest)
     ╱      ╲       integration — backend functions, executed        (Vitest)
     ╱      ╲       component — RTL render + interaction           (Vitest + RTL)
    ╱────────╲      unit — pure functions                          (Vitest)
```

Everything is **sanity/smoke depth**: broad coverage of the paths a visitor or
an admin actually takes, with adversarial input where a defect would be
expensive (money maths, redirects, untrusted markdown), rather than exhaustive
enumeration.

The e2e suites are **hermetic** and run **production's configuration**: the bundle
is built by `npm run build:e2e` with `e2e/build-env.ts` (production's provider
switches, Supabase at the never-resolving `https://supabase.e2e.invalid`), and
`e2e/fixtures/app.ts` answers that host — `/rest/v1`, `/functions/v1`,
`/storage/v1`, `/auth/v1` — and aborts third-party beacons, so no test needs
credentials or network access, and no test can touch production data. An `/api`
request other than the site's own Vercel functions fails the test.
An opt-in block (`E2E_LIVE_API_URL`) runs the same contract against a real
backend when one is available.

## 3. Test items

| Item | Version reference |
|---|---|
| Application source | `src/**` at the commit under test |
| Chat function | `supabase/functions/chat/` (handler, tools, articles, sweep, prompts for the interview and the FAQ chat) and its migrations; the FAQ chat's sheet-log sweep and `log-support-chat` |
| Backend definitions | `supabase/functions/*` (the Edge Functions), `supabase/migrations/*.sql`, `dorit-mailer/functions/api/send-email.js` |
| Published copy | `content/blog/*.md`, `src/config/compliance.ts` |
| Static assets | `index.html`, `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt`, `public/manifest.json` |
| Build output | `dist/` produced by `npm run build:prerender` — the plain `npm run build` omits the prerendered route files, and the e2e suite tests what is in `dist/` |

## 4. Environment

| | |
|---|---|
| Node | 22.x (CI) / 26.x (verified locally) |
| Unit/component/contract/security | Vitest 3, jsdom |
| e2e | Playwright 1.64, Chromium + WebKit |
| Platforms | `web-chromium` (desktop Chrome), `web-webkit` (desktop Safari), `ios-safari` (iPhone 14 / WebKit), `android-chrome` (Pixel 7 / Chromium) |
| SUT under e2e | Production build served by `vite preview` on `127.0.0.1:4173`, or any `PLAYWRIGHT_BASE_URL`. In CI the shards run `SKIP_BUILD=1` against the `dist` artifact the `build` job uploaded — they never build for themselves |
| Locale | `he-IL`, timezone `Asia/Jerusalem` |
| Container | `Dockerfile.test` / `docker-compose.test.yml`, pinned to the Playwright image matching the installed version |

## 5. Entry criteria

1. `npm ci` completes.
2. `npm run build:prerender` produces `dist/`, including one `.html` per public
   route. A plain `npm run build` leaves only `index.html`, and the prerender
   suite then fails on seven routes — a stale artifact, not a regression.
3. Playwright browsers installed (`npx playwright install chromium webkit`) — or the container image is used. Chromium is also what the prerender step drives, so the build needs it too.

## 6. Exit criteria

| Suite | Criterion |
|---|---|
| lint | zero errors |
| typecheck | `tsc` reports zero errors (the inherited-error ratchet is gone — see [10-known-issues](10-known-issues.md) B-3) |
| unit, component, contract, integration, security | 100% pass |
| eval (`test:eval:chat`) | not gated — by hand, non-deterministic, and a failure wants a human reading the transcript |
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
| Allure results — **every suite**, unit through e2e | `allure-results/` |
| Allure report | `allure-report/index.html` — one self-contained file; `npm run allure:open`, or `./scripts/run-tests.sh --report`, to serve it |
| Allure report, from CI | the `allure-report` artifact on each run, and a Cloudflare Pages deployment behind Cloudflare Access — linked from the run summary as `<branch>.<project>.pages.dev` (stable) and the per-deploy URL (immutable) |
| Failure screenshots, video, traces | `test-results/<test>/` |
| CI artefacts | uploaded per job in `.github/workflows/ci.yml` |

Both runners write Allure results into the same `allure-results/`, so one
`allure generate` covers the whole battery — 4858 Vitest results (2122 unit, 754
component, 1196 contract, 704 integration, 82 security, counted 2026-10-29 after
Base44 exit B2) plus the e2e cases per platform. CI merges one upload per e2e **shard** plus one for the Vitest job —
eleven on the full matrix, two on a feature branch — into a single published
report; generating per-leg would give a pile of partial reports instead of one
picture of the run, and sharding only makes that worse. Allure 3 emits the merged report as a single self-contained
HTML file, which CI attaches to every run; a multi-file copy is deployed to
Cloudflare Pages behind Cloudflare Access, and CI fails the run if that copy
answers an anonymous request — on both the branch alias and the per-deploy
hostname, since Access is applied per hostname and only the checked one is
actually known to be protected.

> A run invoked with `--reporter=` on the command line replaces the configured
> reporters and writes **no** Allure results. Omit the flag for any run whose
> results should reach the report.

## 9. Responsibilities and schedule

The suites run on **every push to every branch** (`.github/workflows/ci.yml`),
on a pull request when it opens, and again as a post-deploy smoke test against
the production URL. Locally: `./scripts/run-tests.sh`.

A feature branch gets the battery and an Allure report, and deploys nothing:
every deploy job checks the ref, so `main` and `builder` remain the only
branches that can reach a site.

**e2e depth varies by where the run is.** A feature branch or a PR gets
Chromium only, on a single shard (~5 min); `main`, `builder`, a manual run and
the **nightly run at 19:00 UTC (22:00 Israel during IDT)** get all four
platforms, sharded across ten runners (~4m30 wall, ~48 job-minutes). The `plan`
job decides both the platforms and the shard counts, and says which in the run
summary. The split exists because WebKit costs 9 minutes against Chromium's 4
for identical tests, and two of the four legs are WebKit; `main` is deliberately
excluded from the narrowing, because its green run is what the production
publish is gated on.

**Shards, not workers.** The WebKit legs get three shards each and the Chromium
legs two, because a shard is two more real cores. Raising `workers` instead does
not work and has been measured twice: four workers on a two-core runner took
web-webkit 9m22 → 11m52 and then failed, and on a 12-core machine web-chromium
ran 2 workers → 35.7s, 4 → 23.0s, 6 → 23.6s, 8 → 25.1s, 10 → 31.8s, 12 → 34.2s.
The curve turns upwards well before the core count: these tests are a browser
waiting on a page, not CPU-bound work. See `playwright.config.ts`. The pull-request trigger is narrowed to

`opened`/`reopened` because pushes to the branch already run — reacting to
`synchronize` as well would run the whole matrix twice per commit.

Everything keyed to a `builder` branch is dormant (it was built for the Base44
Builder, which is retired; its GitHub App is removed by the checklist in
docs/current-state.md). Merging stays a person's action, so
the enforcement lives at the publish step, which only runs from `main` and only
on a green run.

**One nightly job deletes rather than reports.** `prune-vercel` removes Vercel
preview deployments older than a month. It runs on the schedule only — no
`workflow_dispatch`, because a manual trigger beside the publish button is how
somebody clears a preview they were halfway through reading, and there is no
undo. Its rule is unit-tested (UNIT-PRV-001..006) rather than trusted to the
`target=preview` query it filters with, and `npm run prune:vercel` without
`--apply` prints what it would delete. It is skipped entirely when the Vercel
credentials are absent.

A red run costs production, not staging. The Vercel staging deployment goes out
whenever the build succeeds — a failing run is exactly when it helps to open the
broken build next to the report that says what broke — while the Vercel
production promotion requires every suite to have passed, and the post-deploy
smoke test runs only after that promotion succeeds.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Hebrew/RTL string selectors are brittle | Prefer roles and `id`s; regex only where copy is stable |
| Stubbed backend drifts from the real one | `tests/contract/` reads the real entity/function definitions; an opt-in live suite re-checks against a running backend |
| Animation timing flakiness | `framer-motion` is stubbed in component tests; e2e waits on assertions, never on sleeps |
| Third-party beacons cause noise | Analytics, fonts and media hosts are intercepted in the e2e fixture |
| A maintenance job deletes something it should have kept | The nightly prune is asserted on the two guards, not on the API filter it asks with (UNIT-PRV-001..006), and has no manual trigger — see §9 |
| Colour-contrast debt masks new regressions | Contrast is reported on every run and can be enforced with one env var |
