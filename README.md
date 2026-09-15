# Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## The two environments

| | Host | URL | Deploys when |
| --- | --- | --- | --- |
| **Production** | Base44 | <https://safe-arch-plan.base44.app> | a push to `main`, **only if the whole run is green** |
| **Staging** | Vercel | the `deploy-vercel` job's URL, on the run summary | a push to `main` or `builder`, **even when the tests are red** |

That difference is the point of having two, not an oversight. A failing run is exactly
when you want the broken build somewhere you can open it, next to the Allure report that
says what broke — so staging takes it anyway, behind Vercel's login. Only the build
itself has to have succeeded, since otherwise there is nothing to deploy. Production is
gated: the publish job in `.github/workflows/ci.yml` refuses to run unless `build`,
`test-node` and every `test-e2e` shard succeeded.

On `builder` the Vercel deploy is a *preview* of one change rather than a site anyone
lives on, which is why the run summary's table is written on `main` only.

Neither URL is written into the pipeline. Production comes from the `BASE44_URL`
repository variable and staging from the deploy job's own output, both reported in the
**Deployed sites** table on every `main` run — so the table keeps telling the truth
through the domain move described in [Moving production to the custom
domain](#moving-production-to-the-custom-domain), which swaps these two roles around.

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

## Previewing the Production Build

`npm run preview` serves the real `dist/` bundle, which is the only way to check
the site the way a visitor gets it. Two things that Base44's hosting supplies are
missing from a local build, and the repo now fills both in:

- **The app id.** Base44 injects `VITE_BASE44_APP_ID` into its own builds, and
  Vite inlines it, so a build from a clone used to ship `appId: undefined` and
  post every form to `/api/apps/undefined/...`. It now falls back to the app this
  clone is linked to, read from `base44/.app.jsonc` — so `base44 link` is what
  makes a local build able to reach a backend at all.
- **The `/api` route.** `vite preview` serves static files and nothing else. The
  deployed site answers `/api` (Vercel rewrites it to Base44; Base44's own host
  owns the path), so the preview needs a proxy to match. It is **opt-in**, by
  naming the backend:

  ```bash
  VITE_BASE44_APP_BASE_URL=https://safe-arch-plan.base44.app npm run preview
  ```

⚠️ That proxy points at **production data** — a form you submit through it creates
a real lead and sends real email. It stays off by default for that reason, and
because `npm run test:e2e` serves the site from this same preview server: its
specs are hermetic only because `e2e/fixtures/app.ts` stubs every `/api` call, and
a proxy that switched itself on would turn any request the fixture missed into a
write against the live app.

Without the variable, `/api` simply 404s and every form on the site reports
*"לא הצלחנו לשלוח את הבקשה כרגע"*. That is the preview server having no backend,
not the site being broken.

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

## Moving production to the custom domain

Today the client-facing site is `safe-arch-plan.base44.app` — Base44 serves both the
app and the backend. Production is moving to `govari-fin.co.il` on Vercel, which keeps
Base44 as the backend and is the precondition for the Python migration: the Vercel
`/api/*` rewrite is what lets a Python service take paths over one at a time, and
Base44's own host has no equivalent — it answers `405` to any path it does not own.

The repo side is already done and is inert until the last step. `VITE_SITE_URL` sets
the canonical origin: `src/lib/seo.ts` reads it at runtime, and a build plugin rewrites
`index.html`, `sitemap.xml`, `robots.txt` and `llms.txt` to match. Unset, the build emits
exactly what it does today, so nothing moves until you move it.

`index.html` is on that list because the document a crawler is served is the one that
matters, and it was the one being missed: the sitemap moved hosts while the served HTML
kept advertising the old origin in its canonical tag, `og:url` and two static JSON-LD
blocks. `applySeo` patches the first two in the browser — the audience that did not need
it — and never touches the JSON-LD at all.

**Do these in order.** The variable goes last, because a sitemap advertising a host that
does not resolve is worse than one pointing at the old site.

0. **Check that only CI promotes production.** Vercel's Git integration and this
   workflow both deploy the project, so a push to `main` built it twice and the later
   one won. That was merely wasteful while Vercel was staging. It is not once the
   domain points there: the Git integration fires immediately and ignores the test run,
   so a red push would reach customers while the workflow was still deciding whether to
   allow it. `vercel.json` now sets `git.deploymentEnabled` to `false` for `main` and
   `builder` — the two branches CI deploys itself — and leaves it on everywhere else so
   pull requests keep their previews. Confirm in the Vercel dashboard that a push to
   `main` produces exactly one deployment, and that it is the one from the workflow.

   This makes CI the only path to production, so its Vercel credentials have to be
   working: `VERCEL_TOKEN`, `VERCEL_SCOPE` and `VERCEL_PROJECT_NAME`. The job skips with
   a notice rather than failing when they are missing, which before this change meant a
   missed staging deploy and afterwards means production silently stops updating.

1. **Point DNS at Vercel.** Add `govari-fin.co.il` and `www.govari-fin.co.il` to the
   Vercel project, then set the records the dashboard shows at the registrar. Pick one
   as canonical — `www` or the apex — and let Vercel redirect the other. Wait for both
   to resolve before continuing.
2. **Take the production deployment out from behind login.** Vercel → Settings →
   Deployment Protection. Staging is protected on purpose; production cannot be, or the
   site is unreachable. Leave preview protection alone.
3. **Check the site answers on the domain**, including `/api/*`. The rewrite forwards to
   Base44, so a form submission is the honest test: if a lead arrives, the domain and the
   backend are talking.
4. **Set `VITE_SITE_URL`** to the canonical origin — in **both** builders.

   In the Vercel project (Production scope): `vercel pull` carries it into the build.
   In Base44's app settings too, and this half is easy to forget. Base44 keeps serving a
   complete copy of the site at `safe-arch-plan.base44.app` after the move; if that copy
   still declares itself canonical, it competes with the real site for the same content.
   Given the variable it declares the production domain instead, which is what tells a
   search engine the two are one site.

   Either way the next build moves the canonical tags, the sitemap, robots.txt,
   llms.txt and the share links together — Vite resolves the variable from the shell or
   from a `.env` file, and the build plugin reads the same resolved value the
   application does, so the two cannot disagree.
5. **Set the `PRODUCTION_URL` repository variable** to the same origin, and
   `BASE44_URL` to `https://safe-arch-plan.base44.app`. The smoke test targets
   `PRODUCTION_URL`, so this is what repoints it; the two were one variable while the
   two hosts coincided.
6. **Resubmit the sitemap** in Search Console for the new property, and keep the old
   one until it stops receiving traffic. Base44 cannot `301` to Vercel — you do not
   control its routing — so the old URL ages out rather than redirecting.

Base44 keeps being deployed throughout. It still owns auth, the agents, the entity
store and the connectors; what changes is that the browser reaches it through Vercel
instead of directly.

### Publishing from the Base44 dashboard stays supported

Nothing above takes it away, and that is deliberate rather than incidental. The GitHub
App still syncs the repo into the Builder, and `base44 dashboard open` → publish works
exactly as it does today. The `git.deploymentEnabled` setting in step 0 lives in
`vercel.json`, which only Vercel reads; Base44 builds from `base44/config.jsonc` and is
unaffected by it.

What could quietly take it away is a build that starts depending on something only CI or
Vercel provides. CI sets `VITE_BASE44_APP_ID` for the whole workflow and Vercel adds
`VITE_SITE_URL`, so a green build here says nothing about the Builder's environment —
the failure would appear after a publish, on production. The build job therefore builds a
second time with those unset, the way the Builder runs it. If that step goes red, a
dashboard publish is broken even though everything else is green.

The one thing to remember when publishing from the GUI: the Builder has its own
environment, so `VITE_SITE_URL` has to be set there too (step 4). Without it that build
keeps emitting the old canonical, and the copy Base44 serves starts competing with the
production domain for the same content.

## The home page, and the one conversation

The landing page runs eight sections: hero, carrier logos, a short About, the
five service pillars, **`#start`**, the case studies, testimonials and the
questions. `#start` is the only place it asks for anything — the interview agent
at full width, WhatsApp and phone beside it, and the short form as a secondary
card for anyone who would rather not chat.

It used to run seventeen sections and five separate ways to send the same name
and phone number, with the header, hero, sticky bar and footer each pointing at
a different one. Everything that left is still on the site: the two
self-assessment tools at [`/tools`](src/pages/Tools.tsx), the essay and the full
biography at [`/perspective`](src/pages/Perspective.tsx), the reading
recommender at the top of `/blog`. Only the duplicate routes to the same
conversation were deleted.

Anchors into those sections work from every route — `useSectionNav` routes home
first and then scrolls, because a bare `#services` on `/blog` sets the URL and
does nothing.

## A platform limit worth knowing before you add a recipient

Base44's `Core.SendEmail` delivers **only to registered users of the app**. An
address that is not registered fails silently and shows up as a warning in the
operations copy, nowhere else.

This is not theoretical: `dorit@govari-fin.co.il` was not a registered user, so
she received none of the leads the site collected while the operations mailbox
received all of them. Adding an address to `NOTIFY_EMAILS` is therefore only
half the job — the other half is registering it as a user of the app.

A visitor is never a registered user, so the confirmation email the site used to
offer them could not arrive. The interview no longer promises one. Sending real
confirmations needs an external mail provider with a verified domain rather than
the Core integration.

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

A finished interview leaves the same way a form does. The agent hands the
summary the visitor approved to `submitLead`, which mails it to דורית and to the
team operating the site in the site's own layout, and confirms to the visitor if
they gave an address. It used to end at `Lead.create` instead — stored, and
nobody told, until somebody happened to open the leads screen.

What it hands over is a **fixed schema, not free text**. The agent picks one of
seven tracks from the visitor's stated goal — pension, insurance, retirement,
tax, savings, self-employed, or a general fallback — and fills that track's
named fields. `INTERVIEW_TRACKS` in `submitLead/entry.ts` is the whitelist: a
key the model invents is dropped before it reaches anyone, which is what stops a
model handed a form from inventing a field called `advice`. Every value passes
through `redact()`, because a profile is written by a model that just heard the
visitor type things it was told not to record.

The interview is saved **twice**. Name and phone are asked after the goal and
before the track questions, and the agent saves a `partial` record the moment it
has them — silently, mailing nobody. A visitor who answers four questions and
closes the tab used to leave nothing at all; now they leave a row דורית can
follow up. The closing call updates that same row rather than creating a second,
keyed on the phone number within a six-hour window, which is also what stops a
visitor running the interview three times from producing three leads.

Two fields are deliberately narrower than they look. **Management fees** are
recorded as the visitor stated them, or as "לא ידוע למבקר" — the agent notes the
number and is barred from saying whether it is high, because §2 forbids
supplying figures and opinions, not recording what it was told. **Health** is a
flag and never a description: the insurance track asks whether there is anything
דורית should know, records "יש"/"אין", and a visitor who volunteers detail
triggers the `sensitive_data` handoff instead of being written down.

The rest lives in the prompts, and `tests/contract/agents.contract.test.ts`
fails if a mandatory clause disappears from any of them.

Full description of the layer, what is enforced where, and one open question
for דורית's compliance adviser: [`base44/agents/COMPLIANCE.md`](base44/agents/COMPLIANCE.md).

## Search engines, and AI assistants

Two different readers, and they do not get the same thing.

Google executes JavaScript, so it sees what a visitor sees: `useSeo` writes each
route's title, description, canonical and JSON-LD at runtime, `/faq` carries
`FAQPage` markup generated from the questions it renders, posts carry
`BlogPosting`, and every page carries breadcrumbs.

**AI crawlers mostly do not run JavaScript.** GPTBot, ClaudeBot, PerplexityBot
and CCBot receive the static `index.html` on every path — so to them `/faq`,
`/tools` and `/blog` all look like the home page. That is the single largest SEO
constraint on this site and it is architectural; it is written up as B-0 in
[10-known-issues](tests/test-plan/10-known-issues.md), with prerendering as the
fix and the reason it has not been done yet.

What mitigates it is [`public/llms.txt`](public/llms.txt): a static file those
crawlers *can* read in full, carrying the services, the contact details, the
licence number, the affiliation disclosure, what the automated helpers refuse to
do, and a link to every public route. It had drifted to a phone number and an
email that do not reach her, because a file in `public/` is invisible to the
type-checker and to every suite. `tests/contract/ai-surface.contract.test.ts`
now derives the contact details from `src/config/contact.js` and fails on any
other address or number in the file.

`robots.txt` names each AI crawler explicitly and allows it, with a comment
saying how to opt out of training while staying answerable in AI search.

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

The full battery — lint, typecheck, unit, component, contract, integration,
security, and end-to-end across desktop web, iOS Safari and Android Chrome —
runs from one command:

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
| Everything (Vitest, one process) | `npm run test:vitest` | `tests/` |
| Unit | `npm run test:unit` | `tests/unit/` |
| Component | `npm run test:component` | `tests/component/` |
| Contract | `npm run test:contract` | `tests/contract/` |
| Integration | `npm run test:integration` | `tests/integration/` |
| Security (static) | `npm run test:security` | `tests/security/` |
| e2e — UI, API, security, a11y, SEO | `npm run test:e2e` | `e2e/` |
| SEO only | `npm run test:e2e:seo` | `e2e/seo/` |

`npm test` is `test:vitest` followed by `test:e2e`. The five Vitest suites used
to run as five separate `vitest run` invocations, which paid the startup cost
five times — 8.5s against 4.1s for the same 436 cases in one process. The
per-suite commands remain for running one on its own, and `./scripts/run-tests.sh`
still invokes them separately so its summary can report each suite's own
pass/fail.

**The integration suite runs the Base44 backend functions for real.** They sit
outside `tsconfig.json` and execute on Deno inside Base44, so nothing else in
the repo ever runs them — the other suites match strings against their source.
`tests/helpers/base44-function.ts` loads one in-process against a recording
client and reports what it stored, who it mailed, what each recipient saw, and
what survived a failure.

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


**Every push, on every branch, runs the battery** — lint, the typecheck gate,
build, the five Vitest suites, e2e, and an Allure report attached to the run.
How much e2e depends on where you are:

| Where | e2e | Roughly |
|---|---|---|
| A feature branch, or a PR | **Chromium only** | ~5 min |
| `main`, `builder`, or a manual run | **all four platforms** | ~12 min |
| **Nightly at 22:00** (19:00 UTC) | all four platforms | ~12 min |

The four legs are the whole cost of a run — WebKit alone takes 9 minutes
against Chromium's 4, and `ios-safari` is WebKit too. Paying that on every push
to a feature branch buys little: a defect only WebKit sees is rare, and the
nightly run finds it the same day. `main` keeps the full matrix on purpose,
because the publish job refuses to run unless e2e passed — narrowing it there
would quietly weaken the gate in front of the client's site.

A feature branch deploys **nothing**: every deploy job checks the ref, so
`main` and `builder` stay the only branches that can reach a site, and only
those two publish the report. Nor can the nightly run deploy — every deploy job
also requires a `push` event.

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

**The verdict is not Builder-only.** The `Safe to merge?` job runs on every
branch except `main`, writes to the run summary, and — when the commit has an
open PR — posts a comment on it, edited in place so there is one comment always
describing the latest run. The check goes red when the answer is no, because a
check called "Safe to merge?" sitting green beside a body that says *do not
merge* is worse than no check at all.

That isn't a weaker guarantee than it sounds, because **publishing only ever
happens from main**, and the publish there requires a green run. The gate sits
where users are actually affected.

⚠️ Every Builder branch shares the app's **live data** — "the same live records
everywhere", in Base44's words. Tests never touch it, but anything you do by
hand in the Builder writes to דורית's real leads.

### Branches

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
