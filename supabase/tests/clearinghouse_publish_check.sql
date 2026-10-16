-- Publishing a snapshot and a client's answers, against a local
-- `supabase start`, in the style of clearinghouse_analysis_check.sql: every
-- block raises on a wrong answer, so a clean run is the assertion. Synthetic
-- data; rolled back.
\set ON_ERROR_STOP on
begin;

insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- Staff of agency 1; a client with a confirmed address; a client whose
-- address is not confirmed; a member of agency 2.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000001','authenticated','authenticated','pub-staff@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000002','authenticated','authenticated','client@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000003','authenticated','authenticated','unconfirmed@example.com', null),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-0000-0000-000000000004','authenticated','authenticated','pub-other@example.com', now());

insert into public.memberships (user_id, agency_id, role) values
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('ffffffff-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');

insert into public.clearinghouse_snapshots (id, agency_id, client_name, taken_at, interface_version, data) values
  ('bbbbbbbb-1111-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'לקוח', now(), '9.0', '{"accounts":[],"secret_note":"x"}');

-- ── staff publish; another agency cannot ───────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  begin
    perform public.clearinghouse_publish('bbbbbbbb-1111-0000-0000-000000000001', 'client@example.com',
      '[{"title":"t","body":"b","priority":"check"}]');
    raise exception 'another agency published a snapshot';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  begin
    perform public.clearinghouse_publish('bbbbbbbb-1111-0000-0000-000000000001', 'not an address', '[{"title":"t","body":"b","priority":"check"}]');
    raise exception 'published to a non-address';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.clearinghouse_publish('bbbbbbbb-1111-0000-0000-000000000001', 'client@example.com', '[]');
    raise exception 'published nothing';
  exception when invalid_parameter_value then null;
  end;
  perform public.clearinghouse_publish('bbbbbbbb-1111-0000-0000-000000000001', ' Client@Example.com ',
    '[{"title":"דמי ניהול","body":"נבקש הפחתה","priority":"important"},{"title":"כיסוי","body":"נבדוק","priority":"check"}]');
  if (select count(*) from public.clearinghouse_published_items) <> 2 then
    raise exception 'staff did not see the two published items';
  end if;
  if (select client_email from public.clearinghouse_snapshots) <> 'client@example.com' then
    raise exception 'the address was not normalised';
  end if;
  begin
    update public.clearinghouse_published_items set client_status = 'accepted';
    raise exception 'staff answered for the client';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.snapshot_for('client@example.com');
    raise exception 'staff called snapshot_for';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── the client reads their own snapshot and answers ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v jsonb := public.my_snapshot();
  v_item uuid;
begin
  if v is null or jsonb_array_length(v->'items') <> 2 then
    raise exception 'the client did not get their snapshot with two items';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v) k) <> array['data','items','published_at','taken_at'] then
    raise exception 'my_snapshot returned keys beyond the allowed four';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v->'items'->0) k)
       <> array['body','client_note','client_status','id','priority','title'] then
    raise exception 'an item carried keys beyond the allowed six';
  end if;
  if (v->'items'->0->>'title') <> 'דמי ניהול' then
    raise exception 'items are not in the published order';
  end if;
  v_item := (v->'items'->1->>'id')::uuid;
  perform public.respond_to_recommendation(v_item, 'question', 'מה זה אומר?');
  if (public.my_snapshot()->'items'->1->>'client_status') <> 'question' then
    raise exception 'the answer did not stick';
  end if;
  begin
    perform public.respond_to_recommendation(v_item, 'deleted', null);
    raise exception 'an unknown status was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform 1 from public.clearinghouse_published_items;
    if found then raise exception 'the client read the items table directly'; end if;
  end;
  begin
    perform 1 from public.clearinghouse_snapshots;
    if found then raise exception 'the client read the snapshots table directly'; end if;
  end;
end $$;
reset role;

-- ── nobody else gets it, nor answers it ─────────────────────────────────────
select set_config('test.item', (select id::text from public.clearinghouse_published_items order by position limit 1), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if public.my_snapshot() is not null then
    raise exception 'an unconfirmed address got a snapshot';
  end if;
  begin
    perform public.respond_to_recommendation(current_setting('test.item')::uuid, 'accepted', null);
    raise exception 'an unconfirmed address answered';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The client's first item, read as the owner, for the outsider to try.
select set_config('test.item', (select id::text from public.clearinghouse_published_items order by position limit 1), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if public.my_snapshot() is not null then
    raise exception 'another user got the client''s snapshot';
  end if;
  begin
    perform public.respond_to_recommendation(current_setting('test.item')::uuid, 'accepted', null);
    raise exception 'another user answered the client''s recommendation';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role anon;
do $$ begin
  begin
    perform public.my_snapshot();
    raise exception 'anon called my_snapshot';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── unpublished, it is gone from the client's area ─────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.clearinghouse_published_items where client_status = 'question' and staff_seen_at is null) <> 1 then
    raise exception 'staff did not see the open question';
  end if;
  perform public.clearinghouse_mark_answers_seen('bbbbbbbb-1111-0000-0000-000000000001');
  if exists (select 1 from public.clearinghouse_published_items where client_updated_at is not null and staff_seen_at is null) then
    raise exception 'answers were not marked seen';
  end if;
  perform public.clearinghouse_unpublish('bbbbbbbb-1111-0000-0000-000000000001');
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if public.my_snapshot() is not null then
    raise exception 'an unpublished snapshot is still in the client''s area';
  end if;
end $$;
reset role;

rollback;
