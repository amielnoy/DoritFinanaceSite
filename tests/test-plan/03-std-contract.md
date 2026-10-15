# STD-03 — Contract Tests

**Suite:** `contract` · **Runner:** `npm run test:contract` (Vitest, node)
**Location:** `tests/contract/` · **Cases:** 181 declared cases (IDs in section 4; a range such as `X-001..014` counts each ID); `npm run test:contract` runs 932 including `it.each` / `describe.each` expansions (931 pass, 1 skipped)

---

## 1. Purpose

Keep the frontend and the Base44 backend definitions from drifting apart. These
tests do not restate the payloads: they **read the real call sites out of
`src/`** and the **real schemas out of `base44/`**, so a renamed field, a new
`source` value outside the entity enum, or a loosened RLS rule fails here rather
than in production.

## 2. Test items

| Item | Source |
|---|---|
| Entity schemas | `base44/entities/{BlogPost,Contact,Lead,Testimonial,User}.jsonc` |
| Agent prompts | `base44/agents/{needs_interview,blog_recommender,support_agent}.jsonc` |
| Published articles | `content/blog/*.md` |
| Frontend write paths | `base44.entities.*.create/update/filter`, `integrations.Core.SendEmail` |
| Backend functions | `base44/functions/{createConsultationEvent,escalateToHuman,upsertContact,logSupportChat}/entry.ts` |
| Connectors | `base44/connectors/{googlecalendar,googlesheets}.jsonc` |
| Function logging | every `base44/functions/*/entry.ts`, `scripts/archive-logs.mjs`, the `logs` job in `ci.yml` |

## 3. Approach

Two helpers do the work:

- `tests/helpers/entity-schema.ts` — loads the `.jsonc` entity definitions and
  validates a payload against the JSON-Schema subset they use (type, required,
  enum, minimum/maximum, no undeclared properties).
- `tests/helpers/source-scan.ts` — a balanced-brace scanner that extracts the
  object literal passed to a call matching a pattern, returning its top-level
  keys and string-literal values; `edgeSource()` reads an Edge function's
  handler, its sibling modules and the `_shared` modules they import.
- `tests/helpers/chat-prompt-sources.mjs` — the rules that turn a Base44
  agent's instructions into the chat function's Markdown prompts
  (`INTERVIEW_TOOL_SECTION`, `SUPPORT_TOOL_SECTION`, `withToolSection`,
  `collapseBlankRuns`).

## 4. Test cases

### 4.1 Entity definitions — `entities.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-ENT-001 | "ships the entities the frontend depends on" | Exactly `BlogPost, Lead, Testimonial, User` |
| CTR-ENT-002..017 | Per entity (×4): well-formed and name matches filename; only supported property types; `required` lists only declared properties; enums and defaults consistent | All pass |
| CTR-RLS-001 | "Lead: anyone may submit, only admins may read/update/delete" | `create === true`; read/update/delete gated on `role: admin` |
| CTR-RLS-002 | "BlogPost: world-readable, admin-writable" | `read === true`; writes gated on `role: admin` |
| CTR-RLS-003 | "no entity is left world-writable by accident" | No entity has `update`/`delete` set to `true` |

### 4.2 Frontend payloads — `frontend-payloads.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-LED-001 | "finds every Lead.create call site" | None in the browser — the three backend functions own every write |
| CTR-LED-002..010 | Per call site (×3): sends only declared fields; sends `name` and `phone`; uses enum-legal `source`/`status` literals | All pass |
| CTR-LED-011 | "covers all three declared lead sources across the site" | `{quick, detailed, consultation}` = the entity's `source` enum |
| CTR-LED-012 | "validates a representative payload from each form end to end" | Zero validation issues for all three |
| CTR-LED-013 | "rejects a payload with an unknown source or a stray field" | Exactly two issues: `source`, `utm_campaign` (negative control) |
| CTR-BLG-001 | "the admin payload carries title and body and nothing undeclared" | `BlogAdmin` payload conforms |
| CTR-BLG-002 | "publish toggles only flip the declared boolean field" | Every updated key is declared |
| CTR-BLG-003 | "the public blog list filters on the published flag only" | One `filter` call, `{published}`, declared boolean |
| CTR-BLG-004 | "keeps the mirror-only fields off the BlogPost entity" | `slug` is not a BlogPost property |
| CTR-TST-001 | "sends only declared fields and both required ones" | `Testimonial.create` conforms |
| CTR-TST-002 | "keeps the rating inside the declared 1..5 range" | 5 valid; 6 and 0 rejected |
| CTR-TST-003 | "only accepts the declared review sources" | `google \| midrag`; `yelp` rejected |
| CTR-EML-001 | "every send supplies to, subject and body" | Exactly those three keys on every `SendEmail` |
| CTR-EML-002 | "never hardcodes a recipient inline" | No literal `to:` string — recipients come from named constants |

`slug` is the one key the admin's BlogPost payload may carry that the entity lacks — it is the Supabase mirror's alone — and a case fails if it ever becomes a Base44 field.

### 4.3 Backend function — `consultation-function.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-FN-001 | "is issued by the lead adapter, so components never call it directly" | `invoke("createConsultationEvent"` appears in the adapter and in no component |
| CTR-FN-002 | "the client sends exactly the fields the function reads" | Client keys ≡ the function's destructured body fields |
| CTR-FN-003 | "the function's mandatory fields are the same as the Lead entity's" | Guard is on `name` and `phone`, matching `Lead.required` |
| CTR-FN-004 | "returns 400 with an error message when name or phone is missing" | A 400 `Response.json({error})` exists |
| CTR-FN-005 | "surfaces an upstream calendar failure as 502, not as a success" | `if (!res.ok)` → status 502 |
| CTR-FN-006 | "catches unexpected errors as 500" | `catch (error)` → status 500 |
| CTR-FN-007 | "returns `{ ok, eventId, htmlLink }` on success" | Success literal carries all three keys |
| CTR-FN-008 | "every error response carries an `error` key" | ≥3 error responses, all with `error` |
| CTR-FN-009 | "takes every calendar token from a connector, never from a literal" | Both connectors named in the provider table; token read as `getConnection(cal.connector)`; no secret literals |
| CTR-FN-010 | "does not echo the access token back to the caller" | No `accessToken` in any `Response.json(...)` |
| CTR-FN-011 | "uses declared connectors that exist in the repo" | `outlook.jsonc` and `googlecalendar.jsonc` both present |
| CTR-FN-012 | "asks Outlook for the scope it actually needs" | `outlook.jsonc` carries `Calendars.ReadWrite` |
| CTR-FN-013 | "both calendars are reached through one function, not two" | One payload; one `invoke`; **no** `invoke("createOutlookEvent"` anywhere in the adapter |
| CTR-FN-014 | "writes to Outlook and Google, Outlook first" | Default provider list is `outlook,google` |
| CTR-FN-015 | "gives each calendar the timezone name it understands" | `Israel Standard Time` for Graph, `Asia/Jerusalem` for Google |
| CTR-FN-016 | "reads the event link under each calendar's own name" | `data.webLink` and `data.htmlLink` |
| CTR-FN-017 | "one calendar failing does not lose the other" | The loop `continue`s; the 502 is conditioned on `created.length === 0` |
| CTR-FN-018 | "refuses rather than reporting success when no calendar is configured" | `PROVIDERS.length === 0` → 500 |

`CTR-FN-013..018` exist because the two calendars differ in five small,
trap-shaped ways, and every one of them fails *silently* when it is wrong: the
event is accepted, and it is in the wrong place or at the wrong hour. That is
not hypothetical — A-47 is exactly it. Two functions held the same
event-building code, one of them got the timezone fix and the other did not, and
meetings booked from the consultation form sat three hours late in the only
diary Dorit actually reads.

## 4a. The compliance contract

Two files here test text rather than shape, and do so on purpose. Both cover
artefacts that a regulator, not a compiler, is the reader of.

**`agents.contract.test.ts` — `CTR-AGT-001..180`** — the three agent prompts. For each
agent it asserts the eighteen mandatory clauses of the compliance block (bot
disclosure, licence number `L-00107009`, the marketing-not-advice statement, the
absolute bans on product recommendation and figures, the privacy-law citation
and data-minimisation rule, the complaint and privacy-request routes, the
"never guess — escalate" default, and the fallback phone and email), that
`escalateToHuman` is wired as a tool, that the prompt opens by disclosing it is
automated, and that no agent is granted an entity operation beyond its job.

One case there is about reachability rather than compliance: every agent must
carry `allow_anonymous_access: true`. All three sit on public pages, and Base44
answers `createConversation` for an agent without it with a 401 — "User must be
authenticated to create a conversation" — which the chat reports as the same
"לא הצלחתי לשלוח את ההודעה כרגע" line a network blip produces. The flag was
absent from these files until a Builder "Update base44 packages" commit wrote
out the full agent schema and stamped the server default, `false`, into all
three at once, taking every chat on the site down silently. It is pinned here
because the next regeneration will try the same thing.

A second block, "the configuration nobody typed by hand", pins the *whole*
non-prompt surface of each agent with `toEqual` against a hand-written literal:
every key, the tool list, the memory settings, the model. That commit added
eighteen previously-absent keys in one go and two of them carried behaviour;
pinning one flag leaves seventeen. The assertion is deliberately not a snapshot
— `vitest -u` rewrites a snapshot mechanically with nobody reading the delta,
which reproduces the failure this exists to prevent, one layer up. A literal can
only be made green by a person opening the file and typing the new value.

Two further cases in the same file cover what the chat shell must keep doing
when the backend does not: the route to a person is rendered from state the
panel owns, in one place, outside both branches of the consent gate — the
transcript is replaced wholesale by every server push, so a phone number written
into it survives only until the next one — and a failed send hands the visitor
back what they typed.

It then pins the four places the escalation vocabulary is written down —
`Lead.escalation_reason`, each prompt, `src/config/compliance.ts` and the
`EscalationReason` union — and fails if any of them drifts from the others.

Finally it asserts what the shell enforces and a prompt cannot: no message may
be sent before consent, the handoff path exists independently of the model, and
the fence published beside the interview agent matches what the prompt actually
forbids. A page that claims the agent gives no figures while the prompt has
stopped saying so is a false statement to a visitor, and fails here.

Three blocks cover the interview agent specifically.

The first is the **schema**, which exists in two places and has to agree in
both: `INTERVIEW_TRACKS` in `submitLead` decides what is rendered and stored,
the prompt decides what is asked. The test parses the track table out of the
function and fails if a track or a field is never named in the prompt — drift
there fails silently in the direction that shows least, with the agent
collecting answers the function drops on the floor. A second case pins the
declaration that the interview collects rather than advises, in the prompt and
in the mail; a third pins that the health question stays a flag and never grows
back into asking what the condition is, with the `Lead` entity checked for a
place to put one.

The **operations mailbox list** is the fourth thing Base44's isolated entry
points force us to duplicate, alongside `redact`, `escapeHtml` and
`SHEET_COLUMNS`, and the one whose drift is hardest to see: a mailbox added to
`submitLead` and not to `escalateToHuman` produces no error anywhere —
enquiries arrive, and escalations, the messages that matter most, quietly reach
one fewer person. One case pins the three copies byte-identical; another pins
that each mailbox gets its own `try`, since one wrapped around the whole loop
would let the first bounce swallow the rest.

A last block covers how the interview agent *ends*. A finished interview has to
reach a person, and a bare `Lead.create` reaches nobody — it stores the summary
and sends no mail, so it waits for whoever next opens the leads screen. The
block pins that the agent is wired to `submitLead` and not to the `Lead` entity,
that it calls it with the source the function knows how to lay out, that the
prompt says in so many words not to write the record directly, that it carries
the same data-minimisation rule as the booking agent, and that it does not
confirm a save that failed.

One block covers **which transport reaches whom**. `Core.SendEmail` delivers
only to registered users of the app, so `CORE_EMAILS` is not a list of people —
it is the list of addresses the platform is able to reach, and everyone else
takes the mailer. The tests pin that list byte-identical across the three
isolated entry points, because a disagreement would mail the same address one
way here and another way there; that the single `Core.SendEmail` call sits
inside the routing helper rather than being a choice made three times; and that
**the agency never appears on the Core path** — that last one is the original
defect stated as an assertion, since a copy that silently fails to her looks
exactly like one that arrived.

A second block pins `escapeHtml`, `detailRow`, `block` and `proseRow`
byte-identical across every function that renders mail. `escalateToHuman` grew
an HTML notification of its own, which meant a third copy of the palette
helpers; Base44's isolated entries leave no way to share them. Duplicated is
fine, drifted is not, and a drifted `escapeHtml` is a phishing vector rather
than a cosmetic difference.

Two blocks cover the **support agent**, which answers in the free chat on `/faq`
and nowhere else. The first pins the boundary of that: it collects nothing, has
nothing to collect, points anyone wanting a callback at the interview, and —
the inversion worth stating — hands over *every* channel `escalateToHuman`
returns, WhatsApp included. That last one reads backwards until you know why a
WhatsApp channel was rejected (B-8): the published number is Dorit's own
account, so withholding it here would withhold a human from someone asking for
one. A companion case pins that no agent holds `upsertContact`, which makes the
contact flow a capability decision rather than a prompt decision.

The second covers the **record**. A chat that keeps its transcript has to say so
before it starts, and the interview's consent notice describes different
processing entirely: it promises that a name and a phone number are collected,
which here would be a precise description of something that does not happen. So
the support chat carries `SUPPORT_CONSENT_POINTS`, and the block fails if that
notice loses the storage sentence, gains the interview's collection promise, or
drops the licence. Alongside it: that `logSupportChat` is called once at the end
and never mentioned to the visitor — which is only acceptable *because* the
notice says it, so the two cases hold each other up — that the transcript and
topic are redacted before anything is written, and that the support row is keyed
on the same normalised phone number `upsertContact` uses.

The reading recommender had the same defect until `CONSENT_VERSION` v5: it
showed the interview's notice. It now carries `BLOG_RECOMMENDER_CONSENT_POINTS`,
the one-line notice Dorit's compliance adviser approved on 2026-10-10 plus the
licence line (`COMPLIANCE.md` §9). "the reading recommender's notice" pins the
approved sentence word for word, the licence and affiliation beside it, the
absence of the interview's collection promise, and the v5 version stamp — so
wording that drifts from what was approved fails before it ships.

The `Contact` entity has a block of its own, covering code no agent calls today.
It pins that the record is keyed on the phone number and nothing else, that the
number is normalised before it becomes that key, and — the one that matters most
— that the field list is exactly the six a callback needs. An ID number, a
policy number or anything medical has no field to land in, so a reworded prompt
alone cannot start storing them.

**`logging.contract.test.ts` — `CTR-LOG-001..067`** — what the backend is
allowed to write down. These functions logged nothing until now, so the only
diagnosis available was the warnings appendix in the operations email — which
means only an enquiry whose mail went out could be diagnosed, and the failures
worth diagnosing are the ones where it did not.

Adding logging creates a hazard worth a suite rather than a comment. A log is
the one store a deletion request never reaches, and the whole schema exists to
keep identifiers out of storage. So half these cases are about restraint: every
`log()` call site is parsed out of every function and checked for eleven
forbidden field names, mail lines must carry a `role` rather than a recipient,
and any provider error text must be truncated — it is not ours and not bounded.
The other half are about usefulness: every function opens and closes its
request, every line carries the correlation id, the helper is byte-identical
across all seven isolated entries, and each declares its own name exactly once.

A final block pins the archive: nightly only, never committed (the repository
is public), each file named for the window it covers rather than the day it
ran, and a fetch failure that warns instead of reddening the nightly badge.

A last block *executes* the publish gate rather than reading it. Base44 offers
two credentials and only one exists on every plan — a workspace API key, or the
access/refresh pair a local login leaves behind — and the first version of the
gate failed the run whenever `BASE44_API_KEY` held anything that was not a
workspace key. That is right when it is the only credential (the CLI would fall
back to a device login and hang) and wrong when a working session sits beside
it, which is how the merge of #48 failed with all three secrets present. The
cases extract the step's shell out of the YAML and run it under `bash -e` for
each combination, since shell embedded in a workflow is covered by nothing else
here.

**`ai-surface.contract.test.ts` — `CTR-AI-001..018`** — what an AI assistant can
read. The app is client-rendered, so a crawler that does not execute JavaScript
receives the home page's `<head>` on every route; `public/llms.txt` is therefore
the only surface such a crawler reads in full, and the one nothing was checking.
It had drifted to a phone number and an email that do not reach her — a static
file in `public/` is invisible to the type-checker and to every other suite. The
block derives the expected contact details from `src/config/agencyProfile.ts`, fails
on any other address or number in the file, and pins the disclosures an
assistant would summarise: the licence number, the affiliation, that the
automated helpers collect rather than advise, and that nothing promises a
return. It also pins that `llms.txt` links every route the sitemap advertises —
the two drift in opposite directions, because a new page reaches the sitemap
when an SEO test asks for it and is forgotten here because nothing does — and
that `robots.txt` names each AI crawler explicitly rather than leaving them to
the wildcard. `CTR-AI-015..017` pin that `robots.txt` tells a crawler where
`/llms-full.txt` is, that `build:prerender` runs `scripts/build-seo-files.mjs`
after the prerender (so Vercel and CI write the sitemap, `llms.txt` and
`llms-full.txt` with the published articles), and that the Base44 Builder's plain
`build` stays `vite build`. `CTR-AI-018` pins that the prerender and the SEO
files both read their environment through `buildEnv`.

**`blog-content.contract.test.ts` — `CTR-ART-001..019`** — the repo-held articles under
`content/blog/`. Each must parse, be a real article rather than a stub, carry
the גילוי נאות block with the licence number and the affiliation, contain no
promise of a return, map cleanly onto the `BlogPost` entity, and ship as a
draft: publishing stays a human decision. The optional `action_time` ("רבע
שעה") is declared on the entity as an optional string and kept to 20
characters per article — it is a chip on a card, not a sentence.

**`personal-area.contract.test.ts` — `CTR-ACC-001..006`** — what a signed-in
visitor may read of their own enquiries. CI does not run
`supabase/tests/account_check.sql`, so this block reads the migration
statically and pins what a careless edit would break silently: who may call
which function, and which columns leave. The grant and revoke lines are matched
whitespace-tolerantly — the test pins grants, not alignment.

| ID | `it` title | Asserts |
|---|---|---|
| CTR-ACC-001 | "adds the columns the page shows" | `summary`, `profile`, `track_label` are added to `leads` |
| CTR-ACC-002 | "only service_role may call enquiries_for" | Revoked from `public`; granted to `service_role`; never granted to `authenticated` or `anon` |
| CTR-ACC-003 | "signed-in users may call my_enquiries, anonymous visitors may not" | Granted to `authenticated`; revoked from `public`; no grant to `anon` |
| CTR-ACC-004 | "returns no column outside the visitor's list" | Both functions declare exactly 11 output columns, in the order `created_at`, `source`, `track`, `track_label`, `meeting_topic`, `timing`, `scheduled_at`, `summary`, `profile`, `completed`, `in_calendar`; none of `base44_id`, `name`, `phone`, `email`, `status`, `calendar_status`, … |
| CTR-ACC-005 | "matches only a verified address" | `my_email` requires `email_confirmed_at is not null` |
| CTR-ACC-006 | "opens no table to ordinary users" | The migration creates no policy on `leads` or `meetings` |

### 4.4 The repository as a contract

Five files here assert things about the repo's own configuration rather than
about application data. They exist because each covers something that fails
*silently* — a wrong value produces a green run and a broken result.

**`workflow.contract.test.ts`** — `.github/workflows/ci.yml`, parsed rather than
grepped. No job may upload two artifacts under one name (a real 409 that failed a
run after the whole battery had passed), every Vitest suite on disk must be run
by some job, and no job may depend on or read an output from a job that does not
declare it. It also forbids a build that strips `VITE_BASE44_APP_ID` from writing
the default `dist/` in any job that uploads `dist` — that arrangement shipped a
bundle whose app id inlined to `undefined` as the artifact all ten e2e shards
tested, and the suite stayed green because the fixture stubs `**/api/**`.
Since articles are prebuilt, the nightly run is no longer deploy-free: CTR-REB-001
requires `deploy-vercel` and `deploy-supabase` to run on `schedule` (the functions
first, because `--prod` waits for them), and a companion case keeps the Base44
publish — which ships the agents — off it. CTR-REB-002 pins that the publish
workflow ends by dispatching `ci.yml` on `main` with `deploy=true`, with
`actions: write` and only after a real publish. CTR-REB-003 requires
`PRERENDER_REQUIRED=1` on the production Vercel build only; CTR-REB-004 keeps
`PRERENDER_ARTICLES_FIXTURE` in the e2e `build` job's `Build` step and out of the
workflow-level `env`, every other job and `vercel.json`; CTR-REB-005 requires the
production deploy check to fetch `/blog`, which now shares its name with the
`blog/` directory of articles. CTR-REB-006 requires the workflow's `cancel-in-progress`
to be false on `schedule`, so the nightly run queues behind an in-flight push rather
than cancelling it (Vercel on new code, Base44 on old); CTR-REB-007 requires the
production smoke to skip the agent-conversation probes on `schedule`, and the spec to
honour `E2E_SKIP_AGENT_PROBES`. `prerender-hermetic.contract.test.ts` (CTR-REB-008)
pins that `scripts/prerender.mjs` aborts `googletagmanager.com` / `google-analytics.com`
before navigating, as the e2e fixture does, so a build sends no fake page_views.
`article-slug.contract.test.ts` (CTR-SLG-REF) pins the 400 and 409 slug-refusal texts
in `BlogAdmin.tsx` to the ones in `contentAdmin`.

**`deploy-gate.contract.test.ts`** — that exactly one thing promotes production.
`vercel.json` must disable Git-triggered deploys on `main` and `builder` and
leave them on elsewhere, so pull-request previews survive. And `--prod` must be
conditioned on both suites going green: `needs:` orders jobs, it does not gate
them, so an earlier version of this file asserted the `needs:` line and called
that "behind the tests" while a red run still reached `--prod`. A companion case
pins that a red run *does* still deploy, as a preview — staging on red is the
point of staging, and a later fix must not buy the gate by removing it.

Two cases pin that the Vercel build gets the project's own app id (A-76). The
workflow sets `VITE_BASE44_APP_ID=e2e-sanity-app` globally for the e2e bundle,
and a process variable outranks what `vercel pull` writes, so every Vercel
deploy shipped a bundle posting to `/api/apps/e2e-sanity-app/...`. One case
requires the "Build for Vercel" step to drop the variable before `vercel build`;
the other requires the step to refuse a bundle under `.vercel/output` that still
names the placeholder.

The "waits for the new release to be served" case also pins how long that wait
can be. The Vercel job records the bundle it is deploying to production (step
`built`, read from `.vercel/output/static/index.html`, production only, after
"Build for Vercel"), and the smoke passes it as `EXPECTED_ASSET`. Production is
then ready the moment it serves that bundle, which is immediately when a commit
left the frontend unchanged. Before this, the wait asked for the bundle to
*change* and sat out its whole eight-minute timeout on every backend-, docs- or
SEO-file merge.

Ten further cases cover the run summary, per writer rather than per file. The
two writers are split by branch and cannot both fire — "Deployed sites" on
`main`, "Safe to merge?" on every other ref — which is deliberate, since two
tables calling one URL different things is worse than one. The cost was that the
branch half carried a different set of links from the trunk half, and the one it
omitted was production: the address the verdict exists to protect was the one
you had to look up. Each writer must now name production (from
`vars.PRODUCTION_URL`, never written out), the Allure report and the Vercel
staging build, and must say the links need a sign-in — both answer an anonymous
request with a redirect, and without the note the first reading is that CI
published a broken link. Asserted inside each job's own body, because "the
workflow mentions Allure somewhere" is true of a workflow that prints it in only
one of them.

**`canonical-host.contract.test.ts`** — one origin, written in one place.
`VITE_SITE_URL` is the runtime source, and every checked-in file that spells the
host out must be one the build rewrites. `index.html` was missing from that list,
so a host move shifted the sitemap and left the served document advertising the
old origin in its canonical tag, `og:url` and two static JSON-LD blocks.

**`vercel-functions.contract.test.ts`, old article addresses.** Every
`/blog/<24 hex>` — a Base44 id, what article links were before slugs — must be
rewritten to `api/og/blog.ts` with no `has` condition (people get the 301 as
well as crawlers), before the crawler rule and the SPA catch-all.

**`vercel-functions.contract.test.ts`, clean URLs.** `cleanUrls` is `true` (so
`dist/<route>.html` answers `/<route>`), the catch-all rewrites to `/app`, and
`api/og/blog.ts` fetches the shell from `${SITE_URL}/app` — no `VERCEL_URL`
(deployment protection) and no `functions.includeFiles` (it aborts
`deploy --prebuilt`).

**`base44-backend.contract.test.ts`** — the Vite plugin that lets a locally built
bundle reach a real backend. The app id falls back to the linked app only when
the environment supplies none, never overriding it; a checkout with no
`base44/.app.jsonc` stays silent, which is what keeps CI's "build the way the
Builder does" guard meaningful; and the `/api` preview proxy stays opt-in,
because `npm run test:e2e` serves the site from that same preview server and is
hermetic only while every `/api` call is stubbed. Two more cover the analytics
beacon: `<Analytics />` must be mounted behind a flag `vite.config.js` derives
from Vercel's own `VERCEL`, not from a variable set per environment — a hand-set
flag fails by being left on in a Base44 build, which is the state it replaces
(A-43). Two further cases close the
other end of that arrangement: the e2e build seals `e2e-sanity-app` into `dist/`,
and `dist/` is what `vite preview` serves, so `npm run preview` must rebuild
before serving and `scripts/run-tests.sh` must discard the bundle it built. A
preview left on that artifact 404s every backend call and reports it as the one
line a real outage produces — "מצטערת, לא הצלחתי לשלוח את ההודעה כרגע".

**`carriers.contract.test.ts`** — every insurer link resolves to a domain that
exists, and each carrier's name and URL agree.

Since the FAQ chat's sweep, `edgeSource()` in `tests/helpers/source-scan.ts`
returns a function's `handler.ts`, **its sibling `.ts` modules** (not `index.ts`
or `*.generated.ts`) and the `_shared` modules any of them import. The logging
and function-clock contracts therefore scan `chat/turn.ts` and `chat/sweep.ts`
too: a log line or a date format there is held to the same rules as one in
`handler.ts`. The test cases themselves are unchanged; what they scan grew.

**`function-clock.contract.test.ts`** — that a time a person reads is Israel
time. The functions run in UTC and `toLocaleString("he-IL")` takes the zone from
the runtime, which put every interview summary three hours early (A-63).

| ID | Title | Expected result |
|---|---|---|
| CTR-CLK-001 | "finds the functions to check" | More than five `entry.ts` scanned — an empty scan would pass everything |
| CTR-CLK-002 | "names the zone on every date it formats" | Every `toLocale(Date\|Time)?String(…)` in `base44/functions/*/entry.ts` carries `timeZone: 'Asia/Jerusalem'` |

**`frontend-payloads.contract.test.ts`, the call shape.** The adapters call
functions through `invokeFunction(this.client, "submitLead", {…})` since A-67;
`CTR-LED-*` and the `submitClaim` cases recognise that form as well as the bare
`functions.invoke(…)`, so the payload is still read from the one place it is
built.

**`e2e-selection.contract.test.ts`** — that a block for one kind of device is
selected by tag, not skipped by a condition callback (A-68).

| ID | Title | Expected result |
|---|---|---|
| CTR-SEL-001 | "finds the specs to check" | More than five specs scanned |
| CTR-SEL-002 | "never skips by a condition callback, which Allure reports as a failed hook" | No `test.skip((` in any spec |
| CTR-SEL-003 | "filters each tag out of the projects it does not belong to" | Two `grepInvert` filters of each kind |

### 4.5 Base44 SDK parity — `sdk-version.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-SDK-001 | "finds at least one function pin" | At least one `npm:@base44/sdk@<version>` import under `base44/functions` |
| CTR-SDK-002 | "`<function>` pins the SDK version the lockfile installs" (one per function) | Pinned version equals `package-lock.json`'s `node_modules/@base44/sdk` version — what `npm ci` installs, unlike a local `node_modules` an earlier install may have left. Functions pick up a bump only on the next Base44 publish. |

### 4.6 Self-hosted fonts — `fonts.contract.test.ts`

The fonts used to come from Google Fonts: every visitor's IP address went to
Google, and the e2e suite (which blocked Google Fonts to stay hermetic)
rendered in CI's fallback faces instead of the real ones. See A-74.

| ID | Title | Expected result |
|---|---|---|
| CTR-FNT-001 | "nothing that ships asks Google for fonts" | No `fonts.googleapis.com` / `fonts.gstatic.com` in `index.html`, `src/` or `public/` |
| CTR-FNT-002 | "every face in the site sheet points at a file that exists" | Each `url(/fonts/…)` in `src/fonts.css` is a file in `public/fonts` |
| CTR-FNT-003 | "every face in the poa sheet points at a file that exists" | The same for `public/fonts/poa.css` |
| CTR-FNT-004 | "declares every named family the site's font stacks use" | Every quoted family in the `--font-*` stacks of `src/index.css` has an `@font-face` |
| CTR-FNT-005 | "covers Hebrew in the faces Hebrew text falls through to" | Frank Ruhl Libre and Noto Serif Hebrew each declare a face with `U+0590-05FF` |
| CTR-FNT-006 | "preloads only files it serves and declares, with crossorigin" | Every `<link rel=preload as=font>` has `crossorigin`, exists, and is declared in `src/fonts.css` |
| CTR-FNT-007 | "ships the OFL licence beside the files" | A `LICENSE-<package>.txt` naming the SIL Open Font License for every font package |
| CTR-FNT-008 | "caches the font files without letting the document rule swallow them" | `/fonts/(.*)` has a `max-age` in `vercel.json`, the `no-cache` rule skips `fonts/`, and `public/_headers` matches |

Regenerate the files with `node scripts/self-host-fonts.mjs`; never edit
`src/fonts.css` or `public/fonts/poa.css` by hand.

### 4.7 The lead functions on Edge — `edge-functions.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-EDGE-001 | "mention no Docs, no Outlook and no Base44 connector" | No file under `supabase/functions` names `googledocs`, `graph.microsoft.com`, `connectors.` or `createClientFromRequest` |
| CTR-EDGE-002 | "are each registered without JWT verification, as submit-claim is" | `verify_jwt = false` for `submit-claim`, `submit-lead`, `escalate-to-human`, `log-support-chat` in `config.toml` |
| CTR-EDGE-003 | "ask Google for exactly two scopes" | `_shared/google.ts` lists only `calendar.events` and `spreadsheets` |
| CTR-EDGE-004 | "registers each clearinghouse function without the gateway's JWT check, because each checks its caller itself" | `verify_jwt = false` for every `masleka-*` directory |

### 4.8 Article addresses — `article-slug.contract.test.ts`

`blog_posts.slug` is shaped by four things that cannot import one another — the
migration's CHECK, `src/lib/articlePath.ts`, `contentAdmin` and
`scripts/published-articles.mjs` — and these cases keep them one rule. The
backfill is checked against the files it names, from its own side, so a draft
added to `content/blog/` later needs no row in a migration that has shipped.
`supabase/tests/blog_slug_check.sql` is the runtime counterpart: it re-applies
the migration on production-shaped rows (a duplicated title, an untidy Base44
id, a row with none) and asserts the backfill and every constraint. It also
asserts the BEFORE INSERT fallback trigger: an insert or upsert that sends no
slug gets `post-<id>`, an existing slug is never overwritten, and a sent slug is
kept. That trigger is what lets the migration reach production before the code
that writes real slugs.

| ID | Title | Expected result |
|---|---|---|
| CTR-SLUG-001 | "the migration's CHECKs are articlePath's patterns" | `slug ~` equals `SLUG_PATTERN.source`; `slug !~` equals `BASE44_ID_PATTERN.source` |
| CTR-SLUG-002 | "gives a repo article's slug to that file's exact title" | 20 backfill rows name a file; each title equals that file's front matter |
| CTR-SLUG-003 | "names the two live articles older than the repo files" | `bituach-briut-digitali`, `pensia-beidan-ha-ai` with their exact titles |
| CTR-SLUG-004 | "maps 22 distinct titles to 22 distinct slugs" | 22 rows, no title or slug twice |
| CTR-SLUG-005 | "builds no /blog/<…> address by hand" | No `/blog/${` or `"/blog/" +` in `src/` or `api/` outside `articlePath.ts` |
| CTR-SLUG-006 | "%s links articles through articlePath" (7 files) | `articlePath(` in ArticleCard, FeaturedRow, Blog, BlogPost, blogSeo, BlogAdmin, api/og/blog.ts |
| CTR-SLUG-007 | "contentAdmin's copy is the same" | Both patterns equal `articlePath.ts`'s; `ARTICLE_FIELDS` has no `slug` |
| CTR-SLUG-008 | "the build's copy is the same" | `scripts/published-articles.mjs` patterns equal `articlePath.ts`'s |

### 4.9 IndexNow — `indexnow.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-INOW-001 | "publishes the key file at the site root, holding the key" | `public/<key>.txt` contains `INDEXNOW_KEY` |
| CTR-INOW-002 | "is a step of the Vercel deploy job, for production only" | The step is gated on `steps.target.outputs.env == 'production'` and runs `node scripts/indexnow.mjs` |
| CTR-INOW-003 | "can never fail the deploy" | `continue-on-error: true`; the script has no non-zero `process.exit` / `exitCode` |

### 4.10 The chat tables — `chat-schema.contract.test.ts`

The chat function's records (`chat_conversations`, `chat_messages`, `chat_usage`,
`chat_budget_alerts`) are written only by the `chat` Edge Function with the
service role; an agency member or a platform admin reads their own agency's
rows. These cases read the two migrations as text. `supabase/tests/chat_tables_check.sql`
is the runtime counterpart: against a local database it asserts that anon and an
outsider read nothing, that a member sees only their agency and an admin sees
both, that an authenticated user can neither write a message nor call the purge,
that `chat_month_usage` sums per model, that the purge removes exactly the
expired conversation with its messages, and that deleting a lead deletes its
transcript and usage rows.

| ID | Title | Expected result |
|---|---|---|
| CTR-CHSCH-001 | "%s has row-level security on" (4 tables) | `enable row level security` for each of the four tables |
| CTR-CHSCH-002 | "are closed to anon and to authenticated writes" | Table privileges revoked from anon and authenticated; `select` alone granted back; outside comments, no grant naming insert/update/delete/all (alone or in a list) to authenticated, and no grant at all to anon |
| CTR-CHSCH-003 | "let a member or an admin read their own agency's rows, and nobody else" | One `can_see(agency_id) or is_admin()` select policy on each of the three readable tables; none on `chat_budget_alerts`; exactly three `create policy chat_` |
| CTR-CHSCH-004 | "delete a transcript with its lead, and messages and usage with their conversation" | `lead_id` and the two conversation FKs are `on delete cascade` |
| CTR-CHSCH-005 | "keep transcripts twelve months by default" | `delete_after` defaults to `now() + interval '12 months'` |
| CTR-CHSCH-006 | "open the usage totals and the purge to the service role only" | `revoke execute` from public, anon, authenticated and `grant execute` to service_role on `chat_month_usage` and `purge_chat_conversations` |
| CTR-CHSCH-007 | "schedule the purge nightly, after enabling pg_cron" | The schedule migration creates the extension and schedules `chat-purge-nightly` at `15 1 * * *` |
| CTR-CHSCH-008 | "record a hand-off apart from status, so a lead and a hand-off can both be told" | `chat_conversations.escalated_at timestamptz` is nullable and present |
| CTR-CHSCH-009 | "hold a conversation for one turn at a time with a lease, free by default (I3)" | `chat_conversations.busy_until timestamptz` is nullable and present |
| CTR-CHSCH-010 | "guard against write grants hidden in a list and against any grant to anon" | The two guards match `grant select, insert … to authenticated`, `grant all …`, a grant to `service_role, authenticated`, and a grant to anon; not a select grant, not the service-role grant, not a comment (triage 1) |
| CTR-CHSCH-011 | "marks a logged conversation with a nullable timestamp, indexed for the sweep" (`20261018000000_chat_support_sheet_log.sql`) | `alter table public.chat_conversations add column sheet_logged_at timestamptz;` and a partial index on `last_message_at` where `sheet_logged_at is null` |
| CTR-CHSCH-012 | "calls the function only with both Vault secrets, and never hard-codes the project URL" | Reads `chat_sweep_url` and `chat_sweep_token` from `vault.decrypted_secrets`; returns when either is null; `net.http_post` with the `x-chat-sweep` header; the project ref appears nowhere (Review Focus 5) |
| CTR-CHSCH-013 | "is security definer with an empty search path, and executable by no API role" | `chat_sweep_tick()` is `security definer` with `set search_path = ''`; execute revoked from public, anon, authenticated and service_role |
| CTR-CHSCH-014 | "runs every 15 minutes" | `cron.schedule('chat-support-sheet-log', '*/15 * * * *', …chat_sweep_tick…)` |

### 4.11 The chat prompts — `chat-prompts.contract.test.ts`

The chat function's prompts are Markdown files under `supabase/functions/chat/prompts/`, built into `prompts.generated.ts`. `interview.md`, filled for Dorit, must equal today's `needs_interview.jsonc` instructions apart from three tool-section lines; `compliance.md` is `COMPLIANCE.md` §3 and §5 verbatim; the function's agency copy must equal `agencyProfile.ts`.

| ID | Title | Expected result |
|---|---|---|
| CTR-CHPROMPT-001 | "%s equals agencyProfile.ts" | `AGENCY` (the function's copy) equals `AGENCY_PROFILE`, field by field (6 cases) |
| CTR-CHPROMPT-002 | "names the agency the tenant migration seeds" | The tenant migration inserts `AGENCY.id` |
| CTR-CHPROMPT-003 | "each tool-section change matches exactly one line of today's instructions" | The five `startsWith` prefixes (three tool-section, two language) each match one line of `needs_interview.jsonc` |
| CTR-CHPROMPT-004 | "renders, for Dorit, to today's text byte for byte apart from the three tool-section lines and the two language lines" | `interview.md` filled for agency 1 equals today's instructions with only the three lines replaced |
| CTR-CHPROMPT-005 | "asks for submitLead and never for a fenced block" | `interview.md` has no fenced `lead` block and requests the `submitLead` call |
| CTR-CHPROMPT-013 | "interviews a visitor who writes in English in English, and keeps what reaches Dorit in Hebrew" | `PROMPTS.interview` has no "דבר רק בעברית"; it says to interview an English writer in English, not to hand them off for the language alone, and that summary/profile sent to Dorit are always Hebrew (the user's decision of 2026-10-14; en-01) |
| CTR-CHPROMPT-006 | "is COMPLIANCE.md §3 and §5, verbatim" | `compliance.md` equals the §3 + §5 excerpt of `COMPLIANCE.md` |
| CTR-CHPROMPT-007 | "no longer lists createConsultationEvent as an interview tool" | The stale `createConsultationEvent` row is gone from `COMPLIANCE.md` |
| CTR-CHPROMPT-008 | "is what the build script writes from the Markdown files today" | `prompts.generated.ts` equals `renderPromptsModule` output; stale means run `npm run build:chat-prompts` |

`support.md` is the FAQ agent's prompt (`base44/agents/support_agent.jsonc`) with the tool section changed: the BlogPost line names `listArticles` / `readArticle` and links by slug, and the five `logSupportChat` lines are removed because the function logs the sheet itself (see `SUPPORT_TOOL_SECTION` in `tests/helpers/chat-prompt-sources.mjs`).

| ID | Title | Expected result |
|---|---|---|
| CTR-CHPROMPT-009 | "each replaced or removed line exists exactly once today" (support.md against the prompt Base44 runs today) | Each of the six `SUPPORT_TOOL_SECTION` prefixes matches one line of `support_agent.jsonc` |
| CTR-CHPROMPT-010 | "equals today's instructions with only the tool section changed" | `PROMPTS.support` filled equals today's instructions with the six lines replaced or dropped and blank runs collapsed |
| CTR-CHPROMPT-011 | "names its real tools and no Base44 one" | Names `listArticles`, `readArticle`, `escalateToHuman` and the `(/blog/<slug>)` link form; not `BlogPost` or `logSupportChat` |
| CTR-CHPROMPT-012 | "carries the agency's details as placeholders, not literals" | No `050-831-1776`, `dorit@govari-fin.co.il` or `L-00107009` in `PROMPTS.support` |

`procedures.md` is the procedures agent's prompt (`base44/agents/procedures_agent.jsonc`) with `PROCEDURES_TOOL_SECTION` applied: the BlogPost line names `listArticles` / `readArticle` and links by slug, the `logSupportChat` line is dropped (the sweep logs the chat), and the one "מגבלת הירוק" line that read an article "ב-BlogPost" reads it with `readArticle`.

| ID | Title | Expected result |
|---|---|---|
| CTR-CHPROMPT-014 | "each replaced or removed line exists exactly once today" (procedures.md against the prompt Base44 runs today) | Each of the three `PROCEDURES_TOOL_SECTION` prefixes matches one line of `procedures_agent.jsonc` |
| CTR-CHPROMPT-015 | "equals today's instructions with only the tool section changed" (procedures.md) | `PROMPTS.procedures` filled equals today's instructions with the three lines replaced or dropped and blank runs collapsed |
| CTR-CHPROMPT-016 | "names its real tools and no Base44 one" (procedures.md) | Names `listArticles`, `readArticle`, `escalateToHuman` and `(/blog/<slug>)`; not `BlogPost` or `logSupportChat` |
| CTR-CHPROMPT-017 | "carries the agency's details as placeholders, not literals" (procedures.md) | No `050-831-1776`, `dorit@govari-fin.co.il` or `L-00107009` in `PROMPTS.procedures` |

### 4.12 The chat function's tools — `tests/contract/chat-function.contract.test.ts`

The interview's tools ask the model for nothing their Edge handlers do not read, and offer exactly the hand-off reasons `escalate-to-human` knows. Tasks 6 and 7 add their cases here.

| ID | Title | Expected result |
|---|---|---|
| CTR-CHFN-001 | "submitLead asks the model only for fields submit-lead reads" | Every `submitLead` schema property is destructured by the submit-lead handler |
| CTR-CHFN-002 | "escalateToHuman asks the model only for fields escalate-to-human reads" | Every `escalateToHuman` schema property is destructured by the escalate-to-human handler |
| CTR-CHFN-003 | "offers exactly the hand-off reasons escalate-to-human knows" | `ESCALATION_REASONS` equals the keys of `REASONS` in `escalation.js`, in order |
| CTR-CHFN-004 | "is public, like the forms, and registered" | `config.toml` has `[functions.chat]` with `verify_jwt = false` |
| CTR-CHFN-005 | "enforces the same limits the page states" | The handler's `MAX_MESSAGE_CHARS` and `MAX_TURNS` equal the page's |
| CTR-CHFN-006 | "accepts no consent version longer than submit-lead's column holds" | `MAX_CONSENT_VERSION_CHARS` equals `LEAD_FIELD_LIMITS.consent_version` in `submit-lead/lead.js` |
| CTR-CHFN-008 | "stamps every conversation with the consent version it was given under" (changed pin, `agents.contract.test.ts`) | `consent_version: consentVersion`, chosen as `viaChatFunction ? CHAT_FUNCTION_CONSENT_VERSION : CONSENT_VERSION` |
| CTR-CHFN-007 | "sends only fields the function reads" | Every key the browser adapter posts, on the first and the following message, is read by `handler.ts` as `input.<key>` |
| CTR-CHFN-009 | "sends only fields log-support-chat reads, and never a phone" (the sheet-log sweep → log-support-chat) | `channel` and every key of `sheetRow()`'s output are destructured by `log-support-chat/handler.ts`; no `phone` key |
| CTR-CHFN-010 | "files only outcomes log-support-chat knows, so none lands as 'לא ידוע'" | `SHEET_OUTCOMES` equals the keys of `OUTCOMES` in `log-support-chat/handler.ts` |

### 4.13 The clearinghouse schema — `masleka-schema.contract.test.ts`

Reads `supabase/migrations/20261015000000_masleka_requests.sql` (applied in
production; never edited) and `20261019000000_masleka_wipe_notice.sql`. The behaviour
itself is proved by `supabase/tests/masleka_check.sql` against a local
`supabase start` (manual, like the other SQL checks):
`supabase start && supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/masleka_check.sql`.

| ID | Title | Expected result |
|---|---|---|
| CTR-MSK-001 | "sorts after every migration that came before it" | After `20261014000000_blog_slug.sql` |
| CTR-MSK-002 | "turns row-level security on for both tables" | Both `enable row level security` |
| CTR-MSK-003 | "grants anon nothing at all" | No grant names `anon` |
| CTR-MSK-004 | "lets the browser read neither the ciphertext nor the token hash" | Column grant without `code_ciphertext`, `id_ciphertext`, `token_hash`; no table-wide select; no writes |
| CTR-MSK-005 | "keeps the service-only functions away from anon and authenticated, by name" | Five revokes `from public, anon, authenticated`; `my_staff_role` to authenticated only |
| CTR-MSK-006 | "refuses ciphertext outside code_received, in the table itself" | The check constraint |
| CTR-MSK-007 | "wipes at nine days and expires links at thirty" | Both intervals present |
| CTR-MSK-008 | "schedules its jobs only where pg_cron and pg_net exist" | Both `cron.schedule` calls after the `pg_available_extensions` guard |
| CTR-MSK-009 | "keeps the remind call's address and secret in Vault, not in the migration" | Vault names present; no URL |
| CTR-MSK-010 | "creates no storage bucket — no clearinghouse file is ever uploaded" | No `storage.buckets` |
| CTR-MSK-011 | "hands the two staff lookups to service_role alone" | `staff_role` and `masleka_staff_emails` granted to `service_role`, to no one else |
| CTR-MSK-012 | "pins an empty search_path on every security definer function" | Every `security definer` function has `set search_path = ''` |
| CTR-MSK-013 | "keeps the access log append-only, even for service_role" | service_role's default privileges revoked; log granted `select, insert` only; log FK `on delete set null`, no cascade |
| CTR-MSK-014 | "comes after the clearinghouse migration, which is applied and never edited" | `20261019000000_masleka_wipe_notice.sql` sorts after it; the applied file never names `wipe_notified_at` |
| CTR-MSK-015 | "adds the one marker column and nothing else" | `add column wipe_notified_at timestamptz`; no drop, grant, revoke, function, policy or schedule |
| CTR-MSK-016 | "leaves the marker out of the browser's column grant" | `wipe_notified_at` not among the columns granted to `authenticated` |

### 4.14 The clearinghouse ships dark — `masleka-dark-launch.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-MSKD-001 | "has the five functions to check" | Exactly the five `masleka-*` directories |
| CTR-MSKD-002 | "masleka-code refuses before it reads or writes anything while the switch is off" | `if (!maslekaEnabled())` precedes every read, write and mail |
| CTR-MSKD-003 | "masleka-create refuses before it reads or writes anything while the switch is off" | Same |
| CTR-MSKD-004 | "masleka-remind refuses before it reads or writes anything while the switch is off" | Same |
| CTR-MSKD-005 | "masleka-reveal refuses before it reads or writes anything while the switch is off" | Same |
| CTR-MSKD-006 | "masleka-submitted refuses before it reads or writes anything while the switch is off" | Same |
| CTR-MSKD-007 | "turns the Edge switch on only for exactly \"true\"" | The literal comparison after `trim()` |
| CTR-MSKD-008 | "lets submit-lead create or reuse a request only behind the same switch" | `await createRequest(` and `await findInvitedRequest(` each called once, inside the guarded block; `rotateMaslekaLink` called once, only under `if (masleka?.reuse)` |
| CTR-MSKD-009 | "is off in a build that does not set VITE_MASLEKA_ENABLED" | `false` |
| CTR-MSKD-010 | "is turned on by nothing in the repository" | No `MASLEKA_ENABLED=true` (comment lines aside) in Vercel, Playwright, Vitest, Supabase config, package.json or workflows |
| CTR-MSKD-011 | "registers the staff pages only when switched on, and the client page always (it then says unavailable)" | Guarded `StaffRoute` block; `/masleka` route; page default `enabled = MASLEKA_ENABLED` |
| CTR-MSKD-012 | "recognises "VITE_MASLEKA_ENABLED": "true" as switch-on: true" | Detected (JSON-quoted key with a string true) |
| CTR-MSKD-013 | "recognises "MASLEKA_ENABLED":true as switch-on: true" | Detected (JSON-quoted key with a bare true) |
| CTR-MSKD-014 | "recognises MASLEKA_ENABLED: true as switch-on: true" | Detected (unquoted YAML) |
| CTR-MSKD-015 | "recognises MASLEKA_ENABLED=true as switch-on: true" | Detected (env style) |
| CTR-MSKD-016 | "recognises VITE_MASLEKA_ENABLED: "true" as switch-on: true" | Detected (YAML with a quoted value) |
| CTR-MSKD-017 | "recognises VITE_MASLEKA_ENABLED = 'true' as switch-on: true" | Detected (spaced, single-quoted) |
| CTR-MSKD-018 | "recognises MASLEKA_ENABLED=false as switch-on: false" | Not detected |
| CTR-MSKD-019 | "recognises MASLEKA_ENABLED="" as switch-on: false" | Not detected |
| CTR-MSKD-020 | "recognises "VITE_MASLEKA_ENABLED": "" as switch-on: false" | Not detected |
| CTR-MSKD-021 | "recognises # MASLEKA_ENABLED=true as switch-on: false" | Not detected |
| CTR-MSKD-022 | "recognises // VITE_MASLEKA_ENABLED=true as switch-on: false" | Not detected |
| CTR-MSKD-023 | "recognises the `=== 'true'` comparison in code as switch-on: false" | Not detected |

### 4.15 The clearinghouse analysis schema — `clearinghouse-analysis-schema.contract.test.ts`

Reads `supabase/migrations/20261021000000_clearinghouse_analysis.sql`. The behaviour is proved by `supabase/tests/clearinghouse_analysis_check.sql` against a local `supabase start`, as in §4.13.

| ID | Title | Expected result |
|---|---|---|
| CTR-CHA-001 | "sorts after the clearinghouse pipeline's migrations" | After `20261019000000_masleka_wipe_notice.sql` |
| CTR-CHA-002 | "turns row-level security on for both tables, and grants anon nothing" | Both enabled; no grant names `anon` |
| CTR-CHA-003 | "scopes both tables to the snapshot's agency" | Two policies, each through `can_see(agency_id)` |
| CTR-CHA-004 | "never lets the browser edit a snapshot, set its retention or say who wrote it" | No update grant; the insert column list leaves out `delete_after`, `created_by`, `created_at`, `id` |
| CTR-CHA-005 | "lets the browser change a decision's status and wording only — the database stamps who and when" | Update grant is exactly `status`, `final_text`; the stamp trigger sets `reviewed_by` |
| CTR-CHA-006 | "purges snapshots past retention nightly, their decisions with them, and only the service role may run it" | The delete, `on delete cascade`, the revoke, `cron.schedule('clearinghouse-purge'` |
| CTR-CHA-007 | "stores the report as an object, capped in size, and no raw file anywhere" | `jsonb_typeof = 'object'`, `< 262144`; no bucket, `bytea` or `xml` |

### 4.16 Claim-document retention — `claim-documents-retention.contract.test.ts`

Reads `supabase/migrations/20261023000000_claim_documents_retention.sql`, the purge function and `config.toml`. The behaviour is proved by `supabase/tests/claim_documents_retention_check.sql` against a local `supabase start`, and by §4.31 of the integration plan.

| ID | Title | Expected result |
|---|---|---|
| CTR-CDR-001 | "lists only the claim-documents bucket, past two months" | `bucket_id = 'claim-documents'`, `interval '2 months'` |
| CTR-CDR-002 | "never deletes in SQL — the files go through the Storage API" | No `delete from storage.`; the function calls `deleteStorageObjects('claim-documents'` |
| CTR-CDR-003 | "lets only the service role list them or start the purge" | Revoked from public, anon, authenticated; every grant to `service_role` |
| CTR-CDR-004 | "runs nightly, and the function checks the cron secret rather than a JWT" | `cron.schedule('claim-documents-purge', '15 3 * * *'`; `verify_jwt = false`; `x-site-cron` on both sides |

### 4.17 Publishing a snapshot to the client — `clearinghouse-publish-schema.contract.test.ts`

Reads `supabase/migrations/20261024000000_clearinghouse_publish.sql`; the behaviour is proved by `supabase/tests/clearinghouse_publish_check.sql` against a local `supabase start`.

| ID | Title | Expected result |
|---|---|---|
| CTR-PUB-001 | "sorts after every migration already applied" | The last file |
| CTR-PUB-002 | "shows the client exactly four fields, and each recommendation exactly six" | `taken_at, published_at, data, items`; `id, title, body, priority, client_status, client_note`; never the address, the publisher or the seen-marks |
| CTR-PUB-003 | "answers only for the signed-in user's verified address, and only published snapshots" | `snapshot_for(my_email())`; `published_at is not null`; answers only on the caller's own |
| CTR-PUB-004 | "lets only the service role call snapshot_for, and nobody anonymous call anything" | As titled |
| CTR-PUB-005 | "lets staff publish only their own agency's snapshots, and never write the items directly" | `can_see(v_agency) or is_admin()` in all three; items: select only |

## 5. Runtime counterpart

[STD-05 §4.2](05-std-api.md) re-checks the same contract against **observed
browser traffic**, and an opt-in block re-checks it against a **live backend**.
The static tests catch drift at review time; the runtime ones catch it at run
time.

## 6. Pass criteria

All 161 declared cases pass (vitest: 890 pass, 1 skipped, of 891 with expansions). A failure means either the frontend or the backend definition
moved — fix the side that is wrong; do not relax the assertion.


### Lead retention — `lead-retention.contract.test.ts`

`supabase/migrations/20261025000000_lead_retention.sql` against what it must agree with. The job itself is exercised end to end in a scratch Postgres by `supabase/tests/lead_retention_check.sql`.

| ID | Title | Expected result |
|---|---|---|
| CTR-RET-001 | "sorts after every migration already applied" | After `20261024000000_clearinghouse_publish.sql` |
| CTR-RET-002 | "allows the same statuses in the database, the Base44 entity and adminLead" | new, contacted, closed, escalated, partial, client — in all three |
| CTR-RET-003 | "lets an admin set every status the type names, client included, and each one exists in the database" | `LeadStatus` ⊆ the check constraint |
| CTR-RET-004 | "keeps the privacy policy's promise: 24 months from the last contact, then deleted or anonymized" | The policy's sentence; `interval '24 months'`; the last contact = latest of created, updated, meeting |
| CTR-RET-005 | "never touches a client, and anonymizes what identifies the person" | `status <> 'client'`; name, phone, email, message, summary, profile, notes cleared |
| CTR-RET-006 | "runs nightly and only as the database itself" | Execute revoked from public, anon, authenticated; `leads-retention` at 03:45 |

### Lead sheet retention — `lead-sheet-retention.contract.test.ts`

`supabase/migrations/20261026000000_lead_sheet_retention.sql` and `supabase/functions/sheet-retention` (Architecture N-02). The rule is exercised in a scratch Postgres by `supabase/tests/lead_sheet_retention_check.sql`; the job by `sheet-retention.integration.test.ts`.

| ID | Title | Expected result |
|---|---|---|
| CTR-SRET-001 | "sorts after the lead retention it follows" | After `20261025000000_lead_retention.sql` |
| CTR-SRET-002 | "counts a lead live only while it exists and is not anonymized, by either id" | `anonymized_at is null`; `base44_id = x` or a guarded `x::uuid`; the anonymization spares a client |
| CTR-SRET-003 | "empties the visitor's details and keeps what the database keeps" | Events: requested time, name, phone, email, summary, the four profile fields — never the date, source, topic, id or completeness; Support: phone and transcript |
| CTR-SRET-004 | "keeps an unlinked Events row 24 months and a Support row 12, as promised" | `EVENTS_MONTHS = 24`, `SUPPORT_MONTHS = 12`; the policy's 24 months |
| CTR-SRET-005 | "lets only the service role ask or start it" | Revoked from public, anon, authenticated; every grant to `service_role` |
| CTR-SRET-006 | "runs nightly after the anonymization, and the function checks the cron secret rather than a JWT" | `lead-sheet-retention` at 04:30, after `leads-retention` at 03:45; `verify_jwt = false`; `x-site-cron` on both sides |

### Production smoke publish preflight

`production-smoke.contract.test.ts` executes the CI preflight and checks that
only the publisher of `PRODUCTION_URL` can enable browser smoke tests. Covers
missing Base44 credentials despite a successful Vercel deploy, trailing slashes,
a configured Base44 origin, Vercel previews, skipped deployments, and successful
production publishes. `deploy-gate.contract.test.ts` verifies the workflow passes
actual deployment outputs into this preflight before starting Playwright.
Missing production publication stays a CI failure with an actionable message;
it does not weaken the home section or accessibility assertions.
