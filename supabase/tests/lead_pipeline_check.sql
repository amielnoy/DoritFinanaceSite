-- The lead pipeline (20261109000000_lead_pipeline.sql), against a local
-- `supabase start`, in the style of staff_leads_check.sql: every block raises
-- on a wrong answer, so a clean run is the assertion. Synthetic data; rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/lead_pipeline_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 an Admin of agency 1 · 2 a User of agency 1
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001','authenticated','authenticated','pipe-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000002','authenticated','authenticated','pipe-user@example.com', now());
insert into public.memberships (user_id, agency_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('eeeeeeee-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'user');

-- e1 is the User's; e2 is nobody's.
insert into public.leads (id, agency_id, name, phone, source, status, assigned_user_id) values
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'שלו', '0541111111', 'consultation', 'new', 'eeeeeeee-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'נועה', '0542222222', 'interview', 'new', null);

-- ── the pipeline's statuses are accepted, a made-up one is not ───────────
do $$ begin
  update public.leads set status = 'meeting_set' where id = 'e0000000-0000-0000-0000-0000000000e2';
  update public.leads set status = 'proposal_sent' where id = 'e0000000-0000-0000-0000-0000000000e2';
  update public.leads set status = 'new' where id = 'e0000000-0000-0000-0000-0000000000e2';
  begin
    update public.leads set status = 'won' where id = 'e0000000-0000-0000-0000-0000000000e2';
    raise exception 'a made-up status was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ── a new lead is logged as created ──────────────────────────────────────
do $$ begin
  if not exists (select 1 from public.lead_events
                  where lead_id = 'e0000000-0000-0000-0000-0000000000e1' and kind = 'created' and to_value = 'new') then
    raise exception 'the new lead was not logged';
  end if;
  -- three server-side status changes on e2 above, each logged, with no person behind them
  if (select count(*) from public.lead_events
       where lead_id = 'e0000000-0000-0000-0000-0000000000e2' and kind = 'status' and actor_id is null) <> 3 then
    raise exception 'the server-side status changes were not all logged';
  end if;
end $$;

-- ── the User moves their lead and plans a follow-up; both are logged ─────
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  update public.leads set status = 'contacted' where id = 'e0000000-0000-0000-0000-0000000000e1';
  update public.leads set next_follow_up_on = date '2026-11-02' where id = 'e0000000-0000-0000-0000-0000000000e1';
  if not exists (select 1 from public.lead_events
                  where lead_id = 'e0000000-0000-0000-0000-0000000000e1' and kind = 'status'
                    and from_value = 'new' and to_value = 'contacted'
                    and actor_id = 'eeeeeeee-0000-0000-0000-000000000002') then
    raise exception 'the status change was not logged with its member';
  end if;
  if not exists (select 1 from public.lead_events
                  where lead_id = 'e0000000-0000-0000-0000-0000000000e1' and kind = 'follow_up'
                    and from_value is null and to_value = '2026-11-02') then
    raise exception 'the follow-up was not logged';
  end if;

  -- notes: the User's own lead, yes; another lead, no; nothing secret
  perform public.add_lead_note('e0000000-0000-0000-0000-0000000000e1', '  ביקש שנתקשר אחרי החגים  ');
  if (select note from public.lead_events where lead_id = 'e0000000-0000-0000-0000-0000000000e1' and kind = 'note')
     is distinct from 'ביקש שנתקשר אחרי החגים' then
    raise exception 'the note was not saved trimmed';
  end if;
  begin
    perform public.add_lead_note('e0000000-0000-0000-0000-0000000000e2', 'לא שלי');
    raise exception 'a User noted a lead that is not theirs';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  begin
    perform public.add_lead_note('e0000000-0000-0000-0000-0000000000e1', '   ');
    raise exception 'a blank note was saved';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_required' then raise; end if;
  end;
  begin
    perform public.add_lead_note('e0000000-0000-0000-0000-0000000000e1', 'ת.ז. 123456789');
    raise exception 'a note with an ID number was saved';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_invalid' then raise; end if;
  end;
  begin
    perform public.add_lead_note('e0000000-0000-0000-0000-0000000000e1', repeat('א', 2001));
    raise exception 'a 2,001-character note was saved';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_too_long' then raise; end if;
  end;

  -- the log: read only, and only the leads the User may see
  begin
    insert into public.lead_events (lead_id, kind, note) values ('e0000000-0000-0000-0000-0000000000e1', 'note', 'ישירות');
    raise exception 'a User wrote the log directly';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.lead_events where lead_id = 'e0000000-0000-0000-0000-0000000000e2') then
    raise exception 'a User read the log of a lead that is not theirs';
  end if;
  if not exists (select 1 from public.lead_events where lead_id = 'e0000000-0000-0000-0000-0000000000e1') then
    raise exception 'a User could not read their own lead''s log';
  end if;
end $$;

-- ── an Admin assigns, and merges; both are logged ────────────────────────
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  update public.leads set assigned_user_id = 'eeeeeeee-0000-0000-0000-000000000002'
   where id = 'e0000000-0000-0000-0000-0000000000e2';
  if not exists (select 1 from public.lead_events
                  where lead_id = 'e0000000-0000-0000-0000-0000000000e2' and kind = 'assigned'
                    and from_value is null and to_value = 'eeeeeeee-0000-0000-0000-000000000002'
                    and actor_id = 'eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'the assignment was not logged';
  end if;
  perform public.merge_leads('e0000000-0000-0000-0000-0000000000e1', array['e0000000-0000-0000-0000-0000000000e2']::uuid[]);
  if not exists (select 1 from public.lead_events
                  where lead_id = 'e0000000-0000-0000-0000-0000000000e2' and kind = 'merged'
                    and to_value = 'e0000000-0000-0000-0000-0000000000e1') then
    raise exception 'the merge was not logged';
  end if;
end $$;

reset role;

-- ── retention's anonymising clears the notes, and keeps the rest ─────────
do $$ begin
  update public.leads set anonymized_at = now(), name = 'נמחק', phone = ''
   where id = 'e0000000-0000-0000-0000-0000000000e1';
  if exists (select 1 from public.lead_events
              where lead_id = 'e0000000-0000-0000-0000-0000000000e1' and note is not null) then
    raise exception 'an anonymised lead kept its notes';
  end if;
  if not exists (select 1 from public.lead_events
                  where lead_id = 'e0000000-0000-0000-0000-0000000000e1' and kind = 'status') then
    raise exception 'anonymising erased the status history';
  end if;
end $$;

-- ── deleting a lead deletes its log ──────────────────────────────────────
do $$ begin
  delete from public.leads where id = 'e0000000-0000-0000-0000-0000000000e2';
  if exists (select 1 from public.lead_events where lead_id = 'e0000000-0000-0000-0000-0000000000e2') then
    raise exception 'a deleted lead left its log behind';
  end if;
end $$;

rollback;
\echo 'lead_pipeline_check: OK'
