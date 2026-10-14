-- Clearinghouse snapshots and review decisions, against a local
-- `supabase start`, in the style of masleka_check.sql: every block raises on a
-- wrong answer, so a clean run is the assertion. Synthetic data; rolled back.
\set ON_ERROR_STOP on
begin;

insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- A staff member of agency 1, a signed-in outsider, a member of agency 2.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001','authenticated','authenticated','ch-staff@example.com'),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000002','authenticated','authenticated','ch-outsider@example.com'),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000004','authenticated','authenticated','ch-other-agency@example.com');

insert into public.memberships (user_id, agency_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'staff'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');

-- One snapshot per agency, and one already past its retention, as the owner.
insert into public.clearinghouse_snapshots (id, agency_id, client_name, taken_at, interface_version, data, delete_after) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'לקוח א', now(), '9.0', '{"accounts":[]}', now() + interval '24 months'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'לקוח ב', now(), '9.0', '{"accounts":[]}', now() + interval '24 months'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'לקוח ישן', now() - interval '25 months', '9.0', '{"accounts":[]}', now() - interval '1 day');
insert into public.clearinghouse_reviews (snapshot_id, finding_key, status) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'no_disability_cover:', 'approved');

-- ── anon sees nothing ───────────────────────────────────────────────────────
set local role anon;
do $$ begin
  begin
    perform 1 from public.clearinghouse_snapshots;
    raise exception 'anon read clearinghouse_snapshots';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.clearinghouse_reviews;
    raise exception 'anon read clearinghouse_reviews';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.clearinghouse_purge();
    raise exception 'anon ran the purge';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── an outsider sees nothing and writes nothing ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.clearinghouse_snapshots) <> 0 then
    raise exception 'an outsider read snapshots';
  end if;
  if (select count(*) from public.clearinghouse_reviews) <> 0 then
    raise exception 'an outsider read reviews';
  end if;
  begin
    insert into public.clearinghouse_reviews (snapshot_id, finding_key, status)
      values ('bbbbbbbb-0000-0000-0000-000000000001', 'x:', 'approved');
    raise exception 'an outsider reviewed a finding';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── staff of agency 1: their agency only; decisions stamped by the database ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.clearinghouse_snapshots) <> 2 then
    raise exception 'staff did not see exactly their agency''s two snapshots';
  end if;
  if exists (select 1 from public.clearinghouse_snapshots where agency_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'staff saw another agency''s snapshot';
  end if;
  if (select count(*) from public.clearinghouse_reviews) <> 0 then
    raise exception 'staff saw another agency''s review';
  end if;

  insert into public.clearinghouse_reviews (snapshot_id, finding_key, status, final_text)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'savings_fee_high:s1', 'approved', 'נוסח של דורית');
  if (select reviewed_by from public.clearinghouse_reviews where finding_key = 'savings_fee_high:s1')
       <> 'eeeeeeee-0000-0000-0000-000000000001' then
    raise exception 'a decision was not stamped with its reviewer';
  end if;
  update public.clearinghouse_reviews set status = 'rejected', final_text = null where finding_key = 'savings_fee_high:s1';
  if (select status from public.clearinghouse_reviews where finding_key = 'savings_fee_high:s1') <> 'rejected' then
    raise exception 'staff could not change a decision';
  end if;

  begin
    insert into public.clearinghouse_reviews (snapshot_id, finding_key, status)
      values ('bbbbbbbb-0000-0000-0000-000000000002', 'x:', 'approved');
    raise exception 'staff reviewed another agency''s snapshot';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.clearinghouse_reviews set reviewed_by = null;
    raise exception 'staff rewrote who reviewed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.clearinghouse_snapshots (client_name, taken_at, interface_version, data, delete_after)
      values ('x', now(), '9.0', '{}', now() + interval '10 years');
    raise exception 'staff set a snapshot''s retention';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.clearinghouse_snapshots set client_name = 'x';
    raise exception 'staff edited a snapshot';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.clearinghouse_snapshots (agency_id, client_name, taken_at, interface_version, data)
      values ('aaaaaaaa-0000-0000-0000-000000000002', 'x', now(), '9.0', '{}');
    raise exception 'staff wrote a snapshot into another agency';
  exception when insufficient_privilege then null;
  end;

  -- A snapshot of their own: written with the default retention, deletable.
  insert into public.clearinghouse_snapshots (client_name, taken_at, interface_version, data)
    values ('לקוח חדש', now(), '9.0', '{"accounts":[]}');
  delete from public.clearinghouse_snapshots where client_name = 'לקוח חדש';
end $$;
reset role;

-- ── the purge takes only what is past retention, with its decisions ────────
insert into public.clearinghouse_reviews (snapshot_id, finding_key, status) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'no_survivors_cover:', 'approved');
do $$ begin
  if public.clearinghouse_purge() <> 1 then
    raise exception 'the purge did not take exactly the one expired snapshot';
  end if;
  if exists (select 1 from public.clearinghouse_snapshots where id = 'bbbbbbbb-0000-0000-0000-000000000003') then
    raise exception 'the expired snapshot survived';
  end if;
  if exists (select 1 from public.clearinghouse_reviews where snapshot_id = 'bbbbbbbb-0000-0000-0000-000000000003') then
    raise exception 'a purged snapshot''s decisions survived';
  end if;
  if (select count(*) from public.clearinghouse_snapshots) <> 2 then
    raise exception 'the purge took a snapshot still in retention';
  end if;
end $$;

rollback;
