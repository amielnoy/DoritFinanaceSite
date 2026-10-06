# Phase 0 — what Base44 actually holds

Measured 2026-10-05 against the live app (`6a9e6144d2bee5cdfb4ddf74`). Nothing
here was changed; every number below was read, not estimated.

This document exists to answer one question before anybody writes migration
code: **how much of this project is really Base44, and which parts are only
hosted there?** The answer turned out to be smaller than it looks.

---

## 1. The data

| Entity | Rows | Range | Mirrored to Supabase |
|---|---:|---|---|
| `Lead` | 41 | 2026-09-08 → 2026-10-04 | **yes** — `mirrorLeadToSupabase` |
| `Testimonial` | 3 | 2026-09-07 | no |
| `BlogPost` | 2 | 2026-09-07 | no |
| `User` | 1 | 2026-09-07 | no (auth) |
| `Contact` | 0 | — | **yes** — `mirrorContactToSupabase` |

**47 rows in total**, and the only table that grows is already written to
Supabase on every save, along with the meetings (`mirrorMeetingToSupabase`).

This is the single most important number in this document. There is no data
migration problem here. There is a *configuration* migration, which is a
different and much smaller thing.

Of those 41 leads, by the way, **none came from a real visitor** — all are ours,
see A-59. That is a business fact rather than a migration one, but it bears on
how much risk a cutover actually carries: today there is no live intake to
protect.

---

## 2. What the frontend actually calls

Every screen imports `src/services/ports.ts`, never the SDK. Nine ports, each
with one adapter — two for `AuthPort` and `AccountPort`:

| Port | Adapter | Base44 API behind it |
|---|---|---|
| `LeadPort` | `Base44LeadService` | `functions.invoke`, via `invokeFunction` |
| `ContentPort` | `Base44ContentService` | `entities.BlogPost`, `entities.Testimonial` |
| `AgentPort` | `Base44AgentService` | `agents.*` |
| `SupportPort` | `Base44SupportService` | `functions.invoke`, via `invokeFunction` |
| `UploadPort` | `Base44UploadService` | `integrations.Core` |
| `LeadAdminPort` | `Base44LeadAdminService` | `entities.Lead` |
| `ContentAdminPort` | `Base44ContentAdminService` | `entities.*` |
| `AuthPort` | `Base44AuthService` **/ `SupabaseAuthService`** | `auth.*` |
| `AccountPort` | `Base44AccountService` **/ `SupabaseAccountService`** | `functions.invoke` (`myAccount`), via `invokeFunction` / Supabase `rpc("my_enquiries")` |

The last two rows are the proof of concept: **`AuthPort` and `AccountPort` each
have two adapters**, chosen at runtime by `VITE_AUTH_PROVIDER` (`AccountPort`
serves the `/account` personal area and follows the sign-in). The pattern that would carry a
migration is not hypothetical here — it is in use.

`invokeFunction` (`src/services/base44/invoke.ts`) is the one place that knows
the SDK resolves `invoke` to an axios response rather than the body. A
replacement backend that returns the body directly passes through it unchanged.

Raw SDK surface, counted across `src/`:

```
 6  client.entities.BlogPost      2  client.functions.invoke
 4  client.entities.Testimonial   4  client.agents.*
 3  client.entities.Lead         10  client.auth.*  (two adapters)
 1  client.integrations.Core      1  client.functions.fetch
```

About thirty call sites (recounted 2026-10-06: 31, the one change being `auth.*`
9 → 10), all inside nine Base44 files that nothing else imports plus
`SupabaseAuthService`. `AccountPort` adds none: `Base44AccountService` reaches
`myAccount` through `invokeFunction`, which was already counted, and
`SupabaseAccountService` calls the Supabase client, not Base44's.

---

## 3. What the backend actually uses

Eight functions, 3,910 lines (recounted 2026-10-06; `myAccount` is the eighth). The Deno-specific surface is **one API**:

```
33  Deno.env.get      → process.env
```

That is the whole of it. No Deno file system, no Deno KV, no Deno-only imports.

What is genuinely Base44, per function:

| Function | Lines | connectors | Core mail | entities | supabase | mailer |
|---|---:|:-:|:-:|:-:|:-:|:-:|
| `submitLead` | 1692 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `escalateToHuman` | 640 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `submitClaim` | 495 | | ✓ | ✓ | ✓ | ✓ |
| `createConsultationEvent` | 315 | ✓ | | | | |
| `upsertContact` | 302 | ✓ | | ✓ | ✓ | |
| `contentAdmin` | 192 | | | ✓ | ✓ | |
| `logSupportChat` | 190 | ✓ | | | | |
| `myAccount` | 84 | | | | ✓ | |

Three dependencies, in descending order of difficulty:

**`connectors.getConnection`** — 7 call sites, four connectors. This is the only
hard one: Base44 holds the OAuth refresh tokens for Google and Microsoft. See §5.

**`integrations.Core.SendEmail`** — 3 call sites, and `CORE_EMAILS` is
`["amielnoy@gmail.com"]`. One address. Everything else already goes through
`dorit-mailer` on Cloudflare with Resend. **Mail is effectively already
migrated**; this is a leftover, not a dependency.

**`entities.*`** — 13 call sites across 5 entities, all CRUD, all already
mirrored or trivially small (§1).

The functions have no shared module — Base44 gives them none, which is why
helpers are hand-duplicated and `tests/contract/agents.contract.test.ts` exists
to keep the copies identical. That has been a standing cost. In a migration it
becomes an asset: **there is nothing to untangle.** Each file is already
self-contained and could move one at a time.

---

## 4. The agents

| Agent | Model | Tools | Anonymous |
|---|---|---|---|
| `needs_interview` | automatic | `submitLead`, `escalateToHuman` | true |
| `support_agent` | automatic | `logSupportChat`, `escalateToHuman`, BlogPost read | true |
| `blog_recommender` | automatic | `escalateToHuman`, BlogPost read | true |
| `procedures_agent` | automatic | `logSupportChat`, `escalateToHuman`, BlogPost read | true |

This is where the pain is, and it is worth being precise about why rather than
saying "the agents are hard".

The prompts are ours — 17,844 characters for the interview alone, versioned in
this repo and pinned by contract tests. Those move unchanged.

What does not move is everything around them: conversation storage, the
streaming transport, and tool execution. **Tool execution is the one that has
already cost us** (A-59): Base44 does not run an agent's tools in an anonymous
conversation, there is no log of the refusal, and we cannot see into it. We work
around it today by having the page submit the closing payload itself.

That workaround is also a partial dress rehearsal. It has already moved the most
important side effect out of the agent runtime.

---

## 5. The connectors — the real lock-in

| Connector | Scopes | Used by |
|---|---|---|
| `outlook` | `Calendars.ReadWrite`, `User.Read`, `offline_access` | `submitLead`, `createConsultationEvent` |
| `googlecalendar` | `calendar.events`, `email` | `submitLead`, `createConsultationEvent` |
| `googledocs` | `documents`, `email` | `submitLead` |
| `googlesheets` | `spreadsheets`, `email` | `submitLead`, `upsertContact`, `escalateToHuman`, `logSupportChat` |

Base44 performs the OAuth dance and stores the refresh tokens. Replacing this
means registering our own OAuth apps with Google and Microsoft, storing refresh
tokens ourselves, and handling expiry — the one piece of genuinely new
infrastructure a migration needs.

Two things make it smaller than it sounds. The Google three could be a **service
account** with domain delegation, which removes refresh-token handling
altogether. And the `outlook` connector is authorised as `amielnoy@outlook.com`
rather than Dorit (A-54), so that account has to be revisited either way.

---

## 6. Auth

```jsonc
{ "enableUsernamePassword": true, "enableGoogleLogin": true,
  "enableMicrosoftLogin": true, "enableFacebookLogin": true,
  "enableAppleLogin": true, "enableSSOLogin": false }
```

Five providers enabled; **one user exists**. The admin screens are role-gated on
`role: admin`, which is a Base44 user field.

`SupabaseAuthService` already implements `AuthPort`. The work here is a login
for Dorit and a role claim, not a user migration.

---

## 7. Hosting

Production is `safe-arch-plan.base44.app`, published by CI's *Publish to Base44*
step. Vercel already builds the same tree and is **deliberately disabled** in
`vercel.json` (`git.deploymentEnabled.main: false`) so that only the tested
pipeline can promote.

Base44 hosting has one defect we cannot configure around: `index.html` is served
with **no `Cache-Control`, no `ETag` and no `Last-Modified`**, while hashed
assets carry `max-age=604800`. `public/_headers` is ignored and `config.jsonc`
has no header setting. That is A-57, and it cost a day.

`vercel.json` already sends `no-cache` on documents and `immutable` on assets.
**Moving hosting fixes A-57 as a side effect**, which is why it is the cheapest
thing on the list with the highest immediate return.

---

## 8. What Base44 has actually cost us

Not an argument for leaving — a list of what a migration would and would not
buy. Every item is in `tests/test-plan/10-known-issues.md`.

| | Fixed by leaving? |
|---|---|
| **A-59** agent tools not executed for anonymous visitors; no log of the refusal | **yes** |
| **A-57** `index.html` served with no cache validators, not configurable | **yes** (hosting) |
| **A-50/51/52** the Builder re-creating `.jsx` auth pages over our `.tsx` | **yes** |
| **A-42** `agents push` is a second release step CI cannot perform | **yes** |
| **new** deployed source matches `main` while the runtime serves an older build | **yes** |
| A-53 agent calls log to `preview`, which a publish wipes | yes, incidentally |
| A-54 the `outlook` connector is authorised as the wrong account | no — ours |
| A-56 the post-save work ran in a queue | no — ours, already fixed |

The pattern is worth naming: **most of these are invisibility rather than
breakage.** The platform does something unexpected and offers no way to see it,
so each one costs a day of inference from absent logs rather than an hour of
reading an error. That is the cost being weighed, more than any single outage.

---

## 9. What this means for the plan

- **Data is not the obstacle.** 47 rows, the growing table already mirrored.
- **The frontend is already abstracted.** Nine ports, two of them dual-adapter (`AuthPort`, `AccountPort`).
- **The functions are nearly portable.** `Deno.env.get` is the whole runtime
  surface; mail is already external; the files are already independent.
- **Two things are genuinely hard:** connector OAuth (§5) and the agent runtime
  (§4) — and the agent workaround has already moved its riskiest part out.
- **Hosting is nearly free and pays immediately** (§7).

Suggested order, each step shippable and reversible on its own:

| Step | Buys | Effort | Reversal |
|---|---|---|---|
| 1 · hosting → Vercel | fixes A-57 | ~1 day | DNS, minutes |
| 2 · auth → Supabase | adapter exists | ~3 days | one env var |
| 3 · entities → Supabase | ends the lock-in | ~1 week | mirror runs both ways |
| 4 · functions → Vercel | removes the stale-runtime class | ~2 weeks | per function |
| 5 · agents → direct API | fixes A-59, gives us logs | ~1 month | per agent |
| 6 · connectors → own OAuth | last tie | ~1 week | keep both briefly |

**Steps 1 and 3 carry most of the value for a tenth of the effort.** Step 5 is
the expensive one and the only one that addresses what actually hurt; it is
worth doing, and worth doing last.

Nothing above should start before the Base44 support report on A-59 has been
sent and answered. If they fix tool execution for anonymous conversations, step
5 — the month — may not be needed at all.
