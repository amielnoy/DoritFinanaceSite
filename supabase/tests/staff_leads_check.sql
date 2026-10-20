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
                          consent_version, consent_at, possible_duplicate) values
  ('11111111-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'כפילות', '0501111111', 'staff', 'new',
   'ffffffff-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000002', 'phone', 'verbal', 'staff-intake-v1', now(),
   true);

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

-- ── possible_duplicate: an Admin may clear it, never set it ──────────────
do $$ begin
  begin
    update public.leads set possible_duplicate = true where id = '11111111-0000-0000-0000-000000000011';
    raise exception 'an Admin set possible_duplicate';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  update public.leads set possible_duplicate = false where id = '11111111-0000-0000-0000-000000000012';
  if (select possible_duplicate from public.leads where id = '11111111-0000-0000-0000-000000000012') then
    raise exception 'an Admin could not clear possible_duplicate';
  end if;
end $$;
reset role;

-- Put the flag back, as the server, for the User block.
update public.leads set possible_duplicate = true where id = '11111111-0000-0000-0000-000000000012';

-- ── a User cannot clear it ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  begin
    update public.leads set possible_duplicate = false where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'a User cleared possible_duplicate';
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
  if l.possible_duplicate then raise exception 'a fresh lead was flagged'; end if;
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
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, repeat('א', 2001),
      'phone', null, 'new', 'verbal', null, false);
    raise exception '2001 characters of notes were accepted';
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
  -- A phone not in normalizePhone's shape (the create-lead function sends
  -- only that shape; a direct call to the RPC may not).
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '054-555-6666', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a phone with dashes was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_phone' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '+972545556666', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a +972 phone was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_phone' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '--', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a punctuation-only phone was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_phone' then raise; end if;
  end;
  -- What redact() would have cut: an ID in the notes, a card in the topic, an IBAN in the referrer.
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, 'ת.ז. 123456782',
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'an ID number in the notes was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_invalid' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, 'כרטיס 4580-1234-5678-9012', null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a card number in the topic was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_invalid' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, null,
      'referral', 'il620108000000099999999', 'new', 'verbal', null, false);
    raise exception 'an IBAN in the referrer was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_invalid' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0545556666', null, null, 'חשבון 1234567',
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'an account number in the notes was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_invalid' then raise; end if;
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

-- What redact() leaves, and a ten-digit number it does not touch, go through.
do $$
declare r record;
begin
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'מוסתר', '0545550000', null, 'כרטיס [הושמט — מספר כרטיס]',
    'ת.ז. [הושמט — מספר מזהה], חזר מ-0501234567 ב-10:30', 'referral', 'דרך [הושמט — חשבון בנק]',
    'new', 'verbal', null, false);
  if r.lead_id is null then raise exception 'redacted text was refused'; end if;
end $$;

-- ── a User who cannot see the match: flagged, and the answer is the NEW id ─
do $$
declare r record; n integer;
begin
  select count(*) into n from public.leads;
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'כפולה', '0529998888', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if r.duplicate is distinct from 'hidden' then raise exception 'expected hidden, got %', r.duplicate; end if;
  if r.lead_id = '11111111-0000-0000-0000-000000000022' then
    raise exception 'a hidden duplicate returned the other lead''s id';
  end if;
  -- The User sees their own row; no column of it leads to the other lead.
  if (select possible_duplicate from public.leads where id = r.lead_id) is distinct from true then
    raise exception 'the User cannot see the new lead, or it is not flagged';
  end if;
  if exists (select 1 from public.leads where id = '11111111-0000-0000-0000-000000000022') then
    raise exception 'the User can read a lead that is not theirs';
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.leads where name = 'כפולה' and possible_duplicate) <> 1 then
    raise exception 'the hidden match did not set possible_duplicate';
  end if;
end $$;

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

  -- 050-1234567 exists; 0501234567 is the same number.
  select count(*) into n from public.leads;
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'קיים', '0501234567', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if r.duplicate is distinct from 'visible' or r.lead_id <> '11111111-0000-0000-0000-000000000021' then
    raise exception 'expected the visible match, got % / %', r.duplicate, r.lead_id;
  end if;
  if (select count(*) from public.leads) <> n then raise exception 'a visible duplicate still inserted a row'; end if;

  -- The Admin looked and chose a second lead: inserted, not flagged.
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'קיים', '0501234567', null, null, null,
    'phone', null, 'new', 'verbal', null, true);
  if (select count(*) from public.leads) <> n + 1 then raise exception 'p_duplicate_ok did not insert'; end if;
  if (select possible_duplicate from public.leads where id = r.lead_id) then
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

-- ── a landline in two shapes is one number ────────────────────────────────
-- (the stored lead dashed, the new one as normalizePhone gives it)
insert into public.leads (id, agency_id, name, phone, source, status) values
  ('11111111-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'קווי', '03-1234567', 'consultation', 'new');
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'קווי', '031234567', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if r.duplicate is distinct from 'visible' or r.lead_id <> '11111111-0000-0000-0000-000000000023' then
    raise exception 'a landline in two shapes was not one number: % / %', r.duplicate, r.lead_id;
  end if;

  -- Told by email, but no address: refused.
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0540002222', null, null, null,
      'phone', null, 'new', 'email', null, false);
    raise exception 'notice by email without an email was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_notice' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0540002222', '   ', null, null,
      'phone', null, 'new', 'email', null, false);
    raise exception 'notice by email with a blank email was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_notice' then raise; end if;
  end;
end $$;
reset role;

-- ── a User's own older lead wins over a newer one they cannot see ──────────
insert into public.leads (id, agency_id, name, phone, source, status, assigned_user_id, created_at) values
  ('11111111-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', 'שלי', '053-3333333', 'consultation', 'new',
   'ffffffff-0000-0000-0000-000000000002', now() - interval '1 day'),
  ('11111111-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001', 'לא שלי', '0533333333', 'consultation', 'new',
   null, now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'שלי', '0533333333', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
  if r.duplicate is distinct from 'visible' or r.lead_id <> '11111111-0000-0000-0000-000000000031' then
    raise exception 'expected the User''s own lead, got % / %', r.duplicate, r.lead_id;
  end if;
end $$;
reset role;

-- ── 60 leads an hour per member, in the RPC too ───────────────────────────
-- Sixty from two hours ago do not count; sixty more this hour do.
insert into public.leads (agency_id, name, phone, source, status, brought_by, created_at)
select '00000000-0000-0000-0000-000000000001', 'ישן ' || g, '0550000000', 'consultation', 'new',
       'ffffffff-0000-0000-0000-000000000002', now() - interval '2 hours'
  from generate_series(1, 60) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0551110000', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
end $$;
reset role;
insert into public.leads (agency_id, name, phone, source, status, brought_by)
select '00000000-0000-0000-0000-000000000001', 'חדש ' || g, '0550000000', 'consultation', 'new',
       'ffffffff-0000-0000-0000-000000000002'
  from generate_series(1, 60) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0551110001', null, null, null,
      'phone', null, 'new', 'verbal', null, false);
    raise exception 'a 61st lead in an hour was accepted';
  exception when raise_exception then
    if sqlerrm <> 'rate_limited' then raise; end if;
  end;
end $$;
-- Another member is not held by the User's count.
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0551110002', null, null, null,
    'phone', null, 'new', 'verbal', null, false);
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
