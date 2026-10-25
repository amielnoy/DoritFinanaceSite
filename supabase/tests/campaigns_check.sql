-- Reactivation campaigns, stage 1 (20261111000000_campaigns.sql), in the style
-- of staff_leads_check.sql: every block raises on a wrong answer. Rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/campaigns_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 an Admin of agency 1 · 2 a User of agency 1 · 3 an Admin of agency B
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000001','authenticated','authenticated','cmp-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000002','authenticated','authenticated','cmp-user@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000003','authenticated','authenticated','cmp-other@example.com', now());
insert into public.agencies (id, name) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'סוכנות אחרת');
insert into public.memberships (user_id, agency_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'user'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-00000000000b', 'admin');

-- ── a lead may now come from a campaign ──────────────────────────────────
do $$ begin
  insert into public.leads (agency_id, name, phone, source, status, channel, campaign)
  values ('00000000-0000-0000-0000-000000000001', 'מקמפיין', '0541234567', 'interview', 'new', 'reactivation', 'k7x2m9qa');
  begin
    insert into public.leads (agency_id, name, phone, source, status, channel)
    values ('00000000-0000-0000-0000-000000000001', 'ערוץ מומצא', '0541234568', 'interview', 'new', 'tiktok');
    raise exception 'a made-up channel was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ── an Admin creates a campaign, as themselves ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  insert into public.campaigns (id, agency_id, name, code, message)
  values ('bbbbbbbb-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'חזרה ללקוחות', 'k7x2m9qa',
          'שלום, כאן דורית: {link}' || chr(10) || 'להסרה השב/י ''הסר''');
  if (select created_by from public.campaigns where id = 'bbbbbbbb-0000-0000-0000-0000000000c1')
     is distinct from 'bbbbbbbb-0000-0000-0000-000000000001' then
    raise exception 'the campaign is not the Admin''s';
  end if;
  begin
    insert into public.campaigns (agency_id, name, code, message)
    values ('00000000-0000-0000-0000-000000000001', 'בלי הסרה', 'abcd1234', 'שלום, כאן דורית: {link}');
    raise exception 'a message without an opt-out line was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.campaigns (agency_id, name, code, message)
    values ('00000000-0000-0000-0000-000000000001', 'קוד רע', 'Has Space', 'להסרה השב/י הסר');
    raise exception 'a code with capitals and a space was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.campaigns (agency_id, name, code, message, created_by)
    values ('00000000-0000-0000-0000-000000000001', 'בשם אחר', 'zzzz9999', 'להסרה השב/י הסר', 'bbbbbbbb-0000-0000-0000-000000000002');
    raise exception 'an Admin created a campaign in someone else''s name';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.campaigns (agency_id, name, code, message)
    values ('00000000-0000-0000-0000-000000000001', 'כפול', 'k7x2m9qa', 'להסרה השב/י הסר');
    raise exception 'a second campaign took the same code';
  exception when unique_violation then null;
  end;

  -- edit the name and message; the code stays
  update public.campaigns set name = 'חזרה ללקוחות — סתיו' where id = 'bbbbbbbb-0000-0000-0000-0000000000c1';
  begin
    update public.campaigns set code = 'newcode1' where id = 'bbbbbbbb-0000-0000-0000-0000000000c1';
    raise exception 'a campaign''s code was changed';
  exception when insufficient_privilege then
    if sqlerrm <> 'campaign_fixed' then raise; end if;
  end;
  begin
    delete from public.campaigns where id = 'bbbbbbbb-0000-0000-0000-0000000000c1';
    raise exception 'a campaign was deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── a User reads the agency's campaigns, and creates none ────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if not exists (select 1 from public.campaigns where id = 'bbbbbbbb-0000-0000-0000-0000000000c1') then
    raise exception 'a User cannot see the agency''s campaign';
  end if;
  begin
    insert into public.campaigns (agency_id, name, code, message)
    values ('00000000-0000-0000-0000-000000000001', 'של User', 'user1234', 'להסרה השב/י הסר');
    raise exception 'a User created a campaign';
  exception when insufficient_privilege then null;
  end;
  update public.campaigns set name = 'שונה ע״י User' where id = 'bbbbbbbb-0000-0000-0000-0000000000c1';
  if (select name from public.campaigns where id = 'bbbbbbbb-0000-0000-0000-0000000000c1') = 'שונה ע״י User' then
    raise exception 'a User edited a campaign';
  end if;
end $$;

-- ── another agency sees nothing of it ────────────────────────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.campaigns where id = 'bbbbbbbb-0000-0000-0000-0000000000c1') then
    raise exception 'another agency read the campaign';
  end if;
  begin
    insert into public.campaigns (agency_id, name, code, message)
    values ('00000000-0000-0000-0000-000000000001', 'פלישה', 'other123', 'להסרה השב/י הסר');
    raise exception 'another agency''s Admin created a campaign in agency 1';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
\echo 'campaigns_check: OK'
