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

## The agents, and where they stop

Three LLM agents run on the site — `needs_interview`, `booking_assistant` and
`blog_recommender` (`base44/agents/`). They belong to a licensed insurance
agency, which makes most of what a visitor would like to ask them off-limits:
no product recommendation, no figures, no view on whether to move, withdraw or
cancel anything. Every one of those ends in a handoff to דורית rather than a
partial answer, and so does any case where the agent is simply not sure.

Two of those guarantees do not depend on the model at all, on purpose:

- **Nothing is sent before consent.** The message box is disabled until the
  visitor accepts the notice, and no conversation is opened with the backend
  until then — a prompt can be talked out of asking; this cannot.
- **The route to a person is a button**, present from the first frame, that
  calls `escalateToHuman` and renders דורית's phone, WhatsApp and email even
  when the call fails, and even before consent.

The rest lives in the prompts, and `tests/contract/agents.contract.test.ts`
fails if a mandatory clause disappears from any of them.

Full description of the layer, what is enforced where, and one open question
for דורית's compliance adviser: [`base44/agents/COMPLIANCE.md`](base44/agents/COMPLIANCE.md).

## Blog articles in the repo

Articles under [`content/blog/`](content/blog/) are Markdown with front matter.
They live here rather than only in the Builder because a post published by a
licensed agency carries a mandatory גילוי נאות block, and a disclosure that
exists only as a database row is one nobody reviews.

```bash
npm run seed:blog                    # dry run — lists what would be written
node scripts/seed-blog.mjs --apply   # writes, needs an admin sign-in
```

Posts are matched by title (update if present, create if not) and ship as
**drafts** — publishing stays a decision made from `/admin/blog`.

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

**Allure 3** inlines the whole report into a single self-contained
`allure-report/index.html`, so you can also just open that file. Allure 2 could
not: it fetched thousands of small JSON files over XHR and showed an empty shell
when opened from disk, which is the only reason the report ever needed hosting
at all. Both commands above still serve it on localhost, which is the nicer way
to click through a failure.

⚠️ Passing `--reporter=` to `vitest` or `playwright` on the command line
*replaces* the configured reporters, so such a run writes no Allure results at
all. Omit the flag for any run you want in the report.

CI builds the merged report — all four platforms plus the Vitest suites — on
every run of `main` or `builder`, pass or fail, and puts it in two places:

| Where | Shape | Who can read it |
|---|---|---|
| The run itself, as the `allure-report` artifact | one self-contained `index.html` | anyone who can see this repository |
| **Cloudflare Pages** | the ordinary multi-file report | whoever Cloudflare Access lets in |

Two shapes because Cloudflare rejects any single asset over **25 MiB**, and a
full run's single-file report is around 46 MB. The hosted copy is therefore the
split one — roughly 4,000 files against a 20,000-file ceiling. Both come from
the same results, and both have the analytics beacon stripped.

The artifact needs nothing set up and always exists. The Cloudflare deploy is
opt-in, and skips with a notice when these are missing:

All three live in **GitHub**, not Cloudflare — *this repository → Settings →
Secrets and variables → Actions*. Only their values come from Cloudflare:

| Name | Kind | Where the value comes from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | Cloudflare → My Profile → API Tokens → Create Token, with the **Cloudflare Pages: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Cloudflare dashboard sidebar, or `npx wrangler whoami` |
| `CLOUDFLARE_PAGES_PROJECT` | variable | any project name you like — CI creates the project if it does not exist |

#### Keeping the hosted report private

The report carries the client's copy and failure screenshots of her site, so it
must not be world-readable. **CI enforces that rather than trusting it**: after
each deploy it fetches the URL anonymously and fails the run if the report comes
back. A protection nothing checks is one that silently lapses.

Cloudflare Access is what provides it, and there is a trap in how it applies:

> Cloudflare's project-level **Enable access policy** toggle (Workers & Pages →
> the project → Settings → General) protects **preview deployments only** — not
> the `*.pages.dev` production domain, and not a custom domain.

The project therefore needs a **production branch that CI never pushes**. When
CI creates the project it sets that to `production` for exactly this reason:
deploys use `--branch` = the git ref (`main` or `builder`), so every report
lands as a *preview* deployment, which is what the toggle covers. **If you
created the project yourself**, check that setting — a project whose production
branch is `main` will serve every report from the unprotected production
domain.

Flipping the toggle on is still a manual step, once, in the dashboard. If you
would rather serve the report from the production domain, protect that hostname
with an Access application in Zero Trust instead; the verification step treats
both the same way, because all it asks is whether an anonymous request can read
the report.

Generating the report also strips a Google Analytics beacon that Allure injects
into every one it produces — see `scripts/strip-allure-analytics.mjs`. It
reports to Qameta's property rather than ours, and there is no config flag or
environment variable that turns it off.

### Branches

**Every push, on every branch, runs the full battery** — lint, the typecheck
gate, build, the four Vitest suites, e2e across four platforms, and an Allure
report attached to the run. A feature branch deploys **nothing**: every deploy
job checks the ref, so `main` and `builder` stay the only branches that can
reach a site, and only those two publish the report.

A pull request triggers a run when it **opens**; later commits are covered by
the push trigger, so the matrix does not run twice for the same SHA.

**Today the Base44 Builder syncs straight to `main`**, so its edits land on the
trunk untested. Nothing reaches the client's site regardless — the Base44
publish requires a green run — but `main` itself can go red at any time, and
has.

CI already carries the support for working on a Builder branch, and it is
**dormant** — everything keyed to `builder` triggers only on pushes to that
branch, and the Builder isn't pointed at one yet. To switch over (a Base44-side
setting that costs Builder tokens):

1. In the Builder's branch dropdown, **Create new branch**, named `builder`.
2. Confirm it appears on GitHub (`git ls-remote --heads origin`).

No workflow change is needed. From then on, every Builder edit gets:

```
builder ──[unit · component · contract · security · e2e × 4]──┬── Vercel preview URL
                                                              ├── Allure report
                                                              └── ✅ / 🛑 safe to merge
```

The preview is the part worth having: a URL for *that* change, which you open
and look at before merging, instead of judging a Builder edit from a diff.

**CI does not merge for you, on purpose.** On a branch the Builder replaces its
Publish button with **Merge to main**, and Base44 keeps each Builder branch as
a real branch here — so merging is already its job, and a CI job doing it too
would race and leave the two disagreeing. CI runs everything and posts the
verdict; you press the button.

That isn't a weaker guarantee than it sounds, because **publishing only ever
happens from main**, and the publish there requires a green run. The gate sits
where users are actually affected.

⚠️ Every Builder branch shares the app's **live data** — "the same live records
everywhere", in Base44's words. Tests never touch it, but anything you do by
hand in the Builder writes to דורית's real leads.

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
