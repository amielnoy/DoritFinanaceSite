# STD-03 — Contract Tests

**Suite:** `contract` · **Runner:** `npm run test:contract` (Vitest, node)
**Location:** `tests/contract/` · **Cases:** 240

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
| CTR-FN-001 | "is invoked from the interview agent" | Called server-side at the end of the scheduling step; the browser wizard that used to call it is deleted |
| CTR-FN-002 | "the client sends exactly the fields the function reads" | Client keys ≡ the function's destructured body fields |
| CTR-FN-003 | "the function's mandatory fields are the same as the Lead entity's" | Guard is on `name` and `phone`, matching `Lead.required` |
| CTR-FN-004 | "returns 400 with an error message when name or phone is missing" | A 400 `Response.json({error})` exists |
| CTR-FN-005 | "surfaces an upstream Google Calendar failure as 502" | `if (!res.ok)` → status 502 |
| CTR-FN-006 | "catches unexpected errors as 500" | `catch (error)` → status 500 |
| CTR-FN-007 | "returns `{ ok, eventId, htmlLink }` on success" | Success literal carries all three keys |
| CTR-FN-008 | "every error response carries an `error` key" | ≥3 error responses, all with `error` |
| CTR-FN-009 | "takes the Google token from the connector, never from a literal" | `connectors.getConnection('googlecalendar')`; no secret literals |
| CTR-FN-010 | "does not echo the access token back to the caller" | No `accessToken` in any `Response.json(...)` |
| CTR-FN-011 | "uses a declared connector that exists in the repo" | `base44/connectors/googlecalendar.jsonc` present |

## 4a. The compliance contract

Two files here test text rather than shape, and do so on purpose. Both cover
artefacts that a regulator, not a compiler, is the reader of.

**`agents.contract.test.ts` — `CTR-AGT-001..102`** — the three agent prompts. For each
agent it asserts the eighteen mandatory clauses of the compliance block (bot
disclosure, licence number `L-00107009`, the marketing-not-advice statement, the
absolute bans on product recommendation and figures, the privacy-law citation
and data-minimisation rule, the complaint and privacy-request routes, the
"never guess — escalate" default, and the fallback phone and email), that
`escalateToHuman` is wired as a tool, that the prompt opens by disclosing it is
automated, and that no agent is granted an entity operation beyond its job.

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

**`logging.contract.test.ts` — `CTR-LOG-001..061`** — what the backend is
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

**`blog-content.contract.test.ts` — `CTR-ART-001..013`** — the repo-held articles under
`content/blog/`. Each must parse, be a real article rather than a stub, carry
the גילוי נאות block with the licence number and the affiliation, contain no
promise of a return, map cleanly onto the `BlogPost` entity, and ship as a
draft: publishing stays a human decision.

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
hermetic only while every `/api` call is stubbed.

**`carriers.contract.test.ts`** — every insurer link resolves to a domain that
exists, and each carrier's name and URL agree.

## 5. Runtime counterpart

[STD-05 §4.2](05-std-api.md) re-checks the same contract against **observed
browser traffic**, and an opt-in block re-checks it against a **live backend**.
The static tests catch drift at review time; the runtime ones catch it at run
time.

## 6. Pass criteria

All 347 cases pass. A failure means either the frontend or the backend definition
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
