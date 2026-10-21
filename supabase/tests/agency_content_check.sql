-- The public read side (20261106100000_agency_content_read_side.sql), against
-- a local `supabase start`, in the style of onboarding_check.sql: every block
-- raises on a wrong answer, so a clean run is the assertion. Synthetic data;
-- rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/agency_content_check.sql
\set ON_ERROR_STOP on
begin;

-- F: a live agency · G: a draft · agency 1 is Dorit's (seeded)
-- c0 the account that confirmed F's and G's consent
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-0000000000c0','authenticated','authenticated','ac-confirmer@example.com', now());

insert into public.agencies (id, name, status) values
  ('ffffffff-0000-0000-0000-00000000000f', 'סוכנות חיה', 'active'),
  ('ffffffff-0000-0000-0000-0000000000a9', 'סוכנות טיוטה', 'draft');
insert into public.agency_profiles (agency_id, display_name, domain) values
  ('ffffffff-0000-0000-0000-00000000000f', 'סוכנות חיה', 'f.example'),
  ('ffffffff-0000-0000-0000-0000000000a9', 'סוכנות טיוטה', 'g.example');
insert into public.agents (id, agency_id, full_name) values
  ('99999999-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-00000000000f', 'סוכנת חיה'),
  ('99999999-0000-0000-0000-0000000000a9', 'ffffffff-0000-0000-0000-0000000000a9', 'סוכנת טיוטה');
-- As the table owner, so the stamp is what is written here.
insert into public.testimonials (name, quote, agency_id, agent_id, consent_confirmed_at, consent_confirmed_by) values
  ('ac-agency1', 'תודה', '00000000-0000-0000-0000-000000000001', null, null, null),
  ('ac-f', 'מעולה', 'ffffffff-0000-0000-0000-00000000000f', '99999999-0000-0000-0000-0000000000f1',
   now(), 'eeeeeeee-0000-0000-0000-0000000000c0'),
  ('ac-g', 'מצוין', 'ffffffff-0000-0000-0000-0000000000a9', '99999999-0000-0000-0000-0000000000a9',
   now(), 'eeeeeeee-0000-0000-0000-0000000000c0');

-- ── the grants (review M-2) ──────────────────────────────────────────────
do $$ begin
  if has_table_privilege('anon', 'public.testimonials', 'select') then
    raise exception 'anon still reads testimonials whole';
  end if;
  if has_table_privilege('authenticated', 'public.testimonials', 'select') then
    raise exception 'authenticated still reads testimonials whole';
  end if;
  if has_column_privilege('anon', 'public.testimonials', 'consent_confirmed_by', 'select') then
    raise exception 'anon reads who confirmed the consent';
  end if;
  if has_column_privilege('authenticated', 'public.testimonials', 'consent_confirmed_by', 'select') then
    raise exception 'authenticated reads who confirmed the consent';
  end if;
  if has_column_privilege('anon', 'public.testimonials', 'consent_confirmed_at', 'select') then
    raise exception 'anon reads when the consent was confirmed';
  end if;
  if not has_column_privilege('authenticated', 'public.testimonials', 'consent_confirmed_at', 'select') then
    raise exception 'authenticated cannot read when the consent was confirmed';
  end if;
  if has_table_privilege('anon', 'public.agency_profiles', 'select') then
    raise exception 'anon reads agency_profiles';
  end if;
end $$;

-- ── what a visitor reads ─────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  seen text[];
begin
  -- The site's own column list (TESTIMONIAL_COLUMNS). Agency 1's rows only:
  -- an outside agency's, live and consented or not, waits for Rollout 5.
  select array_agg(name order by name) into seen
    from (select id, base44_id, name, role, quote, image_url, rating, source, created_at
            from public.testimonials where name like 'ac-%') t;
  if seen is distinct from array['ac-agency1'] then
    raise exception 'a visitor reads the wrong testimonials: %', seen;
  end if;
  begin
    perform consent_confirmed_by from public.testimonials;
    raise exception 'anon read consent_confirmed_by';
  exception when insufficient_privilege then null;
  end;
  begin
    perform consent_confirmed_at from public.testimonials;
    raise exception 'anon read consent_confirmed_at';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.testimonials;
    raise exception 'anon read testimonials with *';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.testimonials where name like 'ac-%') <> 1 then
    raise exception 'anon cannot count testimonials';
  end if;

  select array_agg(agency_id::text order by agency_id) into seen from public.public_agency_sites
   where agency_id in ('00000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-00000000000f',
                       'ffffffff-0000-0000-0000-0000000000a9');
  if seen is distinct from array['00000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-00000000000f'] then
    raise exception 'a visitor reads the wrong agency sites: %', seen;
  end if;
  if (select domain from public.public_agency_sites where agency_id = 'ffffffff-0000-0000-0000-00000000000f') <> 'f.example' then
    raise exception 'a live agency''s site is not found by its domain';
  end if;
  if exists (select 1 from public.public_agency_sites where domain = 'g.example') then
    raise exception 'a draft agency''s site is public';
  end if;
  begin
    perform 1 from public.agency_profiles limit 1;
    raise exception 'anon reads the agency_profiles table';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── what a signed-in member reads ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000c0","role":"authenticated"}';
do $$ begin
  -- Naming the column checks the grant; agency 1's row is one the member sees.
  if not exists (select consent_confirmed_at from public.testimonials where name = 'ac-agency1') then
    raise exception 'a member cannot read when the consent was confirmed';
  end if;
  begin
    perform consent_confirmed_by from public.testimonials;
    raise exception 'a member read consent_confirmed_by';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.testimonials where name = 'ac-f') then
    raise exception 'another live agency''s testimonial is public';
  end if;
  if exists (select 1 from public.testimonials where name = 'ac-g') then
    raise exception 'a draft agency''s testimonial is public';
  end if;
end $$;
reset role;

-- ── the view's shape, the success-case columns ───────────────────────────
do $$
declare
  cols text[];
begin
  select array_agg(column_name::text order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'public_agency_sites';
  if cols is distinct from array['agency_id', 'domain', 'display_name', 'phone_e164', 'phone_display', 'whatsapp',
                                 'email', 'default_whatsapp_message', 'service_area'] then
    raise exception 'public_agency_sites shows the wrong columns: %', cols;
  end if;

  insert into public.success_cases (agency_id, title, body, tag)
  values ('ffffffff-0000-0000-0000-00000000000f', 'חיסכון', 'גוף', repeat('א', 60));
  if (select metric_is_estimate from public.success_cases where agency_id = 'ffffffff-0000-0000-0000-00000000000f') then
    raise exception 'a success case''s metric is an estimate by default';
  end if;
  begin
    insert into public.success_cases (agency_id, title, body, tag)
    values ('ffffffff-0000-0000-0000-00000000000f', 'x', 'y', repeat('א', 61));
    raise exception 'a 61-character tag was accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
