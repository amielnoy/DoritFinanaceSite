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
-- list. client_since and products are not fixed: they follow leads_update_*,
-- but a person may set them only on a client, and only to what
-- client_fields_ok allows — else a direct PATCH of client_since on any lead
-- would take it out of the 24-month anonymisation, which skips such rows.
create or replace function public.leads_guard_staff_fields() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_person boolean := current_user in ('authenticated', 'anon');
  v_err    text;
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

    -- A client's since-when and service lines: on a client only, and checked.
    if new.client_since is distinct from old.client_since or new.products is distinct from old.products then
      if new.status <> 'client' and new.opened_as <> 'client' then
        raise exception 'field_invalid' using errcode = '22023';
      end if;
      v_err := public.client_fields_ok(new.client_since, new.products);
      if v_err is not null then
        raise exception '%', v_err using errcode = '22023';
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

-- ── client_fields_ok: the month and the list, in one place ─────────────────
-- Null when fine, else the refusal. "This month" is Israel's: on the 31st at
-- 23:30 UTC it is already the 1st there, and that month is allowed.
create function public.client_fields_ok(p_since date, p_products text[]) returns text
  language sql
  stable
  set search_path = ''
as $$
  select case
    when p_since is null
      or p_since < date '1990-01-01'
      or p_since <> date_trunc('month', p_since)::date
      or p_since > date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date then 'bad_since'
    when p_products is null
      or cardinality(p_products) < 1
      or not (p_products <@ array['pension','provident','life','health',
                                  'savings','planning','claims','other']::text[]) then 'bad_products'
  end
$$;

-- ── create_staff_lead, replaced: it adds clients too ──────────────────────
-- 20261105000000's body; changed only where a client differs (steps 2 and 5).
-- The three new arguments are last and defaulted, so a call naming the old
-- twelve gets exactly the lead it got before.
drop function public.create_staff_lead(uuid, text, text, text, text, text, text, text, text, text, uuid, boolean);
create function public.create_staff_lead(
  p_agency_id    uuid,
  p_name         text,
  p_phone        text,
  p_email        text,
  p_topic        text,
  p_notes        text,
  p_intake       text,
  p_referrer     text,
  p_status       text,
  p_notice       text,
  p_assignee     uuid,
  p_duplicate_ok boolean,
  p_as_client    boolean default false,
  p_client_since date    default null,
  p_products     text[]  default null
) returns table (lead_id uuid, duplicate text)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_caller   uuid := auth.uid();
  v_assignee uuid;
  v_digits   text;
  v_dup      uuid;
  v_id       uuid;
  v_client   boolean := coalesce(p_as_client, false);
  v_status   text;
  v_err      text;
  -- What redact() (supabase/functions/submit-lead/lead.js) cuts out: a card,
  -- a nine-digit ID or a six-to-eight-digit account between non-digits, an IBAN
  -- between non-alphanumerics. The same boundaries as redact(), not \y: Postgres
  -- counts a Hebrew letter as a word character and JavaScript does not.
  -- Detection only; the create-lead function redacts before it calls, so only
  -- a direct call trips it.
  c_secret   constant text :=
    '(^|[^0-9])([0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}|[0-9]{6,9})([^0-9]|$)|(^|[^A-Za-z0-9])[Ii][Ll][0-9]{2}[A-Za-z0-9]{17,}([^A-Za-z0-9]|$)';
begin
  -- 0 agency 1 only: the privacy notice the client is told names Dorit's agency
  -- (create-lead's AGENCY_1, refused there too)
  if p_agency_id is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'agency_not_enabled' using errcode = '42501';
  end if;

  -- 1 who may, and how often: 60 an hour, as the create-lead function allows,
  -- so a direct call to /rest/v1/rpc cannot fill the table either. The lock
  -- makes the count and the insert one step per member (and their duplicate
  -- check with it); it is released at the end of the transaction.
  if v_caller is null or not (public.has_role(p_agency_id, 'user') or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('staff-lead:' || v_caller::text));
  if (select count(*) from public.leads
       where brought_by = v_caller and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- 2 what may be said (name 80, email 254, topic 200 as LEAD_FIELD_LIMITS;
  -- notes 2000, where redact() cuts)
  -- a client: always status 'client' (p_status is not read), since-when and
  -- the product lines; a lead: none of those
  if v_client then
    v_status := 'client';
    v_err := public.client_fields_ok(p_client_since, p_products);
    if v_err is not null then
      raise exception '%', v_err using errcode = '22023';
    end if;
  else
    if p_status is null or p_status not in ('new','contacted','client') then
      raise exception 'bad_status' using errcode = '22023';
    end if;
    if p_client_since is not null or p_products is not null then
      raise exception 'field_invalid' using errcode = '22023';
    end if;
    v_status := p_status;
  end if;
  if p_intake is null or p_intake not in ('phone','in_person','referral','event','existing_client','other') then
    raise exception 'bad_intake' using errcode = '22023';
  end if;
  -- 'agreement' (told in the engagement agreement) only for a client
  if p_notice is null or p_notice not in ('verbal','email','whatsapp','agreement')
     or (p_notice = 'agreement' and not v_client) then
    raise exception 'bad_notice' using errcode = '22023';
  end if;
  if p_notice = 'email' and nullif(btrim(p_email), '') is null then
    raise exception 'bad_notice' using errcode = '22023'; -- told by email, but no address
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '' then
    raise exception 'field_required' using errcode = '22023';
  end if;
  if char_length(p_name) > 80 or char_length(p_phone) > 30
     or char_length(coalesce(p_email, '')) > 254 or char_length(coalesce(p_topic, '')) > 200
     or char_length(coalesce(p_notes, '')) > 2000 or char_length(coalesce(p_referrer, '')) > 120 then
    raise exception 'field_too_long' using errcode = '22023';
  end if;
  -- the shape normalizePhone gives: 0 and eight or nine digits
  if p_phone !~ '^0[0-9]{8,9}$' then
    raise exception 'bad_phone' using errcode = '22023';
  end if;
  if coalesce(p_notes, '') ~ c_secret or coalesce(p_topic, '') ~ c_secret
     or coalesce(p_referrer, '') ~ c_secret then
    raise exception 'field_invalid' using errcode = '22023';
  end if;

  -- 3 whose it is: a User's lead is theirs; Admin+ (and the operator) choose
  if public.has_role(p_agency_id, 'admin') or public.is_admin() then
    if p_assignee is not null and not public.lead_assignee_ok(p_agency_id, p_assignee) then
      raise exception 'assignee_not_member' using errcode = '22023';
    end if;
    v_assignee := p_assignee;
  else
    v_assignee := v_caller;
  end if;

  -- 4 the same person again, whatever the formatting
  -- the national number: digits only, without a leading 972 or 0
  v_digits := regexp_replace(regexp_replace(p_phone, '\D', '', 'g'), '^(972|0)', '');
  if v_digits <> '' then
    select l.id into v_dup
      from public.leads l
     where l.agency_id = p_agency_id
       and l.anonymized_at is null
       and regexp_replace(regexp_replace(l.phone, '\D', '', 'g'), '^(972|0)', '') = v_digits
     order by public.can_see_lead(l.id) desc, l.created_at desc -- one the caller can open, if any
     limit 1;
  end if;
  if v_dup is not null and public.can_see_lead(v_dup) then
    if not coalesce(p_duplicate_ok, false) then
      return query select v_dup, 'visible'::text;
      return;
    end if;
    v_dup := null; -- seen and chosen: a second lead, not flagged
  end if;

  -- 5 write it
  insert into public.leads (
    agency_id, name, phone, email, topic, notes, status, source, channel,
    brought_by, intake, referrer_note, notice_method, consent_version, consent_at,
    assigned_user_id, assigned_at, assigned_by, possible_duplicate,
    opened_as, client_since, products
  ) values (
    p_agency_id, btrim(p_name), btrim(p_phone), nullif(btrim(p_email), ''), nullif(btrim(p_topic), ''),
    nullif(btrim(p_notes), ''), v_status, 'staff',
    case when p_intake in ('referral','existing_client') then 'referral' else 'direct' end,
    v_caller, p_intake, nullif(btrim(p_referrer), ''), p_notice,
    case when v_client then 'staff-client-v1' else 'staff-intake-v1' end, now(),
    v_assignee,
    case when v_assignee is not null then now() end,
    case when v_assignee is not null then v_caller end,
    v_dup is not null,
    case when v_client then 'client' else 'lead' end,
    case when v_client then p_client_since end,
    case when v_client then p_products end
  ) returning id into v_id;

  return query select v_id, case when v_dup is not null then 'hidden' end::text;
end;
$$;

-- ── convert_lead_to_client: the lead someone already is becomes a client ──
-- Security invoker: an ordinary update under the caller's session, so
-- leads_update_* and can_see_lead decide as for a status change in the drawer.
-- An update RLS filters out changes nothing, and nothing is an error. A lead
-- merged into another is one person with it: the main lead is converted.
-- opened_as stays 'lead' and the original consent stays (they were told when
-- they enquired). Returns the converted lead's id.
create function public.convert_lead_to_client(p_lead_id uuid, p_client_since date, p_products text[])
returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  v_err    text := public.client_fields_ok(p_client_since, p_products);
  v_target uuid;
  v_id     uuid;
begin
  if v_err is not null then
    raise exception '%', v_err using errcode = '22023';
  end if;
  select coalesce(l.merged_into, l.id) into v_target
    from public.leads l
   where l.id = p_lead_id and l.anonymized_at is null;
  update public.leads
     set status = 'client', client_since = p_client_since, products = p_products
   where id = v_target and anonymized_at is null
  returning id into v_id;
  if v_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.client_fields_ok(date, text[]) from public, anon, authenticated;
-- convert_lead_to_client runs as its caller and calls it; it reads nothing.
grant execute on function public.client_fields_ok(date, text[]) to authenticated;
revoke execute on function public.create_staff_lead(uuid, text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, date, text[]) from public, anon, authenticated;
grant execute on function public.create_staff_lead(uuid, text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, date, text[]) to authenticated;
revoke execute on function public.convert_lead_to_client(uuid, date, text[]) from public, anon, authenticated;
grant execute on function public.convert_lead_to_client(uuid, date, text[]) to authenticated;
