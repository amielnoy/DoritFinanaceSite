# STD-03 — Contract Tests

**Suite:** `contract` · **Runner:** `npm run test:contract` (Vitest, node)
**Location:** `tests/contract/` · **Cases:** 439

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
  keys and string-literal values.

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
| CTR-TST-001 | "sends only declared fields and both required ones" | `Testimonial.create` conforms |
| CTR-TST-002 | "keeps the rating inside the declared 1..5 range" | 5 valid; 6 and 0 rejected |
| CTR-TST-003 | "only accepts the declared review sources" | `google \| midrag`; `yelp` rejected |
| CTR-EML-001 | "every send supplies to, subject and body" | Exactly those three keys on every `SendEmail` |
| CTR-EML-002 | "never hardcodes a recipient inline" | No literal `to:` string — recipients come from named constants |

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

**`ai-surface.contract.test.ts` — `CTR-AI-001..014`** — what an AI assistant can
read. The app is client-rendered, so a crawler that does not execute JavaScript
receives the home page's `<head>` on every route; `public/llms.txt` is therefore
the only surface such a crawler reads in full, and the one nothing was checking.
It had drifted to a phone number and an email that do not reach her — a static
file in `public/` is invisible to the type-checker and to every other suite. The
block derives the expected contact details from `src/config/contact.js`, fails
on any other address or number in the file, and pins the disclosures an
assistant would summarise: the licence number, the affiliation, that the
automated helpers collect rather than advise, and that nothing promises a
return. It also pins that `llms.txt` links every route the sitemap advertises —
the two drift in opposite directions, because a new page reaches the sitemap
when an SEO test asks for it and is forgotten here because nothing does — and
that `robots.txt` names each AI crawler explicitly rather than leaving them to
the wildcard.

**`blog-content.contract.test.ts` — `CTR-ART-001..019`** — the repo-held articles under
`content/blog/`. Each must parse, be a real article rather than a stub, carry
the גילוי נאות block with the licence number and the affiliation, contain no
promise of a return, map cleanly onto the `BlogPost` entity, and ship as a
draft: publishing stays a human decision.

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

## 5. Runtime counterpart

[STD-05 §4.2](05-std-api.md) re-checks the same contract against **observed
browser traffic**, and an opt-in block re-checks it against a **live backend**.
The static tests catch drift at review time; the runtime ones catch it at run
time.

## 6. Pass criteria

All 542 cases pass. A failure means either the frontend or the backend definition
moved — fix the side that is wrong; do not relax the assertion.

### Production smoke publish preflight

`production-smoke.contract.test.ts` executes the CI preflight and checks that
only the publisher of `PRODUCTION_URL` can enable browser smoke tests. Covers
missing Base44 credentials despite a successful Vercel deploy, trailing slashes,
a configured Base44 origin, Vercel previews, skipped deployments, and successful
production publishes. `deploy-gate.contract.test.ts` verifies the workflow passes
actual deployment outputs into this preflight before starting Playwright.
Missing production publication stays a CI failure with an actionable message;
it does not weaken the home section or accessibility assertions.
