-- The new-agency wizard, Rollout step 1
-- (docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md).
--
-- Additive: two agency statuses before 'active', the onboarding role helper,
-- the licensee (agents), the profile's new columns, testimonials' consent,
-- success cases, the agent-photos bucket and the four RPCs. Nothing reads
-- any of it yet: no UI calls the RPCs, and the site still reads its constants.
-- agency_role() is not touched, so a draft agency's members get no lead data.
--
-- Field keys ('agents.licence_number', …) are spelled as in
-- src/config/onboarding.ts; tests/contract/agency-onboarding.contract.test.ts
-- fails when the two disagree.

-- ── statuses ───────────────────────────────────────────────────────────────
-- draft → pending_review → active ⇄ suspended; the operator may return a
-- pending agency to draft. The default stays 'active', so an insert that names
-- no status behaves as before.
alter table public.agencies drop constraint agencies_status_check;
alter table public.agencies add constraint agencies_status_check
  check (status in ('draft', 'pending_review', 'active', 'suspended'));

-- ── who is setting an agency up ────────────────────────────────────────────
-- Membership role in an agency that is still being set up (or is live).
-- Used ONLY by the onboarding policies below; lead data keeps agency_role(),
-- which stays null for draft and pending_review.
create function public.onboarding_role(p_agency_id uuid) returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.role
    from public.memberships m
    join public.agencies a on a.id = m.agency_id
   where m.agency_id = p_agency_id
     and m.user_id = auth.uid()
     and a.status in ('draft', 'pending_review', 'active')
$$;

-- Whether an agency is live. Asked by policies anon reads through, which
-- cannot read agencies itself; it tells nothing beyond what the public site shows.
create function public.agency_is_active(p_agency_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from public.agencies where id = p_agency_id and status = 'active')
$$;

-- '2026-10-agents-v5' → '2026-10-agents-v6'; null → 'v1'; no trailing number → '-2' appended.
create function public.next_consent_version(p_version text) returns text
  language sql
  immutable
  set search_path = ''
as $$
  select case
    when p_version is null or btrim(p_version) = '' then 'v1'
    when p_version ~ '\d+$'
      then regexp_replace(p_version, '\d+$', '') || ((substring(p_version from '(\d+)$'))::numeric + 1)::text
    else p_version || '-2'
  end
$$;

-- The owner of a draft reads their agency's row (name, status); the
-- operator already reads every row, and nobody but the operator writes one.
create policy agencies_read_onboarding on public.agencies
  for select to authenticated using (public.onboarding_role(id) is not null);

-- Status moves into and out of draft / pending_review only through the RPCs
-- below, so activation always passes its gates. active ⇄ suspended stays the
-- operator's direct write, as before. Runs as the caller: a person
-- (authenticated) is held, the RPCs (their definer) and the server are not.
create function public.agencies_guard_status() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.status is distinct from old.status
     and (old.status in ('draft', 'pending_review') or new.status in ('draft', 'pending_review')) then
    raise exception 'use_onboarding_functions' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger agencies_guard_status
  before update on public.agencies
  for each row execute function public.agencies_guard_status();

-- ── the agency profile: the wizard's columns ───────────────────────────────
alter table public.agency_profiles
  -- Where lead mail goes: up to five addresses, each the shape create_agency
  -- accepts. Joined on a space, which no address may contain.
  add column notify_emails           text[] check (
    notify_emails is null
    or (cardinality(notify_emails) <= 5
        and array_position(notify_emails, null) is null
        and (cardinality(notify_emails) = 0
             or array_to_string(notify_emails, ' ') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+( [^@\s]+@[^@\s]+\.[^@\s]+)*$')
        and octet_length(array_to_string(notify_emails, ' ')) <= 1300)),
  add column domain                  text unique check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+$'),
  add column mail_from               text,
  add column consent_version         text,
  add column service_area            text check (char_length(service_area) <= 200),
  -- Wizard state (last step, per-step flags). The "review" key is the
  -- operator's: owner's email, submit / return / activate stamps and notes.
  -- Under 64 KB: it is read with every profile.
  add column onboarding              jsonb not null default '{}'::jsonb
    check (jsonb_typeof(onboarding) = 'object' and octet_length(onboarding::text) < 65536),
  -- Gate 3 of activation: the operator approved the disclosure sentences.
  add column disclosures_approved_at timestamptz,
  add column disclosures_approved_by uuid references auth.users(id) on delete set null;

-- A draft's profile row exists from create_agency on, before its contact
-- details are typed, and each step autosaves on its own. The columns stay
-- required where it matters: submit_agency_for_review and activate_agency
-- refuse an agency without them. Agency 1's row already has every value.
alter table public.agency_profiles
  alter column phone_e164               drop not null,
  alter column phone_display            drop not null,
  alter column whatsapp                 drop not null,
  alter column email                    drop not null,
  alter column default_whatsapp_message drop not null,
  alter column licence_entity           drop not null,
  alter column licence_number           drop not null,
  alter column licence_regulator        drop not null;

create policy agency_profiles_read_onboarding on public.agency_profiles
  for select to authenticated using (public.onboarding_role(agency_id) is not null);
-- The owner edits a draft's profile too (agency_profiles_update_owner asks
-- has_role, which is null until the agency is active). Admin and User do not.
create policy agency_profiles_update_onboarding_owner on public.agency_profiles
  for update to authenticated
  using (public.onboarding_role(agency_id) = 'owner')
  with check (public.onboarding_role(agency_id) = 'owner');

-- The operator's columns, and what changing the licence line costs. Runs as
-- the caller, like leads_guard_staff_fields: a person who is not the operator
-- is held; the RPCs and the agents trigger (their definer) are trusted.
create function public.agency_profiles_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_person   boolean := current_user in ('authenticated', 'anon');
  v_operator boolean := public.is_admin();
begin
  if tg_op = 'INSERT' then
    if v_person and not v_operator
       and (new.domain is not null or new.mail_from is not null or new.ga4_measurement_id is not null
            or new.consent_version is not null
            or new.disclosures_approved_at is not null or new.disclosures_approved_by is not null) then
      raise exception 'operator_only' using errcode = '42501';
    end if;
    if v_person and new.disclosures_approved_at is not null then
      new.disclosures_approved_at := now();
      new.disclosures_approved_by := auth.uid();
    end if;
    return new;
  end if;

  if v_person and not v_operator then
    if new.domain is distinct from old.domain
       or new.mail_from is distinct from old.mail_from
       or new.ga4_measurement_id is distinct from old.ga4_measurement_id
       or new.consent_version is distinct from old.consent_version
       or new.disclosures_approved_at is distinct from old.disclosures_approved_at
       or new.disclosures_approved_by is distinct from old.disclosures_approved_by then
      raise exception 'operator_only' using errcode = '42501';
    end if;
    -- The wizard writes its state whole; the operator's part survives it.
    new.onboarding := (new.onboarding - 'review')
      || case when old.onboarding ? 'review' then jsonb_build_object('review', old.onboarding -> 'review')
              else '{}'::jsonb end;
  elsif v_person and new.disclosures_approved_at is distinct from old.disclosures_approved_at then
    new.disclosures_approved_at := case when new.disclosures_approved_at is null then null else now() end;
    new.disclosures_approved_by := case when new.disclosures_approved_at is null then null else auth.uid() end;
  end if;

  -- The licence line is quoted by the notices: an approval of the old wording
  -- no longer holds, and a live agency's visitors consented under the old one.
  if new.licence_entity is distinct from old.licence_entity then
    new.disclosures_approved_at := null;
    new.disclosures_approved_by := null;
    if public.agency_is_active(new.agency_id) then
      new.consent_version := public.next_consent_version(old.consent_version);
    end if;
  end if;
  return new;
end;
$$;

create trigger agency_profiles_guard
  before insert or update on public.agency_profiles
  for each row execute function public.agency_profiles_guard();

-- ── agents: the licensee ───────────────────────────────────────────────────
-- Personal facts belong to the person, not the agency: an agency can later
-- have several licensees. Columns the wizard fills step by step are nullable
-- (each step autosaves); submit_agency_for_review holds them to complete.
create table public.agents (
  id                            uuid primary key default gen_random_uuid(),
  agency_id                     uuid not null references public.agencies(id) on delete cascade,
  user_id                       uuid references auth.users(id) on delete set null,
  full_name                     text not null,
  -- Drives every Hebrew sentence that names them ("בעלת/בעל רישיון").
  grammatical_gender            text check (grammatical_gender in ('f', 'm')),
  professional_title            text,
  -- In the agent-photos bucket, under this agent's own folder (see the
  -- agents_photo_path constraint below): the card serves it to visitors.
  photo_path                    text,
  photo_alt                     text check (char_length(photo_alt) <= 200),
  licence_number                text,
  licence_types                 text[] not null default '{}'
    check (licence_types <@ array['pension_agent', 'life_agent', 'general_agent', 'pension_advisor', 'pension_marketer']),
  licence_regulator             text not null default 'רשות שוק ההון, ביטוח וחיסכון',
  -- Null = not answered yet; decides which disclosure is shown (שיווק vs ייעוץ).
  has_institutional_affiliation boolean,
  affiliations                  text[] not null default '{}',
  -- The operator's, by trigger. verified_licence_number is the number that was
  -- checked: the site keeps showing it while a changed number awaits a check.
  -- Null = never checked, or the name changed since: the card is hidden.
  licence_verified_at           timestamptz,
  licence_verified_by           uuid references auth.users(id) on delete set null,
  verified_licence_number       text,
  -- Bounded: Dorit's own about texts come to about 2 KB, her three stats to 100 bytes.
  bio                           jsonb not null default '{}'::jsonb
    check (jsonb_typeof(bio) = 'object' and octet_length(bio::text) <= 16384),
  stats                         jsonb not null default '[]'::jsonb
    check (case when jsonb_typeof(stats) = 'array'
                then jsonb_array_length(stats) <= 3 and octet_length(stats::text) <= 1024
                else false end),
  booking_url                   text check (booking_url ~ '^https://'),
  meeting_minutes               integer not null default 15 check (meeting_minutes between 5 and 240),
  review_links                  jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review_links) = 'object' and (review_links - 'google' - 'midrag') = '{}'::jsonb
           and not jsonb_path_exists(review_links, '$.* ? (@.type() != "string" || !(@ like_regex "^https://"))')),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  -- Lets testimonials and success cases bind their agent to their own agency.
  unique (id, agency_id),
  -- Only a WebP in this agent's own folder of the bucket — never a URL, never
  -- another agency's file.
  constraint agents_photo_path check (
    photo_path is null
    or photo_path ~ ('^' || agency_id::text || '/' || id::text || '/[A-Za-z0-9_-]{1,100}\.webp$'))
);

create index agents_agency_idx on public.agents (agency_id);

create trigger agents_touch before update on public.agents
  for each row execute function public.touch_updated_at();

alter table public.agents enable row level security;

create policy agents_read_onboarding on public.agents
  for select to authenticated using (public.onboarding_role(agency_id) is not null or public.is_admin());
create policy agents_insert_owner on public.agents
  for insert to authenticated with check (public.onboarding_role(agency_id) = 'owner' or public.is_admin());
create policy agents_update_owner on public.agents
  for update to authenticated
  using (public.onboarding_role(agency_id) = 'owner' or public.is_admin())
  with check (public.onboarding_role(agency_id) = 'owner' or public.is_admin());
create policy agents_delete_operator on public.agents
  for delete to authenticated using (public.is_admin());

-- Licence verification is the operator's; the agency never changes; a person
-- links only their own account. The check covers who holds which licence, so
-- a change to the name, number, types or regulator voids it, in every status:
-- a check of other facts proves nothing about these.
--   · number, types or regulator: verified_licence_number stays, and the card
--     keeps showing that checked number until the new one is checked;
--   · name: verified_licence_number goes too, so the card hides the licensee
--     until the operator checks again — a checked number beside an unchecked
--     name would vouch for someone the register was never asked about.
-- Runs as the caller.
create function public.agents_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_person   boolean := current_user in ('authenticated', 'anon');
  v_operator boolean := public.is_admin();
begin
  if tg_op = 'INSERT' then
    if v_person and not v_operator then
      if new.licence_verified_at is not null or new.licence_verified_by is not null
         or new.verified_licence_number is not null then
        raise exception 'operator_only' using errcode = '42501';
      end if;
      if new.user_id is not null and new.user_id is distinct from auth.uid() then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end if;
    if new.licence_verified_at is not null then
      if v_person then
        new.licence_verified_at := now();
        new.licence_verified_by := auth.uid();
      end if;
      new.verified_licence_number := new.licence_number;
    end if;
    return new;
  end if;

  if v_person and not v_operator then
    if new.agency_id is distinct from old.agency_id then
      raise exception 'agency_fixed' using errcode = '42501';
    end if;
    if new.licence_verified_at is distinct from old.licence_verified_at
       or new.licence_verified_by is distinct from old.licence_verified_by
       or new.verified_licence_number is distinct from old.verified_licence_number then
      raise exception 'operator_only' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id and new.user_id is not null and new.user_id is distinct from auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if new.full_name is distinct from old.full_name then
    new.licence_verified_at := null;
    new.licence_verified_by := null;
    new.verified_licence_number := null;
  elsif (new.licence_number, new.licence_types, new.licence_regulator)
        is distinct from (old.licence_number, old.licence_types, old.licence_regulator) then
    new.licence_verified_at := null;
    new.licence_verified_by := null;
  elsif new.licence_verified_at is distinct from old.licence_verified_at then
    if v_person then
      new.licence_verified_at := case when new.licence_verified_at is null then null else now() end;
      new.licence_verified_by := case when new.licence_verified_at is null then null else auth.uid() end;
    end if;
    if new.licence_verified_at is not null then
      new.verified_licence_number := new.licence_number;
    end if;
  end if;
  return new;
end;
$$;

create trigger agents_guard
  before insert or update on public.agents
  for each row execute function public.agents_guard();

-- What a change to an agency's licensees does to its profile. Definer,
-- because it writes columns the owner may not (agency_profiles_guard trusts it).
--   · a licensee added or removed, or anything the disclosure sentences are
--     built from edited → the operator's approval of them lapses (activation
--     gate 3 must be passed again);
--   · on a live agency, a licensee added or removed, or a licence number, name
--     or gender edited → consent_version moves on: the notice its visitors
--     consent under now reads differently.
-- Telling the operator is a later PR.
create function public.agents_after_change() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_agency     uuid;
  v_disclosure boolean;
  v_consent    boolean;
begin
  if tg_op = 'UPDATE' then
    v_agency := new.agency_id;
    v_disclosure :=
      (new.full_name, new.grammatical_gender, new.professional_title, new.licence_number, new.licence_types,
       new.licence_regulator, new.has_institutional_affiliation, new.affiliations)
      is distinct from
      (old.full_name, old.grammatical_gender, old.professional_title, old.licence_number, old.licence_types,
       old.licence_regulator, old.has_institutional_affiliation, old.affiliations);
    v_consent :=
      (new.licence_number, new.full_name, new.grammatical_gender)
      is distinct from (old.licence_number, old.full_name, old.grammatical_gender);
  elsif tg_op = 'INSERT' then
    v_agency := new.agency_id;
    v_disclosure := true;
    v_consent := true;
  else
    v_agency := old.agency_id;
    v_disclosure := true;
    v_consent := true;
  end if;

  if v_disclosure then
    update public.agency_profiles
       set disclosures_approved_at = null, disclosures_approved_by = null
     where agency_id = v_agency and disclosures_approved_at is not null;
  end if;

  if v_consent and public.agency_is_active(v_agency) then
    update public.agency_profiles
       set consent_version = public.next_consent_version(consent_version)
     where agency_id = v_agency;
  end if;
  return null;
end;
$$;

create trigger agents_after_change
  after insert or update or delete on public.agents
  for each row execute function public.agents_after_change();

-- The public face of a licensee: display columns of live agencies only. A
-- definer view (security_invoker = false, the default, said out loud): anon
-- has no grant on agents and must not get one — that would expose
-- user_id and the verification columns — so the view reads as its owner and
-- the two filters are the only thing keeping drafts and unchecked licensees
-- out: a live agency, and a licensee the operator has checked
-- (verified_licence_number, which a name change clears — see agents_guard).
-- A licensee added to a live agency stays off the card until checked.
-- Do not drop either filter, and do not add columns without asking whether a
-- visitor may see them. The licence number shown is the verified one.
create view public.public_agent_cards with (security_invoker = false) as
  select g.id,
         g.agency_id,
         g.full_name,
         g.grammatical_gender,
         g.professional_title,
         g.photo_path,
         g.photo_alt,
         g.verified_licence_number as licence_number,
         g.licence_types,
         g.licence_regulator,
         g.has_institutional_affiliation,
         g.affiliations,
         g.bio,
         g.stats,
         g.booking_url,
         g.meeting_minutes,
         g.review_links
    from public.agents g
    join public.agencies a on a.id = g.agency_id
   where a.status = 'active'
     and g.verified_licence_number is not null;

-- ── testimonials: the licensee's, with the reviewer's consent ──────────────
-- Every existing row already has an agency (agency 1, by the tenant
-- migration's default; content-admin never sets another) and no agent. A
-- row of any other agency, or tied to a licensee — every row the wizard
-- writes — cannot be saved without the consent stamp; the rows content-admin
-- writes for agency 1 are unaffected. consent_confirmed_by is not required by
-- the checks: it goes null when that account is deleted, and requiring it
-- would make deleting the account fail. The stamp trigger below always fills
-- it for a person's write.
alter table public.testimonials
  add column agent_id             uuid,
  add column source_url           text check (source_url ~ '^https://'),
  -- An account id. testimonials is granted to anon whole (initial schema) and
  -- agency 1's rows are public, so the Data API shows this column to anyone
  -- who names it. Step 2's read side must not widen that: column grants, or a
  -- side table, before any other agency's testimonials are public.
  add column consent_confirmed_by uuid references auth.users(id) on delete set null,
  add column consent_confirmed_at timestamptz,
  add column sort_order           integer not null default 0,
  add constraint testimonials_agent_in_agency
    foreign key (agent_id, agency_id) references public.agents (id, agency_id),
  add constraint testimonials_agent_consent
    check (agent_id is null or consent_confirmed_at is not null);

-- Keyed on the agency too, so an Admin's direct write (testimonials_write_admin)
-- cannot save a new agency's testimonial without consent by leaving agent_id
-- out. NOT VALID: every row should be agency 1's, but production's rows were
-- not inspected, and another agency's legacy row must not fail the migration.
-- New and updated rows are held to it either way.
alter table public.testimonials add constraint testimonials_agency_consent
  check (agency_id = '00000000-0000-0000-0000-000000000001' or consent_confirmed_at is not null) not valid;

alter table public.testimonials drop constraint testimonials_source_check;
alter table public.testimonials add constraint testimonials_source_check
  check (source in ('google', 'midrag', 'direct'));

-- The consent stamp is the database's: a person who ticks the box is who
-- confirmed it, now — never a name or a date typed by the client.
create function public.testimonials_stamp_consent() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.consent_confirmed_at is null then
      new.consent_confirmed_by := null;
    elsif tg_op = 'INSERT' or old.consent_confirmed_at is null then
      new.consent_confirmed_at := now();
      new.consent_confirmed_by := auth.uid();
    else
      new.consent_confirmed_at := old.consent_confirmed_at;
      new.consent_confirmed_by := old.consent_confirmed_by;
    end if;
  end if;
  return new;
end;
$$;

create trigger testimonials_stamp_consent
  before insert or update on public.testimonials
  for each row execute function public.testimonials_stamp_consent();

-- The public read (testimonials_read_member_or_fixed_agency) is unchanged.
-- The owner of a draft reads and writes its testimonials; every row they
-- write names a licensee, so the consent constraint applies to it.
create policy testimonials_read_onboarding on public.testimonials
  for select to authenticated using (public.onboarding_role(agency_id) is not null);
create policy testimonials_write_onboarding_owner on public.testimonials
  for all to authenticated
  using (public.onboarding_role(agency_id) = 'owner')
  with check (public.onboarding_role(agency_id) = 'owner' and agent_id is not null);

-- ── success cases (optional step) ──────────────────────────────────────────
-- Today these are proof.c1…c7 in home.json. Anonymised by rule; the form warns.
create table public.success_cases (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  agent_id   uuid,
  -- Bounded like the bio: Dorit's longest case body is 192 characters.
  title      text not null check (char_length(title) <= 200),
  body       text not null check (char_length(body) <= 2000),
  metric     text check (char_length(metric) <= 100),
  sort_order integer not null default 0,
  published  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agent_id, agency_id) references public.agents (id, agency_id)
);

create index success_cases_agency_idx on public.success_cases (agency_id, sort_order);

create trigger success_cases_touch before update on public.success_cases
  for each row execute function public.touch_updated_at();

alter table public.success_cases enable row level security;

create policy success_cases_read_public on public.success_cases
  for select to anon, authenticated using (published and public.agency_is_active(agency_id));
create policy success_cases_read_onboarding on public.success_cases
  for select to authenticated using (public.onboarding_role(agency_id) is not null or public.is_admin());
create policy success_cases_write_owner on public.success_cases
  for all to authenticated
  using (public.onboarding_role(agency_id) = 'owner' or public.is_admin())
  with check (public.onboarding_role(agency_id) = 'owner' or public.is_admin());

-- ── agent-photos: the portrait ─────────────────────────────────────────────
-- Public, like content-images: the hero's <img> loads it by plain URL. The
-- browser crops and re-encodes to WebP at 480 / 768 / 1080 (stripping EXIF),
-- so WebP is the only type taken; 10 MB matches the client's own limit.
-- Path: <agency_id>/<agent_id>/<file>.webp, written by the agency's owner or
-- the operator. A select policy for the same people, because the Storage API
-- reads the row before it replaces or removes it; visitors need none.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-photos',
  'agent-photos',
  true,
  10485760, -- 10 MB
  array['image/webp']
);

-- The path names an agency the caller owns (or the caller is the operator)
-- and an agent of that agency. The shape is checked before either id is cast.
create function public.can_write_agent_photo(p_name text) returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_agency uuid;
  v_agent  uuid;
begin
  if p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,100}\.webp$' then
    return false;
  end if;
  v_agency := split_part(p_name, '/', 1)::uuid;
  v_agent  := split_part(p_name, '/', 2)::uuid;
  return (public.onboarding_role(v_agency) is not distinct from 'owner' or public.is_admin())
     and exists (select 1 from public.agents g where g.id = v_agent and g.agency_id = v_agency);
end;
$$;

create policy agent_photos_insert_owner on storage.objects
  for insert to authenticated
  with check (bucket_id = 'agent-photos' and public.can_write_agent_photo(name));
create policy agent_photos_update_owner on storage.objects
  for update to authenticated
  using (bucket_id = 'agent-photos' and public.can_write_agent_photo(name))
  with check (bucket_id = 'agent-photos' and public.can_write_agent_photo(name));
create policy agent_photos_delete_owner on storage.objects
  for delete to authenticated
  using (bucket_id = 'agent-photos' and public.can_write_agent_photo(name));
create policy agent_photos_select_owner on storage.objects
  for select to authenticated
  using (bucket_id = 'agent-photos' and public.can_write_agent_photo(name));

-- ── completeness ───────────────────────────────────────────────────────────
-- Every required field still empty, as the keys of src/config/onboarding.ts.
-- An agency with no agent reports every agent field. Called by the RPCs only.
create function public.onboarding_missing(p_agency_id uuid) returns text[]
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  p public.agency_profiles;
  g public.agents;
  v text[] := '{}';
begin
  select * into p from public.agency_profiles where agency_id = p_agency_id;

  if nullif(btrim(p.display_name), '') is null then v := array_append(v, 'agency_profiles.display_name'); end if;
  if nullif(btrim(p.phone_e164), '') is null then v := array_append(v, 'agency_profiles.phone_e164'); end if;
  if nullif(btrim(p.phone_display), '') is null then v := array_append(v, 'agency_profiles.phone_display'); end if;
  if nullif(btrim(p.whatsapp), '') is null then v := array_append(v, 'agency_profiles.whatsapp'); end if;
  if nullif(btrim(p.email), '') is null then v := array_append(v, 'agency_profiles.email'); end if;
  if nullif(btrim(p.default_whatsapp_message), '') is null then v := array_append(v, 'agency_profiles.default_whatsapp_message'); end if;
  if nullif(btrim(p.licence_entity), '') is null then v := array_append(v, 'agency_profiles.licence_entity'); end if;
  if coalesce(cardinality(p.notify_emails), 0) = 0 then v := array_append(v, 'agency_profiles.notify_emails'); end if;

  for g in
    select * from public.agents where agency_id = p_agency_id
    union all
    select (null::public.agents).* where not exists (select 1 from public.agents where agency_id = p_agency_id)
  loop
    if nullif(btrim(g.full_name), '') is null then v := array_append(v, 'agents.full_name'); end if;
    if g.grammatical_gender is null then v := array_append(v, 'agents.grammatical_gender'); end if;
    if nullif(btrim(g.professional_title), '') is null then v := array_append(v, 'agents.professional_title'); end if;
    if nullif(btrim(g.licence_number), '') is null then v := array_append(v, 'agents.licence_number'); end if;
    if coalesce(cardinality(g.licence_types), 0) = 0 then v := array_append(v, 'agents.licence_types'); end if;
    if nullif(btrim(g.licence_regulator), '') is null then v := array_append(v, 'agents.licence_regulator'); end if;
    if g.has_institutional_affiliation is null then v := array_append(v, 'agents.has_institutional_affiliation'); end if;
    if g.has_institutional_affiliation and coalesce(cardinality(g.affiliations), 0) = 0 then
      v := array_append(v, 'agents.affiliations');
    end if;
    if nullif(btrim(g.bio ->> 'headline'), '') is null then v := array_append(v, 'agents.bio.headline'); end if;
    if nullif(btrim(g.bio ->> 'career'), '') is null then v := array_append(v, 'agents.bio.career'); end if;
  end loop;

  -- Once each, in first-seen order.
  return coalesce((select array_agg(k order by i)
                     from (select k, min(i) as i from unnest(v) with ordinality as u(k, i) group by k) d), '{}');
end;
$$;

-- ── the four RPCs ──────────────────────────────────────────────────────────
-- Operator = public.is_admin() (profiles.role = 'admin', "מפעיל הפלטפורמה"),
-- never an agency's Admin. Each checks its caller itself.

-- Step 0: a draft agency and its profile row. No membership: the owner's
-- invitation is invite-user's (an RPC cannot send mail), called next by the
-- UI, and only it makes members — never an email match here, which could hand
-- a draft to whoever registered the address first. The address is kept in
-- onboarding.review so the review screen can show and resend it.
create function public.create_agency(p_name text, p_owner_email text, p_dpa_date date) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'field_required' using errcode = '22023';
  end if;
  if length(v_name) > 200 then
    raise exception 'field_too_long' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  insert into public.agencies (name, status, data_processing_agreement_date)
  values (v_name, 'draft', p_dpa_date)
  returning id into v_id;

  insert into public.agency_profiles (agency_id, display_name, onboarding)
  values (v_id, v_name, jsonb_build_object('review', jsonb_build_object(
    'owner_email', v_email, 'opened_by', auth.uid(), 'opened_at', now())));

  return v_id;
end;
$$;

-- Step 7: the owner (or the operator) sends a complete draft for approval.
create function public.submit_agency_for_review(p_agency_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status  text;
  v_missing text[];
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.onboarding_role(p_agency_id) is not distinct from 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.agencies where id = p_agency_id for update;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'wrong_status' using errcode = '55000', detail = v_status;
  end if;

  v_missing := public.onboarding_missing(p_agency_id);
  if cardinality(v_missing) > 0 then
    raise exception 'incomplete' using errcode = '23514', detail = array_to_string(v_missing, ',');
  end if;

  update public.agencies set status = 'pending_review' where id = p_agency_id;
  update public.agency_profiles
     set onboarding = jsonb_set(onboarding, '{review}', coalesce(onboarding -> 'review', '{}'::jsonb)
           || jsonb_build_object('submitted_at', now(), 'submitted_by', auth.uid()))
   where agency_id = p_agency_id;
end;
$$;

-- "החזרה לתיקונים": back to draft with the operator's note. Mailing the owner
-- is a later PR.
create function public.return_agency(p_agency_id uuid, p_note text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_note   text := btrim(coalesce(p_note, ''));
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_note = '' then
    raise exception 'field_required' using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'field_too_long' using errcode = '22023';
  end if;
  select status into v_status from public.agencies where id = p_agency_id for update;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'wrong_status' using errcode = '55000', detail = v_status;
  end if;

  update public.agencies set status = 'draft' where id = p_agency_id;
  update public.agency_profiles
     set onboarding = jsonb_set(onboarding, '{review}', coalesce(onboarding -> 'review', '{}'::jsonb)
           || jsonb_build_object('returned_at', now(), 'returned_by', auth.uid(), 'return_note', v_note))
   where agency_id = p_agency_id;
end;
$$;

-- "הפעלה": from pending_review only. A suspended agency comes back by the
-- operator's direct status write, as before — reinstating is not onboarding,
-- and agency 1 has no agents row or DPA date to pass these gates with.
-- Re-checks completeness (the draft may have moved since submit), then the
-- three gates: every licensee's licence checked on the register, the
-- processing agreement dated, the disclosures approved.
create function public.activate_agency(p_agency_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_agency  public.agencies;
  v_missing text[];
  v_gates   text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_agency from public.agencies where id = p_agency_id for update;
  if v_agency.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_agency.status <> 'pending_review' then
    raise exception 'wrong_status' using errcode = '55000', detail = v_agency.status;
  end if;

  v_missing := public.onboarding_missing(p_agency_id);
  if cardinality(v_missing) > 0 then
    raise exception 'incomplete' using errcode = '23514', detail = array_to_string(v_missing, ',');
  end if;

  if not exists (select 1 from public.agents where agency_id = p_agency_id)
     or exists (select 1 from public.agents where agency_id = p_agency_id and licence_verified_at is null) then
    v_gates := array_append(v_gates, 'agents.licence_verified_at');
  end if;
  if v_agency.data_processing_agreement_date is null then
    v_gates := array_append(v_gates, 'agencies.data_processing_agreement_date');
  end if;
  if not exists (select 1 from public.agency_profiles
                  where agency_id = p_agency_id and disclosures_approved_at is not null) then
    v_gates := array_append(v_gates, 'agency_profiles.disclosures_approved_at');
  end if;
  if cardinality(v_gates) > 0 then
    raise exception 'gates_closed' using errcode = '23514', detail = array_to_string(v_gates, ',');
  end if;

  update public.agencies set status = 'active' where id = p_agency_id;
  -- The first notice its visitors will consent under.
  update public.agency_profiles
     set consent_version = coalesce(consent_version, 'v1'),
         onboarding = jsonb_set(onboarding, '{review}', coalesce(onboarding -> 'review', '{}'::jsonb)
           || jsonb_build_object('activated_at', now(), 'activated_by', auth.uid()))
   where agency_id = p_agency_id;
end;
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
-- Same shape as the tenant tables: policies decide the rows, grants whether
-- the Data API discusses the table. TRUNCATE and the rest from Supabase's
-- default privileges go with the revoke.
revoke all on public.agents, public.success_cases from anon, authenticated, service_role;
grant select, insert, update, delete on public.agents        to authenticated;
grant select, insert, update, delete on public.success_cases to authenticated;
grant select on public.success_cases to anon;
revoke all on public.public_agent_cards from anon, authenticated, service_role;
grant select on public.public_agent_cards to anon, authenticated;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so each revoke names them.
revoke execute on function public.onboarding_role(uuid)                from public, anon, authenticated;
revoke execute on function public.agency_is_active(uuid)               from public, anon, authenticated;
revoke execute on function public.next_consent_version(text)           from public, anon, authenticated;
revoke execute on function public.agencies_guard_status()              from public, anon, authenticated;
revoke execute on function public.agency_profiles_guard()              from public, anon, authenticated;
revoke execute on function public.agents_guard()                       from public, anon, authenticated;
revoke execute on function public.agents_after_change()                from public, anon, authenticated;
revoke execute on function public.testimonials_stamp_consent()         from public, anon, authenticated;
revoke execute on function public.can_write_agent_photo(text)          from public, anon, authenticated;
revoke execute on function public.onboarding_missing(uuid)             from public, anon, authenticated;
revoke execute on function public.create_agency(text, text, date)      from public, anon, authenticated;
revoke execute on function public.submit_agency_for_review(uuid)       from public, anon, authenticated;
revoke execute on function public.return_agency(uuid, text)            from public, anon, authenticated;
revoke execute on function public.activate_agency(uuid)                from public, anon, authenticated;
-- Asked inside policies and the profile trigger, which run as the person.
grant execute on function public.onboarding_role(uuid)             to authenticated;
grant execute on function public.can_write_agent_photo(text)       to authenticated;
grant execute on function public.next_consent_version(text)        to authenticated;
-- success_cases_read_public is evaluated for visitors too.
grant execute on function public.agency_is_active(uuid)            to anon, authenticated;
grant execute on function public.create_agency(text, text, date)   to authenticated;
grant execute on function public.submit_agency_for_review(uuid)    to authenticated;
grant execute on function public.return_agency(uuid, text)         to authenticated;
grant execute on function public.activate_agency(uuid)             to authenticated;
