-- Duplicate leads and merging (20261108000000_lead_duplicates.sql), against a
-- local `supabase start`, in the style of staff_leads_check.sql: every block
-- raises on a wrong answer, so a clean run is the assertion. Synthetic data;
-- rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/lead_duplicates_check.sql
\set ON_ERROR_STOP on
begin;

-- 1 an Admin of agency 1 · 2 a User of agency 1 · agency D a second agency
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000001','authenticated','authenticated','dup-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000002','authenticated','authenticated','dup-user@example.com', now());
insert into public.agencies (id, name) values ('dddddddd-0000-0000-0000-00000000000d', 'סוכנות בדיקה');
insert into public.memberships (user_id, agency_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('dddddddd-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'user');

-- A: one person by phone, three spellings; E: by email, two spellings; X: another agency; S: alone.
insert into public.leads (id, agency_id, name, phone, email, source, status, created_at, assigned_user_id) values
  ('d0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'אבי', '054-123-4567', null, 'consultation', 'contacted', now() - interval '30 days', 'dddddddd-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'אבי', '+972 54 1234567', 'avi@example.com', 'interview', 'new', now() - interval '3 days', 'dddddddd-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'אבי', '0541234567', null, 'quick', 'new', now() - interval '1 day', null),
  ('d0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'אלה', '0509999991', 'Ella@Example.com', 'consultation', 'client', now() - interval '400 days', null),
  ('d0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'אלה', '0509999992', ' ella@example.com ', 'interview', 'new', now() - interval '2 days', null),
  ('d0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'שקט', '0507777777', null, 'consultation', 'new', now(), null),
  ('d0000000-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-00000000000d', 'אבי', '0541234567', null, 'consultation', 'new', now(), null);

-- ── the keys are computed for every row, whatever wrote it ───────────────
do $$ begin
  if (select count(distinct phone_key) from public.leads
       where id in ('d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a3'))
     <> 1 then
    raise exception 'three spellings of one phone got different keys';
  end if;
  if (select phone_key from public.leads where id = 'd0000000-0000-0000-0000-0000000000a1') is distinct from '541234567' then
    raise exception 'the phone key is not the national number';
  end if;
  if (select phone_key from public.leads where id = 'd0000000-0000-0000-0000-0000000000f1') is distinct from '507777777' then
    raise exception 'a mobile number got no key';
  end if;
  update public.leads set phone = '050' where id = 'd0000000-0000-0000-0000-0000000000f1';
  if (select phone_key from public.leads where id = 'd0000000-0000-0000-0000-0000000000f1') is not null then
    raise exception 'a three-digit placeholder got a key';
  end if;
  update public.leads set phone = '0507777777' where id = 'd0000000-0000-0000-0000-0000000000f1';
  if (select email_key from public.leads where id = 'd0000000-0000-0000-0000-0000000000e2') is distinct from 'ella@example.com' then
    raise exception 'the email key is not trimmed and lower-cased';
  end if;
end $$;

-- ── the clean-up: a dry run lists the groups and writes nothing ──────────
do $$
declare v record; n integer := 0;
begin
  for v in select * from public.merge_duplicate_leads('00000000-0000-0000-0000-000000000001') loop
    n := n + 1;
    if v.primary_id = 'd0000000-0000-0000-0000-0000000000a1' then
      if v.merged_ids <> array['d0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a3']::uuid[]
         or v.matched_on <> 'phone' then
        raise exception 'the phone group is wrong: % %', v.merged_ids, v.matched_on;
      end if;
    elsif v.primary_id = 'd0000000-0000-0000-0000-0000000000e1' then
      if v.merged_ids <> array['d0000000-0000-0000-0000-0000000000e2']::uuid[] or v.matched_on <> 'email' then
        raise exception 'the email group is wrong: % %', v.merged_ids, v.matched_on;
      end if;
    else
      raise exception 'an unexpected group: %', v.primary_id;
    end if;
  end loop;
  if n <> 2 then raise exception 'expected 2 groups, got %', n; end if;
  if exists (select 1 from public.leads where merged_into is not null) then
    raise exception 'the dry run merged';
  end if;
end $$;

-- ── a User may neither merge nor write merged_into directly ──────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  begin
    perform public.merge_leads('d0000000-0000-0000-0000-0000000000a1', array['d0000000-0000-0000-0000-0000000000a2']::uuid[]);
    raise exception 'a User merged';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    update public.leads set merged_into = 'd0000000-0000-0000-0000-0000000000a1'
     where id = 'd0000000-0000-0000-0000-0000000000a2';
    raise exception 'a User wrote merged_into';
  exception when insufficient_privilege then
    if sqlerrm <> 'merge_via_rpc' then raise; end if;
  end;
  begin
    perform public.merge_duplicate_leads('00000000-0000-0000-0000-000000000001');
    raise exception 'a User ran the clean-up';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── an Admin merges through the function, never by hand ──────────────────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  begin
    update public.leads set merged_into = 'd0000000-0000-0000-0000-0000000000a1'
     where id = 'd0000000-0000-0000-0000-0000000000a2';
    raise exception 'an Admin wrote merged_into';
  exception when insufficient_privilege then
    if sqlerrm <> 'merge_via_rpc' then raise; end if;
  end;
  begin
    perform public.merge_leads('d0000000-0000-0000-0000-0000000000a1', array['d0000000-0000-0000-0000-0000000000c1']::uuid[]);
    raise exception 'a lead of another agency was merged';
  exception when no_data_found then
    if sqlerrm <> 'not_found' then raise; end if;
  end;
  begin
    perform public.merge_leads('d0000000-0000-0000-0000-0000000000a1', array['d0000000-0000-0000-0000-0000000000a1']::uuid[]);
    raise exception 'a lead was merged into itself';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_merge' then raise; end if;
  end;

  if public.merge_leads('d0000000-0000-0000-0000-0000000000a2', array['d0000000-0000-0000-0000-0000000000a3']::uuid[]) <> 1 then
    raise exception 'merge_leads did not report one lead';
  end if;
  -- Merging a2 (with a3 under it) into a1 moves a3 to a1: one level deep.
  if public.merge_leads('d0000000-0000-0000-0000-0000000000a1', array['d0000000-0000-0000-0000-0000000000a2']::uuid[]) <> 1 then
    raise exception 'the second merge did not report one lead';
  end if;
  if (select count(*) from public.leads where merged_into = 'd0000000-0000-0000-0000-0000000000a1') <> 2 then
    raise exception 'the merge is not flat';
  end if;
  if (select merged_by from public.leads where id = 'd0000000-0000-0000-0000-0000000000a2') is distinct from 'dddddddd-0000-0000-0000-000000000001' then
    raise exception 'merged_by is not the Admin';
  end if;
  begin
    perform public.merge_leads('d0000000-0000-0000-0000-0000000000a2', array['d0000000-0000-0000-0000-0000000000f1']::uuid[]);
    raise exception 'a merged lead became a main lead';
  exception when invalid_parameter_value then
    if sqlerrm <> 'bad_merge' then raise; end if;
  end;

  perform public.unmerge_lead('d0000000-0000-0000-0000-0000000000a3');
  if (select merged_into from public.leads where id = 'd0000000-0000-0000-0000-0000000000a3') is not null then
    raise exception 'unmerge left merged_into';
  end if;
  begin
    perform public.unmerge_lead('d0000000-0000-0000-0000-0000000000a3');
    raise exception 'an unmerged lead was unmerged again';
  exception when invalid_parameter_value then
    if sqlerrm <> 'not_merged' then raise; end if;
  end;
end $$;

reset role;

-- ── nothing was deleted ──────────────────────────────────────────────────
do $$ begin
  if (select count(*) from public.leads where id::text like 'd0000000-%') <> 7 then
    raise exception 'a lead disappeared';
  end if;
end $$;

-- ── the clean-up for real: the email group merges into the client ────────
do $$ begin
  perform public.merge_duplicate_leads('00000000-0000-0000-0000-000000000001', false);
  if (select merged_into from public.leads where id = 'd0000000-0000-0000-0000-0000000000e2') is distinct from 'd0000000-0000-0000-0000-0000000000e1' then
    raise exception 'the email group did not merge into the client';
  end if;
  -- a3 (unmerged above) shares a1's phone, and a1 already has a2 under it.
  if (select merged_into from public.leads where id = 'd0000000-0000-0000-0000-0000000000a3') is distinct from 'd0000000-0000-0000-0000-0000000000a1' then
    raise exception 'a3 did not merge into the lead that already had history';
  end if;
  if exists (select 1 from public.leads where id = 'd0000000-0000-0000-0000-0000000000c1' and merged_into is not null) then
    raise exception 'the clean-up crossed agencies';
  end if;
end $$;

-- ── deleting a main lead unlinks its merged leads, it never deletes them ─
do $$ begin
  delete from public.leads where id = 'd0000000-0000-0000-0000-0000000000a1';
  if (select count(*) from public.leads where id in ('d0000000-0000-0000-0000-0000000000a2','d0000000-0000-0000-0000-0000000000a3') and merged_into is null) <> 2 then
    raise exception 'the merged leads did not survive their main lead';
  end if;
end $$;

-- ── retention keeps a merged lead whose main lead is a client ────────────
-- Triggers off for the backdating only: the updated_at trigger would stamp now().
set local session_replication_role = replica;
update public.leads set created_at = now() - interval '30 months', updated_at = now() - interval '30 months'
 where id in ('d0000000-0000-0000-0000-0000000000e2', 'd0000000-0000-0000-0000-0000000000f1');
set local session_replication_role = origin;
do $$ begin
  if (select updated_at from public.leads where id = 'd0000000-0000-0000-0000-0000000000e2') > now() - interval '24 months' then
    raise exception 'the backdating did not take';
  end if;
  perform public.anonymize_stale_leads(now());
  if (select anonymized_at from public.leads where id = 'd0000000-0000-0000-0000-0000000000e2') is not null then
    raise exception 'retention anonymised a client''s merged lead';
  end if;
  -- …while a stale lead on its own is still anonymised: the job ran.
  if (select anonymized_at from public.leads where id = 'd0000000-0000-0000-0000-0000000000f1') is null then
    raise exception 'retention did not run';
  end if;
end $$;

rollback;
\echo 'lead_duplicates_check: OK'
