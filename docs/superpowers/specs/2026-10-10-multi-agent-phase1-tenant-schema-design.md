# Multi-agent platform, Phase 1: tenant schema

**Parent spec:** [2026-10-10-multi-agent-platform-design.md](2026-10-10-multi-agent-platform-design.md)
— "Phase 1 · Tenant schema: `agencies`, `memberships`, `agency_id` on every
table, backfilled; policies use `can_see()`. Gate: a user of agency B reads
zero rows of agency A, in every table."

**Goal:** give every row a real `agency_id` and make every policy enforce it,
while changing nothing a visitor or Dorit can observe — there is still only
one agency, so the schema is proven correct before it is ever load-bearing.

## Scope decisions (resolved here, not left to the implementer)

**`agents` and `consents` are deferred**, despite being in the parent spec's
full data model. Nothing reads either until Phase 3 (the chat function needs
`consents`; per-licensee rows only matter once an agency has more than one
licensee). Adding them now is schema nobody exercises. Consequence:
`can_see()` takes only `agency_id` in this phase, not the parent spec's
eventual `can_see(agency_id, agent_id)` — the second parameter arrives with
`agents`.

**`profiles.role` is untouched.** The parent spec's role table has two
distinct tiers — "platform admin" and "agency owner" — and `profiles.role`
maps to the first, which is a real, already-working concept (`is_admin()`
gates the entire admin UI today). `memberships.role` is the new, second tier.
No frontend file changes in this phase: `AuthContext`, `FloatingHeader.tsx`
and `Testimonials.tsx` keep checking `user?.role === "admin"` unchanged, and
it keeps meaning exactly what it means today.

**Platform admin keeps seeing every agency's rows in this phase.** The parent
spec's eventual model replaces that with an audited, time-limited support
grant — a real subsystem (a grants table, an audit log, an approval flow)
that does not exist yet and has no reason to exist while there is one agency.
Every agency-scoped policy below is `can_see(agency_id) or is_admin()`, which
reproduces today's behavior exactly (Dorit is both the only admin and the
only agency owner) and changes nothing observable. Tightening this is a later
phase's work, timed to when a second agency's data is actually at stake.

**`agency_id` is resolved statically, not from the request.** Host-based
tenant resolution is Phase 4 (a second real domain to resolve against). Until
then, Dorit's agency has one fixed, known id, used as a column default and
inlined into policy `WITH CHECK` clauses — so every existing write path,
including the Base44 functions that run as `service_role` and never touch
RLS, keeps working with zero code changes, and an insert that names a
*different* `agency_id` is refused rather than trusted.

**`blog_posts.agency_id` is nullable; the other four tables are not.** The
parent spec's data model says so explicitly ("Null = the shared platform
library; set = the agency's own article") and it is the one place isolation
is not simply "only your own agency": a null row is everyone's. Dorit's 18
existing posts are her own authored content, not generic shared material, so
they backfill to her agency id, not to null. Null stays reserved for content
written to be shared later — nothing in this phase creates such a row, but
the schema has to allow it now so a later phase is not another migration
that changes this table's RLS semantics a second time.

**Agency id constant:** `'00000000-0000-0000-0000-000000000001'` — Dorit's
agency, hard-coded in the migration's own seed insert and reused everywhere
else in this phase that needs "the one agency." Named `AGENCY_1_ID` in SQL
comments throughout.

## Schema

```sql
create table public.agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  -- Blocks go-live for a second agency without one; null is fine for agency 1,
  -- signed under a direct relationship that predates this table.
  data_processing_agreement_date date,
  created_at timestamptz not null default now()
);

-- Phase 0's AGENCY_PROFILE constant, promoted to a row. Nothing reads this
-- table yet — Phase 3's chat function is the first consumer — it exists now
-- so `agency_id` has something real to resolve to.
create table public.agency_profiles (
  agency_id               uuid primary key references public.agencies(id) on delete cascade,
  display_name            text not null,
  phone_e164              text not null,
  phone_display           text not null,
  whatsapp                text not null,
  email                   text not null,
  default_whatsapp_message text not null,
  licence_entity          text not null,
  licence_number          text not null,
  licence_regulator       text not null,
  ga4_measurement_id      text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger agency_profiles_touch before update on public.agency_profiles
  for each row execute function public.touch_updated_at();

-- A person can belong to more than one agency (the parent spec's own
-- reasoning), so this is its own table rather than a column on `profiles`.
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  role       text not null check (role in ('owner', 'agent', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, agency_id)
);

-- Every policy below asks this instead of `is_admin()` for agency-scoped
-- tables. `security definer` + `stable`, matching `is_admin()`'s own shape,
-- for the same reason: it must not recurse through `memberships`' own RLS,
-- and Postgres should evaluate it once per statement, not once per row.
create function public.can_see(p_agency_id uuid) returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from public.memberships
     where agency_id = p_agency_id and user_id = auth.uid()
  );
$$;

-- Seed: agency 1 is Dorit, migrated in place. AGENCY_1_ID below must match
-- every default and WITH CHECK clause later in this migration.
insert into public.agencies (id, name, status, data_processing_agreement_date)
values ('00000000-0000-0000-0000-000000000001', 'דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח', 'active', null);

insert into public.agency_profiles (
  agency_id, display_name, phone_e164, phone_display, whatsapp, email,
  default_whatsapp_message, licence_entity, licence_number, licence_regulator, ga4_measurement_id
) values (
  '00000000-0000-0000-0000-000000000001',
  'דורית גוב ארי',
  '+972508311776', '050-831-1776', '972508311776', 'dorit@govari-fin.co.il',
  'שלום דורית, אשמח/ה לשמוע פרטים נוספים על תכנון פיננסי וביטוחי.',
  'דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח', 'L-00107009', 'רשות שוק ההון, ביטוח וחיסכון',
  'G-LLSYPMGV58'
);

-- Dorit's own membership. Her user id is looked up by email rather than
-- hard-coded, because — unlike the agency id this migration invents —
-- her auth.users row already exists in every environment this runs against
-- and migrations must not assume its id matches between them.
insert into public.memberships (user_id, agency_id, role)
select id, '00000000-0000-0000-0000-000000000001', 'owner'
  from auth.users where email = 'dorit@govari-fin.co.il'
on conflict do nothing;
```

### `agency_id` on the five existing tables

```sql
alter table public.leads
  add column agency_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.agencies(id);
alter table public.contacts
  add column agency_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.agencies(id);
alter table public.testimonials
  add column agency_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.agencies(id);
alter table public.meetings
  add column agency_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.agencies(id);

-- Nullable, unlike the four above — see "Scope decisions".
alter table public.blog_posts
  add column agency_id uuid references public.agencies(id)
    default '00000000-0000-0000-0000-000000000001';
update public.blog_posts set agency_id = '00000000-0000-0000-0000-000000000001'
  where agency_id is null;
```

The four `not null default` columns backfill existing rows as part of the
`alter table` itself (Postgres 11+ computes the default once for existing
rows without a table rewrite); `blog_posts` is backfilled explicitly because
its default must stop applying to future inserts that want a genuinely
shared, null row.

### Policies — replace `is_admin()` with `can_see(agency_id) or is_admin()`

```sql
drop policy leads_read_admin on public.leads;
create policy leads_read_admin on public.leads
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
drop policy leads_update_admin on public.leads;
create policy leads_update_admin on public.leads
  for update to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());
drop policy leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads
  for delete to authenticated using (public.can_see(agency_id) or public.is_admin());

-- The one policy whose WITH CHECK changes meaning, not just its admin half:
-- a public insert may no longer name a different agency.
drop policy leads_insert_public on public.leads;
create policy leads_insert_public on public.leads
  for insert to anon, authenticated
  with check (agency_id = '00000000-0000-0000-0000-000000000001');
```

Repeat the same four-policy shape (insert + read/update/delete, four separate
`create policy` statements) for `contacts`. `testimonials`, `blog_posts` and
`meetings` have a different existing structure — one combined `for all`
write policy plus a separate read policy — and keep that structure; only the
`is_admin()` inside each becomes `can_see(agency_id) or is_admin()`:

```sql
drop policy testimonials_write_admin on public.testimonials;
create policy testimonials_write_admin on public.testimonials
  for all to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());
-- meetings_write_admin takes the identical treatment.

drop policy blog_posts_write_admin on public.blog_posts;
create policy blog_posts_write_admin on public.blog_posts
  for all to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());
```

`blog_posts`' read policy is the one exception to "only your own agency":

```sql
drop policy blog_posts_read_published_or_admin on public.blog_posts;
create policy blog_posts_read_published_or_admin on public.blog_posts
  for select to anon, authenticated
  using (
    (published = true and (agency_id is null or agency_id = '00000000-0000-0000-0000-000000000001'))
    or public.can_see(agency_id) or public.is_admin()
  );
```

A null-agency (shared-library) row is a special case worth stating
explicitly rather than leaving implicit: `can_see(null)` is always false —
`agency_id = p_agency_id` can never be true against `null` — so a shared
post's write policy reduces to `is_admin()` alone. No single agency's
membership can claim write access to a row no agency owns; that is the
correct behavior, not a gap, and it falls out of the same expression with no
special-casing.

### The three new tables' own policies

```sql
alter table public.agencies         enable row level security;
alter table public.agency_profiles  enable row level security;
alter table public.memberships      enable row level security;

-- agencies: a member reads their own agency's row; writes are platform-admin
-- only (onboarding a new agency is not yet a self-service action).
create policy agencies_read_member_or_admin on public.agencies
  for select to authenticated using (public.can_see(id) or public.is_admin());
create policy agencies_write_admin on public.agencies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- agency_profiles: same shape. The parent spec's eventual "agency owner may
-- edit their own profile" has no UI yet in this phase, so write stays
-- admin-only rather than speculatively built for nothing to call it.
create policy agency_profiles_read_member_or_admin on public.agency_profiles
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
create policy agency_profiles_write_admin on public.agency_profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- memberships: a user reads their own rows (so a future "my agencies" screen
-- has something to call); writes are platform-admin only, same reasoning —
-- nothing in this phase lets an owner invite staff yet.
create policy memberships_read_self_or_admin on public.memberships
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy memberships_write_admin on public.memberships
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

### Grants

`agencies`, `agency_profiles` and `memberships` get `select, insert, update,
delete` to `authenticated` (same shape as every existing table, policies
decide the rows) and nothing to `anon` — none of the three has a public-facing
reader. No new `service_role` grant: nothing running as `service_role` in
this phase touches any of the three tables. The five pre-existing tables keep
their current grants unchanged; `agency_id` is a new column on tables
`service_role` can already write.

## Testing

`supabase/tests/agency_isolation_check.sql`, a new file in the exact style of
`rls_check.sql`: `\set ON_ERROR_STOP on`, `begin`/`rollback`, `set local role`
and `set local request.jwt.claims` to become each user in turn, every
assertion a `do $$ ... raise exception ... $$`.

Uses only its own synthetic fixtures, never the migration's real Dorit seed
row — same self-containment as `rls_check.sql`'s `boss@example.com`/
`staff@example.com`. Seeds a second agency and three `auth.users`: one with a
membership in agency 1 only, one with a membership in the new agency 2 only,
and a third with `profiles.role = 'admin'` and *no* membership in either
agency (promoted the same way `rls_check.sql` line 21 already does). As the
agency-2 user, asserts `select count(*)` is 0 against `leads`, `contacts`,
`testimonials` and `meetings` filtered to agency 1's rows (seeded directly as
the table owner before the role switch, bypassing RLS, same as
`rls_check.sql` already does), and that `blog_posts` returns only agency 2's
own published post plus any null-agency published post, never agency 1's. A
second block, as the agency-1 user, proves the reverse. A third, as the
admin with no membership row at all, asserts it still reads both agencies'
rows — proving "platform admin keeps seeing everything in this phase" holds
through `is_admin()` alone, independent of `can_see()`.

Stays a manual `supabase start` check, matching `rls_check.sql` and
`account_check.sql` — neither runs in CI today. Wiring any of the three into
CI is a separate, later change, not scope creep onto this phase's gate.

Unit-level: `tests/unit/agencyProfile.test.ts` gains no new case (it tests
the TS constant, which this phase does not change); a new unit test pins
that `AGENCY_PROFILE`'s values match the migration's `agency_profiles` seed
insert literal-for-literal, so the two cannot drift apart silently the way
`contact.js` and `llms.txt` once did (A-34).

## What does not change

No frontend file. No Base44 function. No API contract. `npm run typecheck`,
`npm run lint` and the full `vitest` suite must be green with zero other
diffs — this phase is schema and policies only, verified by SQL tests that
do not run in the existing CI pipeline, which is itself unchanged.
