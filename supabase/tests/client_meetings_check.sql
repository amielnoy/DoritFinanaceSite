-- A client's meetings with Dorit (20261103000000_client_meetings.sql), against
-- a local `supabase start`, in the style of clearinghouse_publish_check.sql:
-- every block raises on a wrong answer, so a clean run is the assertion.
-- Synthetic data; rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/client_meetings_check.sql
\set ON_ERROR_STOP on
begin;

insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- 1 admin of agency 1 · 2 the client (confirmed) · 3 an unconfirmed address ·
-- 4 owner of agency 2 · 5 a User of agency 1 · 6 a_b@… (the `_` wildcard trap)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000001','authenticated','authenticated','mtg-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000002','authenticated','authenticated','client@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000003','authenticated','authenticated','unconfirmed@example.com', null),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000004','authenticated','authenticated','mtg-other@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000005','authenticated','authenticated','mtg-user@example.com', now());

insert into public.memberships (user_id, agency_id, role) values
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('ffffffff-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner'),
  ('ffffffff-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'user');

-- The client's lead (agency 1, unassigned); someone else's; an agency-2 lead;
-- a lead whose address differs from the client's by one `_`.
insert into public.leads (id, agency_id, name, phone, email, source, status) values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'לקוח', '0501111111', ' Client@Example.com ', 'consultation', 'client'),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'אחר', '0502222222', 'someone@example.com', 'consultation', 'new'),
  ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב', '0503333333', 'b@example.com', 'consultation', 'new'),
  ('11111111-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'מלכודת', '0504444444', 'axb@example.com', 'consultation', 'new');

-- The site's booking (server: created_by null), done, with notes and a draft summary.
insert into public.meetings (id, lead_id, scheduled_at, topic, notes, calendar_status, status, client_summary, kind) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', now() - interval '30 days',
   'פגישת היכרות', 'הערה פנימית של דורית', 'אירוע נוצר ביומן', 'done', 'טיוטה שלא פורסמה', 'first');

-- Before migration 2 a lead holds one meeting: submit-lead is not offered a
-- lead that already has one, so a rebooking makes a new lead instead of failing.
do $$ begin
  if public.lead_for_email('client@example.com', '00000000-0000-0000-0000-000000000001') is not null then
    raise exception 'lead_for_email offered a lead that cannot take a second meeting yet';
  end if;
  if public.lead_for_email('someone@example.com', '00000000-0000-0000-0000-000000000001')
       is distinct from '11111111-0000-0000-0000-000000000002' then
    raise exception 'lead_for_email did not offer a lead with no meeting';
  end if;
end $$;

-- The world after migration 2: many meetings per lead. Dropped here, inside
-- the rolled-back transaction, so the many-meetings cases can be asked now.
alter table public.meetings drop constraint meetings_lead_id_key;

-- ── staff add a meeting to a lead they can see, and only that ──────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  insert into public.meetings (id, lead_id, agency_id, scheduled_at, duration_min, topic, mode, location, kind)
  values ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000001', now() + interval '7 days', 45, 'סקירה שנתית', 'office',
          'רחוב הברזל 1, תל אביב', 'annual_review');
  if (select created_by from public.meetings where id = '22222222-0000-0000-0000-000000000002')
       is distinct from 'ffffffff-0000-0000-0000-000000000001' then
    raise exception 'a staff insert did not record who added it';
  end if;
  begin
    insert into public.meetings (lead_id, agency_id, created_by)
    values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000005');
    raise exception 'staff added a meeting in someone else''s name';
  exception when insufficient_privilege then null;
  end;
  begin
    -- The lead is agency 1's; filing the meeting under agency 2 is a cross-tenant write.
    insert into public.meetings (lead_id, agency_id)
    values ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002');
    raise exception 'a meeting was filed under another agency than its lead';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  -- Publish the first meeting's summary.
  update public.meetings set summary_published_at = now(), client_summary = 'סיכמנו לבדוק דמי ניהול'
   where id = '22222222-0000-0000-0000-000000000001';
end $$;
reset role;

-- A User sees only assigned leads: the client's lead is not theirs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
  begin
    insert into public.meetings (lead_id, agency_id)
    values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    raise exception 'a User added a meeting to a lead not assigned to them';
  exception when insufficient_privilege then null;
  end;
  perform 1 from public.meetings;
  if found then raise exception 'a User read meetings of leads not assigned to them'; end if;
end $$;
reset role;

-- Another agency's owner can add nothing to agency 1's lead.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  begin
    insert into public.meetings (lead_id, agency_id)
    values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    raise exception 'another agency added a meeting to agency 1''s lead';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── the client reads their meetings: the listed columns, never the notes ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  n int;
  v record;
begin
  select count(*) into n from public.my_meetings();
  if n <> 2 then raise exception 'the client saw % meetings, not 2', n; end if;
  -- Newest first: the upcoming review, then the past booking.
  select * into v from public.my_meetings() limit 1;
  if v.kind <> 'annual_review' or v.status <> 'scheduled' or not v.in_calendar then
    raise exception 'the upcoming staff meeting came back wrong (kind %, status %, in_calendar %)', v.kind, v.status, v.in_calendar;
  end if;
  select * into v from public.my_meetings() offset 1 limit 1;
  if v.client_summary is distinct from 'סיכמנו לבדוק דמי ניהול' or not v.in_calendar then
    raise exception 'the published summary did not reach the client';
  end if;
  -- Exactly twelve columns, and none of the private ones.
  if (select array_agg(a.attname::text order by a.attname)
        from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(attname, mode, ord)
       where p.proname = 'my_meetings' and a.mode = 't')
     <> array['client_summary','duration_min','id','in_calendar','kind','location','mode','open_request',
              'scheduled_at','status','summary_published_at','topic'] then
    raise exception 'my_meetings returns columns beyond the allowed twelve';
  end if;
  perform 1 from public.meetings;
  if found then raise exception 'the client read the meetings table directly'; end if;
  begin
    perform public.meetings_for('client@example.com');
    raise exception 'the client called meetings_for';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- An unpublished summary stays in the table.
update public.meetings set summary_published_at = null where id = '22222222-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.meetings_for('client@example.com') where client_summary is not null) then
    raise exception 'an unpublished summary reached the client';
  end if;
end $$;

-- ── the client asks for a change, once, and only for their own meeting ────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  v_id := public.request_meeting_change('22222222-0000-0000-0000-000000000002', 'reschedule', ' אפשר ביום אחר? ');
  if v_id is null then raise exception 'the request returned no id'; end if;
  if (select open_request from public.my_meetings() where id = '22222222-0000-0000-0000-000000000002') <> 'reschedule' then
    raise exception 'the open request does not show on the meeting';
  end if;
  begin
    perform public.request_meeting_change('22222222-0000-0000-0000-000000000002', 'cancel', null);
    raise exception 'a second open request was accepted';
  exception when unique_violation then null;
  end;
  begin
    -- The past meeting is done: there is nothing to move.
    perform public.request_meeting_change('22222222-0000-0000-0000-000000000001', 'reschedule', null);
    raise exception 'a change was asked for a meeting that already happened';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.request_meeting_change('22222222-0000-0000-0000-000000000002', 'move', null);
    raise exception 'an unknown kind was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.request_meeting_change('22222222-0000-0000-0000-000000000002', 'cancel', repeat('א', 501));
    raise exception 'a note over 500 characters was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.meeting_requests (meeting_id, agency_id, kind)
    values ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'cancel');
    raise exception 'the client wrote a request directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Nobody else: an unconfirmed address sees and asks nothing; another signed-in
-- user cannot ask about the client's meeting.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.my_meetings()) then raise exception 'an unconfirmed address saw meetings'; end if;
  begin
    perform public.request_meeting_change('22222222-0000-0000-0000-000000000002', 'cancel', null);
    raise exception 'an unconfirmed address asked for a change';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.my_meetings()) then raise exception 'another user saw the client''s meetings'; end if;
  begin
    perform public.request_meeting_change('22222222-0000-0000-0000-000000000002', 'cancel', null);
    raise exception 'another user asked to change the client''s meeting';
  exception when insufficient_privilege then null;
  end;
  perform 1 from public.meeting_requests;
  if found then raise exception 'another agency read the request'; end if;
end $$;
reset role;

-- ── staff see the request and answer it; the client's words stay theirs ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select note from public.meeting_requests) <> 'אפשר ביום אחר?' then
    raise exception 'staff did not see the request, trimmed';
  end if;
  begin
    update public.meeting_requests set note = 'נערך';
    raise exception 'staff rewrote the client''s note';
  exception when insufficient_privilege then null;
  end;
  update public.meeting_requests set status = 'handled', handled_at = now();
  if (select status from public.meeting_requests) <> 'handled' then
    raise exception 'staff could not mark the request handled';
  end if;
end $$;
reset role;

-- ── the server's lookups ───────────────────────────────────────────────────
do $$ begin
  if public.lead_for_email('CLIENT@example.com', '00000000-0000-0000-0000-000000000001')
       is distinct from '11111111-0000-0000-0000-000000000001' then
    raise exception 'lead_for_email missed the client by case or spacing';
  end if;
  if public.lead_for_email('a_b@example.com', '00000000-0000-0000-0000-000000000001') is not null then
    raise exception 'lead_for_email matched a pattern, not the address';
  end if;
  if public.lead_for_email('client@example.com', 'aaaaaaaa-0000-0000-0000-000000000002') is not null then
    raise exception 'lead_for_email crossed agencies';
  end if;
  if not ('mtg-admin@example.com' = any(public.meeting_request_recipients((select id from public.meeting_requests)))) then
    raise exception 'the agency admin is not told about the request';
  end if;
  if 'mtg-user@example.com' = any(public.meeting_request_recipients((select id from public.meeting_requests))) then
    raise exception 'an unassigned User is told about the request';
  end if;
end $$;

-- ── the enquiry is not repeated by a second meeting ────────────────────────
do $$ begin
  if (select count(*) from public.enquiries_for('client@example.com')) <> 1 then
    raise exception 'a follow-up meeting repeated the enquiry';
  end if;
end $$;

-- ── retention: by the latest meeting; the new free text goes too ──────────
-- Two non-client leads, both created long ago: one with an old and a recent
-- meeting (kept), one with only an old meeting (anonymised).
insert into public.leads (id, agency_id, name, phone, email, source, status, created_at, updated_at) values
  ('11111111-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'פעיל', '0505555555', 'kept@example.com', 'consultation', 'new', now() - interval '30 months', now() - interval '30 months'),
  ('11111111-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'ישן', '0506666666', 'stale@example.com', 'consultation', 'new', now() - interval '30 months', now() - interval '30 months');
insert into public.meetings (id, lead_id, scheduled_at, kind, location, client_summary, status) values
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000005', now() - interval '29 months', 'first', null, null, 'done'),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000005', now() - interval '1 month', 'follow_up', 'זום', null, 'done'),
  ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000006', now() - interval '29 months', 'first', 'משרד', 'סיכום', 'scheduled');
insert into public.meeting_requests (meeting_id, agency_id, kind, note) values
  ('22222222-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'cancel', 'הערה של הלקוח');
do $$ begin
  perform public.anonymize_stale_leads();
  if (select anonymized_at from public.leads where id = '11111111-0000-0000-0000-000000000005') is not null then
    raise exception 'a lead with a recent meeting was anonymised for an old one';
  end if;
  if (select anonymized_at from public.leads where id = '11111111-0000-0000-0000-000000000006') is null then
    raise exception 'a stale lead was not anonymised';
  end if;
  if (select coalesce(location, client_summary) from public.meetings where id = '22222222-0000-0000-0000-000000000007') is not null then
    raise exception 'an anonymised lead''s meeting kept its place or summary';
  end if;
  if (select note from public.meeting_requests where meeting_id = '22222222-0000-0000-0000-000000000007') is not null then
    raise exception 'an anonymised lead''s request kept the client''s note';
  end if;
end $$;

rollback;
