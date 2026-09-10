# Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.
5. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/) — the local Base44 backend runs on it.

Run `base44 --help` (or see the [CLI reference](https://docs.base44.com/developers/references/cli/commands/introduction)) for the full command surface.

## Run Locally

Three commands, from the project root:

```bash
base44 login   # one-time per machine
base44 link    # one-time per clone
base44 dev     # local backend + frontend together
```

Open the frontend URL that `base44 dev` prints (typically `http://localhost:5173`).

Notes:

- **Every fresh clone needs `base44 link`.** It writes `base44/.app.jsonc` (the app-id pointer), which is deliberately gitignored. Your app id is in the Builder URL (`app.base44.com/apps/<id>/...`); `base44 link --help` shows the non-interactive flags.
- **`base44 dev` runs the frontend for you** (via `site.serveCommand` in this repo's `base44/config.jsonc`) — never run `npm run dev` yourself: alone it serves a UI with no backend behind it (`[base44] Proxy not enabled`, every `/api` call fails), and alongside `base44 dev` the second Vite silently takes the next port and you end up looking at the wrong one.
- **The app must be published at least once for the UI to load under `base44 dev`.** The frontend boots by fetching app settings from the hosted app; before the first publish that fails and every page redirects to login. The local API works regardless.
- Entities, functions, and auth run locally — entity data is **in-memory only**, wiped when `base44 dev` restarts. Everything else (Core integrations, OAuth login) is forwarded to your deployed app. Full breakdown: [Local development overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview).

## Frontend Only, Hosted Backend

To work on just the frontend against your app's live hosted backend:

```bash
base44 dev --remote
```

⚠️ In this mode writes go to your app's **production data** — plain `base44 dev` keeps everything local.

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

This repo syncs to Base44 through git, so publish from the dashboard rather than `base44 deploy` — a CLI deploy ships your local tree directly, bypassing the sync, and the deployed state silently diverges from the repo.

CI can do the publish for you instead, from a clean checkout of `main` and only
when the whole run is green. It is opt-in: set the `BASE44_API_KEY` secret (a
workspace API key — it starts with `b44k_`) and the `BASE44_APP_ID` variable on
the repository. Without them the step is skipped and production simply stays
where it was.

> The sync moves code into the Builder; it is not a publish. If the Builder
> reports **"Couldn't fetch your code"**, check that the Base44 GitHub App is
> installed on the account that *currently owns* this repository — the stored
> connection is an owner/name pair, and transferring the repo between accounts
> leaves it pointing at the old path while push webhooks keep arriving.

## Tests

The full battery — lint, typecheck, unit, component, contract, security, and
end-to-end across desktop web, iOS Safari and Android Chrome — runs from one
command:

```bash
./scripts/run-tests.sh                    # everything
./scripts/run-tests.sh unit contract      # selected suites
./scripts/run-tests.sh e2e --project=ios-safari
```

Or in a pinned container, with no local Node or browser install:

```bash
docker compose -f docker-compose.test.yml run --rm tests        # everything
docker compose -f docker-compose.test.yml run --rm tests-node   # no browsers
docker compose -f docker-compose.test.yml run --rm e2e-ios
```

| Suite | Command | Location |
|---|---|---|
| Unit | `npm run test:unit` | `tests/unit/` |
| Component | `npm run test:component` | `tests/component/` |
| Contract | `npm run test:contract` | `tests/contract/` |
| Security (static) | `npm run test:security` | `tests/security/` |
| e2e — UI, API, security, a11y, SEO | `npm run test:e2e` | `e2e/` |
| SEO only | `npm run test:e2e:seo` | `e2e/seo/` |

The end-to-end suites are hermetic: `e2e/fixtures/app.ts` intercepts the whole
Base44 `/api` surface plus third-party beacons, so they need no credentials, no
`base44 link`, and can never write to production data. They run against the
production build served by `vite preview` — point `PLAYWRIGHT_BASE_URL` at a
deployment to smoke-test it instead.

### The report

Every suite writes Allure results, unit through e2e, into one `allure-results/`,
so a single report covers the whole battery:

```bash
./scripts/run-tests.sh --report      # run everything, then open the report
npm run allure:open                  # open the report from the last run
```

The report **must be served**, not opened from disk — it loads its data over
XHR, so double-clicking `allure-report/index.html` shows an empty shell. Both
commands above route through `allure open`, which serves it on localhost.

⚠️ Passing `--reporter=` to `vitest` or `playwright` on the command line
*replaces* the configured reporters, so such a run writes no Allure results at
all. Omit the flag for any run you want in the report.

CI publishes the merged report — all four platforms plus the Vitest suites — to
its own Vercel project on every push to `main`, pass or fail. A link is in each
run's summary, along with the two site links.

### Branches

The Base44 Builder syncs to **`builder`**, never to `main`. Every push there
runs the full battery, and only a green run is promoted:

```
builder ──[unit · component · contract · security · e2e × 4]──> main ──> deploy
              │
              └─ red? promotion stops. main and both sites stay put.
```

So changes made in the Builder cannot reach the trunk untested. If the run is
red, read the Allure report — `builder` runs publish it too — fix it in the
Builder, and push again. Promotion fast-forwards when `main` hasn't moved, so
what deploys is exactly what was tested; if a pull request landed meanwhile it
merges instead and `main` re-tests the result before anything deploys.

### What a red run costs

| Target | Deploys when |
|---|---|
| **Vercel** — staging, login-protected | the build succeeds, tests green **or red** |
| **Base44** — production, client-facing | every suite passed |

A failing run is exactly when you want the broken build somewhere you can open
it, so staging takes it either way; production does not.

- **Test plan and per-suite test descriptions:** [`tests/test-plan/`](tests/test-plan/)
- **Architecture record and review findings:** [`Architecture.html`](Architecture.html)
- **CI/CD:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

## Docs & Support

GitHub integration: [https://docs.base44.com/developers/app-code/local-development/github](https://docs.base44.com/developers/app-code/local-development/github)

Local development: [https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview)

Support: [https://app.base44.com/support](https://app.base44.com/support)
