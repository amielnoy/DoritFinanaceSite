-- Reactivation campaigns, stage 1: a general link an agency sends its own
-- existing clients, and the leads it brings back.
--
-- The link is the site with ?utm_source=reactivation&utm_campaign=<code>
-- (src/lib/campaigns.ts). The browser records it as the lead's channel and
-- campaign (src/lib/attribution.ts — the one link that overrides first touch),
-- and submit-lead saves them on the lead as it already does for every channel.
-- So a lead from a campaign is an ordinary lead with channel 'reactivation'
-- and campaign = the campaign's code; nothing about the lead itself is new.
--
-- campaigns holds what the agency sends: a name, a code and the message.
-- Every message must carry an opt-out line ("להסרה…"); the screen refuses
-- one without it and so does the table.

-- ── the leads' channel gains 'reactivation' ─────────────────────────────
alter table public.leads drop constraint leads_channel_check;
alter table public.leads add constraint leads_channel_check check (channel in (
  'google','facebook','instagram','linkedin','ai_assistant',
  'email','sms','referral','direct','reactivation','unknown'
));

-- ── campaigns ───────────────────────────────────────────────────────────
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  -- The link's utm_campaign: random, lower-case, so it says nothing and
  -- survives attribution's sanitising (letters, digits, '-').
  code        text not null check (code ~ '^[a-z0-9]{8,32}$'),
  message     text not null check (char_length(message) between 1 and 1000 and message like '%להסרה%'),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (agency_id, code)
);
create index campaigns_agency_created on public.campaigns (agency_id, created_at desc);

alter table public.campaigns enable row level security;
revoke all on public.campaigns from public, anon, authenticated;
grant select, insert, update on public.campaigns to authenticated;
grant all on public.campaigns to service_role;

-- Every member sees the agency's campaigns, to tell where a lead came from.
create policy campaigns_read_member on public.campaigns
  for select to authenticated
  using (public.has_role(agency_id, 'user') or public.is_admin());

-- Admin and Owner create and edit them (they speak for the agency), as
-- themselves; nobody deletes one — a campaign is archived, and its leads keep
-- pointing at it.
create policy campaigns_insert_admin on public.campaigns
  for insert to authenticated
  with check ((public.has_role(agency_id, 'admin') or public.is_admin())
              and created_by is not distinct from auth.uid());
create policy campaigns_update_admin on public.campaigns
  for update to authenticated
  using (public.has_role(agency_id, 'admin') or public.is_admin())
  with check (public.has_role(agency_id, 'admin') or public.is_admin());

-- The agency, the code and the author stay what they were.
create function public.campaigns_guard_fixed() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.agency_id is distinct from old.agency_id
     or new.code is distinct from old.code
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'campaign_fixed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger campaigns_guard_fixed
  before update on public.campaigns
  for each row execute function public.campaigns_guard_fixed();
