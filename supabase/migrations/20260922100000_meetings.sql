-- The meeting, which until now was stored nowhere at all.
--
-- The interview agent asks when the visitor wants to meet, builds an ISO
-- `scheduledAt` from the answer, and hands it to the calendar APIs. That was
-- the whole life of the value: the Base44 `Lead` entity has no field for it,
-- and neither did this schema, so the agreed time existed only as an argument
-- in flight. When the agent stopped sending it, nothing recorded that either —
-- the mail still went out, the calendar quietly booked a default slot, and the
-- only trace was a line in the function log.
--
-- Two places, because the two answer different questions. A column on `leads`
-- answers "when did this enquiry want to meet?" while you are looking at the
-- enquiry. A row in `meetings` answers "what is in the diary, and did the
-- calendar actually take it?" — which is a fact about the booking, has its own
-- lifecycle, and is the part that was invisible.

-- ── the enquiry's own meeting fields ────────────────────────────────────────
--
-- `meeting_topic` is deliberately not `topic`. `topic` is the interest area
-- ("גמל, השתלמות ופנסיה") and is derived from the interview profile; the
-- meeting topic is what the two of them agreed to sit down about. They are
-- usually related and occasionally not, and collapsing them loses the second.
alter table public.leads
  add column scheduled_at  timestamptz,
  add column meeting_topic text,
  add column notes         text,
  add column track         text;

-- ── the booking ─────────────────────────────────────────────────────────────
create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  -- Keyed on the lead rather than carrying its own copy of the name and phone.
  -- The contact details are already one table away, and a second copy is a
  -- second place a deletion request has to reach. `on delete cascade` means
  -- erasing the lead erases the meeting with it, rather than leaving an orphan
  -- row that still says who was meeting whom and when.
  lead_base44_id   text not null unique references public.leads(base44_id) on delete cascade,

  -- What was agreed.
  scheduled_at     timestamptz,
  topic            text,
  -- The visitor's own words ("חמישי השבוע, 24/09, 10:00"). Kept beside the
  -- parsed timestamp, not instead of it: when the two disagree, the sentence is
  -- the evidence of what was actually asked for.
  timing           text,
  notes            text,
  track            text,
  source           text check (source in ('consultation','interview')),

  -- What the calendar did about it. `scheduled_at` is the intent; these are the
  -- outcome, and the gap between them is the failure this table exists to make
  -- visible rather than leave in a log line nobody reads.
  calendar_status  text,
  calendar_at      timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index on public.meetings (scheduled_at);

create trigger meetings_touch before update on public.meetings
  for each row execute function public.touch_updated_at();

-- ── policies ────────────────────────────────────────────────────────────────
--
-- Unlike `leads`, there is no public insert. Nothing in a browser writes a
-- meeting: it is written by `submitLead` with the service key, which bypasses
-- RLS. anon has no policy here and no grant below, so the Data API will not
-- discuss this table with an unauthenticated caller at all.
alter table public.meetings enable row level security;

create policy meetings_read_admin on public.meetings
  for select to authenticated using (public.is_admin());
create policy meetings_write_admin on public.meetings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Data API grants ─────────────────────────────────────────────────────────
--
-- Same rule as the first migration: the project does not expose new tables
-- automatically, so a table is unreachable until it is named here. Never anon.
grant select, insert, update, delete on public.meetings to authenticated;

-- The backend function writes as the service role. The first schema forgot
-- these for the other tables and every mirror failed silently until a later
-- migration added them; not repeating that here.
grant select, insert, update, delete on public.meetings to service_role;
