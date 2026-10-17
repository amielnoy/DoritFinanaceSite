-- Saving a client's meetings with Dorit, migration 1 of 2 — additive
-- (docs/superpowers/specs/2026-10-17-client-meetings-design.md, Rollout 1).
--
-- Many meetings per lead, a summary for the client kept apart from Dorit's
-- notes, and the client's two doors: my_meetings() to read and
-- request_meeting_change() to ask. Nothing here drops the one-meeting-per-lead
-- key; migration 2 does, after submit-lead writes its booking by id.
--
-- Two readers assumed one meeting per lead and are fixed here, before a second
-- meeting can exist: enquiries_for now reads the lead's first booking only (a
-- second meeting would have repeated the enquiry), and anonymize_stale_leads
-- reads the lead's latest meeting (an old meeting would have made a lead with a
-- recent one look stale).

-- ── meetings: the new columns ──────────────────────────────────────────────
alter table public.meetings
  add column status               text not null default 'scheduled'
    check (status in ('scheduled', 'done', 'cancelled', 'no_show')),
  add column mode                 text check (mode in ('office', 'phone', 'video')),
  add column location             text check (char_length(location) <= 500),  -- address, or the video link
  add column duration_min         smallint check (duration_min between 10 and 240),
  add column client_summary       text check (char_length(client_summary) <= 5000),  -- written for the client
  add column summary_published_at timestamptz,
  -- Who added it; null = the server (a booking from the site). Staff inserts
  -- take their own id by default, and the insert policy holds them to it.
  add column created_by           uuid default auth.uid() references auth.users(id) on delete set null,
  add column kind                 text not null default 'first'
    check (kind in ('first', 'follow_up', 'annual_review', 'other'));

-- Existing rows are all site bookings: kind 'first' by the default above, and
-- the ones already behind us are done.
update public.meetings set status = 'done' where scheduled_at < now();

-- ── meeting_requests: a change the client asked for ────────────────────────
-- The meeting itself is untouched; Dorit moves it, or not.
create table public.meeting_requests (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  agency_id   uuid not null references public.agencies(id),
  kind        text not null check (kind in ('reschedule', 'cancel')),
  note        text check (char_length(note) <= 500),
  status      text not null default 'open' check (status in ('open', 'handled')),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
-- One open request per meeting: the second ask waits for the first answer.
create unique index meeting_requests_one_open on public.meeting_requests (meeting_id) where status = 'open';

alter table public.meeting_requests enable row level security;

-- The lead a meeting belongs to, for the request policies (like lead_in_agency).
create function public.meeting_lead(p_meeting_id uuid) returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.lead_id from public.meetings m where m.id = p_meeting_id
$$;

-- Staff who can see the meeting's lead read its requests and mark them
-- handled. No insert policy: a client writes only through
-- request_meeting_change.
create policy meeting_requests_read_lead on public.meeting_requests
  for select to authenticated
  using (public.can_see_lead(public.meeting_lead(meeting_id)) or public.is_admin());
create policy meeting_requests_update_lead on public.meeting_requests
  for update to authenticated
  using (public.can_see_lead(public.meeting_lead(meeting_id)) or public.is_admin())
  with check ((public.can_see_lead(public.meeting_lead(meeting_id))
               and public.lead_in_agency(public.meeting_lead(meeting_id), agency_id))
              or public.is_admin());
-- Supabase's default privileges hand a new table to anon and authenticated in
-- full; a column grant narrows nothing until that is taken back.
revoke all on public.meeting_requests from public, anon, authenticated;
grant select on public.meeting_requests to authenticated;
-- Only the answer: what was asked stays as the client asked it.
grant update (status, handled_at) on public.meeting_requests to authenticated;
grant select, insert, update, delete on public.meeting_requests to service_role;

-- ── meetings: staff add one to a lead they can see ─────────────────────────
-- In the lead's own agency, and as themselves.
create policy meetings_insert_lead on public.meetings
  for insert to authenticated
  with check (public.can_see_lead(lead_id)
              and public.lead_in_agency(lead_id, agency_id)
              and created_by = auth.uid());
grant insert on public.meetings to authenticated;

-- ── the personal area: the first booking only ──────────────────────────────
-- Same columns and rule as before (20261013000000_meetings_lead_id.sql); the
-- join reads the lead's first booking, so a follow-up never repeats the enquiry.
create or replace function public.enquiries_for(p_email text)
returns table (
  created_at    timestamptz,
  source        text,
  track         text,
  track_label   text,
  meeting_topic text,
  timing        text,
  scheduled_at  timestamptz,
  summary       text,
  profile       jsonb,
  completed     boolean,
  in_calendar   boolean
)
  language sql security definer stable set search_path = public as $$
  select l.created_at, l.source, l.track, l.track_label, l.meeting_topic, l.timing,
         coalesce(m.scheduled_at, l.scheduled_at),
         l.summary, l.profile,
         l.status is distinct from 'partial',
         coalesce(m.calendar_status like 'אירוע נוצר%', false)
    from public.leads l
    left join lateral (
      select fm.scheduled_at, fm.calendar_status
        from public.meetings fm
       where fm.lead_id = l.id and fm.kind = 'first'
       order by fm.created_at
       limit 1
    ) m on true
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
   order by l.created_at desc
$$;

-- ── the client's door: meetings_for / my_meetings ──────────────────────────
-- Service role only, like enquiries_for. These columns and no others:
-- never notes, timing, calendar_status (only whether it is in the diary),
-- lead_id, agency_id, created_by or track. A column added to meetings later
-- is invisible here until it is added on purpose — and
-- tests/contract/client-meetings-schema.contract.test.ts holds the list.
create function public.meetings_for(p_email text)
returns table (
  id                   uuid,
  scheduled_at         timestamptz,
  duration_min         smallint,
  topic                text,
  kind                 text,
  status               text,
  mode                 text,
  location             text,
  client_summary       text,
  summary_published_at timestamptz,
  in_calendar          boolean,
  open_request         text
)
  language sql security definer stable set search_path = public as $$
  select m.id, m.scheduled_at, m.duration_min, m.topic, m.kind, m.status, m.mode, m.location,
         -- Unpublished is invisible: a draft summary never leaves the table.
         case when m.summary_published_at is not null then m.client_summary end,
         m.summary_published_at,
         coalesce(m.calendar_status like 'אירוע נוצר%', false) or m.created_by is not null,
         (select r.kind from public.meeting_requests r
           where r.meeting_id = m.id and r.status = 'open' limit 1)
    from public.meetings m
    join public.leads l on l.id = m.lead_id
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
     and l.anonymized_at is null
   order by m.scheduled_at desc nulls last
$$;

-- The signed-in user's verified address, or nothing.
create function public.my_meetings()
returns table (
  id                   uuid,
  scheduled_at         timestamptz,
  duration_min         smallint,
  topic                text,
  kind                 text,
  status               text,
  mode                 text,
  location             text,
  client_summary       text,
  summary_published_at timestamptz,
  in_calendar          boolean,
  open_request         text
)
  language sql security definer stable set search_path = public as $$
  select * from public.meetings_for(public.my_email())
$$;

-- A client asks to move or cancel one of their own upcoming meetings. The
-- meeting is checked again here — its id grants nothing on its own — and one
-- open request per meeting is the rule (the index above also holds it under a
-- race). The caller mails Dorit (supabase/functions/meeting-request).
create function public.request_meeting_change(p_meeting uuid, p_kind text, p_note text default null)
returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_email  text := public.my_email();
  v_agency uuid;
  v_id     uuid;
begin
  if v_email is null then
    raise exception 'unverified' using errcode = '42501';
  end if;
  if p_kind not in ('reschedule', 'cancel') or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select m.agency_id into v_agency
    from public.meetings m
    join public.leads l on l.id = m.lead_id
   where m.id = p_meeting
     and m.status = 'scheduled'
     and lower(trim(l.email)) = v_email
     and l.anonymized_at is null;
  if not found then
    raise exception 'not_found' using errcode = '42501';
  end if;
  if exists (select 1 from public.meeting_requests r where r.meeting_id = p_meeting and r.status = 'open') then
    raise exception 'already_open' using errcode = '23505';
  end if;
  insert into public.meeting_requests (meeting_id, agency_id, kind, note)
  values (p_meeting, v_agency, p_kind, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ── the server's two lookups ───────────────────────────────────────────────
-- The newest whole lead of an agency with this address, for submit-lead's
-- rebooking by a signed-in client. An exact match on the normalised address —
-- never a pattern, where `_` would match any character and file the meeting
-- under someone else's lead.
--
-- Until migration 2 drops meetings_lead_id_key a lead holds one meeting, so a
-- lead that already has one is not offered: the booking then makes a new lead,
-- as it always has, instead of failing on the key and losing its record. Once
-- the key is gone the condition is true for every lead, with no deploy.
create function public.lead_for_email(p_email text, p_agency_id uuid) returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select l.id from public.leads l
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
     and l.agency_id = p_agency_id
     and l.anonymized_at is null
     and ( not exists (select 1 from pg_catalog.pg_constraint c
                        where c.conname = 'meetings_lead_id_key'
                          and c.conrelid = 'public.meetings'::regclass)
        or not exists (select 1 from public.meetings m where m.lead_id = l.id) )
   order by l.created_at desc
   limit 1
$$;

-- Who hears about a client's request, besides the operating team: the
-- lead's assigned user and the agency's owners and admins.
create function public.meeting_request_recipients(p_request_id uuid) returns text[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with r as (
    select q.agency_id, l.assigned_user_id
      from public.meeting_requests q
      join public.meetings m on m.id = q.meeting_id
      join public.leads l on l.id = m.lead_id
     where q.id = p_request_id
  )
  select coalesce(array_agg(distinct lower(p.email)), '{}')
    from r
    join public.memberships ms on ms.agency_id = r.agency_id
    join public.profiles p on p.id = ms.user_id
   where p.email is not null and p.email <> ''
     and (ms.role in ('owner', 'admin') or ms.user_id = r.assigned_user_id)
$$;

-- ── retention: the latest meeting, and the new free text ───────────────────
-- As 20261025000000_lead_retention.sql, with two changes: a lead is stale by
-- its latest meeting, not by any one of them; and an anonymised lead's
-- meetings lose the client summary, the place and the requests' notes too.
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
-- Supabase's default privileges hand EXECUTE on a new function to anon and
-- authenticated by name, so revoking from `public` alone closes nothing.
revoke all on function public.meeting_lead(uuid)                            from public, anon, authenticated;
revoke all on function public.meetings_for(text)                            from public, anon, authenticated;
revoke all on function public.my_meetings()                                 from public, anon, authenticated;
revoke all on function public.request_meeting_change(uuid, text, text)      from public, anon, authenticated;
revoke all on function public.lead_for_email(text, uuid)                    from public, anon, authenticated;
revoke all on function public.meeting_request_recipients(uuid)              from public, anon, authenticated;
revoke execute on function public.anonymize_stale_leads(timestamptz)        from public, anon, authenticated;
grant execute on function public.meeting_lead(uuid)                          to authenticated;
grant execute on function public.meetings_for(text)                          to service_role;
grant execute on function public.my_meetings()                               to authenticated;
grant execute on function public.request_meeting_change(uuid, text, text)    to authenticated;
grant execute on function public.lead_for_email(text, uuid)                  to service_role;
grant execute on function public.meeting_request_recipients(uuid)            to service_role;
