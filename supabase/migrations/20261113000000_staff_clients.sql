-- Staff-added clients (docs/superpowers/specs/2026-10-22-staff-client-design.md):
-- an agency member records someone who is already a client as a leads row
-- opened as a client.
--
-- Retention: a client-opened row is excluded from the 24-month anonymisation
-- (anonymize_stale_leads, below). That exclusion holds until the adviser gives
-- the retention period for an engagement; until then nothing is erased.

alter table public.leads
  add column opened_as    text not null default 'lead' check (opened_as in ('lead','client')),
  add column client_since date check (client_since >= date '1990-01-01'
                                      and client_since = date_trunc('month', client_since)),
  add column products     text[] check (products <@ array['pension','provident','life','health',
                                         'savings','planning','claims','other']::text[]);

alter table public.leads drop constraint leads_notice_method_check;
alter table public.leads add constraint leads_notice_method_check
  check (notice_method in ('verbal','email','whatsapp','agreement'));

-- A row opened as a client is a staff row with its client fields and the client notice.
-- (products is not null is explicit: cardinality(null) is null, which a check passes.)
alter table public.leads add constraint leads_opened_as_client check (
  opened_as = 'lead'
  or (source = 'staff' and client_since is not null
      and products is not null and cardinality(products) >= 1 and consent_version = 'staff-client-v1')
) not valid;
alter table public.leads validate constraint leads_opened_as_client;

-- "agreement" only for someone who has one.
alter table public.leads add constraint leads_agreement_notice check (
  notice_method is distinct from 'agreement' or opened_as = 'client'
);

-- ── guard: opened_as joins the fixed fields ───────────────────────────────
-- Body of 20261105000000_staff_leads.sql with opened_as added to the fixed
-- list. client_since and products are not fixed: they follow leads_update_*.
create or replace function public.leads_guard_staff_fields() returns trigger
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
       or new.notice_method is distinct from old.notice_method
       or new.opened_as is distinct from old.opened_as then
      raise exception 'staff_fields_fixed' using errcode = '42501';
    end if;

    if new.possible_duplicate is distinct from old.possible_duplicate then
      if new.possible_duplicate or not public.has_role(old.agency_id, 'admin') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ── retention: client-opened rows are not stale ───────────────────────────
-- Body of 20261108000000_lead_duplicates.sql (merged groups kept together).
-- "A client" now also means a row opened as one or with a client_since — a
-- former client set to closed later — in the contacts clause, the stale rows
-- and both merged-group clauses.
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
          and (k.status = 'client' or k.opened_as = 'client' or k.client_since is not null
                 or greatest(k.created_at, k.updated_at) >= cutoff)
     );

  with stale as (
    select l.id
      from public.leads l
      left join lateral (
        select max(lm.scheduled_at) as last_at from public.meetings lm where lm.lead_id = l.id
      ) m on true
     where l.status <> 'client'
       and l.opened_as = 'lead'
       and l.client_since is null
       and l.anonymized_at is null
       and greatest(l.created_at, l.updated_at, coalesce(m.last_at, l.created_at)) < cutoff
       and not exists (
         select 1 from public.leads p
          where p.id = l.merged_into
            and (p.status = 'client' or p.opened_as = 'client' or p.client_since is not null
                 or greatest(p.created_at, p.updated_at) >= cutoff))
       and not exists (
         select 1 from public.leads c
          where c.merged_into = l.id
            and (c.status = 'client' or c.opened_as = 'client' or c.client_since is not null
                 or greatest(c.created_at, c.updated_at) >= cutoff))
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

revoke execute on function public.leads_guard_staff_fields()       from public, anon, authenticated;
revoke execute on function public.anonymize_stale_leads(timestamptz) from public, anon, authenticated;
