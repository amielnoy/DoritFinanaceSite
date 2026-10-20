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
insert into public.leads (id, agency_id, name, phone, source, status, brought_by, intake, notice_method,
                          consent_version, consent_at, duplicate_of) values
  ('11111111-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'כפילות', '0501111111', 'staff', 'new',
   'ffffffff-0000-0000-0000-000000000002', 'phone', 'verbal', 'staff-intake-v1', now(),
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
  exception when insufficient_privilege then null;
  end;
  begin
    update public.leads set source = 'consultation'
     where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'an Admin changed source';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.leads set notice_method = 'email'
     where id = '11111111-0000-0000-0000-000000000012';
    raise exception 'an Admin changed notice_method';
  exception when insufficient_privilege then null;
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
  exception when insufficient_privilege then null;
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
  exception when insufficient_privilege then null;
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

rollback;
