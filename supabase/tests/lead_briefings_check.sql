-- The AI briefing's cache (20261112000000_lead_briefings.sql), in the style of
-- staff_leads_check.sql: every block raises on a wrong answer. Rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/lead_briefings_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 an Admin of agency 1 · 2 a User of agency 1 (assigned b1 only)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000001','authenticated','authenticated','br-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000002','authenticated','authenticated','br-user@example.com', now());
insert into public.memberships (user_id, agency_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'user');
insert into public.leads (id, agency_id, name, phone, source, status, assigned_user_id) values
  ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'רחל', '0541234567', 'interview', 'new', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'דנה', '0547654321', 'interview', 'new', null);

-- ── the function's insert (service role); two generations of b1, one of b2 ─
insert into public.lead_briefings (lead_id, agency_id, summary, concern, questions, talking_points, model, input_tokens, cached_tokens, output_tokens, created_at)
values
  ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', array['א','ב','ג'], 'פנסיה', array['?'], array['פנסיה'], 'claude-haiku-5-5', 1000, 0, 200, now() - interval '1 minute'),
  ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', array['א'], 'פנסיה', array['?','?','?'], array['פנסיה','בריאות'], 'claude-haiku-5-5', 500, 100, 50, now()),
  ('b0000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', array['א'], 'ביטוח', array['?'], array['בריאות'], 'claude-haiku-5-5', 10, 0, 10, now());

-- ── shape: no fourth summary line, no empty concern, no sixth talking point ─
do $$ begin
  begin
    insert into public.lead_briefings (lead_id, agency_id, summary, concern, questions, talking_points, model)
    values ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', array['1','2','3','4'], 'x', array['?'], array['x'], 'm');
    raise exception 'a four-line summary was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.lead_briefings (lead_id, agency_id, summary, concern, questions, talking_points, model)
    values ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', array['1'], '', array['?'], array['x'], 'm');
    raise exception 'an empty concern was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.lead_briefings (lead_id, agency_id, summary, concern, questions, talking_points, model)
    values ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', array['1'], 'x', array['?'], array['1','2','3','4','5','6'], 'm');
    raise exception 'six talking points were saved';
  exception when check_violation then null;
  end;
end $$;

-- ── the month's usage, per model, for the agency ─────────────────────────
do $$
declare r record;
begin
  select * into r from public.lead_briefing_month_usage('00000000-0000-0000-0000-000000000001', now() - interval '1 day');
  if r.model <> 'claude-haiku-5-5' or r.input_tokens <> 1510 or r.cached_tokens <> 100 or r.output_tokens <> 260 then
    raise exception 'the month''s usage is wrong: %', row_to_json(r);
  end if;
end $$;

-- ── a User reads their own lead's briefings and no other; writes nothing ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.lead_briefings where lead_id = 'b0000000-0000-0000-0000-0000000000b1') <> 2 then
    raise exception 'the assignee cannot read their lead''s briefings';
  end if;
  if exists (select 1 from public.lead_briefings where lead_id = 'b0000000-0000-0000-0000-0000000000b2') then
    raise exception 'a User read a briefing of a lead that is not theirs';
  end if;
  begin
    insert into public.lead_briefings (lead_id, agency_id, summary, concern, questions, talking_points, model)
    values ('b0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', array['1'], 'x', array['?'], array['x'], 'm');
    raise exception 'a signed-in User wrote a briefing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.lead_briefing_month_usage('00000000-0000-0000-0000-000000000001', now() - interval '1 day');
    raise exception 'a signed-in User read the month''s usage';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── the Admin reads every lead's ──────────────────────────────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.lead_briefings) <> 3 then
    raise exception 'the Admin does not see every briefing of the agency';
  end if;
end $$;

-- ── anon reads nothing ───────────────────────────────────────────────────
set local role anon;
do $$ begin
  perform 1 from public.lead_briefings;
  raise exception 'anon read the briefings';
exception when insufficient_privilege then null;
end $$;

-- ── retention anonymises b1: its briefings go; b2's stay ─────────────────
reset role;
update public.leads set anonymized_at = now() where id = 'b0000000-0000-0000-0000-0000000000b1';
do $$ begin
  if exists (select 1 from public.lead_briefings where lead_id = 'b0000000-0000-0000-0000-0000000000b1') then
    raise exception 'an anonymised lead kept its briefings';
  end if;
  if (select count(*) from public.lead_briefings where lead_id = 'b0000000-0000-0000-0000-0000000000b2') <> 1 then
    raise exception 'another lead lost its briefing';
  end if;
end $$;

-- ── a deleted lead takes its briefings with it ───────────────────────────
delete from public.leads where id = 'b0000000-0000-0000-0000-0000000000b2';
do $$ begin
  if exists (select 1 from public.lead_briefings) then
    raise exception 'a deleted lead left its briefing behind';
  end if;
end $$;

rollback;
\echo 'lead_briefings_check: OK'
