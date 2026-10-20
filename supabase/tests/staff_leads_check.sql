-- Staff-created leads (20261105000000_staff_leads.sql), against a local
-- `supabase start`, in the style of client_meetings_check.sql: every block
-- raises on a wrong answer, so a clean run is the assertion. Synthetic data;
-- rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/staff_leads_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 an Admin of agency 1 · 2 a User of agency 1
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000001','authenticated','authenticated','sl-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000002','authenticated','authenticated','sl-user@example.com', now());

insert into public.memberships (user_id, agency_id, role) values
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('ffffffff-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'user');

-- 11: an ordinary lead · 12: a staff lead flagged as a duplicate of 11
insert into public.leads (id, agency_id, name, phone, source, status) values
  ('11111111-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'מקורי', '0501111111', 'consultation', 'new');
-- Assigned to the User, so the User's update reaches the trigger (RLS lets a
-- User update only leads assigned to them).
insert into public.leads (id, agency_id, name, phone, source, status, brought_by, assigned_user_id, intake, notice_method,
                          consent_version, consent_at, duplicate_of) values
  ('11111111-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'כפילות', '0501111111', 'staff', 'new',
   'ffffffff-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000002', 'phone', 'verbal', 'staff-intake-v1', now(),
   '11111111-0000-0000-0000-000000000011');

-- ── a staff lead must say who brought it and how they were told ───────────
do $$ begin
  begin
    insert into public.leads (agency_id, name, phone, source, status)
    values ('00000000-0000-0000-0000-000000000001', 'בלי הודעה', '0502222222', 'staff', 'new');
    raise exception 'a staff lead without its notice fields was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.leads (agency_id, name, phone, source, status, brought_by, intake, notice_method)
    values ('00000000-0000-0000-0000-000000000001', 'בלי הסכמה', '0502222222', 'staff', 'new',
            'ffffffff-0000-0000-0000-000000000002', 'phone', 'verbal');
    raise exception 'a staff lead without consent was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.leads (agency_id, name, phone, source, status, referrer_note)
    values ('00000000-0000-0000-0000-000000000001', 'הערה ארוכה', '0502222222', 'consultation', 'new', repeat('א', 121));
    raise exception 'a 121-character referrer note was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ── an Admin cannot rewrite who brought a lead, or how it arrived ─────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  begin
    update public.leads set brought_by = 'ffffffff-0000-0000-0000-000000000001'
     where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'an Admin changed brought_by';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_fields_fixed' then raise; end if;
  end;
  begin
    update public.leads set source = 'consultation'
     where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'an Admin changed source';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_fields_fixed' then raise; end if;
  end;
  begin
    update public.leads set notice_method = 'email'
     where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'an Admin changed notice_method';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_fields_fixed' then raise; end if;
  end;
  -- Fields outside the guard still move.
  update public.leads set status = 'contacted' where id = '11111111-0000-0000-0000-000000000012';
  if (select status from public.leads where id = '11111111-0000-0000-0000-000000000012') <> 'contacted' then
    raise exception 'the guard blocked an ordinary status change';
  end if;
end $$;

-- ── duplicate_of: an Admin may point it nowhere, never somewhere else ─────
do $$ begin
  begin
    update public.leads set duplicate_of = '11111111-0000-0000-0000-000000000012'
     where id = '11111111-0000-0000-0000-000000000011';
    raise exception 'an Admin set duplicate_of to another lead';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  update public.leads set duplicate_of = null where id = '11111111-0000-0000-0000-000000000012';
  if (select duplicate_of from public.leads where id = '11111111-0000-0000-0000-000000000012') is not null then
    raise exception 'an Admin could not clear duplicate_of';
  end if;
end $$;
reset role;

-- Put the flag back, as the server, for the User block.
update public.leads set duplicate_of = '11111111-0000-0000-0000-000000000011'
 where id = '11111111-0000-0000-0000-000000000012';

-- ── a User cannot clear duplicate_of ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  begin
    update public.leads set duplicate_of = null where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'a User cleared duplicate_of';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
reset role;

-- ── retention clears the referrer note with the rest of the lead ──────────
insert into public.leads (id, agency_id, name, phone, source, status, referrer_note, created_at, updated_at) values
  ('11111111-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'ישן', '0503333333', 'consultation', 'new',
   'רו״ח משה', now() - interval '30 months', now() - interval '30 months');
do $$ begin
  perform public.anonymize_stale_leads(now());
  if (select referrer_note from public.leads where id = '11111111-0000-0000-0000-000000000013') is not null then
    raise exception 'an anonymised lead kept its referrer note';
  end if;
end $$;

-- ═══ create_staff_lead ═══════════════════════════════════════════════════
-- 3 an Admin of agency 2 · 4 nobody · 5 a User of a suspended agency 3
insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'סוכנות מושעית', 'suspended');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000003','authenticated','authenticated','sl-admin2@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000004','authenticated','authenticated','sl-nobody@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000005','authenticated','authenticated','sl-susp@example.com', now());
insert into public.memberships (user_id, agency_id, role) values
  ('ffffffff-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'admin'),
  ('ffffffff-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000003', 'user');

-- Someone already in agency 1 under two spellings of one number, unassigned
-- (the Admin sees it, the User does not), and another only the User can see.
insert into public.leads (id, agency_id, name, phone, source, status) values
  ('11111111-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'קיים', '050-1234567', 'consultation', 'new'),
  ('11111111-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'של מישהו אחר', '052-999 8888', 'consultation', 'new');

-- ── a User creates: theirs, 'staff', p_assignee ignored ───────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare r record; l public.leads;
begin
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'דנה כהן', '0541112222', 'dana@example.com', 'פנסיה', 'הערה פנימית',
    'referral', 'רו״ח משה', 'contacted', 'email',
    'ffffffff-0000-0000-0000-000000000001', false);
  if r.duplicate is not null then raise exception 'a fresh phone came back as a duplicate: %', r.duplicate; end if;
  select * into l from public.leads where id = r.lead_id;
  if l.assigned_user_id is distinct from 'ffffffff-0000-0000-0000-000000000002' then
    raise exception 'a User''s p_assignee was honoured: %', l.assigned_user_id;
  end if;
  if l.brought_by is distinct from 'ffffffff-0000-0000-0000-000000000002' then raise exception 'brought_by is not the caller'; end if;
  if l.assigned_by is distinct from 'ffffffff-0000-0000-0000-000000000002' or l.assigned_at is null then
    raise exception 'assigned_by/assigned_at not set';
  end if;
  if l.source <> 'staff' or l.channel <> 'referral' or l.status <> 'contacted' then
    raise exception 'source/channel/status wrong: %/%/%', l.source, l.channel, l.status;
  end if;
  if l.consent_version <> 'staff-intake-v1' or l.consent_at is null or l.intake <> 'referral'
     or l.notice_method <> 'email' or l.referrer_note <> 'רו״ח משה' then
    raise exception 'consent / intake / notice not written';
  end if;
  if l.notes <> 'הערה פנימית' or l.summary is not null or l.message is not null then
    raise exception 'staff text went somewhere the client can read, or notes is empty';
  end if;
  if l.duplicate_of is not null then raise exception 'a fresh lead was flagged'; end if;
end $$;

-- A channel for a phone intake is 'direct'.
do $$
declare r record;
begin
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'גיל', '0543334444', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if (select channel from public.leads where id = r.lead_id) <> 'direct' then
    raise exception 'a phone intake did not get channel direct';
  end if;
end $$;

-- ── refusals ──────────────────────────────────────────────────────────────
do $$ begin
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, null,
      'phone', null, 'escalated', 'verbal', null, false);
    raise exception 'status escalated was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_status' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, null,
      'phone', null, 'partial', 'verbal', null, false);
    raise exception 'status partial was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_status' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, null,
      'carrier_pigeon', null, 'new', 'verbal', null, false);
    raise exception 'a bad intake was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_intake' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, null,
      'phone', null, 'new', 'smoke_signal', null, false);
    raise exception 'a bad notice method was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_notice' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', repeat('א', 81), '0545556666', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'an 81-character name was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_too_long' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, repeat('א', 4001),
      'phone', null, 'new', 'verbal', null, false);
    raise exception '4001 characters of notes were accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_too_long' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, null,
      'phone', repeat('א', 121), 'new', 'verbal', null, false);
    raise exception 'a 121-character referrer was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_too_long' then raise; end if;
  end;
  -- The agency is not the caller's.
  begin
    perform public.create_staff_lead('aaaaaaaa-0000-0000-0000-000000000002', 'x', '0545556666', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a User of agency 1 created a lead in agency 2';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  -- Direct insert is still revoked.
  begin
    insert into public.leads (agency_id, name, phone, source, status)
    values ('00000000-0000-0000-0000-000000000001', 'ישיר', '0546667777', 'consultation', 'new');
    raise exception 'a person inserted into leads directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── a User who cannot see the match: flagged, and the answer is the NEW id ─
do $$
declare r record; n integer;
begin
  select count(*) into n from public.leads;
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'כפולה', '+972529998888', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if r.duplicate is distinct from 'hidden' then raise exception 'expected hidden, got %', r.duplicate; end if;
  if r.lead_id = '11111111-0000-0000-0000-000000000022' then
    raise exception 'a hidden duplicate returned the other lead''s id';
  end if;
  if (select duplicate_of from public.leads where id = r.lead_id) is distinct from '11111111-0000-0000-0000-000000000022' then
    raise exception 'the new lead is not flagged against the old one';
  end if;
  -- The User gets nothing but their own row back; the other lead stays unreadable.
  if exists (select 1 from public.leads where id = '11111111-0000-0000-0000-000000000022') then
    raise exception 'the User can read a lead that is not theirs';
  end if;
end $$;
reset role;

-- ── an Admin: assigns to a member, sees the visible duplicate ─────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare r record; n integer;
begin
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'רון', '0547778888', null, null, null,
    'event', null, 'new', 'whatsapp', 'ffffffff-0000-0000-0000-000000000002', false);
  if (select assigned_user_id from public.leads where id = r.lead_id) is distinct from 'ffffffff-0000-0000-0000-000000000002' then
    raise exception 'an Admin could not assign to a member';
  end if;
  if (select assigned_by from public.leads where id = r.lead_id) is distinct from 'ffffffff-0000-0000-0000-000000000001' then
    raise exception 'assigned_by is not the Admin';
  end if;
  -- No assignee: left unassigned.
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'שני', '0548889999', null, null, null,
    'other', null, 'client', 'verbal', null, false);
  if (select assigned_user_id from public.leads where id = r.lead_id) is not null then
    raise exception 'a null p_assignee assigned the lead';
  end if;

  -- 050-1234567 exists; +972501234567 is the same number.
  select count(*) into n from public.leads;
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'קיים', '+972501234567', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if r.duplicate is distinct from 'visible' or r.lead_id <> '11111111-0000-0000-0000-000000000021' then
    raise exception 'expected the visible match, got % / %', r.duplicate, r.lead_id;
  end if;
  if (select count(*) from public.leads) <> n then raise exception 'a visible duplicate still inserted a row'; end if;

  -- The Admin looked and chose a second lead: inserted, not flagged.
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'קיים', '+972501234567', null, null, null,
    'phone', null, 'new', 'verbal', null, true);
  if (select count(*) from public.leads) <> n + 1 then raise exception 'p_duplicate_ok did not insert'; end if;
  if (select duplicate_of from public.leads where id = r.lead_id) is not null then
    raise exception 'a chosen second lead was flagged';
  end if;

  -- An assignee from another agency is refused.
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0549990000', null, null, null,
      'phone', null, 'new', 'verbal', 'ffffffff-0000-0000-0000-000000000003', false);
    raise exception 'an Admin assigned to a member of another agency';
  exception when invalid_parameter_value then
    if sqlerrm <> 'assignee_not_member' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0549990000', null, null, null,
      'phone', null, 'new', 'verbal', 'ffffffff-0000-0000-0000-000000000004', false);
    raise exception 'an Admin assigned to a stranger';
  exception when invalid_parameter_value then
    if sqlerrm <> 'assignee_not_member' then raise; end if;
  end;
end $$;
reset role;

-- ── not a member, a suspended agency's member, another agency's Admin ─────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0540001111', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a non-member created a lead';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
  begin
    perform public.create_staff_lead('aaaaaaaa-0000-0000-0000-000000000003', 'x', '0540001111', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a member of a suspended agency created a lead';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0540001111', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'an Admin of agency 2 created a lead in agency 1';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
reset role;

-- ── anon cannot call it at all ────────────────────────────────────────────
set local role anon;
do $$ begin
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0540001111', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'anon called create_staff_lead';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
