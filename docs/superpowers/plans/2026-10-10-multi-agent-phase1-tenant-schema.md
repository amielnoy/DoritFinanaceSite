# Multi-agent Platform Phase 1: Tenant Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give every row in the five existing content tables a real `agency_id`, introduce `agencies`/`agency_profiles`/`memberships`, and replace `is_admin()` with `can_see(agency_id) or is_admin()` in every agency-scoped RLS policy — with zero observable change, since there is still only one agency.

**Architecture:** one Supabase migration (schema + backfill + policy rewrites + grants, in that order, matching how every existing migration in this repo is a single coherent file) plus a new pgTAP-style isolation test that proves a member of one agency reads zero rows of another, plus a unit-test drift guard pinning the migration's seed literals against `src/config/agencyProfile.ts`.

**Tech Stack:** PostgreSQL / Supabase migrations (`supabase/migrations/*.sql`), the Supabase CLI (`supabase start`, `supabase db reset`) for local verification, `psql` for running the SQL test files, Vitest for the TS drift-guard test.

**Spec:** [docs/superpowers/specs/2026-10-10-multi-agent-phase1-tenant-schema-design.md](../specs/2026-10-10-multi-agent-phase1-tenant-schema-design.md) (parent: [2026-10-10-multi-agent-platform-design.md](../specs/2026-10-10-multi-agent-platform-design.md))

## Global Constraints

- The fixed agency id is the literal `'00000000-0000-0000-0000-000000000001'` — used in the migration's column defaults, every `WITH CHECK`/`USING` clause that needs "the one agency," and the seed inserts. Never generated with `gen_random_uuid()`.
- `agents` and `consents` tables are **not** created in this phase — deferred to Phase 3. `can_see()` takes only `agency_id`, never `agent_id`.
- `profiles.role` and `is_admin()` are **not** modified. No frontend file (`AuthContext`, `FloatingHeader.tsx`, `Testimonials.tsx`) changes in this plan.
- Every agency-scoped policy's admin-equivalent condition is `public.can_see(agency_id) or public.is_admin()` — platform admin keeps seeing every agency's rows this phase; this is a deliberate, spec-documented choice, not an oversight to fix.
- `leads.agency_id`, `contacts.agency_id`, `testimonials.agency_id`, `meetings.agency_id` are `not null default '00000000-0000-0000-0000-000000000001' references public.agencies(id)`. `blog_posts.agency_id` is **nullable**, same default, explicitly backfilled rather than left to the column default.
- `leads` and `contacts` keep their existing four-separate-policy structure (insert/read/update/delete). `testimonials`, `blog_posts` and `meetings` keep their existing structure of one combined `for all` write policy plus a separate read policy. No task may restructure these shapes.
- `supabase/tests/agency_isolation_check.sql` is a new file in the exact style of `supabase/tests/rls_check.sql`: `\set ON_ERROR_STOP on`, `begin`/`rollback`, `set local role`, `set local request.jwt.claims`, `do $$ ... raise exception ... $$` assertions. It is **not** wired into any CI workflow — matches `rls_check.sql` and `account_check.sql`, neither of which runs in CI today.
- No Base44 function, no frontend file, no API contract changes anywhere in this plan. `npm run typecheck`, `npm run lint` and the full `npx vitest run` must stay green with zero diffs outside the files this plan names.

## Review Focus

- **A crafted insert naming a different `agency_id` must be refused, not silently overridden.** `leads`/`contacts`' insert policy's `WITH CHECK` must reject `agency_id <> '00000000-0000-0000-0000-000000000001'` explicitly, not merely rely on the column default for a caller who omits the field.
- **An update cannot reassign a row to an agency the caller does not belong to.** `WITH CHECK` on every update/`for all` policy validates the *new* row, so a non-member attempting to move a row into their own agency must fail — this needs an explicit adversarial test, not just a happy-path "I can update my own agency's row" test.
- **A null-agency `blog_posts` row (shared library) is readable by any published-post visitor but writable by nobody except `is_admin()`.** `can_see(null)` is always false (`agency_id = p_agency_id` can never be true against `null`), so this must be proven with a real test, not assumed from the SQL's shape.
- **The migration must not change any existing, already-tested behavior.** `supabase/tests/rls_check.sql` and `supabase/tests/account_check.sql` must still pass unmodified after this migration applies — this is the project's only existing automated evidence that the pre-Phase-1 RLS surface still works, and the spec's explicit promise is "changes nothing a visitor or Dorit can observe."
- **The `agency_profiles` seed literal and `AGENCY_PROFILE` the TS constant must never drift apart.** Phase 0's whole point was one source of truth; a seed migration that silently hand-copies different values than `src/config/agencyProfile.ts` recreates exactly the kind of drift Phase 0 eliminated (see A-34 in `tests/test-plan/10-known-issues.md` for what that drift cost before).

---

### Task 1: The migration — schema, backfill, policies, grants

**Files:**
- Create: `supabase/migrations/20261010000000_tenant_schema.sql`
- Modify: `tests/unit/agencyProfile.test.ts` (add one new `describe` block)

**Interfaces:**
- Consumes: `src/config/agencyProfile.ts`'s `AGENCY_PROFILE` (existing, from Phase 0) — `phoneE164`, `phoneDisplay`, `whatsapp`, `email`, `defaultWhatsappMessage`, `licenceEntity`, `licenceNumber`, `licenceRegulator`, `ga4MeasurementId`.
- Produces: the `agencies`, `agency_profiles`, `memberships` tables; the `public.can_see(p_agency_id uuid) returns boolean` function; `agency_id uuid` columns on `leads`, `contacts`, `testimonials`, `meetings` (not null, default `'00000000-0000-0000-0000-000000000001'`) and `blog_posts` (nullable, same default, explicitly backfilled). Task 2 and Task 3 depend on all of this existing and being seeded.

This task is one SQL file, written whole (matching how `supabase/migrations/20260922100000_meetings.sql` and every other migration in this repo is one coherent file, not built in slices) — but it is developed test-first against the TS drift guard below, and verified against the two existing SQL test files before being considered done.

- [ ] **Step 1: Write the failing drift-guard test**

Open `tests/unit/agencyProfile.test.ts` and read it in full first — it already has a `describe("agencyProfile — one source, no drift", ...)` block with four `it`s (`CONTACT matches the profile`, `LICENCE matches the profile`, `GA4_MEASUREMENT_ID matches the profile`, `index.html's static tag still matches the profile`). Add a fifth test inside that same `describe` block:

```ts
  it("the tenant-schema migration's seed row matches the profile", () => {
    // The migration backfills `agency_profiles` for agency 1 with its own
    // copy of these values (Postgres cannot import a TS module). This is
    // the only thing stopping that copy from silently drifting — see A-34
    // in tests/test-plan/10-known-issues.md for what unchecked drift cost
    // before Phase 0.
    const migration = read(
      join(REPO_ROOT, "supabase/migrations/20261010000000_tenant_schema.sql"),
    );
    const insert = migration.match(
      /insert into public\.agency_profiles[\s\S]*?values\s*\(([\s\S]*?)\);/,
    );
    expect(insert, "no agency_profiles seed insert found in the migration").not.toBeNull();
    const values = [...insert![1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    // Positional, matching the insert's own column list:
    // agency_id, display_name, phone_e164, phone_display, whatsapp, email,
    // default_whatsapp_message, licence_entity, licence_number, licence_regulator, ga4_measurement_id
    const [, , phoneE164, phoneDisplay, whatsapp, email, defaultWhatsappMessage, licenceEntity, licenceNumber, licenceRegulator, ga4MeasurementId] = values;
    expect({
      phoneE164, phoneDisplay, whatsapp, email, defaultWhatsappMessage,
      licenceEntity, licenceNumber, licenceRegulator, ga4MeasurementId,
    }).toEqual({
      phoneE164: AGENCY_PROFILE.phoneE164,
      phoneDisplay: AGENCY_PROFILE.phoneDisplay,
      whatsapp: AGENCY_PROFILE.whatsapp,
      email: AGENCY_PROFILE.email,
      defaultWhatsappMessage: AGENCY_PROFILE.defaultWhatsappMessage,
      licenceEntity: AGENCY_PROFILE.licenceEntity,
      licenceNumber: AGENCY_PROFILE.licenceNumber,
      licenceRegulator: AGENCY_PROFILE.licenceRegulator,
      ga4MeasurementId: AGENCY_PROFILE.ga4MeasurementId,
    });
  });
```

The file already imports `read`, `REPO_ROOT`, `join` and `AGENCY_PROFILE` — do not re-import them.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/agencyProfile.test.ts`
Expected: FAIL — `insert, "no agency_profiles seed insert found in the migration"` is null, because the migration file does not exist yet.

- [ ] **Step 3: Write the migration file**

Create `supabase/migrations/20261010000000_tenant_schema.sql` with exactly this content (copied from the spec, which already contains the full, reviewed SQL):

```sql
-- Phase 1 of the multi-agent platform design: every row gets a real
-- agency_id, and every policy enforces it. There is still only one agency
-- (Dorit), so this is proven correct before it is ever load-bearing — see
-- docs/superpowers/specs/2026-10-10-multi-agent-phase1-tenant-schema-design.md.
--
-- AGENCY_1_ID = '00000000-0000-0000-0000-000000000001' throughout. Host-based
-- tenant resolution (Phase 4) does not exist yet, so this is a fixed literal,
-- not resolved from the request — every existing write path, including the
-- Base44 functions that run as service_role and never touch RLS, keeps
-- working unchanged.

-- ── new tables ──────────────────────────────────────────────────────────────

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
-- so agency_id has something real to resolve to.
create table public.agency_profiles (
  agency_id                uuid primary key references public.agencies(id) on delete cascade,
  display_name             text not null,
  phone_e164               text not null,
  phone_display            text not null,
  whatsapp                 text not null,
  email                    text not null,
  default_whatsapp_message text not null,
  licence_entity           text not null,
  licence_number           text not null,
  licence_regulator        text not null,
  ga4_measurement_id       text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger agency_profiles_touch before update on public.agency_profiles
  for each row execute function public.touch_updated_at();

-- A person can belong to more than one agency, so this is its own table
-- rather than a column on profiles.
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  role       text not null check (role in ('owner', 'agent', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, agency_id)
);

-- Every policy below asks this instead of is_admin() for agency-scoped
-- tables. security definer + stable, matching is_admin()'s own shape, for
-- the same reason: it must not recurse through memberships' own RLS, and
-- Postgres should evaluate it once per statement, not once per row.
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

-- ── seed: agency 1 is Dorit ─────────────────────────────────────────────────

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
-- hard-coded, because — unlike the agency id this migration invents — her
-- auth.users row already exists in every environment this runs against and
-- migrations must not assume its id matches between them.
insert into public.memberships (user_id, agency_id, role)
select id, '00000000-0000-0000-0000-000000000001', 'owner'
  from auth.users where email = 'dorit@govari-fin.co.il'
on conflict do nothing;

-- ── agency_id on the five existing tables ───────────────────────────────────

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

-- Nullable, unlike the four above: null = the shared platform library,
-- set = the agency's own article. Dorit's existing posts are her own
-- authored content, not generic shared material, so they backfill to her
-- agency id explicitly, below, rather than being left null by the default.
alter table public.blog_posts
  add column agency_id uuid references public.agencies(id)
    default '00000000-0000-0000-0000-000000000001';
update public.blog_posts set agency_id = '00000000-0000-0000-0000-000000000001'
  where agency_id is null;

-- ── policies: leads, contacts (four separate policies each) ────────────────

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
drop policy leads_insert_public on public.leads;
create policy leads_insert_public on public.leads
  for insert to anon, authenticated
  with check (agency_id = '00000000-0000-0000-0000-000000000001');

drop policy contacts_read_admin on public.contacts;
create policy contacts_read_admin on public.contacts
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
drop policy contacts_update_admin on public.contacts;
create policy contacts_update_admin on public.contacts
  for update to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());
drop policy contacts_delete_admin on public.contacts;
create policy contacts_delete_admin on public.contacts
  for delete to authenticated using (public.can_see(agency_id) or public.is_admin());
drop policy contacts_insert_public on public.contacts;
create policy contacts_insert_public on public.contacts
  for insert to anon, authenticated
  with check (agency_id = '00000000-0000-0000-0000-000000000001');

-- ── policies: testimonials, meetings (combined write + separate read) ──────

drop policy testimonials_write_admin on public.testimonials;
create policy testimonials_write_admin on public.testimonials
  for all to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());

-- testimonials_read_public (`using (true)`, no is_admin() call) falls
-- outside the "replace is_admin()" sweep above and must be handled on its
-- own: dropping it without a replacement would make testimonials invisible
-- to anon entirely (breaking the live reviews widget); leaving it in place
-- would leak every agency's testimonials to everyone. Scoped exactly like
-- blog_posts' published rows: the one fixed agency (testimonials have no
-- shared-library/nullable concept per the parent spec's data model), plus
-- any member, plus admin.
drop policy testimonials_read_public on public.testimonials;
create policy testimonials_read_member_or_fixed_agency on public.testimonials
  for select to anon, authenticated
  using (agency_id = '00000000-0000-0000-0000-000000000001' or public.can_see(agency_id) or public.is_admin());

drop policy meetings_read_admin on public.meetings;
create policy meetings_read_admin on public.meetings
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
drop policy meetings_write_admin on public.meetings;
create policy meetings_write_admin on public.meetings
  for all to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());

-- ── policies: blog_posts (combined write + the one non-"own agency only" read) ──

drop policy blog_posts_write_admin on public.blog_posts;
create policy blog_posts_write_admin on public.blog_posts
  for all to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());

-- can_see(null) is always false (agency_id = p_agency_id can never be true
-- against null), so a shared (null-agency) post's write policy above
-- reduces to is_admin() alone — no single agency can claim a row no agency
-- owns. That falls out of the expression with no special-casing.

drop policy blog_posts_read_published_or_admin on public.blog_posts;
create policy blog_posts_read_published_or_admin on public.blog_posts
  for select to anon, authenticated
  using (
    (published = true and (agency_id is null or agency_id = '00000000-0000-0000-0000-000000000001'))
    or public.can_see(agency_id) or public.is_admin()
  );

-- ── RLS + policies + grants for the three new tables ────────────────────────

alter table public.agencies         enable row level security;
alter table public.agency_profiles  enable row level security;
alter table public.memberships      enable row level security;

create policy agencies_read_member_or_admin on public.agencies
  for select to authenticated using (public.can_see(id) or public.is_admin());
create policy agencies_write_admin on public.agencies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The parent spec's eventual "agency owner may edit their own profile" has
-- no UI yet in this phase, so write stays admin-only rather than
-- speculatively built for nothing to call it.
create policy agency_profiles_read_member_or_admin on public.agency_profiles
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
create policy agency_profiles_write_admin on public.agency_profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A user reads their own membership rows (so a future "my agencies" screen
-- has something to call); writes are platform-admin only — nothing in this
-- phase lets an owner invite staff yet.
create policy memberships_read_self_or_admin on public.memberships
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy memberships_write_admin on public.memberships
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Same shape as every existing table: policies decide the rows, grants only
-- decide whether the Data API will discuss the table at all. Nothing to
-- anon — none of the three has a public-facing reader. No service_role
-- grant: nothing running as service_role in this phase touches any of the
-- three tables.
grant select, insert, update, delete on public.agencies        to authenticated;
grant select, insert, update, delete on public.agency_profiles to authenticated;
grant select, insert, update, delete on public.memberships     to authenticated;
```

- [ ] **Step 4: Run the drift-guard test to verify it passes**

Run: `npx vitest run tests/unit/agencyProfile.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Apply the migration locally and verify the two existing RLS test files still pass unmodified**

Run (in order):

```bash
supabase start
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls_check.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/account_check.sql
```

`postgresql://postgres:postgres@127.0.0.1:54322/postgres` is the Supabase CLI's standard local connection string. If `supabase start` prints a different `DB URL`, use that instead. `supabase db reset` re-runs every migration from scratch, including this new one, against a clean local database.

Expected: both `psql` runs complete with no `ERROR:` output (each file ends with `rollback;`, so nothing persists and nothing needs cleaning up afterward). If either fails, the failure names the exact `raise exception` message — fix the migration, `supabase db reset` again, and re-run both files before continuing. Do not proceed to Step 6 until both are clean.

- [ ] **Step 6: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three pass, with no diff outside `supabase/migrations/20261010000000_tenant_schema.sql` and `tests/unit/agencyProfile.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261010000000_tenant_schema.sql tests/unit/agencyProfile.test.ts
git commit -m "Multi-agent Phase 1: tenant schema — agencies, agency_profiles, memberships, agency_id backfilled"
```

---

### Task 2: The isolation gate

**Files:**
- Create: `supabase/tests/agency_isolation_check.sql`

**Interfaces:**
- Consumes: the schema and policies from Task 1 — `agencies`, `memberships`, `can_see()`, and `agency_id` on `leads`/`contacts`/`testimonials`/`meetings`/`blog_posts`. Requires the Task 1 migration already applied to the local database (`supabase db reset` run after Task 1's migration file exists).
- Produces: nothing other tasks depend on — this is the terminal proof for this plan's stated gate ("a user of agency B reads zero rows of agency A, in every table").

This file never runs inside `npx vitest run` — it is a standalone SQL script, run directly with `psql` against a local `supabase start` instance, in the same manual-verification style as `supabase/tests/rls_check.sql`. There is no automated "red" state to observe the way a Vitest test has one; instead, write the whole file, then run it, and treat any `raise exception` as the failure to fix — exactly the loop `rls_check.sql` itself was built with.

- [ ] **Step 1: Write `supabase/tests/agency_isolation_check.sql`**

```sql
-- Phase 1's own gate: a member of one agency reads zero rows of another, in
-- every agency-scoped table. Run against a local `supabase start`, same as
-- rls_check.sql and account_check.sql. Every block raises on a wrong answer,
-- so a clean run is the assertion.
--
-- Uses only its own synthetic fixtures, never the migration's real Dorit
-- seed row — same self-containment as rls_check.sql's boss@example.com /
-- staff@example.com.
\set ON_ERROR_STOP on
begin;

-- Agency 1 already exists (seeded by the tenant-schema migration). Agency 2
-- is this test's own fixture.
insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- Three people: a member of agency 1 only, a member of agency 2 only, and a
-- platform admin with no membership row in either agency.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000001','authenticated','authenticated','agency1-member@example.com'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000002','authenticated','authenticated','agency2-member@example.com'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000003','authenticated','authenticated','platform-admin@example.com');

insert into public.memberships (user_id, agency_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');

update public.profiles set role = 'admin' where id = 'bbbbbbbb-0000-0000-0000-000000000003';

-- Seed as the table owner, bypassing RLS, so the reads below have something
-- to find in both agencies.
insert into public.leads (base44_id, name, phone, agency_id) values
  ('ISO-A1-LEAD', 'לקוח א׳', '050-000-1001', '00000000-0000-0000-0000-000000000001'),
  ('ISO-A2-LEAD', 'לקוח ב׳', '050-000-1002', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into public.contacts (phone, name, agency_id) values
  ('050-000-2001', 'איש קשר א׳', '00000000-0000-0000-0000-000000000001'),
  ('050-000-2002', 'איש קשר ב׳', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into public.testimonials (name, quote, agency_id) values
  ('לקוחה א׳', 'מצוין', '00000000-0000-0000-0000-000000000001'),
  ('לקוחה ב׳', 'מעולה', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into public.meetings (lead_base44_id, scheduled_at, agency_id) values
  ('ISO-A1-LEAD', now() + interval '1 day', '00000000-0000-0000-0000-000000000001'),
  ('ISO-A2-LEAD', now() + interval '2 days', 'aaaaaaaa-0000-0000-0000-000000000002');
-- A published post for each agency, plus one null-agency (shared-library)
-- published post and one null-agency draft.
insert into public.blog_posts (title, body, published, agency_id) values
  ('מאמר א׳', 'תוכן', true, '00000000-0000-0000-0000-000000000001'),
  ('מאמר ב׳', 'תוכן', true, 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('מאמר משותף', 'תוכן', true, null),
  ('טיוטה משותפת', 'תוכן', false, null);

-- ── as a member of agency 2 only ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads where agency_id = '00000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'agency 2 member read an agency 1 lead';
  end if;
  if (select count(*) from public.contacts where agency_id = '00000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'agency 2 member read an agency 1 contact';
  end if;
  if (select count(*) from public.meetings where agency_id = '00000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'agency 2 member read an agency 1 meeting';
  end if;
  -- Testimonials and agency 1's own published posts are public-exception
  -- content — there is one live public site right now (no Phase 4 host
  -- routing yet), and rls_check.sql/account_check.sql already require `anon`
  -- to read both; a policy that blocked them for an authenticated member of
  -- a *different* agency while still allowing a fully anonymous visitor
  -- would be incoherent, not stricter. True per-agency isolation for this
  -- content starts to mean something once a second agency has its own live
  -- site. Agency 2's own (unpublished-to-the-world) content stays invisible.
  if (select count(*) from public.testimonials where agency_id = '00000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'agency 2 member cannot read agency 1''s public testimonial';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר א׳') <> 1 then
    raise exception 'agency 2 member cannot read agency 1''s own published blog post';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר ב׳') <> 1 then
    raise exception 'agency 2 member cannot read their own blog post';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר משותף') <> 1 then
    raise exception 'agency 2 member cannot read the shared published post';
  end if;
  if (select count(*) from public.blog_posts where title = 'טיוטה משותפת') <> 0 then
    raise exception 'agency 2 member read an unpublished shared draft';
  end if;
end $$;

-- The public insert policy accepts only the one fixed agency id right now —
-- a caller naming any other agency, even one they are a member of, is
-- refused. There is no live public form for agency 2 yet (Phase 4's work);
-- the check is on the value, not on who is asking.
do $$ begin
  begin
    insert into public.leads (name, phone, agency_id)
      values ('רמאי', '050-000-9999', 'aaaaaaaa-0000-0000-0000-000000000002');
    raise exception 'a lead was inserted naming an agency other than the fixed one';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Cannot reassign a row they can see into someone else's agency.
do $$ begin
  begin
    update public.leads set agency_id = '00000000-0000-0000-0000-000000000001'
      where base44_id = 'ISO-A2-LEAD';
    raise exception 'agency 2 member reassigned a lead into agency 1';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Cannot write a shared (null-agency) post — can_see(null) is always false.
do $$ begin
  begin
    update public.blog_posts set title = 'נגנב' where title = 'מאמר משותף';
    if (select count(*) from public.blog_posts where title = 'נגנב') > 0 then
      raise exception 'agency 2 member wrote to a shared blog post';
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── as a member of agency 1 only — the reverse ──────────────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 lead';
  end if;
  if (select count(*) from public.contacts where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 contact';
  end if;
  if (select count(*) from public.testimonials where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 testimonial';
  end if;
  if (select count(*) from public.meetings where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 meeting';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר ב׳') <> 0 then
    raise exception 'agency 1 member read agency 2''s own blog post';
  end if;
end $$;

-- ── as the platform admin, with no membership row in either agency ─────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads) <> 2 then
    raise exception 'platform admin cannot read both agencies'' leads';
  end if;
  if (select count(*) from public.blog_posts) <> 4 then
    raise exception 'platform admin cannot read every blog post, published or not';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it against the Task 1 migration**

Run (same connection string Task 1 used):

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/agency_isolation_check.sql
```

Expected: completes with no `ERROR:` output. If any block raises, the message names exactly which table/direction failed — fix the policy in `supabase/migrations/20261010000000_tenant_schema.sql` (do not create a second migration to patch the first; this migration has not shipped yet), `supabase db reset`, and re-run this file plus `rls_check.sql` and `account_check.sql` from Task 1 Step 5 before continuing.

- [ ] **Step 3: Re-run the full verification suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: unchanged from Task 1 Step 6 — still green, since this task touched no TS file.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/agency_isolation_check.sql
git commit -m "Multi-agent Phase 1: agency isolation SQL test"
```

---

### Task 3: Final verification and documentation pass

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-multi-agent-platform-design.md` (one line, in its Migration table)

**Interfaces:**
- Consumes: everything from Task 1 and Task 2.
- Produces: nothing — this is the plan's closing task.

- [ ] **Step 1: Re-run every local SQL check one more time, from a clean reset, in sequence**

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/rls_check.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/account_check.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/agency_isolation_check.sql
```

Expected: all three clean, no `ERROR:` output. This is the plan's actual gate — confirm it one final time with both this plan's tasks committed, not mid-edit.

- [ ] **Step 2: Run the full project verification suite one final time**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 3: Mark Phase 1 done in the parent spec**

In `docs/superpowers/specs/2026-10-10-multi-agent-platform-design.md`, find the Migration table row:

```
| Phase 1 · Tenant schema | `agencies`, `memberships`, `agency_id` on every table, backfilled; policies use `can_see()` | A user of agency B reads zero rows of agency A, in every table |
```

Change it to:

```
| Phase 1 · Tenant schema — **done**, see [2026-10-10-multi-agent-phase1-tenant-schema-design.md](2026-10-10-multi-agent-phase1-tenant-schema-design.md) | `agencies`, `memberships`, `agency_id` on every table, backfilled; policies use `can_see()` | A user of agency B reads zero rows of agency A, in every table |
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-10-multi-agent-platform-design.md
git commit -m "Multi-agent Phase 1: mark tenant schema done in the parent spec"
```
