# Moving auth and data off Base44 onto Supabase

**Date:** 2026-09-21 · **Status:** phases 0-1 applied and verified on hjowdyiwjjrqceumkvgt (Frankfurt). Phase 2 next.

## Why

The thread began as "restrict logins to our domain". Base44 can do that at
configuration scale — including `auth sso --provider custom`, which lets us own
the identity provider outright while Base44 stays a relying party. That option
was considered and declined. The decision is to own identity and data directly.

## Scope

**In:** authentication, and the five entities with their twelve RLS rules.

**Out:** function hosting, the three connectors (Google Calendar, Google Sheets,
Outlook), the email integration, and the three AI agents. These stay on Base44
and are re-pointed at the new data layer.

The seam is not clean: the seven functions are the main consumer of both halves,
so all 2,544 lines of them are touched even though they do not move.

## Decisions

| Decision | Choice |
|---|---|
| Target | Supabase — Postgres + RLS + Auth |
| Approach | **A** — adapters behind existing ports; functions keep orchestrating |
| Cutover | Dual-write, verify, flip reads, retire Base44 writes |
| Accounts | Google SSO only; email/password dropped |
| Draft visibility | **Closed** — `published = true OR is_admin()` |

Approach A was chosen over moving CRUD into the browser because `submitLead`
already owns "the enquiry is stored *and* the humans are told", including its
partial-failure paths. Splitting that apart while also swapping the database
underneath it would redesign failure semantics for customer enquiries in the
same change.

## What makes this tractable

`src/services/index.ts` is an explicit composition root whose own comment reads:
"Swapping Base44 for another backend, or a fake in a test, means changing this
file and nothing else." Eight ports already exist. The frontend half is adapter
work; dual-write is a decorator registered in one file.

## Data model

Five tables plus `profiles` (replacing `User`). Enums become CHECK constraints —
cheaper to alter, and `escalation_reason` has ten values that will grow.

Every table carries `base44_id text unique`: the correlation key that makes
reconciliation and backfill possible, and therefore makes the flip safe.

`created_at` is idiomatic in the database; the **adapter maps it to
`created_date`**, so the port contract and all existing call sites are untouched.

`contacts.phone` is UNIQUE — the entity comment says one record per person, keyed
by phone, and `upsertContact` depends on it.

## Authorization

`profiles.role` holds the role; policies call one `security definer stable`
helper, `is_admin()`. Definer rights avoid recursive RLS on `profiles`.

Critically, **no update policy grants a user rights over their own row**. Only
admins may write `profiles`, or role becomes self-service.

## Identity into the functions

The browser sends its Supabase access token in a custom header
(`X-Supabase-Auth`, not `Authorization`, to avoid colliding with Base44's own
handling). The function builds a user-scoped client with it; PostgREST verifies
the signature against the project secret, so forwarding is safe and a forged
token is rejected at Supabase. `asServiceRole` becomes a second client built
from the service role key held in Base44 function secrets.

Anonymous submissions are unchanged: no JWT, anon key, and the INSERT policy
permits it — which is what `create: true` meant.

## Cutover

One config value, `PRIMARY = base44 | supabase`. Writes go to primary first (a
failure fails the request) then the shadow (a failure is logged). Reads always
come from primary. Flipping it swaps the roles; rollback is the same switch.

**Side effects fire exactly once**, after both persists — never inside the
per-store path. Two databases is invisible to a customer; two notification
emails and a double-booked calendar are not.

| Phase | State | Rollback |
|---|---|---|
| 0 | Schema + RLS live, no traffic | drop |
| 1 | Backfill history, populating `base44_id` — **done**, 29 rows | re-run |
| 2 | Dual-write on; Base44 primary | switch off |
| 3 | Reconcile until the diff is clean | stay in 2 |
| 4 | Flip: Supabase primary | flip back |
| 5 | Retire Base44 writes | point of no return |

**Failure semantics invert at phase 4.** Through phase 3 a Supabase write failure
is harmless. From phase 4 it is an enquiry nobody can see, and must fail loudly.

## Dual-write lives in two places

`leads` and `contacts` are written by the **functions** (`submitLead:869`).
`blog_posts` and `testimonials` are written by the **browser** via the admin
adapters. The frontend half is a decorator; the function half is ordinary code.

## Testing

The ports design means the **same contract suite runs against both adapters** —
"Supabase behaves like Base44" becomes an assertion rather than a hope. Per
AGENTS.md the relevant STD under `tests/test-plan/` is updated alongside.

Reconciliation is itself tested: seed divergence, assert the diff catches it.

## Cleanup this forces

- `AuthContext.jsx` and `AuthContext.tsx` both exist; the `.jsx` still calls
  `base44.auth` directly. Resolved to one `.tsx` before any adapter swap.
- `OAuthConsent.jsx` (239 lines) is dead — no `base44/mcp/`, no config, routed
  nowhere. Deleted.
- `Register`, `ForgotPassword`, `ResetPassword` deleted with email/password.

## Open items — must be resolved before phase 4

1. ~~**Region.**~~ **Resolved 2026-09-21.** Rebuilt as `hjowdyiwjjrqceumkvgt`
   in Central EU (Frankfurt); the Mumbai project is gone. Cross-border transfer
   of Israeli personal data is no longer in question, and latency improves.
   Created with "automatically expose new tables" off, so the migration carries
   explicit Data API grants.

   **Tier is still open.** Free projects pause on inactivity and have no PITR,
   against a 24-month retention commitment. Fine through phases 0-2; must not be
   what holds live enquiries at cutover.
2. **`Testimonial.rls.read` is `null`**, not `true`. Public reads clearly work,
   but the semantics are unverified. Phase 0 implements public read to match
   observed behaviour; verify before trusting it.
3. ~~**Unverified:** `asServiceRole` without a user request context.~~
   **Resolved 2026-09-22 — it works.** `createClientFromRequest` reads the
   service token from its own header, `Base44-Service-Authorization`, injected
   by the platform; the user token in `Authorization` is separate and optional.
   So connectors, Sheets and email are unaffected by moving identity to
   Supabase. It also confirms the JWT must travel in a custom header:
   `Authorization` is already consumed by Base44's client construction.
4. **Domain restriction** needs an enforcement point. Google's `hd` is a hint,
   not a control. A trigger on `auth.users` works on any tier; Supabase auth
   hooks are plan-gated. Not in phase 0 — the domain policy is undecided.
5. **Admin bootstrap is manual** — one SQL statement, because nobody can grant
   admin until an admin exists.
6. After the flip, `id` changes format. Internal uses are fine; the **Google
   Sheets export** writes lead data externally and may be keyed on it downstream.

## Phase 1 notes (2026-09-22)

Production was smaller than assumed: 25 leads, 0 contacts, 2 posts, 2
testimonials. No `is_sample` rows, and every `source`/`status` value already
satisfied the CHECK constraints.

Base44 attaches `created_by_id` and `is_sample` to every row. Neither is
carried: the first names a user that will not exist after the migration, the
second marks demo data.

`consent_version` is empty on all 25 leads, though the entity documents it as
the evidentiary half of the duty to inform under תיקון 13 and `compliance.ts`
defines `CONSENT_VERSION`. Nothing writes it. Pre-existing, not caused by the
migration, and worth fixing on its own.

The export contains customer personal data. It is never committed; the
generator takes its path as an argument and writes SQL to stdout.

## Phase 2 notes (2026-09-22) — a blocker found by wiring it up

The mechanism is built and proven: the dual-write decorator (7 unit tests), the
Supabase adapter and its id translation (4 integration tests against real
Postgres), and correlation on create so no row created during the migration
lands uncorrelated.

It is not installed, for a reason that only appeared once it was:

**The browser cannot write to Supabase.** Its client is anonymous, because
identity still belongs to Base44, while `blog_posts` and `testimonials` require
`is_admin()`. Anonymous writes are refused with 42501 — confirmed against a
database, not inferred. `anon` holds `select` and nothing else.

Installing it regardless would look like success and copy nothing: Base44 takes
the write, the visitor is told it worked, a warning lands where nobody reads it,
and Supabase stays empty. That is the failure worth avoiding, so the composition
root still constructs the Base44 adapter directly and says why.

Two ways out, neither chosen:

1. **Route content writes through a backend function.** It already holds
   service-role credentials, and the service key stays off the browser. Fits the
   approach: the functions orchestrate, the adapters forward. Costs a new
   function for writes that currently go straight from the browser to the SDK.
2. **Move auth first.** With a Supabase session the browser is `authenticated`
   and `is_admin()` resolves, so the decorator works as designed. This reorders
   the plan — auth was to follow data — and it is the smaller change, because
   nothing new has to be built.

The lead and contact halves of phase 2 are unaffected: those are written by
functions, which hold the service key already.

Also of note: the phase 4 flip has no wiring, and setting
`VITE_DATA_PRIMARY=supabase` now throws rather than degrading. Base44 would have
to act as the shadow, and there is no reverse of `base44_id` pointing back at a
Supabase row. Flipping is a deliberate act and can afford to be refused with a
reason; falling back quietly would leave someone believing they had cut over.

## Reordered 2026-09-22: auth before the rest of the data

Phase 2 could not proceed as planned. The browser's Supabase client is
anonymous, and content writes need `is_admin()`, so the shadow was refused with
42501. Of the two ways out — a backend function holding the service key, or
moving auth first so the browser carries a session — auth first was chosen. It
builds nothing new: with a real session the decorator works exactly as written.

Lead and contact dual-write is unaffected either way; functions own those writes
and already hold service credentials. The backend-function route follows auth.

### A prerequisite that turned out to be a live defect

The plan listed "resolve the duplicate AuthContext" as tidying. It was not.

`AuthContext.jsx` and `AuthContext.tsx` both existed, and Vite's default
`resolve.extensions` places `.jsx` before `.tsx`. The `.jsx` therefore shadowed
the `.tsx` at every import — so the port-based auth context introduced by
`0e943ca` had never executed. Production was still calling `base44.auth`
directly, and the auth port was inert.

Proven, not inferred: before deletion the bundle carried the `.jsx` strings and
none of the `.tsx` ones; after, the reverse.

The `.jsx` exposed three values the `.tsx` does not — `appPublicSettings`,
`isLoadingPublicSettings`, `checkAppState`. None is read anywhere, and a comment
in `App.jsx` already said so. Every `useAuth()` destructuring in the codebase is
satisfied by the `.tsx` interface.

Worth watching: this replaces the auth context that has actually been running
with one that never has. The two are close but not identical, and the swap is
better exercised now, before auth changes underneath it as well.

### Still needed from the operator before Supabase auth can work

Supabase's Google provider needs a Google Cloud OAuth client — id, secret, and
the Supabase callback URL registered as an authorised redirect. That is console
work I cannot do, and nothing in the auth migration functions without it.

## Auth proven end to end (2026-09-22)

Signed in on localhost with Google against the live project. Every link in the
chain checked against the database rather than the dashboard:

- `/auth/v1/settings` reports google enabled
- `auth.identities.provider` = google for amielnoy@gmail.com
- the trigger created the `profiles` row unprompted, `role = user`
- `is_admin()` returned false before promotion and true after
- reading `public.leads` as that identity, with `role authenticated` and the
  real `sub` in the JWT claims, returns all 25 migrated leads
- the same read as `anon` is refused outright — no SELECT grant

The bootstrap promotion has been run once, by hand, as designed: nobody can
grant admin until an admin exists.

**This is what the content dual-write was missing.** The shadow writes were
refused with 42501 because the browser held an anonymous client; it now holds a
Google-backed session that `is_admin()` recognises, so the decorator can be
installed.

Still open: Supabase's email provider remains enabled, so `/auth/v1/signup`
accepts password sign-ups the UI no longer offers. And domain restriction has no
enforcement point — the Google consent screen must be External, because the
Cloud project has no Workspace organisation behind it.

## Phase 2, the function half (2026-09-22)

`submitLead` and `upsertContact` now mirror into Supabase. Both sit after the
branches converge, so the shadow write happens once per request and only after
the authoritative write succeeded — the same discipline the side effects already
followed, and for the same reason.

Neither throws. Base44 is authoritative in this phase, so a failed mirror is two
stores disagreeing, not an enquiry lost.

Leads upsert on `base44_id`; contacts on `phone`. The difference is deliberate:
phone is the key the Contact entity is built around — one record per person, not
per enquiry — and it is what the function already searched by. Conflicting on
the other column would create a second person with the same number, which is
precisely what that entity exists to prevent.

Verified against the live database before deploying anything: 201 then 200, one
row, fields merged, for both tables.

That check found what would otherwise have shipped silently. `service_role` had
no grants at all — the first migration named only anon and authenticated, and
with "automatically expose new tables" off nothing is implicit. Bypassing RLS is
not the same as holding privileges, and the mirror never throws, so every lead
would have gone to Base44, logged `lead.mirror_failed` where nobody was
watching, and Supabase would have stayed empty while the migration looked done.

Credentials live in Base44's secret store as SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY. Absent, the mirror is a no-op and the function
behaves exactly as it did before — which is what a deploy that has not been
switched on yet should look like.

**Not deployed.** The functions still run their previous version in production.

## Phase 3 — reconciliation (2026-09-22)

`scripts/reconcile-stores.mjs` compares a Base44 export against Supabase and
exits non-zero on drift, so it gates the flip rather than describing it.

Three disagreements, which do not mean the same thing. **missing** is a mirror
that failed — the visitor is fine, the copy is incomplete, and re-running the
backfill repairs it. **orphaned** is a Supabase row with no counterpart, which
before the flip should be impossible and means something wrote directly.
**mismatched** is both stores holding a row and disagreeing about a field: an
update that reached one of them.

The comparison is pure and unit-tested, because the cases worth testing are
awkward to manufacture against live stores — and because the failure that
matters is not missing drift but inventing it. Base44 writes `""` where the
mirror writes NULL; a gate that cries drift over that gets switched off within a
day, and a muted gate is no gate. Phones are matched on digits, ratings by
value (PostgREST returns them as strings), booleans by truth.

First run against production: **25/25 leads, 2/2 posts, 2/2 testimonials, 0/0
contacts, zero drift.**

Then the check that mattered more — a status was changed in Supabase directly,
and reconciliation named that exact lead and field and exited 1; reverting
returned it to clean. A gate that has only ever passed is not evidence of
anything.

Phase 3 is now a standing check rather than a finished step: run it over the
coming days, and a clean run is what justifies phase 4.
