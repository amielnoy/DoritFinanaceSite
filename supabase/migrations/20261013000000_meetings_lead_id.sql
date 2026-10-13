-- A booking keyed by the lead's Supabase id, not its Base44 id.
--
-- meetings.lead_base44_id (not null, FK to leads.base44_id) was the only key,
-- and enquiries_for joined on it. A lead written only to Supabase — every lead
-- once submit-lead serves the site — has no base44_id, so it could not get a
-- booking row, and the personal area could not show one. See
-- docs/superpowers/specs/2026-10-12-connectors-off-base44-design.md.

alter table public.meetings
  add column lead_id uuid references public.leads(id) on delete cascade;

update public.meetings m
   set lead_id = l.id
  from public.leads l
 where l.base44_id = m.lead_base44_id;

alter table public.meetings alter column lead_id set not null;
alter table public.meetings add constraint meetings_lead_id_key unique (lead_id);
alter table public.meetings alter column lead_base44_id drop not null;

-- Until Base44 stops writing, its mirror upserts by lead_base44_id alone.
-- Fill lead_id from it so that path keeps working; a row with neither is
-- refused by the not-null above.
create function public.meetings_fill_lead_id() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is null and new.lead_base44_id is not null then
    select l.id into new.lead_id from public.leads l where l.base44_id = new.lead_base44_id;
  end if;
  return new;
end;
$$;

create trigger meetings_fill_lead_id
  before insert or update on public.meetings
  for each row execute function public.meetings_fill_lead_id();

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
    left join public.meetings m on m.lead_id = l.id
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
   order by l.created_at desc
$$;
