-- Staff-added clients (20261113000000_staff_clients.sql), against a local
-- Postgres/Supabase, in the style of staff_leads_check.sql: every block raises
-- on a wrong answer, so a clean run is the assertion. Synthetic data; rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/staff_clients_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 an Admin of agency 1 · 2 a User of agency 1
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-0000000000c1','authenticated','authenticated','sc-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-0000000000c2','authenticated','authenticated','sc-user@example.com', now());
insert into public.memberships (user_id, agency_id, role) values
  ('ffffffff-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('ffffffff-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'user');

-- 31: a client-opened staff row · 32: an ordinary staff lead (opened_as = 'lead')
insert into public.leads (id, agency_id, name, phone, source, status, brought_by, assigned_user_id, intake, notice_method,
                          consent_version, consent_at, opened_as, client_since, products) values
  ('11111111-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'לקוח', '0501110001', 'staff', 'client',
   'ffffffff-0000-0000-0000-0000000000c2', 'ffffffff-0000-0000-0000-0000000000c2', 'existing_client', 'agreement',
   'staff-client-v1', now(), 'client', date '2019-03-01', array['pension','life']);
insert into public.leads (id, agency_id, name, phone, source, status, brought_by, assigned_user_id, intake, notice_method,
                          consent_version, consent_at) values
  ('11111111-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'ליד', '0501110002', 'staff', 'new',
   'ffffffff-0000-0000-0000-0000000000c2', 'ffffffff-0000-0000-0000-0000000000c2', 'phone', 'verbal',
   'staff-intake-v1', now());

-- ── the constraints ───────────────────────────────────────────────────────
do $$ begin
  begin
    insert into public.leads (agency_id, name, phone, source, status, brought_by, intake, notice_method,
                              consent_version, consent_at, opened_as, client_since)
    values ('00000000-0000-0000-0000-000000000001', 'בלי מוצרים', '0502220001', 'staff', 'client',
            'ffffffff-0000-0000-0000-0000000000c2', 'existing_client', 'agreement', 'staff-client-v1', now(),
            'client', date '2019-03-01');
    raise exception 'a client-opened row without products was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.leads (agency_id, name, phone, source, status, brought_by, intake, notice_method,
                              consent_version, consent_at, opened_as, client_since, products)
    values ('00000000-0000-0000-0000-000000000001', 'יום באמצע', '0502220002', 'staff', 'client',
            'ffffffff-0000-0000-0000-0000000000c2', 'existing_client', 'agreement', 'staff-client-v1', now(),
            'client', date '2019-03-15', array['pension']);
    raise exception 'a client_since that is not the first of the month was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.leads (agency_id, name, phone, source, status, brought_by, intake, notice_method,
                              consent_version, consent_at)
    values ('00000000-0000-0000-0000-000000000001', 'הסכם ללא לקוח', '0502220003', 'staff', 'new',
            'ffffffff-0000-0000-0000-0000000000c2', 'phone', 'agreement', 'staff-intake-v1', now());
    raise exception 'notice_method agreement on an opened_as = lead row was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ── an Admin cannot flip opened_as; client_since and products still move ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$ begin
  begin
    update public.leads set opened_as = 'lead' where id = '11111111-0000-0000-0000-0000000000c1';
    raise exception 'an Admin changed opened_as';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_fields_fixed' then raise; end if;
  end;
  update public.leads set client_since = date '2020-05-01', products = array['health']
   where id = '11111111-0000-0000-0000-0000000000c1';
  if (select client_since from public.leads where id = '11111111-0000-0000-0000-0000000000c1') <> date '2020-05-01'
     or (select products from public.leads where id = '11111111-0000-0000-0000-0000000000c1') <> array['health'] then
    raise exception 'an Admin could not update client_since / products';
  end if;
end $$;
reset role;

-- ── retention: a client-opened row survives, a plain stale lead does not ──
-- leads_touch would stamp updated_at = now() and make the row recent; off for
-- this one update (rolled back with everything else).
alter table public.leads disable trigger leads_touch;
update public.leads set status = 'closed', created_at = now() - interval '40 months', updated_at = now() - interval '40 months'
 where id = '11111111-0000-0000-0000-0000000000c1';
alter table public.leads enable trigger leads_touch;
insert into public.contacts (phone, name, created_at, last_seen)
  values ('0501110001', 'לקוח', now() - interval '40 months', now() - interval '40 months');
insert into public.leads (id, agency_id, name, phone, source, status, created_at, updated_at) values
  ('11111111-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001', 'ישן רגיל', '0501110003', 'consultation', 'closed',
   now() - interval '40 months', now() - interval '40 months');
-- c4: an old lead merged into the former client (20261108000000) stays with it.
insert into public.leads (id, agency_id, name, phone, source, status, created_at, updated_at, merged_into) values
  ('11111111-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000001', 'ממוזג', '0501110001', 'consultation', 'closed',
   now() - interval '40 months', now() - interval '40 months', '11111111-0000-0000-0000-0000000000c1');
do $$ begin
  if (select updated_at from public.leads where id = '11111111-0000-0000-0000-0000000000c1') > now() - interval '30 months' then
    raise exception 'the former client is not old: this block would prove nothing';
  end if;
  perform public.anonymize_stale_leads(now() + interval '30 months');
  if (select anonymized_at from public.leads where id = '11111111-0000-0000-0000-0000000000c1') is not null
     or (select name from public.leads where id = '11111111-0000-0000-0000-0000000000c1') <> 'לקוח' then
    raise exception 'a closed row with client_since was anonymised';
  end if;
  if not exists (select 1 from public.contacts where phone = '0501110001') then
    raise exception 'the contact of a client-opened row was deleted';
  end if;
  if (select anonymized_at from public.leads where id = '11111111-0000-0000-0000-0000000000c4') is not null then
    raise exception 'a lead merged into a former client was anonymised';
  end if;
  if (select anonymized_at from public.leads where id = '11111111-0000-0000-0000-0000000000c3') is null then
    raise exception 'a plain stale lead was not anonymised';
  end if;
end $$;

-- ═══ create_staff_lead with clients · convert_lead_to_client ═════════════
-- 3 another User of agency 1. c5: User 3's lead · c6: User 2's lead · c7: User 2's, merged into c6
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-0000000000c3','authenticated','authenticated','sc-user3@example.com', now());
insert into public.memberships (user_id, agency_id, role) values
  ('ffffffff-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001', 'user');
insert into public.leads (id, agency_id, name, phone, source, status, assigned_user_id) values
  ('11111111-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000001', 'של אחר', '0501110005', 'consultation', 'new',
   'ffffffff-0000-0000-0000-0000000000c3'),
  ('11111111-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-000000000001', 'פנייה ישנה', '0501110006', 'consultation', 'contacted',
   'ffffffff-0000-0000-0000-0000000000c2');
insert into public.leads (id, agency_id, name, phone, source, status, assigned_user_id, merged_into) values
  ('11111111-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-000000000001', 'פנייה ישנה', '0501110006', 'quick', 'new',
   'ffffffff-0000-0000-0000-0000000000c2', '11111111-0000-0000-0000-0000000000c6');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000000c2","role":"authenticated"}';
do $$
declare
  r record;
  l public.leads;
  v uuid;
  bad record;
  this_month date := date_trunc('month', now() at time zone 'Asia/Jerusalem')::date;
begin
  -- a User adds a client: p_status is not read, the client fields land, theirs
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'רחל', '0501110010', null, null, null,
    'existing_client', null, 'new', 'agreement', 'ffffffff-0000-0000-0000-0000000000c1', false,
    true, date '2019-03-01', array['pension','health']);
  select * into l from public.leads where id = r.lead_id;
  if l.status <> 'client' or l.opened_as <> 'client' or l.consent_version <> 'staff-client-v1'
     or l.client_since <> date '2019-03-01' or l.products <> array['pension','health']
     or l.notice_method <> 'agreement' or l.source <> 'staff' then
    raise exception 'a client was not recorded as one: % % % % %', l.status, l.opened_as, l.consent_version, l.client_since, l.products;
  end if;
  if l.assigned_user_id is distinct from 'ffffffff-0000-0000-0000-0000000000c2' then
    raise exception 'a User''s client was not theirs: %', l.assigned_user_id;
  end if;

  -- what a client may not be
  for bad in
    select * from (values
      ((this_month + interval '1 month')::date, array['pension'], 'bad_since'),
      (date '2019-03-15', array['pension'], 'bad_since'),
      (date '1989-12-01', array['pension'], 'bad_since'),
      (null::date, array['pension'], 'bad_since'),
      (date '2019-03-01', array[]::text[], 'bad_products'),
      (date '2019-03-01', array['pension','crypto'], 'bad_products'),
      (date '2019-03-01', null::text[], 'bad_products')
    ) as t(since, products, err)
  loop
    begin
      perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0501110011', null, null, null,
        'existing_client', null, 'client', 'agreement', null, false, true, bad.since, bad.products);
      raise exception 'a client with % / % was accepted', bad.since, bad.products;
    exception when invalid_parameter_value then
      if sqlerrm <> bad.err then raise exception 'expected %, got %', bad.err, sqlerrm; end if;
    end;
  end loop;

  -- and what a lead may not carry
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0501110012', null, null, null,
      'phone', null, 'new', 'agreement', null, false);
    raise exception 'agreement was accepted on a lead';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_notice' then raise; end if;
  end;
  begin
    perform public.create_staff_lead('00000000-0000-0000-0000-000000000001', 'x', '0501110012', null, null, null,
      'phone', null, 'new', 'verbal', null, false, false, null, array['pension']);
    raise exception 'products were accepted on a lead';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_invalid' then raise; end if;
  end;

  -- the old twelve, by name: the lead it always was
  select * into r from public.create_staff_lead(
    p_agency_id => '00000000-0000-0000-0000-000000000001', p_name => 'ישן', p_phone => '0501110013',
    p_email => null, p_topic => null, p_notes => null, p_intake => 'phone', p_referrer => null,
    p_status => 'new', p_notice => 'verbal', p_assignee => null, p_duplicate_ok => false);
  select * into l from public.leads where id = r.lead_id;
  if l.opened_as <> 'lead' or l.consent_version <> 'staff-intake-v1' or l.client_since is not null
     or l.products is not null or l.status <> 'new' then
    raise exception 'a twelve-argument call changed: % % %', l.opened_as, l.consent_version, l.status;
  end if;

  -- a visible match in client mode writes nothing and says so
  select * into r from public.create_staff_lead(
    '00000000-0000-0000-0000-000000000001', 'פנייה ישנה', '0501110006', null, null, null,
    'existing_client', null, 'client', 'agreement', null, false, true, date '2018-01-01', array['life']);
  if r.duplicate is distinct from 'visible' or r.lead_id not in ('11111111-0000-0000-0000-0000000000c6','11111111-0000-0000-0000-0000000000c7') then
    raise exception 'a visible match in client mode answered % %', r.lead_id, r.duplicate;
  end if;

  -- Israel's month, at its edge
  if public.client_fields_ok(this_month, array['pension']) is not null then
    raise exception 'this month (Israel) was refused';
  end if;
  if public.client_fields_ok((this_month + interval '1 month')::date, array['pension']) is distinct from 'bad_since' then
    raise exception 'next month was accepted';
  end if;

  -- conversion through a merged lead converts the main one, which stays opened as a lead
  v := public.convert_lead_to_client('11111111-0000-0000-0000-0000000000c7', date '2018-01-01', array['life']);
  if v is distinct from '11111111-0000-0000-0000-0000000000c6' then raise exception 'converted % instead of the main lead', v; end if;
  select * into l from public.leads where id = v;
  if l.status <> 'client' or l.client_since <> date '2018-01-01' or l.products <> array['life']
     or l.opened_as <> 'lead' or l.consent_version is not null then
    raise exception 'the conversion wrote % % % % %', l.status, l.client_since, l.products, l.opened_as, l.consent_version;
  end if;
  if not exists (select 1 from public.lead_events e where e.lead_id = v and e.kind = 'status' and e.to_value = 'client') then
    raise exception 'the conversion left no status event';
  end if;
  begin
    perform public.convert_lead_to_client('11111111-0000-0000-0000-0000000000c6', date '2018-01-01', array['crypto']);
    raise exception 'a conversion with an unknown product was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_products' then raise; end if;
  end;

  -- someone else's lead: an error, and nothing changes
  begin
    perform public.convert_lead_to_client('11111111-0000-0000-0000-0000000000c5', date '2018-01-01', array['life']);
    raise exception 'a User converted another member''s lead';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select status from public.leads where id = '11111111-0000-0000-0000-0000000000c5') <> 'new' then
    raise exception 'the refused conversion changed the lead';
  end if;
end $$;

-- an Admin converts any lead of the agency
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$ begin
  if public.convert_lead_to_client('11111111-0000-0000-0000-0000000000c5', date '2020-01-01', array['claims'])
     is distinct from '11111111-0000-0000-0000-0000000000c5' then
    raise exception 'an Admin could not convert a lead of the agency';
  end if;
end $$;
reset role;

rollback;
