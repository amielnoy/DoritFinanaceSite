-- The sheet's retention rule (20261026000000_lead_sheet_retention.sql), checked.
--
-- SCRATCH DATABASE ONLY. It creates its own minimal `leads` and refuses to run
-- where one already exists. From the repository root:
--
--   docker run -d --rm --name pg-scratch -e POSTGRES_PASSWORD=t -p 54399:5432 postgres:16-alpine
--   sed -n '/^create or replace function public.lead_sheet_live/,/^-- Nightly at 04:30/p' \
--     supabase/migrations/20261026000000_lead_sheet_retention.sql | sed '$d' > /tmp/sheet-retention-core.sql
--   PGPASSWORD=t psql -h localhost -p 54399 -U postgres -f supabase/tests/lead_sheet_retention_check.sql
--   docker stop pg-scratch
--
-- Expected: of the ids asked, only the live Supabase lead and the live Base44
-- lead are answered — not the anonymized ones, a deleted lead, a malformed id
-- or an empty one; and neither anon nor authenticated may execute either function.
\set ON_ERROR_STOP on
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'leads') then
    raise exception 'lead_sheet_retention_check.sql runs in a scratch database only';
  end if;
end $$;
create role anon; create role authenticated; create role service_role;
create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  base44_id     text unique,
  anonymized_at timestamptz
);
\i /tmp/sheet-retention-core.sql

insert into public.leads (id, base44_id, anonymized_at) values
  ('11111111-1111-1111-1111-111111111111', null, null),
  ('22222222-2222-2222-2222-222222222222', null, now()),
  ('33333333-3333-3333-3333-333333333333', '68a0f1c2d3e4f5a6b7c8d9e0', null),
  ('44444444-4444-4444-4444-444444444444', '68a0f1c2d3e4f5a6b7c8d9e1', now());

do $$
declare
  got text[];
begin
  select array_agg(x order by x) into got from public.lead_sheet_live(array[
    '11111111-1111-1111-1111-111111111111',  -- live
    '22222222-2222-2222-2222-222222222222',  -- anonymized
    '68a0f1c2d3e4f5a6b7c8d9e0',              -- live, by its Base44 id
    '68a0f1c2d3e4f5a6b7c8d9e1',              -- anonymized, by its Base44 id
    '55555555-5555-5555-5555-555555555555',  -- deleted
    'not-a-uuid',
    ''
  ]) as x;
  if got is distinct from array['11111111-1111-1111-1111-111111111111', '68a0f1c2d3e4f5a6b7c8d9e0'] then
    raise exception 'lead_sheet_live answered %', got;
  end if;
  if has_function_privilege('anon', 'public.lead_sheet_live(text[])', 'execute')
     or has_function_privilege('authenticated', 'public.lead_sheet_live(text[])', 'execute')
     or has_function_privilege('anon', 'public.lead_sheet_call_retention()', 'execute')
     or has_function_privilege('authenticated', 'public.lead_sheet_call_retention()', 'execute') then
    raise exception 'anon or authenticated may execute a sheet-retention function';
  end if;
  if not has_function_privilege('service_role', 'public.lead_sheet_live(text[])', 'execute') then
    raise exception 'service_role may not execute lead_sheet_live';
  end if;
  raise notice 'lead_sheet_retention_check: PASS';
end $$;
