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

-- Everything that hangs off a lead, in agency A: user1's (lead 1), user2's
-- (lead 2), and lead-less work by each.
insert into public.leads (id, name, phone, agency_id) values
  ('eeeeeeee-0000-0000-0000-000000000006', 'למחיקה', '050-000-3006', 'cccccccc-0000-0000-0000-00000000000a');
insert into public.meetings (lead_id, agency_id, scheduled_at) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000a', now() + interval '1 day'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-00000000000a', now() + interval '2 days');
insert into public.contacts (phone, name, agency_id) values ('050-000-4001', 'איש קשר', 'cccccccc-0000-0000-0000-00000000000a');
insert into public.chat_conversations (id, agency_id, role, token_hash, consent_version, consent_at, lead_id) values
  ('ffffffff-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-00000000000a', 'interview', repeat('1', 64), 'v1', now(), 'eeeeeeee-0000-0000-0000-000000000001'),
  ('ffffffff-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-00000000000a', 'interview', repeat('2', 64), 'v1', now(), 'eeeeeeee-0000-0000-0000-000000000002'),
  ('ffffffff-0000-0000-0000-0000000000c3', 'cccccccc-0000-0000-0000-00000000000a', 'support',   repeat('3', 64), 'v1', now(), null);
insert into public.chat_messages (conversation_id, agency_id, role, content) values
  ('ffffffff-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-00000000000a', 'user', 'שלום 1'),
  ('ffffffff-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-00000000000a', 'user', 'שלום 2'),
  ('ffffffff-0000-0000-0000-0000000000c3', 'cccccccc-0000-0000-0000-00000000000a', 'user', 'שלום 3');
insert into public.masleka_requests (id, agency_id, lead_id, client_name, token_hash, created_by) values
  ('ffffffff-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-000000000001', 'בקשה 1', repeat('4', 64), 'dddddddd-0000-0000-0000-000000000002'),
  ('ffffffff-0000-0000-0000-0000000000a2', 'cccccccc-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-000000000002', 'בקשה 2', repeat('5', 64), 'dddddddd-0000-0000-0000-000000000002'),
  ('ffffffff-0000-0000-0000-0000000000a3', 'cccccccc-0000-0000-0000-00000000000a', null, 'בקשה בלי פנייה 1', repeat('6', 64), 'dddddddd-0000-0000-0000-000000000003'),
  ('ffffffff-0000-0000-0000-0000000000a4', 'cccccccc-0000-0000-0000-00000000000a', null, 'בקשה בלי פנייה 2', repeat('7', 64), 'dddddddd-0000-0000-0000-000000000004');
insert into public.masleka_access_log (agency_id, request_id, user_id, field) values
  ('cccccccc-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-000000000003', 'id'),
  ('cccccccc-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-0000000000a2', 'dddddddd-0000-0000-0000-000000000004', 'code');
insert into public.clearinghouse_snapshots (id, agency_id, request_id, lead_id, client_name, taken_at, interface_version, data, created_by) values
  ('ffffffff-0000-0000-0000-0000000000b1', 'cccccccc-0000-0000-0000-00000000000a', null, 'eeeeeeee-0000-0000-0000-000000000001', 'צילום 1', now(), '1', '{}', 'dddddddd-0000-0000-0000-000000000002'),
  ('ffffffff-0000-0000-0000-0000000000b2', 'cccccccc-0000-0000-0000-00000000000a', null, 'eeeeeeee-0000-0000-0000-000000000002', 'צילום 2', now(), '1', '{}', 'dddddddd-0000-0000-0000-000000000002'),
  ('ffffffff-0000-0000-0000-0000000000b3', 'cccccccc-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-0000000000a3', null, 'צילום בלי פנייה', now(), '1', '{}', null);
insert into public.clearinghouse_published_items (snapshot_id, position, title, body, priority) values
  ('ffffffff-0000-0000-0000-0000000000b1', 0, 'המלצה', 'גוף', 'check'),
  ('ffffffff-0000-0000-0000-0000000000b2', 0, 'המלצה', 'גוף', 'check');
insert into public.agency_profiles (agency_id, display_name, phone_e164, phone_display, whatsapp, email,
  default_whatsapp_message, licence_entity, licence_number, licence_regulator) values
  ('cccccccc-0000-0000-0000-00000000000a', 'סוכנות א׳', '+972500000000', '050-000-0000', '972500000000', 'a@roles.test', 'שלום', 'ישות', 'L-1', 'רשות');
insert into public.blog_posts (title, body, published, agency_id, slug) values
  ('מאמר מפורסם', 'תוכן', true, 'cccccccc-0000-0000-0000-00000000000a', 'roles-published');

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

-- ── the narrowed policies: who reads and writes what ───────────────────────
reset role;
set local role authenticated;

-- A User: their own lead and everything hanging off it, nothing else.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare v_count int;
begin
  if (select array_agg(id::text order by id) from public.leads) is distinct from array['eeeeeeee-0000-0000-0000-000000000001'] then
    raise exception 'a user reads leads other than their own';
  end if;
  if (select count(*) from public.meetings) <> 1
     or not exists (select 1 from public.meetings where lead_id = 'eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'a user reads a meeting not on their lead';
  end if;
  if (select array_agg(id::text) from public.chat_conversations) is distinct from array['ffffffff-0000-0000-0000-0000000000c1']
     or (select array_agg(content) from public.chat_messages) is distinct from array['שלום 1']
     or exists (select 1 from public.chat_usage where conversation_id <> 'ffffffff-0000-0000-0000-0000000000c1') then
    raise exception 'a user reads a chat not on their lead, or one with no lead';
  end if;
  if (select array_agg(id::text order by id) from public.masleka_requests)
     is distinct from array['ffffffff-0000-0000-0000-0000000000a1', 'ffffffff-0000-0000-0000-0000000000a3'] then
    raise exception 'a user reads a clearinghouse request that is not theirs';
  end if;
  if (select array_agg(id::text order by id) from public.clearinghouse_snapshots)
     is distinct from array['ffffffff-0000-0000-0000-0000000000b1', 'ffffffff-0000-0000-0000-0000000000b3']
     or (select count(*) from public.clearinghouse_published_items) <> 1 then
    raise exception 'a user reads a snapshot that is not theirs';
  end if;
  if (select array_agg(user_id::text) from public.masleka_access_log) is distinct from array['dddddddd-0000-0000-0000-000000000003'] then
    raise exception 'a user reads someone else''s reveals';
  end if;
  if exists (select 1 from public.contacts) then
    raise exception 'a user reads contacts';
  end if;
  -- Their own lead: work it, not delete it; another's: not even touch it.
  update public.leads set status = 'contacted' where id = 'eeeeeeee-0000-0000-0000-000000000002';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'a user changed another user''s lead'; end if;
  delete from public.leads where id = 'eeeeeeee-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'a user deleted a lead'; end if;
  -- Publishing the analysis of their own lead, not another's.
  perform public.clearinghouse_publish('ffffffff-0000-0000-0000-0000000000b1', 'client@roles.test',
    '[{"title":"t","body":"b","priority":"check"}]');
  perform pg_temp.expect_error(
    $q$select public.clearinghouse_publish('ffffffff-0000-0000-0000-0000000000b2', 'client@roles.test', '[{"title":"t","body":"b","priority":"check"}]')$q$,
    'not_found');
  -- The agency profile: read, never written.
  if not exists (select 1 from public.agency_profiles where agency_id = 'cccccccc-0000-0000-0000-00000000000a') then
    raise exception 'a user cannot read the agency profile';
  end if;
  update public.agency_profiles set display_name = 'שונה' where agency_id = 'cccccccc-0000-0000-0000-00000000000a';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'a user changed the agency profile'; end if;
  -- Articles: drafts only.
  insert into public.blog_posts (title, body, published, agency_id, slug) values ('טיוטה', 'תוכן', false, 'cccccccc-0000-0000-0000-00000000000a', 'roles-draft');
  perform pg_temp.expect_error(
    $q$insert into public.blog_posts (title, body, published, agency_id, slug) values ('פרסום', 'תוכן', true, 'cccccccc-0000-0000-0000-00000000000a', 'roles-user-publish')$q$,
    'new row violates row-level security policy for table "blog_posts"');
  update public.blog_posts set title = 'שונה' where slug = 'roles-published';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'a user changed a published article'; end if;
  perform pg_temp.expect_error(
    $q$update public.blog_posts set published = true where slug = 'roles-draft'$q$,
    'new row violates row-level security policy for table "blog_posts"');
  perform pg_temp.expect_error(
    $q$insert into public.testimonials (name, quote, agency_id) values ('לקוחה', 'טוב', 'cccccccc-0000-0000-0000-00000000000a')$q$,
    'new row violates row-level security policy for table "testimonials"');
  -- Members: seen, with their addresses; never written directly.
  if (select count(*) from public.memberships where agency_id = 'cccccccc-0000-0000-0000-00000000000a') <> 4
     or (select count(*) from public.profiles p
          where p.id in (select user_id from public.memberships where agency_id = 'cccccccc-0000-0000-0000-00000000000a')) <> 4 then
    raise exception 'a user does not see the agency''s members and their profiles';
  end if;
  if exists (select 1 from public.profiles where id = 'dddddddd-0000-0000-0000-000000000005') then
    raise exception 'a user reads the profile of someone outside their agencies';
  end if;
  perform pg_temp.expect_error(
    $q$insert into public.memberships (user_id, agency_id, role) values ('dddddddd-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-00000000000a', 'user')$q$,
    'permission denied for table memberships');
end $$;

-- An Admin: the whole agency, its contacts and testimonials; not the profile.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare v_count int;
begin
  if (select count(*) from public.leads) <> 4 or (select count(*) from public.meetings) <> 2
     or (select count(*) from public.chat_conversations) <> 3 or (select count(*) from public.masleka_requests) <> 4
     or (select count(*) from public.clearinghouse_snapshots) <> 3 or (select count(*) from public.masleka_access_log) <> 2
     or (select count(*) from public.contacts) <> 1 then
    raise exception 'an admin does not read the whole agency';
  end if;
  perform public.clearinghouse_publish('ffffffff-0000-0000-0000-0000000000b2', 'client@roles.test',
    '[{"title":"t","body":"b","priority":"check"}]');
  insert into public.testimonials (name, quote, agency_id) values ('לקוחה', 'טוב', 'cccccccc-0000-0000-0000-00000000000a');
  update public.blog_posts set published = true where slug = 'roles-draft';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'an admin cannot publish'; end if;
  update public.agency_profiles set display_name = 'שונה' where agency_id = 'cccccccc-0000-0000-0000-00000000000a';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'an admin changed the agency profile'; end if;
  delete from public.leads where id = 'eeeeeeee-0000-0000-0000-000000000006';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'an admin cannot delete a lead'; end if;
  perform pg_temp.expect_error(
    $q$update public.memberships set role = 'owner' where user_id = 'dddddddd-0000-0000-0000-000000000002'$q$,
    'permission denied for table memberships');
end $$;

-- The Owner: the agency profile is theirs.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare v_count int;
begin
  update public.agency_profiles set display_name = 'סוכנות א׳ — חדש' where agency_id = 'cccccccc-0000-0000-0000-00000000000a';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'the owner cannot change the agency profile'; end if;
end $$;

-- A non-member and a suspended agency's Owner: nothing.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.leads) or exists (select 1 from public.meetings)
     or exists (select 1 from public.chat_conversations) or exists (select 1 from public.masleka_requests)
     or exists (select 1 from public.clearinghouse_snapshots) or exists (select 1 from public.contacts)
     or exists (select 1 from public.memberships where agency_id = 'cccccccc-0000-0000-0000-00000000000a') then
    raise exception 'a non-member reads an agency''s data';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000007","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.leads) or exists (select 1 from public.agencies where id = 'cccccccc-0000-0000-0000-00000000000c') then
    raise exception 'a suspended agency''s owner still reads it';
  end if;
end $$;

-- The operator: every agency, suspended included.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000006","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.leads where agency_id in ('cccccccc-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-00000000000c')) <> 5 then
    raise exception 'the operator does not read every agency''s leads';
  end if;
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
