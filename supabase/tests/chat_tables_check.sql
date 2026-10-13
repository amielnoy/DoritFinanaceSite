-- The chat tables: who reads what, what cascades, and what the two functions
-- do. Run against a local `supabase start` after `supabase db reset`, like
-- agency_isolation_check.sql. Every block raises on a wrong answer, so a clean
-- run is the assertion.
\set ON_ERROR_STOP on
begin;

insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000001','authenticated','authenticated','chat-agency1@example.com'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000002','authenticated','authenticated','chat-outsider@example.com'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000003','authenticated','authenticated','chat-admin@example.com');
insert into public.memberships (user_id, agency_id, role) values
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner');
update public.profiles set role = 'admin' where id = 'cccccccc-0000-0000-0000-000000000003';

insert into public.leads (id, name, phone, agency_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'לקוחת צ׳אט', '050-000-3001', '00000000-0000-0000-0000-000000000001');

insert into public.chat_conversations (id, agency_id, role, token_hash, consent_version, consent_at, lead_id) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'interview', repeat('a', 64), '2026-10-agents-v6', now(), 'dddddddd-0000-0000-0000-000000000001'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'interview', repeat('b', 64), '2026-10-agents-v6', now(), null);
insert into public.chat_messages (conversation_id, agency_id, role, content) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'user', 'שלום'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'user', 'היי');
insert into public.chat_usage (conversation_id, agency_id, model, input_tokens, cached_tokens, output_tokens) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'claude-haiku-5-5', 100, 50, 10),
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'claude-haiku-5-5', 200, 0, 20);

-- ── anon: no way in ─────────────────────────────────────────────────────────
set local role anon;
do $$ begin
  begin
    perform 1 from public.chat_conversations;
    raise exception 'anon could read chat_conversations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.chat_month_usage('00000000-0000-0000-0000-000000000001', now() - interval '1 day');
    raise exception 'anon could call chat_month_usage';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── an outsider: zero rows ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.chat_conversations) <> 0 then raise exception 'an outsider read conversations'; end if;
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'an outsider read messages'; end if;
  if (select count(*) from public.chat_usage) <> 0 then raise exception 'an outsider read usage'; end if;
  begin
    insert into public.chat_messages (conversation_id, role, content) values ('eeeeeeee-0000-0000-0000-000000000001', 'user', 'x');
    raise exception 'an authenticated user could write a message';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_chat_conversations();
    raise exception 'authenticated could call the purge';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── a member of agency 1: agency 1 only ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.chat_conversations) <> 1 then raise exception 'member does not see exactly agency 1''s conversation'; end if;
  if exists (select 1 from public.chat_messages where agency_id <> '00000000-0000-0000-0000-000000000001') then raise exception 'member read another agency''s messages'; end if;
end $$;
reset role;

-- ── a platform admin: both ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.chat_conversations) <> 2 then raise exception 'admin does not see both conversations'; end if;
end $$;
reset role;

-- ── the service role: totals, purge, cascades ───────────────────────────────
set local role service_role;
do $$
declare
  r record;
begin
  select * into r from public.chat_month_usage('00000000-0000-0000-0000-000000000001', now() - interval '1 day');
  if r.model <> 'claude-haiku-5-5' or r.input_tokens <> 300 or r.cached_tokens <> 50 or r.output_tokens <> 30 then
    raise exception 'chat_month_usage summed wrong: %', r;
  end if;
end $$;
reset role;

update public.chat_conversations set delete_after = now() - interval '1 minute'
 where id = 'eeeeeeee-0000-0000-0000-000000000002';
set local role service_role;
do $$ begin
  if public.purge_chat_conversations() <> 1 then raise exception 'the purge did not delete exactly the expired conversation'; end if;
  if exists (select 1 from public.chat_messages where conversation_id = 'eeeeeeee-0000-0000-0000-000000000002') then
    raise exception 'a purged conversation left its messages';
  end if;
end $$;
reset role;

delete from public.leads where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.chat_conversations where id = 'eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'deleting a lead left its transcript';
  end if;
  if exists (select 1 from public.chat_usage where conversation_id = 'eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'deleting a lead left its usage rows';
  end if;
end $$;

rollback;
