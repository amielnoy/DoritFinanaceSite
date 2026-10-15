-- Lead retention (20261025000000_lead_retention.sql), checked end to end.
--
-- SCRATCH DATABASE ONLY. It creates its own minimal `leads`, `meetings` and
-- `contacts` and refuses to run where a `leads` table already exists. Run it
-- in a throwaway Postgres, from the repository root:
--
--   docker run -d --rm --name pg-scratch -e POSTGRES_PASSWORD=t -p 54399:5432 postgres:16-alpine
--   sed -n '/^-- 1\. The status/,/^-- 4\. Nightly/p' supabase/migrations/20261025000000_lead_retention.sql \
--     | sed '$d' > /tmp/retention-core.sql
--   PGPASSWORD=t psql -h localhost -p 54399 -U postgres -f supabase/tests/lead_retention_check.sql
--   docker stop pg-scratch
--
-- Expected: 1 anonymized on the first run, 0 on the second; "Old Lead" is
-- 'נמחק' with no phone, email or message and its meeting's timing and notes
-- cleared; the client, the recent lead and the two touched within the period
-- are whole; contacts 0502222222 and 0503333333 remain; anon and
-- authenticated cannot execute the function.
\set ON_ERROR_STOP on
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'leads') then
    raise exception 'lead_retention_check.sql runs in a scratch database only';
  end if;
end $$;
create role anon; create role authenticated;
create table public.leads (
  id uuid primary key default gen_random_uuid(), base44_id text unique,
  name text not null, phone text not null, email text, source text, topic text, timing text, message text,
  status text not null default 'new' check (status in ('new','contacted','closed','escalated','partial')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  summary text, profile jsonb, notes text, campaign text, meeting_topic text);
create table public.meetings (id uuid primary key default gen_random_uuid(), lead_id uuid unique references public.leads(id) on delete cascade, scheduled_at timestamptz, topic text, timing text, notes text);
create table public.contacts (id uuid primary key default gen_random_uuid(), phone text not null unique, name text, last_seen timestamptz, created_at timestamptz not null default now());
\i /tmp/retention-core.sql
-- The fixture. "now" is 2029-01-01; 24 months before is 2027-01-01.
insert into leads (id, name, phone, email, topic, message, status, created_at, updated_at) values
 ('00000000-0000-0000-0000-000000000001','Old Lead','0501111111','a@x.com','פנסיה','hello','contacted','2026-09-01','2026-09-05'),
 ('00000000-0000-0000-0000-000000000002','Old Client','0502222222','b@x.com','ביטוח','hi','client','2026-09-01','2026-09-05'),
 ('00000000-0000-0000-0000-000000000003','Recent','0503333333','c@x.com','מס','hey','new','2028-06-01','2028-06-01'),
 ('00000000-0000-0000-0000-000000000004','Old, met late','0504444444','d@x.com','פנסיה','m','contacted','2026-09-01','2026-09-01'),
 ('00000000-0000-0000-0000-000000000005','Old, touched late','0505555555',null,'פנסיה','t','closed','2026-09-01','2027-03-01');
insert into meetings (lead_id, scheduled_at, timing, notes) values
 ('00000000-0000-0000-0000-000000000001','2026-09-10','חמישי 10:00','note'),
 ('00000000-0000-0000-0000-000000000004','2027-06-01','יוני','n');
insert into contacts (phone, name, last_seen) values
 ('0501111111','Old Lead','2026-09-05'),      -- old, no client: goes
 ('0502222222','Old Client','2026-09-05'),    -- old, but a client shares the phone: stays
 ('0503333333','Recent','2028-06-01');        -- recent: stays
select public.anonymize_stale_leads('2029-01-01') as anonymized_first_run;
select public.anonymize_stale_leads('2029-01-01') as anonymized_second_run;
select name, phone, coalesce(email,'∅') email, coalesce(message,'∅') message, topic, status, anonymized_at is not null as anonymized from leads order by id;
select l.name as lead, coalesce(m.timing,'∅') timing, coalesce(m.notes,'∅') notes, m.scheduled_at::date from meetings m join leads l on l.id = m.lead_id order by l.id;
select phone from contacts order by phone;
select has_function_privilege('anon', 'public.anonymize_stale_leads(timestamptz)', 'execute') as anon_can_run,
       has_function_privilege('authenticated', 'public.anonymize_stale_leads(timestamptz)', 'execute') as authenticated_can_run;
