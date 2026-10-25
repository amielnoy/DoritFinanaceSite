-- The lead pipeline (feature 2): two more statuses, a follow-up day per lead,
-- and an activity log.
--
-- Pipeline: new → contacted → meeting_set → proposal_sent → client / closed.
-- The stored keys of the old statuses stay: retention never anonymises a
-- `client`, the personal area skips `partial`, and the interview writes
-- `escalated` and `partial`. Only their labels changed on the screen.
--
-- lead_events is the log: status changes, assignments, follow-up changes and
-- merges are written by a trigger on leads, whoever made them (the screen, an
-- Edge Function, a job), each with its time and, when a person did it, who.
-- Notes are written through add_lead_note. Nobody writes the log directly.

-- ── statuses ─────────────────────────────────────────────────────────────
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new','contacted','meeting_set','proposal_sent','closed','escalated','partial','client'));

-- ── follow-up: a day, Israel's date — nobody plans a call to the minute ───
alter table public.leads add column next_follow_up_on date;

-- ── the activity log ─────────────────────────────────────────────────────
create table public.lead_events (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('created','status','assigned','note','follow_up','merged','unmerged','whatsapp')),
  from_value text check (char_length(from_value) <= 100),
  to_value   text check (char_length(to_value) <= 100),
  note       text check (char_length(note) <= 2000),
  at         timestamptz not null default now()
);
create index lead_events_lead_at on public.lead_events (lead_id, at desc);

alter table public.lead_events enable row level security;
revoke all on public.lead_events from public, anon, authenticated;
grant select on public.lead_events to authenticated;
grant all on public.lead_events to service_role;
-- Whoever may see the lead sees its log: the same rule as the lead itself.
create policy lead_events_read on public.lead_events
  for select to authenticated using (public.can_see_lead(lead_id));

-- Security definer so the log is written whatever role changed the lead;
-- auth.uid() still reads the caller's JWT (null for the server and jobs).
create function public.leads_log_events() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events (lead_id, actor_id, kind, to_value) values (new.id, v_actor, 'created', new.status);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value)
    values (new.id, v_actor, 'status', old.status, new.status);
  end if;
  if new.assigned_user_id is distinct from old.assigned_user_id then
    insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value)
    values (new.id, v_actor, 'assigned', old.assigned_user_id::text, new.assigned_user_id::text);
  end if;
  if new.next_follow_up_on is distinct from old.next_follow_up_on then
    insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value)
    values (new.id, v_actor, 'follow_up', old.next_follow_up_on::text, new.next_follow_up_on::text);
  end if;
  if new.merged_into is distinct from old.merged_into then
    insert into public.lead_events (lead_id, actor_id, kind, from_value, to_value)
    values (new.id, v_actor, case when new.merged_into is null then 'unmerged' else 'merged' end,
            old.merged_into::text, new.merged_into::text);
  end if;
  -- Retention anonymised the lead: its notes are free text about the person.
  if new.anonymized_at is not null and old.anonymized_at is null then
    update public.lead_events set note = null where lead_id = new.id;
  end if;
  return new;
end;
$$;

create trigger leads_log_events
  after insert or update on public.leads
  for each row execute function public.leads_log_events();

-- ── add_lead_note ────────────────────────────────────────────────────────
-- Whoever may see the lead. Refuses a blank or over-long note, and one that
-- carries what looks like an ID, card or bank account number — the check
-- create_staff_lead runs on its free text (c_secret there).
create function public.add_lead_note(p_lead_id uuid, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_secret constant text :=
    '(^|[^0-9])([0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}|[0-9]{6,9})([^0-9]|$)|(^|[^A-Za-z0-9])[Ii][Ll][0-9]{2}[A-Za-z0-9]{17,}([^A-Za-z0-9]|$)';
  v_note text := btrim(coalesce(p_note, ''));
  v_id   bigint;
begin
  if not public.can_see_lead(p_lead_id)
     or exists (select 1 from public.leads l where l.id = p_lead_id and l.anonymized_at is not null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_note = '' then
    raise exception 'field_required' using errcode = '22023';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'field_too_long' using errcode = '22023';
  end if;
  if v_note ~ c_secret then
    raise exception 'field_invalid' using errcode = '22023';
  end if;

  insert into public.lead_events (lead_id, actor_id, kind, note)
  values (p_lead_id, auth.uid(), 'note', v_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_lead_note(uuid, text) from public, anon, authenticated;
grant execute on function public.add_lead_note(uuid, text) to authenticated;
revoke execute on function public.leads_log_events() from public, anon, authenticated;
