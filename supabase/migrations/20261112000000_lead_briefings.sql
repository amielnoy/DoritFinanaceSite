-- The AI briefing before a call (feature 4): "תדריך לפני שיחה" in a lead's
-- drawer. The lead-briefing Edge Function writes one row per generation; the
-- screen shows the newest. Regenerating adds a row, so this month's spend is
-- the sum of the rows (lead_briefing_month_usage) and nothing is overwritten.
--
-- What a row holds is the model's draft, written from the lead's interview
-- answers and transcript after the function took out every phone, email and
-- the name — never contact details. It is still about the person, so it goes
-- with the lead: deleted with it (on delete cascade) and when retention
-- anonymises it (leads_drop_briefings below).
--
-- Nobody signed in writes here: the function inserts with the service role,
-- after can_see_lead under the caller's own session. Whoever may see the lead
-- reads its briefings, as with its activity log.

create table public.lead_briefings (
  id             bigint generated always as identity primary key,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  agency_id      uuid not null references public.agencies(id),
  -- (1) up to three lines on the interview
  summary        text[] not null check (cardinality(summary) between 1 and 3
                                        and char_length(array_to_string(summary, ' ')) <= 1200),
  -- (2) the client's main concern
  concern        text not null check (char_length(concern) between 1 and 400),
  -- (3) suggested questions for the call
  questions      text[] not null check (cardinality(questions) between 1 and 3
                                        and char_length(array_to_string(questions, ' ')) <= 1200),
  -- (4) talking points: service areas to raise, never a company, policy or figure
  talking_points text[] not null check (cardinality(talking_points) between 1 and 5
                                        and char_length(array_to_string(talking_points, ' ')) <= 1500),
  model          text not null check (char_length(model) <= 100),
  input_tokens   integer not null default 0 check (input_tokens >= 0),
  cached_tokens  integer not null default 0 check (cached_tokens >= 0),
  output_tokens  integer not null default 0 check (output_tokens >= 0),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index lead_briefings_lead_created on public.lead_briefings (lead_id, created_at desc);
create index lead_briefings_agency_created on public.lead_briefings (agency_id, created_at);

alter table public.lead_briefings enable row level security;
revoke all on public.lead_briefings from public, anon, authenticated;
grant select on public.lead_briefings to authenticated;
grant all on public.lead_briefings to service_role;
create policy lead_briefings_read on public.lead_briefings
  for select to authenticated using (public.can_see_lead(lead_id));

-- Retention anonymised the lead: its briefing is a summary of the person.
create function public.leads_drop_briefings() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  delete from public.lead_briefings where lead_id = new.id;
  return new;
end;
$$;
revoke execute on function public.leads_drop_briefings() from public, anon, authenticated;

create trigger leads_drop_briefings
  after update of anonymized_at on public.leads
  for each row
  when (new.anonymized_at is not null and old.anonymized_at is null)
  execute function public.leads_drop_briefings();

-- This month's briefing tokens per model, for the function's budget check
-- (chat_month_usage's shape: a handful of rows, not every briefing).
create function public.lead_briefing_month_usage(p_agency_id uuid, p_since timestamptz)
  returns table (model text, input_tokens bigint, cached_tokens bigint, output_tokens bigint)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select b.model, sum(b.input_tokens), sum(b.cached_tokens), sum(b.output_tokens)
    from public.lead_briefings b
   where b.agency_id = p_agency_id and b.created_at >= p_since
   group by b.model;
$$;
revoke execute on function public.lead_briefing_month_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.lead_briefing_month_usage(uuid, timestamptz) to service_role;
