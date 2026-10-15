-- The clearinghouse pipeline's gate, against a local `supabase start`, in the
-- style of agency_isolation_check.sql: every block raises on a wrong answer,
-- so a clean run is the assertion. Synthetic fixtures only; rolled back.
\set ON_ERROR_STOP on
begin;

insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- A staff member of agency 1 (an Admin since the agency roles: one who sees
-- the whole agency), a signed-in outsider, a platform admin, and a member of
-- agency 2. agency_roles_check.sql covers the User who sees only their own.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000001','authenticated','authenticated','masleka-staff@example.com'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000002','authenticated','authenticated','masleka-outsider@example.com'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000003','authenticated','authenticated','masleka-admin@example.com'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000004','authenticated','authenticated','masleka-other-agency@example.com');

insert into public.memberships (user_id, agency_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');
update public.profiles set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000003';

-- Six requests, as the table owner: invited, invited and expired, a code ten
-- days old, a code two days old, a submission long past the clearinghouse's
-- deletion, and one of agency 2.
insert into public.masleka_requests (id, client_name, token_hash, status, token_expires_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'לקוח מוזמן', repeat('a', 64), 'invited', now() + interval '20 days'),
  ('cccccccc-0000-0000-0000-000000000002', 'לקוח שפג תוקפו', repeat('b', 64), 'invited', now() - interval '1 hour');
insert into public.masleka_requests (id, client_name, token_hash, status, code_ciphertext, id_ciphertext, id_last4, code_received_at) values
  ('cccccccc-0000-0000-0000-000000000003', 'לקוח ישן', repeat('c', 64), 'code_received', 'sealed-code', 'sealed-id', '0018', now() - interval '10 days'),
  ('cccccccc-0000-0000-0000-000000000004', 'לקוח טרי', repeat('d', 64), 'code_received', 'sealed-code', 'sealed-id', '0026', now() - interval '2 days');
insert into public.masleka_requests (id, client_name, token_hash, status, submitted_at, clearinghouse_deletes_at) values
  ('cccccccc-0000-0000-0000-000000000005', 'לקוח שהוגש מזמן', repeat('e', 64), 'submitted', now() - interval '40 days', now() - interval '20 days');
insert into public.masleka_requests (id, agency_id, client_name, token_hash) values
  ('cccccccc-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000002', 'לקוח של סוכנות ב׳', repeat('f', 64));
insert into public.masleka_access_log (request_id, user_id, field) values
  ('cccccccc-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000001', 'id');

-- ── anon: nothing ───────────────────────────────────────────────────────────
set local role anon;
do $$ begin
  begin
    perform count(id) from public.masleka_requests;
    raise exception 'anon read masleka_requests';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(id) from public.masleka_access_log;
    raise exception 'anon read masleka_access_log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.my_agency_role('00000000-0000-0000-0000-000000000001');
    raise exception 'anon called my_agency_role';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.staff_role('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    raise exception 'anon called staff_role';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.masleka_staff_emails('cccccccc-0000-0000-0000-000000000001');
    raise exception 'anon read the staff addresses';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── a signed-in outsider: no rows, no role ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 0 then
    raise exception 'an outsider read clearinghouse requests';
  end if;
  if (select count(id) from public.masleka_access_log) <> 0 then
    raise exception 'an outsider read the access log';
  end if;
  if public.my_agency_role('00000000-0000-0000-0000-000000000001') is not null then
    raise exception 'an outsider has a staff role';
  end if;
  begin
    perform public.staff_role('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    raise exception 'authenticated called staff_role directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.masleka_staff_emails('cccccccc-0000-0000-0000-000000000001');
    raise exception 'authenticated read the staff addresses';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.masleka_wipe_stale();
    raise exception 'authenticated ran the wipe';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── the agency-1 staff member: their agency's rows, never the secrets ───────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 5 then
    raise exception 'staff member does not see exactly agency 1''s five requests';
  end if;
  if (select count(id) from public.masleka_access_log) <> 1 then
    raise exception 'staff member cannot read the access log';
  end if;
  if public.my_agency_role('00000000-0000-0000-0000-000000000001') is distinct from 'admin' then
    raise exception 'staff member''s role is not admin';
  end if;
  begin
    perform code_ciphertext from public.masleka_requests limit 1;
    raise exception 'staff member read code_ciphertext through the Data API role';
  exception when insufficient_privilege then null;
  end;
  begin
    perform id_ciphertext from public.masleka_requests limit 1;
    raise exception 'staff member read id_ciphertext';
  exception when insufficient_privilege then null;
  end;
  begin
    perform token_hash from public.masleka_requests limit 1;
    raise exception 'staff member read token_hash';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.masleka_requests set status = 'cancelled' where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'staff member wrote a request directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.masleka_requests (client_name, token_hash) values ('מזויף', repeat('9', 64));
    raise exception 'staff member inserted a request directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── a member of agency 2: only their own agency's row ──────────────────────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 1 then
    raise exception 'agency 2 member does not see exactly their own request';
  end if;
  if public.my_agency_role('00000000-0000-0000-0000-000000000001') is not null then
    raise exception 'agency 2 member counts as agency 1 staff';
  end if;
end $$;

-- ── the platform admin: everything ─────────────────────────────────────────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 6 then
    raise exception 'platform admin cannot read every request';
  end if;
  -- The operator holds no agency role; is_admin() is theirs.
  if public.my_agency_role('00000000-0000-0000-0000-000000000001') is not null or not public.is_admin() then
    raise exception 'the platform operator reads as an agency member, or not as the operator';
  end if;
end $$;
reset role;

-- ── the staff mailing list ─────────────────────────────────────────────────
do $$
declare
  list text[] := public.masleka_staff_emails('cccccccc-0000-0000-0000-000000000001');
begin
  -- The agency's Admins and Owners (and the handler, none here); not the
  -- platform operator, who belongs to no agency.
  if not (list @> array['masleka-staff@example.com']) then
    raise exception 'staff addresses miss the agency admin: %', list;
  end if;
  -- With no request, agency 1's Admins and Owners alone.
  if not (public.masleka_staff_emails(null) @> array['masleka-staff@example.com'])
     or 'masleka-other-agency@example.com' = any(public.masleka_staff_emails(null)) then
    raise exception 'the no-request list is not agency 1''s Admins and Owners: %', public.masleka_staff_emails(null);
  end if;
  if 'masleka-outsider@example.com' = any(list) or 'masleka-other-agency@example.com' = any(list)
     or 'masleka-admin@example.com' = any(list) then
    raise exception 'staff addresses include someone who is not staff: %', list;
  end if;
end $$;

-- ── service_role alone may ask who is staff ────────────────────────────────
set local role service_role;
do $$ begin
  if public.staff_role('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001') is distinct from 'admin' then
    raise exception 'service_role cannot ask staff_role';
  end if;
  if cardinality(public.masleka_staff_emails('cccccccc-0000-0000-0000-000000000001')) < 1 then
    raise exception 'service_role cannot read the staff addresses';
  end if;
end $$;
reset role;

-- ── ciphertext outside code_received is refused by the table ───────────────
do $$ begin
  begin
    update public.masleka_requests set status = 'submitted' where id = 'cccccccc-0000-0000-0000-000000000004';
    raise exception 'a request moved to submitted while still holding ciphertext';
  exception when check_violation then null;
  end;
  begin
    update public.masleka_requests set code_ciphertext = null, status = 'submitted' where id = 'cccccccc-0000-0000-0000-000000000004';
    raise exception 'a request moved to submitted while still holding the ID ciphertext';
  exception when check_violation then null;
  end;
  begin
    update public.masleka_requests set id_ciphertext = 'sealed-id' where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'an invited request took ciphertext';
  exception when check_violation then null;
  end;
end $$;

-- ── the access log is append-only, even for service_role ───────────────────
set local role service_role;
do $$ begin
  begin
    update public.masleka_access_log set field = 'code';
    raise exception 'service_role updated the access log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.masleka_access_log;
    raise exception 'service_role deleted from the access log';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.masleka_access_log;
    raise exception 'service_role truncated the access log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.masleka_requests;
    raise exception 'service_role deleted requests';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.masleka_requests;
    raise exception 'service_role truncated requests';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Deleting a request (as the owner) keeps its audit rows, unlinked.
do $$ begin
  insert into public.masleka_requests (id, client_name, token_hash) values
    ('cccccccc-0000-0000-0000-000000000007', 'לקוח למחיקה', repeat('7', 64));
  insert into public.masleka_access_log (request_id, user_id, field) values
    ('cccccccc-0000-0000-0000-000000000007', 'dddddddd-0000-0000-0000-000000000001', 'code');
  delete from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000007';
  if (select count(*) from public.masleka_access_log where request_id is null) <> 1 then
    raise exception 'the access log row did not survive its request with a null request_id';
  end if;
end $$;

-- ── the nine-day wipe ───────────────────────────────────────────────────────
do $$ begin
  if public.masleka_wipe_stale() <> 1 then
    raise exception 'the wipe did not touch exactly the one stale request';
  end if;
  if exists (select 1 from public.masleka_requests
              where id = 'cccccccc-0000-0000-0000-000000000003'
                and (code_ciphertext is not null or id_ciphertext is not null or status <> 'expired' or ciphertext_wiped_at is null)) then
    raise exception 'the stale request kept its ciphertext or its status';
  end if;
  if not exists (select 1 from public.masleka_requests
                  where id = 'cccccccc-0000-0000-0000-000000000004'
                    and code_ciphertext is not null and status = 'code_received') then
    raise exception 'the wipe touched a request only two days old';
  end if;
  if public.masleka_wipe_stale() <> 0 then
    raise exception 'a second wipe found something to do';
  end if;
end $$;

-- ── expiry ─────────────────────────────────────────────────────────────────
do $$ begin
  if public.masleka_expire() <> 2 then
    raise exception 'expiry did not touch exactly the expired link and the long-gone submission';
  end if;
  if (select status from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000002') <> 'expired' then
    raise exception 'an expired link stayed invited';
  end if;
  if (select status from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000005') <> 'expired' then
    raise exception 'a submission two weeks past the clearinghouse''s deletion stayed submitted';
  end if;
  if (select status from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000001') <> 'invited' then
    raise exception 'expiry touched a link that is still valid';
  end if;
end $$;

-- ── the wipe's footprint, which masleka-remind announces (20261019000000) ──
-- After the wipe and the expiry, exactly the stale code matches the remind
-- run's filter; the expired link (no code) and the old submission do not.
set local role service_role;
do $$ begin
  if (select array_agg(id) from public.masleka_requests
       where status = 'expired' and code_received_at is not null
         and submitted_at is null and wipe_notified_at is null)
     is distinct from array['cccccccc-0000-0000-0000-000000000003'::uuid] then
    raise exception 'the wipe notice would not name exactly the stale unsubmitted request';
  end if;
  update public.masleka_requests set wipe_notified_at = now()
   where id = 'cccccccc-0000-0000-0000-000000000003' and wipe_notified_at is null;
  if not found then
    raise exception 'service_role could not claim the wipe notice';
  end if;
end $$;
reset role;

-- The board's role cannot read the marker: it is not among the granted columns.
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  begin
    perform wipe_notified_at from public.masleka_requests limit 1;
    raise exception 'staff member read wipe_notified_at, which is not granted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── the remind call does nothing without its Vault secrets ─────────────────
do $$ begin
  perform public.masleka_call_remind();
end $$;

-- ── the schedules, where pg_cron exists ────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'masleka-housekeeping') then
      raise exception 'masleka-housekeeping is not scheduled';
    end if;
    if exists (select 1 from pg_extension where extname = 'pg_net')
       and not exists (select 1 from cron.job where jobname = 'masleka-remind') then
      raise exception 'masleka-remind is not scheduled';
    end if;
  end if;
end $$;

rollback;
