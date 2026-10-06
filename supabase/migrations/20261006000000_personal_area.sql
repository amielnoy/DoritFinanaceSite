-- A personal area for signed-in visitors.
--
-- An enquiry belongs to the user whose verified email equals the enquiry's
-- email. The risk that accepts is recorded in base44/agents/COMPLIANCE.md §6;
-- design in docs/superpowers/specs/2026-10-06-personal-area-design.md.
--
-- The tables gain no policy. `enquiries_for` is the only door, and it names
-- every column that leaves — a column added to `leads` later is invisible to
-- a visitor until someone adds it here on purpose.

-- ── what the page shows that was stored nowhere ─────────────────────────────
alter table public.leads
  add column summary     text,
  add column profile     jsonb,   -- [[label, value], ...] as the summary mail shows them
  add column track_label text;

-- ── who is asking ───────────────────────────────────────────────────────────
-- Null for an unconfirmed address, so an unverified sign-up sees nothing.
create or replace function public.my_email() returns text
  language sql security definer stable set search_path = public as $$
  select nullif(lower(trim(email)), '') from auth.users
   where id = auth.uid() and email_confirmed_at is not null
$$;

-- ── what a visitor may see ──────────────────────────────────────────────────
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
    left join public.meetings m on m.lead_base44_id = l.base44_id
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
   order by l.created_at desc
$$;

create or replace function public.my_enquiries()
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
  select * from public.enquiries_for(public.my_email())
$$;

-- Supabase's default privileges hand EXECUTE on a new function to anon and
-- authenticated by name, so revoking from `public` alone closes nothing.
revoke all on function public.my_email()            from public, anon, authenticated;
revoke all on function public.enquiries_for(text)   from public, anon, authenticated;
revoke all on function public.my_enquiries()        from public, anon, authenticated;
grant execute on function public.my_email()          to authenticated;
grant execute on function public.enquiries_for(text) to service_role;
grant execute on function public.my_enquiries()      to authenticated;
