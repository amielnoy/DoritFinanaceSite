-- Agency roles (20261029000000_agency_roles_additive.sql, and the narrowing
-- in 20261030000000_agency_roles_narrowing.sql), checked in PostgreSQL.
-- Run against a local `supabase start` after the migrations, as
-- agency_isolation_check.sql. Synthetic fixtures only; every change is rolled
-- back, and every block raises on a wrong answer, so a clean run is the
-- assertion.
\set ON_ERROR_STOP on
begin;

-- ── fixtures ───────────────────────────────────────────────────────────────
-- Agency A is a fresh agency (not the real agency 1); B is another; S is
-- suspended.
insert into public.agencies (id, name, status) values
  ('cccccccc-0000-0000-0000-00000000000a', 'סוכנות א׳', 'active'),
  ('cccccccc-0000-0000-0000-00000000000b', 'סוכנות ב׳', 'active'),
  ('cccccccc-0000-0000-0000-00000000000c', 'סוכנות מושעית', 'suspended');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000001','authenticated','authenticated','owner@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000002','authenticated','authenticated','admin@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000003','authenticated','authenticated','user1@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000004','authenticated','authenticated','user2@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000005','authenticated','authenticated','outsider@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000006','authenticated','authenticated','operator@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000007','authenticated','authenticated','suspended@roles.test', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000008','authenticated','authenticated','owner-b@roles.test', now());

update public.profiles set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000006';

insert into public.memberships (user_id, agency_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000a', 'owner'),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-00000000000a', 'admin'),
  ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-00000000000a', 'user'),
  ('dddddddd-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-00000000000a', 'user'),
  ('dddddddd-0000-0000-0000-000000000007', 'cccccccc-0000-0000-0000-00000000000c', 'owner'),
  ('dddddddd-0000-0000-0000-000000000008', 'cccccccc-0000-0000-0000-00000000000b', 'owner');

insert into public.leads (id, name, phone, agency_id, assigned_user_id) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'של משתמש 1', '050-000-3001', 'cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000003'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'של משתמש 2', '050-000-3002', 'cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000004'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'לא שויך',     '050-000-3003', 'cccccccc-0000-0000-0000-00000000000a', null),
  ('eeeeeeee-0000-0000-0000-000000000004', 'של ב׳',       '050-000-3004', 'cccccccc-0000-0000-0000-00000000000b', null),
  ('eeeeeeee-0000-0000-0000-000000000005', 'של מושעית',   '050-000-3005', 'cccccccc-0000-0000-0000-00000000000c', null);

-- Runs `sql` as the current role and passes only if it raises `message`.
create function pg_temp.expect_error(sql text, message text) returns void
  language plpgsql as $$
declare
  v_got text;
begin
  begin
    execute sql;
  exception when others then
    v_got := sqlerrm;
  end;
  if v_got is null then
    raise exception 'expected % but it succeeded: %', message, sql;
  elsif v_got <> message then
    raise exception 'expected %, got % from: %', message, v_got, sql;
  end if;
end $$;

-- ── who holds what ─────────────────────────────────────────────────────────
set local role authenticated;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if public.agency_role('cccccccc-0000-0000-0000-00000000000a') is distinct from 'owner'
     or not public.has_role('cccccccc-0000-0000-0000-00000000000a', 'owner')
     or not public.has_role('cccccccc-0000-0000-0000-00000000000a', 'user') then
    raise exception 'the owner does not hold owner';
  end if;
  if public.has_role('cccccccc-0000-0000-0000-00000000000b', 'user') then
    raise exception 'an owner of A holds a role in B';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if not public.has_role('cccccccc-0000-0000-0000-00000000000a', 'admin')
     or public.has_role('cccccccc-0000-0000-0000-00000000000a', 'owner') then
    raise exception 'admin ranks wrong';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if not public.has_role('cccccccc-0000-0000-0000-00000000000a', 'user')
     or public.has_role('cccccccc-0000-0000-0000-00000000000a', 'admin') then
    raise exception 'user ranks wrong';
  end if;
  if public.has_role('cccccccc-0000-0000-0000-00000000000a', 'nonsense') then
    raise exception 'an unknown minimum was met';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000007","role":"authenticated"}';
do $$ begin
  if public.agency_role('cccccccc-0000-0000-0000-00000000000c') is not null
     or public.has_role('cccccccc-0000-0000-0000-00000000000c', 'user') then
    raise exception 'a suspended agency still gives its owner a role';
  end if;
  if public.can_see_lead('eeeeeeee-0000-0000-0000-000000000005') then
    raise exception 'a suspended agency still shows its leads';
  end if;
end $$;

-- ── can_see_lead ───────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if not public.can_see_lead('eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'a user cannot see their own lead';
  end if;
  if public.can_see_lead('eeeeeeee-0000-0000-0000-000000000002')
     or public.can_see_lead('eeeeeeee-0000-0000-0000-000000000003')
     or public.can_see_lead('eeeeeeee-0000-0000-0000-000000000004') then
    raise exception 'a user sees a lead not assigned to them';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if not (public.can_see_lead('eeeeeeee-0000-0000-0000-000000000001')
      and public.can_see_lead('eeeeeeee-0000-0000-0000-000000000002')
      and public.can_see_lead('eeeeeeee-0000-0000-0000-000000000003')) then
    raise exception 'an admin does not see every lead of the agency';
  end if;
  if public.can_see_lead('eeeeeeee-0000-0000-0000-000000000004') then
    raise exception 'an admin of A sees a lead of B';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
  if public.can_see_lead('eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'a non-member sees a lead';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000006","role":"authenticated"}';
do $$ begin
  if not (public.can_see_lead('eeeeeeee-0000-0000-0000-000000000004')
      and public.can_see_lead('eeeeeeee-0000-0000-0000-000000000005')) then
    raise exception 'the operator does not see every lead';
  end if;
end $$;

-- ── the leads trigger ──────────────────────────────────────────────────────
-- Run as the table owner with a person's session, so the policies (narrowed
-- in step 2) do not hide the row and only the trigger decides. The trigger
-- tells a person from the server by current_user, so these use `authenticated`.
reset role;
grant update on public.leads to authenticated;
set local role authenticated;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare v_count int;
begin
  perform pg_temp.expect_error(
    $q$update public.leads set assigned_user_id = 'dddddddd-0000-0000-0000-000000000004' where id = 'eeeeeeee-0000-0000-0000-000000000001'$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$update public.leads set assigned_user_id = null where id = 'eeeeeeee-0000-0000-0000-000000000001'$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$update public.leads set assigned_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000001'$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$update public.leads set agency_id = 'cccccccc-0000-0000-0000-00000000000b' where id = 'eeeeeeee-0000-0000-0000-000000000001'$q$,
    'agency_fixed');
  -- Working the lead is not assigning it.
  update public.leads set status = 'contacted' where id = 'eeeeeeee-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'a user cannot change the status of their own lead'; end if;
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare v_lead record;
begin
  update public.leads set assigned_user_id = 'dddddddd-0000-0000-0000-000000000004'
   where id = 'eeeeeeee-0000-0000-0000-000000000003';
  select assigned_user_id, assigned_at, assigned_by into v_lead
    from public.leads where id = 'eeeeeeee-0000-0000-0000-000000000003';
  if v_lead.assigned_user_id is distinct from 'dddddddd-0000-0000-0000-000000000004'
     or v_lead.assigned_at is null
     or v_lead.assigned_by is distinct from 'dddddddd-0000-0000-0000-000000000002' then
    raise exception 'an admin assignment did not record when and by whom';
  end if;
  perform pg_temp.expect_error(
    $q$update public.leads set assigned_user_id = 'dddddddd-0000-0000-0000-000000000005' where id = 'eeeeeeee-0000-0000-0000-000000000003'$q$,
    'assignee_not_member');
  perform pg_temp.expect_error(
    $q$update public.leads set assigned_user_id = 'dddddddd-0000-0000-0000-000000000008' where id = 'eeeeeeee-0000-0000-0000-000000000003'$q$,
    'assignee_not_member');
  perform pg_temp.expect_error(
    $q$update public.leads set agency_id = 'cccccccc-0000-0000-0000-00000000000b' where id = 'eeeeeeee-0000-0000-0000-000000000003'$q$,
    'agency_fixed');
  -- The history columns are the trigger's: a direct write leaves them as they were.
  update public.leads set assigned_by = 'dddddddd-0000-0000-0000-000000000005', assigned_at = '2000-01-01'
   where id = 'eeeeeeee-0000-0000-0000-000000000003';
  if exists (select 1 from public.leads where id = 'eeeeeeee-0000-0000-0000-000000000003'
              and (assigned_by is distinct from 'dddddddd-0000-0000-0000-000000000002' or assigned_at < '2001-01-01')) then
    raise exception 'assigned_at/assigned_by took a direct write';
  end if;
  update public.leads set assigned_user_id = null where id = 'eeeeeeee-0000-0000-0000-000000000003';
  if exists (select 1 from public.leads where id = 'eeeeeeee-0000-0000-0000-000000000003'
              and (assigned_at is not null or assigned_by is not null)) then
    raise exception 'unassigning left history on an unassigned lead';
  end if;
end $$;

-- The server (service_role) assigns without a session, to a member only.
reset role;
grant update on public.leads to service_role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$ begin
  update public.leads set assigned_user_id = 'dddddddd-0000-0000-0000-000000000003'
   where id = 'eeeeeeee-0000-0000-0000-000000000003';
  perform pg_temp.expect_error(
    $q$update public.leads set assigned_user_id = 'dddddddd-0000-0000-0000-000000000005' where id = 'eeeeeeee-0000-0000-0000-000000000003'$q$,
    'assignee_not_member');
  update public.leads set assigned_user_id = null where id = 'eeeeeeee-0000-0000-0000-000000000003';
end $$;

-- ── set_member_role ────────────────────────────────────────────────────────
reset role;
set local role authenticated;

-- A User manages nobody.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005', 'user')$q$,
    'forbidden');
end $$;

-- An Admin adds and keeps Users, and touches nothing above a User.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005', 'user');
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005', 'admin')$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000002', 'owner')$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001', 'user')$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-000000000005', 'user')$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005', 'agent')$q$,
    'invalid_role');
end $$;

-- The audit: the Admin reads it, a User does not, and the add was recorded.
do $$ begin
  if not exists (select 1 from public.membership_events
                  where agency_id = 'cccccccc-0000-0000-0000-00000000000a'
                    and target_user_id = 'dddddddd-0000-0000-0000-000000000005'
                    and action = 'added' and new_role = 'user'
                    and actor_id = 'dddddddd-0000-0000-0000-000000000002') then
    raise exception 'the add was not recorded, or the admin cannot read it';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.membership_events) then
    raise exception 'a user reads the membership history';
  end if;
end $$;

-- The Owner may do anything inside the agency, nothing outside it.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  perform public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000004', 'admin');
  if not exists (select 1 from public.membership_events
                  where target_user_id = 'dddddddd-0000-0000-0000-000000000004'
                    and action = 'role_changed' and old_role = 'user' and new_role = 'admin') then
    raise exception 'the promotion was not recorded';
  end if;
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-000000000005', 'user')$q$,
    'forbidden');
  -- The last Owner cannot step down.
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001', 'admin')$q$,
    'last_owner');
end $$;

-- An Admin cannot change another Admin (now user2), nor remove one.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform pg_temp.expect_error(
    $q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000004', 'user')$q$,
    'forbidden');
  perform pg_temp.expect_error(
    $q$select public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000004')$q$,
    'forbidden');
end $$;

-- The operator acts in any agency, with no membership.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000006","role":"authenticated"}';
do $$ begin
  perform public.set_member_role('cccccccc-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-000000000005', 'user');
end $$;

-- ── remove_member and leave ────────────────────────────────────────────────
-- A User leaves: their lead goes back to the queue.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  perform pg_temp.expect_error(
    $q$select public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005')$q$,
    'forbidden');
  perform public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000003');
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.memberships
              where user_id = 'dddddddd-0000-0000-0000-000000000003'
                and agency_id = 'cccccccc-0000-0000-0000-00000000000a') then
    raise exception 'leaving left the membership';
  end if;
  if exists (select 1 from public.leads where id = 'eeeeeeee-0000-0000-0000-000000000001' and assigned_user_id is not null) then
    raise exception 'leaving left the lead assigned';
  end if;
  if not exists (select 1 from public.membership_events
                  where target_user_id = 'dddddddd-0000-0000-0000-000000000003' and action = 'left') then
    raise exception 'leaving was not recorded';
  end if;
end $$;
set local role authenticated;

-- An Admin removes a User; the Owner cannot remove themselves while last.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005');
  perform pg_temp.expect_error(
    $q$select public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005')$q$,
    'not_found');
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  perform pg_temp.expect_error(
    $q$select public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001')$q$,
    'last_owner');
  -- Transfer: make the Admin an Owner, then step down.
  perform public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000002', 'owner');
  perform public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001', 'admin');
end $$;

-- ── execution grants ───────────────────────────────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  perform pg_temp.expect_error($q$select public.has_role('cccccccc-0000-0000-0000-00000000000a', 'user')$q$,
    'permission denied for function has_role');
  perform pg_temp.expect_error($q$select public.can_see_lead('eeeeeeee-0000-0000-0000-000000000001')$q$,
    'permission denied for function can_see_lead');
  perform pg_temp.expect_error($q$select public.set_member_role('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005', 'user')$q$,
    'permission denied for function set_member_role');
  perform pg_temp.expect_error($q$select public.remove_member('cccccccc-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000005')$q$,
    'permission denied for function remove_member');
end $$;

-- ── cascades are not demotions ─────────────────────────────────────────────
reset role;
do $$ begin
  delete from public.leads where agency_id = 'cccccccc-0000-0000-0000-00000000000b';
  delete from public.agencies where id = 'cccccccc-0000-0000-0000-00000000000b';
  delete from auth.users where id = 'dddddddd-0000-0000-0000-000000000007';
end $$;

rollback;
