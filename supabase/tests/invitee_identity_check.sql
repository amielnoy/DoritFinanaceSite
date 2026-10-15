-- Synthetic accounts; every change is rolled back. Run after the migrations.
\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-2700-0000-0000-000000000001', 'authenticated', 'authenticated', 'former@example.test', now()),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-2700-0000-0000-000000000002', 'authenticated', 'authenticated', 'current@example.test', now()),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-2700-0000-0000-000000000003', 'authenticated', 'authenticated', 'orphan@example.test', now());

-- Auth changed; the profiles retain the old addresses.
update auth.users set email = 'moved@example.test' where id = 'ffffffff-2700-0000-0000-000000000001';
update auth.users set email = 'former@example.test' where id = 'ffffffff-2700-0000-0000-000000000002';
delete from public.profiles where id = 'ffffffff-2700-0000-0000-000000000003';

set local role service_role;
do $$ begin
  if public.invitee_for(' Former@Example.Test ') is distinct from 'ffffffff-2700-0000-0000-000000000002'::uuid then
    raise exception 'invitation did not resolve the current Auth owner';
  end if;
  if public.invitee_for('moved@example.test') is distinct from 'ffffffff-2700-0000-0000-000000000001'::uuid then
    raise exception 'changed address could not be invited';
  end if;
  if public.invitee_for('current@example.test') is not null then
    raise exception 'historical profile address matched';
  end if;
  if public.invitee_for('orphan@example.test') is not null then
    raise exception 'account without a profile matched';
  end if;
  if public.invitee_for('') is not null or public.invitee_for(null) is not null then
    raise exception 'empty address matched';
  end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform public.invitee_for('former@example.test');
    raise exception 'anon could resolve account addresses';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
do $$ begin
  begin
    perform public.invitee_for('former@example.test');
    raise exception 'authenticated could resolve account addresses';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
