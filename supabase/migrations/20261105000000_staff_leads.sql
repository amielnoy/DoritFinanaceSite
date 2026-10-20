-- Staff-created leads (docs/superpowers/specs/2026-10-20-staff-lead-design.md):
-- a member of an agency adds a lead they met in person, by phone or by
-- referral. Additive: five columns, one constraint, one guard trigger, and the
-- retention job learns the new free-text column. The create_staff_lead RPC is
-- appended below.

alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('consultation','detailed','quick','claim','escalation','interview','staff'));

alter table public.leads
  add column brought_by    uuid references auth.users(id) on delete set null,
  add column intake        text check (intake in
                             ('phone','in_person','referral','event','existing_client','other')),
  add column referrer_note text check (char_length(referrer_note) <= 120), -- "רו״ח משה", not a contact record
  add column notice_method text check (notice_method in ('verbal','email','whatsapp')),
  add column duplicate_of  uuid references public.leads(id) on delete set null;

-- A staff lead always says how it arrived and how they were told. brought_by is
-- not required here: it goes null when the member's account is deleted, and
-- create_staff_lead sets it at insert.
alter table public.leads add constraint leads_staff_fields check (
  source is distinct from 'staff'
  or (intake is not null and notice_method is not null
      and consent_version is not null and consent_at is not null)
) not valid;
alter table public.leads validate constraint leads_staff_fields;

create index leads_agency_brought_by on public.leads (agency_id, brought_by)
  where brought_by is not null;

-- ── guard: the staff fields are fixed once written ────────────────────────
-- Runs as its caller, like leads_guard_assignment: a person (authenticated or
-- anon) is held to the rules, the server and the platform operator are not.
-- Admin+ is held too; only the operator may correct these. duplicate_of may
-- be cleared by an Admin of the lead's agency ("לא כפילות"), never set.
create function public.leads_guard_staff_fields() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_person boolean := current_user in ('authenticated', 'anon');
begin
  if v_person and not public.is_admin() then
    if new.brought_by is distinct from old.brought_by
       or new.source is distinct from old.source
       or new.intake is distinct from old.intake
       or new.consent_version is distinct from old.consent_version
       or new.consent_at is distinct from old.consent_at
       or new.notice_method is distinct from old.notice_method then
      raise exception 'staff_fields_fixed' using errcode = '42501';
    end if;

    if new.duplicate_of is distinct from old.duplicate_of then
      if new.duplicate_of is not null or not public.has_role(old.agency_id, 'admin') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_guard_staff_fields
  before update on public.leads
  for each row execute function public.leads_guard_staff_fields();

-- ── retention: the referrer note is free text about a person ──────────────
-- Body of 20261103000000_client_meetings.sql, with referrer_note = null added
-- to the anonymising update.
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

-- ── grants ─────────────────────────────────────────────────────────────────
-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so each revoke names them.
revoke execute on function public.leads_guard_staff_fields()       from public, anon, authenticated;
revoke execute on function public.anonymize_stale_leads(timestamptz) from public, anon, authenticated;
