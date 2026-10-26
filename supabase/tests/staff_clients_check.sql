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

rollback;
