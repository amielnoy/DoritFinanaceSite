-- Duplicate leads: one person, several submissions.
--
-- Every lead gets two duplicate keys, computed by the database whatever wrote
-- the row (the interview, the contact form, a member by hand), so detection
-- happens at creation with no caller remembering to do it:
--   phone_key — digits only, a leading 972 or 0 dropped (create_staff_lead's
--               key, and nationalPhone() in src/lib/staff-leads.ts), and only
--               when at least 8 digits are left: "050" or "0" is no one's
--               number, and keying it would make every such lead one person;
--   email_key — trimmed, lower case.
-- The leads screen groups leads that share a key. "מזג" folds a group into one
-- lead by pointing the others at it (merged_into). Nothing is deleted: a merged
-- lead keeps its interview, meetings and documents, and unmerge_lead undoes it.

alter table public.leads
  add column phone_key text generated always as (
    substring(regexp_replace(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '^(972|0)', '') from '^[0-9]{8,}$')
  ) stored,
  add column email_key text generated always as (nullif(lower(btrim(coalesce(email, ''))), '')) stored,
  add column merged_into uuid references public.leads(id) on delete set null,
  add column merged_at   timestamptz,
  add column merged_by   uuid references auth.users(id) on delete set null,
  add constraint leads_not_merged_into_self check (merged_into is distinct from id);

create index leads_agency_phone_key on public.leads (agency_id, phone_key) where phone_key is not null;
create index leads_agency_email_key on public.leads (agency_id, email_key) where email_key is not null;
create index leads_merged_into on public.leads (merged_into) where merged_into is not null;

-- ── guard: a merge goes through merge_leads / unmerge_lead ───────────────
-- Runs as its caller, like leads_guard_staff_fields: a person (authenticated or
-- anon) may not write the merge columns directly, even with update rights on
-- the row — a User could otherwise hide their own lead under another. The
-- functions below are security definer, and the operator is not held.
create function public.leads_guard_merge() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin()
     and (new.merged_into is distinct from old.merged_into
          or new.merged_at is distinct from old.merged_at
          or new.merged_by is distinct from old.merged_by) then
    raise exception 'merge_via_rpc' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger leads_guard_merge
  before update on public.leads
  for each row execute function public.leads_guard_merge();

-- ── merge_leads ──────────────────────────────────────────────────────────
-- Admin+ of the main lead's agency, or the operator. Every lead must be in the
-- same agency and not anonymised; the main lead must not itself be merged.
-- Leads already merged into one of the others move to the main lead, so a
-- merge is always one level deep. Returns how many leads were folded.
create function public.merge_leads(p_primary uuid, p_others uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_found  boolean := false;
  v_merged uuid;
  n integer;
begin
  select l.agency_id, true, l.merged_into into v_agency, v_found, v_merged
    from public.leads l
   where l.id = p_primary and l.anonymized_at is null;
  if not v_found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (public.has_role(v_agency, 'admin') or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_merged is not null or p_others is null or cardinality(p_others) = 0 or p_primary = any(p_others) then
    raise exception 'bad_merge' using errcode = '22023';
  end if;
  if (select count(*) from public.leads l
       where l.id = any(p_others) and l.agency_id is not distinct from v_agency and l.anonymized_at is null)
     <> (select count(distinct x) from unnest(p_others) x) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.leads set merged_into = p_primary where merged_into = any(p_others);
  update public.leads
     set merged_into = p_primary, merged_at = now(), merged_by = auth.uid()
   where id = any(p_others);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── unmerge_lead ─────────────────────────────────────────────────────────
create function public.unmerge_lead(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_found  boolean := false;
  v_merged uuid;
begin
  select l.agency_id, true, l.merged_into into v_agency, v_found, v_merged
    from public.leads l
   where l.id = p_id;
  if not v_found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (public.has_role(v_agency, 'admin') or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_merged is null then
    raise exception 'not_merged' using errcode = '22023';
  end if;
  update public.leads set merged_into = null, merged_at = null, merged_by = null where id = p_id;
end;
$$;

revoke execute on function public.merge_leads(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.merge_leads(uuid, uuid[]) to authenticated;
revoke execute on function public.unmerge_lead(uuid) from public, anon, authenticated;
grant execute on function public.unmerge_lead(uuid) to authenticated;

-- ── merge_duplicate_leads: the one-time clean-up of what is already there ─
-- Run from the SQL editor (no role is granted it). Dry run by default: it
-- lists each group it would merge and writes nothing.
--   select * from public.merge_duplicate_leads('<agency id>');         -- look
--   select * from public.merge_duplicate_leads('<agency id>', false);  -- merge
-- A group is every lead reachable through a shared phone_key or email_key.
-- It merges into a client if there is one, else a lead others were already
-- merged into, else the oldest — the screen's rule (mergeTarget()).
create function public.merge_duplicate_leads(p_agency_id uuid, p_dry_run boolean default true)
returns table (primary_id uuid, merged_ids uuid[], matched_on text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_group uuid[];
  v_size  integer;
  v_done  uuid[] := '{}';
  v_phone boolean;
  v_email boolean;
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for r in
    select l.id from public.leads l
     where l.agency_id is not distinct from p_agency_id
       and l.anonymized_at is null and l.merged_into is null
       and (l.phone_key is not null or l.email_key is not null)
     order by l.created_at, l.id
  loop
    continue when r.id = any(v_done);
    v_group := array[r.id];
    loop
      v_size := cardinality(v_group);
      select array_agg(l.id order by l.created_at, l.id) into v_group
        from public.leads l
       where l.agency_id is not distinct from p_agency_id
         and l.anonymized_at is null and l.merged_into is null
         and (l.id = any(v_group)
              or l.phone_key in (select g.phone_key from public.leads g where g.id = any(v_group) and g.phone_key is not null)
              or l.email_key in (select g.email_key from public.leads g where g.id = any(v_group) and g.email_key is not null));
      exit when cardinality(v_group) = v_size;
    end loop;
    v_done := v_done || v_group;
    continue when cardinality(v_group) < 2;

    select l.id into primary_id
      from public.leads l
     where l.id = any(v_group)
     order by (l.status = 'client') desc,
              exists (select 1 from public.leads c where c.merged_into = l.id) desc,
              l.created_at, l.id
     limit 1;
    merged_ids := array(select x from unnest(v_group) x where x <> primary_id);
    v_phone := exists (select 1 from public.leads l where l.id = any(v_group) and l.phone_key is not null
                        group by l.phone_key having count(*) > 1);
    v_email := exists (select 1 from public.leads l where l.id = any(v_group) and l.email_key is not null
                        group by l.email_key having count(*) > 1);
    matched_on := concat_ws('+', case when v_phone then 'phone' end, case when v_email then 'email' end);

    if not p_dry_run then
      update public.leads set merged_into = primary_id where merged_into = any(merged_ids);
      update public.leads set merged_into = primary_id, merged_at = now(), merged_by = null where id = any(merged_ids);
    end if;
    return next;
  end loop;
end;
$$;

revoke execute on function public.merge_duplicate_leads(uuid, boolean) from public, anon, authenticated;

-- ── retention: one person's history is kept, or let go, together ─────────
-- Body of 20261105000000_staff_leads.sql, with two conditions added to `stale`:
-- a merged lead stays while its main lead is a client or recent, and a main
-- lead stays while any lead merged into it is a client or recent.
create or replace function public.anonymize_stale_leads(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff constant timestamptz := p_now - interval '24 months';
  n integer;
begin
  delete from public.contacts c
   where coalesce(c.last_seen, c.created_at) < cutoff
     and not exists (
       select 1 from public.leads k
        where k.phone = c.phone
          and (k.status = 'client' or greatest(k.created_at, k.updated_at) >= cutoff)
     );

  with stale as (
    select l.id
      from public.leads l
      left join lateral (
        select max(lm.scheduled_at) as last_at from public.meetings lm where lm.lead_id = l.id
      ) m on true
     where l.status <> 'client'
       and l.anonymized_at is null
       and greatest(l.created_at, l.updated_at, coalesce(m.last_at, l.created_at)) < cutoff
       and not exists (
         select 1 from public.leads p
          where p.id = l.merged_into
            and (p.status = 'client' or greatest(p.created_at, p.updated_at) >= cutoff))
       and not exists (
         select 1 from public.leads c
          where c.merged_into = l.id
            and (c.status = 'client' or greatest(c.created_at, c.updated_at) >= cutoff))
  )
  update public.leads l
     set name = 'נמחק',
         phone = '',
         email = null,
         message = null,
         summary = null,
         profile = null,
         notes = null,
         timing = null,
         campaign = null,
         referrer_note = null,
         anonymized_at = p_now
    from stale
   where l.id = stale.id;
  get diagnostics n = row_count;

  -- The meeting's own free text about the person.
  update public.meetings m
     set timing = null, notes = null, client_summary = null, location = null
    from public.leads l
   where m.lead_id = l.id and l.anonymized_at = p_now;

  update public.meeting_requests r
     set note = null
    from public.meetings m
    join public.leads l on l.id = m.lead_id
   where r.meeting_id = m.id and l.anonymized_at = p_now;

  return n;
end;
$$;
