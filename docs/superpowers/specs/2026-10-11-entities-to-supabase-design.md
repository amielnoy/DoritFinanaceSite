# Entities → Supabase: cutting Base44's remaining reads over

**Date:** 2026-10-11 · **Status:** design, not yet implemented.

**Parent:** [docs/base44-exit/00-inventory.md](../../base44-exit/00-inventory.md) ("Step 3 · entities → Supabase")
and [2026-10-10-multi-agent-platform-design.md](2026-10-10-multi-agent-platform-design.md) (Phase 2, "Off Base44").
This is the fifth piece of that phase. Storage (#134), the mail cutover (#137)
and the auth cutover (#139) are done; hosting moved to Vercel with DNS/SSL
confirmed working today.

## Why now

`Lead`, `Contact`, `Testimonial` and `BlogPost` are already written to Supabase
on every save — `mirrorLeadToSupabase`/`mirrorContactToSupabase` on creation,
and `adminLead`/`contentAdmin` keep them current on admin edits. The frontend
still reads all of this from Base44 anyway, through three adapters named in
`src/services/index.ts`: `Base44ContentService` (public blog/testimonials),
`Base44ContentAdminService` (the admin content list, wrapped by
`FunctionContentAdminService` since the auth cutover), and
`Base44LeadAdminService` (the admin leads list at `/admin/leads`). The data
these reads need already exists and is current in Supabase. This piece cuts
the reads over; it is not a data migration.

## Scope

**In:**
- `src/services/supabase/SupabaseContentService.ts` — new, implements
  `ContentPort`. Public reads: `listArticles`, `getArticle`, `listTestimonials`,
  reading `blog_posts`/`testimonials` directly via their existing anon-readable
  RLS policies.
- `src/services/supabase/SupabaseContentAdminService.ts` — new, implements the
  full `ContentAdminPort` (to match `FunctionContentAdminService`'s constructor
  signature, which takes `reads: ContentAdminPort`, unchanged from the auth
  cutover). Only `listArticles`/`listTestimonials` are ever actually called —
  `FunctionContentAdminService` owns every write, calling the `contentAdmin`
  backend function — so the five write methods on this class throw
  `new Error("writes go through FunctionContentAdminService")` rather than
  doing anything: a guard against ever being called by mistake, not real
  behaviour. This mirrors the existing shape: `Base44ContentAdminService`
  today also implements the full port even though only its reads are used the
  same way.
- `src/services/supabase/SupabaseLeadAdminService.ts` — new, implements
  `LeadAdminPort`. `list()` reads `leads` directly via the signed-in admin's
  own session and the existing `leads_read_admin` RLS policy — no backend
  function needed for reads, same pattern `SupabaseAccountService` already
  uses for `my_enquiries`. `setStatus`/`remove` are **not** reimplemented here;
  they keep going through `adminLead` exactly as today (already a reliable,
  request-failing dual write — see "What's already correct" below).
- `src/services/supabase/SupabaseTableClient.ts` — new, one shared narrow
  interface (`.from(table).select(cols?).eq(col, val)?.order(col, {ascending})?.limit(n)`)
  covering the PostgREST surface all three adapters above need. One file
  because all three need the literal same dependency shape — not a
  speculative abstraction.
- `src/services/index.ts` — `content`, the `reads` argument passed into
  `contentAdmin`'s `FunctionContentAdminService`, and `leadsAdmin` each become
  a conditional: Supabase-backed when `supabase` is configured, Base44-backed
  when it is not (same `? ... : ...` shape `uploadPort` already uses). The
  three Base44 adapters (`Base44ContentService`, `Base44ContentAdminService`,
  `Base44LeadAdminService`) are **not** deleted — they stay as the fallback.
- `base44/functions/contentAdmin/entry.ts` — the `mirror()` helper currently
  logs a warning on failure and returns, so a failed Supabase write is
  invisible to the caller. Change it to let the failure propagate, so the
  whole request fails when the mirror does — the same observable contract
  `adminLead` already has. The write **order stays exactly as it is**
  (Base44 first, then the Supabase mirror): `createArticle`/`createTestimonial`
  depend on Base44 generating the id that gets stamped into Supabase's
  `base44_id` column, so there is no id yet to write Supabase first with. This
  is a narrower fix than first proposed (reordering, matching `adminLead`) —
  that reordering only makes sense for operations on an id that already
  exists, and two different orderings for different operations on the same
  function was worse than one, unchanged order with a real failure signal.

**What's already correct, not touched:**
- `adminLead` (`base44/functions/adminLead/entry.ts`) already writes Supabase
  first and fails the whole request (502) if that write fails, before
  attempting Base44 — exactly the reliability this piece needs from leads.
  Nothing here changes.
- `base44/functions/submitLead`, `submitClaim`, `escalateToHuman`,
  `upsertContact` — the mirror-on-create functions. Not touched; they already
  work and are outside this piece's read-side scope.
- `LeadPort` (`Base44LeadService`, public lead submission) — untouched. That
  is Step 4 ("functions → Vercel") territory, not this piece.
- `Contact` entity — no frontend port currently reads it; out of scope.
- `User`/auth — done, piece 4 (#139).

**Out — explicitly deferred:**
- Deleting the Base44 read adapters. Unlike the auth cutover, this piece keeps
  a live Base44 fallback (see "Why keep Base44 as a fallback here" below) —
  retiring it is a later step, gated on the Phase 2 doc's own two-week
  "Base44 read-only, then switch off" gate.
- `BlogPost`'s Base44 copy staying current specifically for three of Base44's
  own agents (`support_agent`, `blog_recommender`, `procedures_agent`), which
  read it directly and are not migrating in this piece (that is Step 5,
  "agents → direct API", gated on Base44 support's answer to the A-59 report
  per the inventory doc). `contentAdmin`'s Base44 write for blog posts is kept
  specifically so those agents don't start working off stale data the moment
  this piece ships.
- Giving CI's e2e suite real or mocked Supabase credentials. CI never sets
  `VITE_SUPABASE_*`, so `supabase` stays `null` there and every port in this
  piece takes the Base44 fallback — meaning CI's existing e2e suite and its
  Base44 mocking keep working completely unchanged, and the real Supabase
  path is only exercised locally (where `.env.local` now has genuine
  credentials) and in production. Accepted gap, consistent with the same call
  already made in the auth cutover's final review.
- Any change to `tests/contract/agents.contract.test.ts` or the agents
  themselves.

## Why keep Base44 as a fallback here (not a hard cutover like auth)

The auth cutover deliberately removed the Base44 fallback entirely, because
dual-pathing a security-sensitive system was the exact risk being removed.
Content and lead reads are not security-sensitive in that way — they are
data. A misconfigured Supabase client here should mean "read from Base44, as
before," not "degrade to broken." So this piece adds a conditional in the
composition root rather than deleting anything; the Base44 adapters remain
fully live code, not dead weight being carried temporarily.

## Data mapping

Supabase's schema (`supabase/migrations/20260921000000_initial_schema.sql`)
gives each table its own `id` (uuid) plus a `base44_id` (text, unique) and
`created_at` (timestamptz), while `Article`, `Testimonial` and `LeadRecord`
(`src/services/ports.ts`) all declare `id: string` and `created_date: string`.
Every new adapter applies the same two mappings:

- **`base44_id` → `id`** — not Supabase's own uuid. Article URLs (`/blog/:id`),
  the sitemap, and any existing bookmark or indexed link all use the Base44
  id today. Returning Supabase's uuid instead would 404 every one of them.
  Keeping `base44_id` as the port-facing `id` makes the swap invisible outside
  the adapter.
- **`created_at` → `created_date`** — same value, Base44's SDK just named the
  field differently.

No other field renames: `title`/`excerpt`/`body`/`image_url`/`tags`/`published`
(articles), `name`/`role`/`quote`/`image_url`/`rating`/`source` (testimonials),
`name`/`phone`/`email`/`source`/`topic`/`timing`/`message`/`status` (leads)
all match the Supabase columns as-is.

**`getArticle(id)` must filter on the `base44_id` column, not Supabase's own
`id`.** Both columns exist on `blog_posts`, and the `id` this method receives
is always a `base44_id` value (per the mapping above — it's what every caller
in the frontend already holds). Querying `.eq("id", id)` instead of
`.eq("base44_id", id)` would compile, pass a type check, and simply return
nothing for every real article — this is the one place in this piece where
the two id columns could be silently swapped, so the test for this method
must assert the query targets `base44_id` specifically, not just that it
returns the right shape.

`listArticles` (public) filters `published = true` explicitly in the query,
even though the `blog_posts_read_published_or_admin` RLS policy already
enforces it for an anonymous caller — defence in depth, matching the existing
comment in `Base44ContentService` about why that filter lives in the port
rather than being left to RLS alone. `SupabaseContentAdminService.listArticles`
does **not** filter on `published` — the admin's own authenticated session
satisfies `... or public.is_admin()`, so the query naturally returns drafts
too, which is the one thing `ContentAdminPort.listArticles` must do that
`ContentPort.listArticles` must never do.

## Error handling

- **`contentAdmin`'s `mirror()` helper**: stops swallowing failures. The
  write order is unchanged (Base44 first, Supabase second) for the reason
  given above; what changes is that a failed Supabase write now fails the
  whole request instead of being logged and ignored.
- **The three new read adapters**: no new error handling. `ContentPort`,
  `ContentAdminPort` and `LeadAdminPort` do not declare a special error shape
  the way `AuthPort` does (no status-coded `AuthFailure`) — these just
  propagate whatever the Supabase client rejects with, exactly as the Base44
  adapters do today.
- **Composition root fallback**: `supabase ? new Supabase...(...) : new Base44...(...)`,
  the same shape `uploadPort` already has. No new behaviour to design here —
  copying a pattern already proven in this file.

## Testing

- **Unit tests**, one file per new adapter, each pinning the `base44_id`→`id`
  and `created_at`→`created_date` mapping and (for `SupabaseContentService`)
  the `published`-filter behaviour, against a narrow `SupabaseTableClient`
  fake — not the real SDK, same approach as `tests/unit/supabase-upload.test.ts`
  and the account-services tests.
- **`contentAdmin` integration test** (red/green): first show that a Supabase
  mirror failure today does not fail the request (red), then show it does
  after the fix (green) — same shape as the existing
  `tests/integration/mailer.integration.test.ts` tests for a missing-config
  / failing-provider case.
- **Composition-root fallback**: a focused test (or an extension of the
  existing contract test) confirming `content`/`contentAdmin`'s `reads`/
  `leadsAdmin` pick the Supabase adapter when `supabase` is truthy and the
  Base44 one when it is `null`.
- **Contract test**: `tests/contract/frontend-payloads.contract.test.ts`'s
  "only the composition root names a concrete implementation" check must
  still hold with the three new classes added — re-run, not rewritten.
- **e2e**: no new Supabase mocking needed (see "Out," above) — CI's existing
  suite exercises the Base44 fallback path unchanged. The real Supabase path
  is proven locally (`.env.local` has genuine credentials) before merge.
- **Post-merge manual check**: confirm the public blog/testimonials pages and
  the admin leads/content lists actually render from Supabase in production,
  not just that nothing broke — production now has real Supabase credentials
  too (set earlier the same day as this spec).

## Known risk

`SupabaseContentAdminService`'s write methods throwing if ever called is a
guard, not a tested behavioural requirement — if a future change ever routes
a real write through this class instead of `FunctionContentAdminService`, it
will fail loudly rather than silently bypass the backend function's admin
check. Worth a one-line comment at the call site, not a test, since nothing
in the composition root's current wiring can reach it.
