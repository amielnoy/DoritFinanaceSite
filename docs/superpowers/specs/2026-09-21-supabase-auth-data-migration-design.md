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
3. **Unverified:** whether a Base44 function can build an `asServiceRole` client
   without a user request context. Connectors and email depend on it after the
   migration. Cheap to check, reshapes the function work if false.
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
