-- One-click WhatsApp (20261110000000_lead_whatsapp.sql), in the style of
-- staff_leads_check.sql: every block raises on a wrong answer. Rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/lead_whatsapp_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 the Owner of agency 1 · 2 a User of agency 1
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000001','authenticated','authenticated','wa-owner@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000002','authenticated','authenticated','wa-user@example.com', now());
insert into public.memberships (user_id, agency_id, role) values
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'user');
insert into public.agency_profiles (agency_id, display_name, phone_e164, phone_display, whatsapp, email, default_whatsapp_message,
                                   licence_entity, licence_number, licence_regulator)
values ('00000000-0000-0000-0000-000000000001', 'דורית', '+972500000000', '050-0000000', '972500000000', 'd@example.com', 'שלום',
        'דורית', '0', 'רשות שוק ההון')
on conflict (agency_id) do nothing;
insert into public.leads (id, agency_id, name, phone, source, status, assigned_user_id) values
  ('c0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'רחל', '0541234567', 'consultation', 'new', 'cccccccc-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'דנה', '0547654321', 'consultation', 'new', null);

-- ── every agency starts with the default message ─────────────────────────
do $$ begin
  if (select lead_whatsapp_template from public.agency_profiles where agency_id = '00000000-0000-0000-0000-000000000001')
     is distinct from 'היי {name}, כאן {agent} — קיבלתי את הפנייה שלך בנושא {topic}, מתי נוח לדבר?' then
    raise exception 'the default message is not the one the screen keeps';
  end if;
end $$;

-- ── a User logs a message on their lead, not on another's; reads the template ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.log_lead_whatsapp('c0000000-0000-0000-0000-0000000000c1');
  if not exists (select 1 from public.lead_events where lead_id = 'c0000000-0000-0000-0000-0000000000c1'
                  and kind = 'whatsapp' and actor_id = 'cccccccc-0000-0000-0000-000000000002'
                  and note is null and from_value is null and to_value is null) then
    raise exception 'the message was not logged, or logged with content';
  end if;
  begin
    perform public.log_lead_whatsapp('c0000000-0000-0000-0000-0000000000c2');
    raise exception 'a User logged a message on a lead that is not theirs';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  if (select lead_whatsapp_template from public.agency_profiles where agency_id = '00000000-0000-0000-0000-000000000001') is null then
    raise exception 'a member cannot read the template';
  end if;
  -- a User cannot change it
  update public.agency_profiles set lead_whatsapp_template = 'של User' where agency_id = '00000000-0000-0000-0000-000000000001';
  if (select lead_whatsapp_template from public.agency_profiles where agency_id = '00000000-0000-0000-0000-000000000001') = 'של User' then
    raise exception 'a User changed the template';
  end if;
end $$;

-- ── the Owner edits it, within its bounds ────────────────────────────────
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  update public.agency_profiles set lead_whatsapp_template = 'שלום {name}, מדברת {agent}'
   where agency_id = '00000000-0000-0000-0000-000000000001';
  if (select lead_whatsapp_template from public.agency_profiles where agency_id = '00000000-0000-0000-0000-000000000001')
     is distinct from 'שלום {name}, מדברת {agent}' then
    raise exception 'the Owner could not edit the template';
  end if;
  begin
    update public.agency_profiles set lead_whatsapp_template = '   ' where agency_id = '00000000-0000-0000-0000-000000000001';
    raise exception 'a blank template was saved';
  exception when check_violation then null;
  end;
  begin
    update public.agency_profiles set lead_whatsapp_template = repeat('א', 501) where agency_id = '00000000-0000-0000-0000-000000000001';
    raise exception 'a 501-character template was saved';
  exception when check_violation then null;
  end;
end $$;

reset role;
rollback;
\echo 'lead_whatsapp_check: OK'
