# Test Plan & Software Test Descriptions

Structured documentation for every automated test in this repository, in the
shape of an IEEE 829-style Test Plan (`00-master-test-plan.md`) plus one
Software Test Description (STD) per suite.

| # | Document | Suite | Runner | Where the tests live |
|---|---|---|---|---|
| 00 | [Master Test Plan](00-master-test-plan.md) | all | — | — |
| 01 | [STD — Unit](01-std-unit.md) | unit | Vitest (node/jsdom) | `tests/unit/` |
| 02 | [STD — Component](02-std-component.md) | component | Vitest + React Testing Library | `tests/component/` |
| 03 | [STD — Contract](03-std-contract.md) | contract | Vitest (node) | `tests/contract/` |
| 04 | [STD — Security](04-std-security.md) | security | Vitest + Playwright | `tests/security/`, `e2e/security/` |
| 05 | [STD — API](05-std-api.md) | api | Playwright (`request`) | `e2e/api/` |
| 06 | [STD — UI e2e](06-std-ui-e2e.md) | ui | Playwright (browser) | `e2e/ui/` |
| 07 | [STD — Mobile (iOS/Android)](07-std-mobile.md) | ui (mobile) | Playwright device profiles | `e2e/ui/mobile.spec.ts` |
| 08 | [STD — Accessibility](08-std-accessibility.md) | a11y | Playwright + axe-core | `e2e/a11y/` |
| 09 | [Traceability matrix](09-traceability-matrix.md) | all | — | — |
| 10 | [Known issues & deviations](10-known-issues.md) | all | — | — |
| 11 | [STD — SEO](11-std-seo.md) | seo | Playwright + Vitest | `e2e/seo/`, `tests/unit/seo.dom.test.ts` |
| 12 | [STD — Integration](12-std-integration.md) | integration | Vitest (node) | `tests/integration/` |
| 13 | [STD — Agent Evals](13-std-eval.md) | eval | Vitest (node), opt-in | `tests/eval/` |

## Test case identifiers

`<SUITE>-<AREA>-<NNN>` — e.g. `UNIT-PFC-004`, `E2E-MOB-007`, `SEC-XSS-002`.
The ID appears in the STD; the matching test's title is quoted next to it so a
failure in CI maps straight back to a documented case.

## How to run

```bash
./scripts/run-tests.sh                 # everything
./scripts/run-tests.sh unit contract   # selected suites
docker compose -f docker-compose.test.yml run --rm tests   # pinned container
```
