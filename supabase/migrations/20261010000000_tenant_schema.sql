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
