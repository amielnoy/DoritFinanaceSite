-- The new-agency wizard's schema (20261106000000_agency_onboarding.sql),
-- against a local `supabase start`, in the style of staff_leads_check.sql:
-- every block raises on a wrong answer, so a clean run is the assertion.
-- Synthetic data; rolled back.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/onboarding_check.sql
\set ON_ERROR_STOP on
begin;

-- D: a draft agency · E: another draft agency · agency 1 is Dorit's (seeded)
-- a0 the operator · a1 D's owner · a2 D's Admin · a3 D's User · a4 E's owner
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-0000000000a0','authenticated','authenticated','ob-operator@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-0000000000a1','authenticated','authenticated','ob-owner@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-0000000000a2','authenticated','authenticated','ob-admin@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-0000000000a3','authenticated','authenticated','ob-user@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-0000000000a4','authenticated','authenticated','ob-other@example.com', now());
insert into public.profiles (id, role) values ('eeeeeeee-0000-0000-0000-0000000000a0', 'admin')
  on conflict (id) do update set role = 'admin';

insert into public.agencies (id, name, status) values
  ('dddddddd-0000-0000-0000-00000000000d', 'סוכנות טיוטה', 'draft'),
  ('dddddddd-0000-0000-0000-00000000000e', 'סוכנות אחרת', 'draft');
insert into public.agency_profiles (agency_id, display_name, onboarding) values
  ('dddddddd-0000-0000-0000-00000000000d', 'סוכנות טיוטה', '{"review":{"owner_email":"ob-owner@example.com"}}'),
  ('dddddddd-0000-0000-0000-00000000000e', 'סוכנות אחרת', '{}');
insert into public.memberships (user_id, agency_id, role) values
  ('eeeeeeee-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-00000000000d', 'owner'),
  ('eeeeeeee-0000-0000-0000-0000000000a2', 'dddddddd-0000-0000-0000-00000000000d', 'admin'),
  ('eeeeeeee-0000-0000-0000-0000000000a3', 'dddddddd-0000-0000-0000-00000000000d', 'user'),
  ('eeeeeeee-0000-0000-0000-0000000000a4', 'dddddddd-0000-0000-0000-00000000000e', 'owner');
-- E's licensee, written by the server, for the cross-agency blocks below.
insert into public.agents (id, agency_id, full_name) values
  ('99999999-0000-0000-0000-00000000000e', 'dddddddd-0000-0000-0000-00000000000e', 'סוכן אחר');
insert into public.success_cases (agency_id, title, body, published) values
  ('dddddddd-0000-0000-0000-00000000000e', 'תיק של טיוטה', 'גוף', true);

-- ── the statuses, and existing rows ───────────────────────────────────────
do $$ begin
  begin
    insert into public.agencies (name, status) values ('x', 'archived');
    raise exception 'an unknown agency status was accepted';
  exception when check_violation then null;
  end;
  if (select status from public.agencies where id = '00000000-0000-0000-0000-000000000001') <> 'active' then
    raise exception 'agency 1 is no longer active';
  end if;
  -- An existing testimonial (no agent, no consent) is still valid; 'direct' is a source now.
  insert into public.testimonials (name, quote, agency_id, source)
  values ('ותיקה', 'תודה', '00000000-0000-0000-0000-000000000001', 'direct');
  begin
    insert into public.testimonials (name, quote, agency_id)
    values ('x', 'y', 'dddddddd-0000-0000-0000-00000000000e');
    raise exception 'another agency''s testimonial without consent was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.testimonials (name, quote, agency_id, source)
    values ('x', 'y', '00000000-0000-0000-0000-000000000001', 'facebook');
    raise exception 'an unknown testimonial source was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ═══ create_agency ═══════════════════════════════════════════════════════
-- Not callable by a visitor at all.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.create_agency('x', 'x@example.com', null);
    raise exception 'anon called create_agency';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'anon called submit_agency_for_review';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.return_agency('dddddddd-0000-0000-0000-00000000000d', 'x');
    raise exception 'anon called return_agency';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'anon called activate_agency';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- An agency's owner is not the operator.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  begin
    perform public.create_agency('x', 'x@example.com', null);
    raise exception 'an owner opened an agency';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  -- The completeness helper is the RPCs' alone.
  begin
    perform public.onboarding_missing('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'a person called onboarding_missing';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  begin
    perform public.create_agency('  ', 'x@example.com', null);
    raise exception 'an agency without a name was opened';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_required' then raise; end if;
  end;
  begin
    perform public.create_agency('x', 'not-an-email', null);
    raise exception 'an agency was opened for a bad address';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_email' then raise; end if;
  end;

  -- The address belongs to an existing, confirmed account (a4): still no membership.
  v_id := public.create_agency('  סוכנות חדשה ', ' OB-Other@Example.com ', '2026-10-01');
  if (select status from public.agencies where id = v_id) <> 'draft' then
    raise exception 'create_agency did not open a draft';
  end if;
  if (select data_processing_agreement_date from public.agencies where id = v_id) <> '2026-10-01' then
    raise exception 'create_agency lost the DPA date';
  end if;
  if (select display_name from public.agency_profiles where agency_id = v_id) <> 'סוכנות חדשה' then
    raise exception 'create_agency did not start the profile from the name';
  end if;
  if (select onboarding #>> '{review,owner_email}' from public.agency_profiles where agency_id = v_id) <> 'ob-other@example.com' then
    raise exception 'create_agency did not keep the owner''s address';
  end if;
  if exists (select 1 from public.memberships where agency_id = v_id) then
    raise exception 'create_agency made a membership — that is invite-user''s';
  end if;

  -- The operator's own insert of a profile: the approval is stamped now, by them.
  insert into public.agencies (id, name) values ('dddddddd-0000-0000-0000-00000000000f', 'הוספה ישירה');
  insert into public.agency_profiles (agency_id, display_name, disclosures_approved_at, disclosures_approved_by)
  values ('dddddddd-0000-0000-0000-00000000000f', 'הוספה ישירה', '2001-01-01', 'eeeeeeee-0000-0000-0000-0000000000a1');
  if (select disclosures_approved_at from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000f') < now() - interval '1 minute'
     or (select disclosures_approved_by from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000f')
        <> 'eeeeeeee-0000-0000-0000-0000000000a0' then
    raise exception 'the operator''s inserted approval kept the client''s date or name';
  end if;
end $$;
reset role;

-- ═══ a draft's owner ═════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare
  n integer;
begin
  -- Lead data stays closed: agency_role() and can_see() know nothing of a draft.
  if public.agency_role('dddddddd-0000-0000-0000-00000000000d') is not null then
    raise exception 'agency_role() answered for a draft agency';
  end if;
  if public.can_see('dddddddd-0000-0000-0000-00000000000d') then
    raise exception 'can_see() answered true for a draft agency';
  end if;
  if public.my_agency_role('dddddddd-0000-0000-0000-00000000000d') is not null then
    raise exception 'my_agency_role() answered for a draft agency';
  end if;
  if public.onboarding_role('dddddddd-0000-0000-0000-00000000000d') is distinct from 'owner' then
    raise exception 'onboarding_role() does not see the owner of a draft';
  end if;

  -- Reads their own agency, profile — and nobody else's.
  if (select count(*) from public.agencies where id = 'dddddddd-0000-0000-0000-00000000000d') <> 1 then
    raise exception 'the owner cannot read their draft agency';
  end if;
  if (select count(*) from public.agencies where id = 'dddddddd-0000-0000-0000-00000000000e') <> 0 then
    raise exception 'the owner reads another draft agency';
  end if;
  if (select count(*) from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000e') <> 0 then
    raise exception 'the owner reads another agency''s profile';
  end if;
  if (select count(*) from public.agents where agency_id = 'dddddddd-0000-0000-0000-00000000000e') <> 0 then
    raise exception 'the owner reads another agency''s agents';
  end if;

  -- Writes the profile.
  update public.agency_profiles set phone_e164 = '+972501234567', phone_display = '050-123-4567',
         whatsapp = '972501234567', email = 'owner@example.com'
   where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'the owner could not write their draft''s profile'; end if;

  -- The wizard's state is theirs; the operator's part of it survives a whole write.
  update public.agency_profiles set onboarding = '{"last_step": 3, "review": {"owner_email": "evil@example.com"}}'
   where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  if (select onboarding ->> 'last_step' from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> '3'
     or (select onboarding #>> '{review,owner_email}' from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'ob-owner@example.com' then
    raise exception 'the owner rewrote the operator''s review notes, or lost their own step';
  end if;

  -- The notification list: up to five real-looking addresses.
  update public.agency_profiles set notify_emails = array['a@example.com', 'b@example.com']
   where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  begin
    update public.agency_profiles set notify_emails = array['not an address']
     where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'a notification address that is not one was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.agency_profiles set notify_emails = array['a@example.com', '']
     where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'an empty notification address was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.agency_profiles
       set notify_emails = array['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com']
     where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'a sixth notification address was accepted';
  exception when check_violation then null;
  end;
  update public.agency_profiles set notify_emails = null where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  -- The wizard's state stays small.
  begin
    update public.agency_profiles set onboarding = jsonb_build_object('blob', repeat('x', 70000))
     where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'a 70 KB onboarding state was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.agency_profiles set service_area = repeat('א', 201) where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'a 201-character service area was accepted';
  exception when check_violation then null;
  end;

  -- Not another agency's.
  update public.agency_profiles set email = 'x@example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000e';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner wrote another agency''s profile'; end if;

  -- Not the operator's columns.
  begin
    update public.agency_profiles set domain = 'evil.example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the owner set the domain';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    update public.agency_profiles set mail_from = 'x@evil.example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the owner set the mail sender';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    update public.agency_profiles set ga4_measurement_id = 'G-EVIL' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the owner set GA4';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    update public.agency_profiles set disclosures_approved_at = now() where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the owner approved their own disclosures';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    update public.agency_profiles set consent_version = 'mine' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the owner set the consent version';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;

  -- Not the status: there is no write policy on agencies for them.
  update public.agencies set status = 'active' where id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner changed their agency''s status'; end if;
  update public.agencies set name = 'x' where id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner wrote the agency row'; end if;

  -- The agent row: theirs to create, linked to themselves only, never verified by them.
  insert into public.agents (id, agency_id, user_id, full_name)
  values ('99999999-0000-0000-0000-00000000000d', 'dddddddd-0000-0000-0000-00000000000d',
          'eeeeeeee-0000-0000-0000-0000000000a1', 'בעלת הרישיון');
  begin
    insert into public.agents (agency_id, full_name, licence_verified_at)
    values ('dddddddd-0000-0000-0000-00000000000d', 'x', now());
    raise exception 'the owner inserted a verified agent';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    insert into public.agents (agency_id, user_id, full_name)
    values ('dddddddd-0000-0000-0000-00000000000d', 'eeeeeeee-0000-0000-0000-0000000000a3', 'x');
    raise exception 'the owner linked someone else''s account';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    update public.agents set licence_verified_at = now() where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'the owner verified their own licence';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    update public.agents set licence_verified_by = 'eeeeeeee-0000-0000-0000-0000000000a0' where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'the owner named a verifier';
  exception when insufficient_privilege then
    if sqlerrm <> 'operator_only' then raise; end if;
  end;
  begin
    update public.agents set agency_id = 'dddddddd-0000-0000-0000-00000000000e' where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'the owner moved their agent to another agency';
  exception when insufficient_privilege then null;  -- agency_fixed, or the policy's check
  end;
  begin
    insert into public.agents (agency_id, full_name) values ('dddddddd-0000-0000-0000-00000000000e', 'x');
    raise exception 'the owner added an agent to another agency';
  exception when insufficient_privilege then null;
  end;
  update public.agents set full_name = 'x' where id = '99999999-0000-0000-0000-00000000000e';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner edited another agency''s agent'; end if;
  begin
    update public.agents set booking_url = 'javascript:alert(1)' where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'a booking link that is not https was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.agents set review_links = '{"google": "javascript:alert(1)"}' where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'a review link that is not https was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.agents set review_links = '{"facebook": "https://example.com"}' where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'an unknown review site was accepted';
  exception when check_violation then null;
  end;
  update public.agents set review_links = '{"google": "https://g.example.com/r"}' where id = '99999999-0000-0000-0000-00000000000d';
  -- The portrait path: this agent's own folder, a WebP — never a URL.
  update public.agents
     set photo_path = 'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait-480.webp'
   where id = '99999999-0000-0000-0000-00000000000d';
  declare
    bad text;
  begin
    foreach bad in array array[
      'https://evil.example.com/pixel.gif',
      'dddddddd-0000-0000-0000-00000000000e/99999999-0000-0000-0000-00000000000e/portrait-480.webp',
      'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/../x.webp',
      'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait.jpg'
    ] loop
      begin
        update public.agents set photo_path = bad where id = '99999999-0000-0000-0000-00000000000d';
        raise exception 'a photo path was accepted: %', bad;
      exception when check_violation then null;
      end;
    end loop;
  end;
  begin
    update public.agents set bio = jsonb_build_object('career', repeat('א', 9000)) where id = '99999999-0000-0000-0000-00000000000d';
    raise exception 'an 18 KB bio was accepted';
  exception when check_violation then null;
  end;

  -- Testimonials: theirs, with consent, stamped by the database.
  insert into public.testimonials (name, quote, agency_id, agent_id, source, consent_confirmed_at, consent_confirmed_by)
  values ('ר״ל', 'מקצועית', 'dddddddd-0000-0000-0000-00000000000d', '99999999-0000-0000-0000-00000000000d', 'google',
          '2001-01-01', 'eeeeeeee-0000-0000-0000-0000000000a0');
  if (select consent_confirmed_by from public.testimonials where name = 'ר״ל') <> 'eeeeeeee-0000-0000-0000-0000000000a1'
     or (select consent_confirmed_at from public.testimonials where name = 'ר״ל') < now() - interval '1 minute' then
    raise exception 'the consent stamp took the client''s name or date';
  end if;
  begin
    insert into public.testimonials (name, quote, agency_id, agent_id)
    values ('x', 'y', 'dddddddd-0000-0000-0000-00000000000d', '99999999-0000-0000-0000-00000000000d');
    raise exception 'a testimonial without consent was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.testimonials (name, quote, agency_id, consent_confirmed_at)
    values ('x', 'y', 'dddddddd-0000-0000-0000-00000000000d', now());
    raise exception 'a draft''s testimonial without a licensee was saved';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.testimonials (name, quote, agency_id, agent_id, consent_confirmed_at)
    values ('x', 'y', 'dddddddd-0000-0000-0000-00000000000e', '99999999-0000-0000-0000-00000000000e', now());
    raise exception 'the owner wrote another agency''s testimonial';
  exception when insufficient_privilege then null;
  end;
  begin
    -- Their own agency, another agency's agent: the composite key refuses it.
    insert into public.testimonials (name, quote, agency_id, agent_id, consent_confirmed_at)
    values ('x', 'y', 'dddddddd-0000-0000-0000-00000000000d', '99999999-0000-0000-0000-00000000000e', now());
    raise exception 'a testimonial named another agency''s agent';
  exception when foreign_key_violation then null;
  end;

  -- Success cases.
  insert into public.success_cases (agency_id, agent_id, title, body, published)
  values ('dddddddd-0000-0000-0000-00000000000d', '99999999-0000-0000-0000-00000000000d', 'חיסכון', 'גוף', true);
  begin
    insert into public.success_cases (agency_id, title, body) values ('dddddddd-0000-0000-0000-00000000000e', 'x', 'y');
    raise exception 'the owner wrote another agency''s success case';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.success_cases where agency_id = 'dddddddd-0000-0000-0000-00000000000e') <> 0 then
    raise exception 'the owner reads another draft''s success cases';
  end if;

  -- The portrait: their agency's folder and agent, a WebP name, nothing else.
  insert into storage.objects (bucket_id, name)
  values ('agent-photos', 'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait-480.webp');
  update storage.objects set metadata = '{"v":2}'
   where bucket_id = 'agent-photos' and name = 'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait-480.webp';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'the owner cannot replace their portrait'; end if;
  declare
    bad text;
  begin
    foreach bad in array array[
      'dddddddd-0000-0000-0000-00000000000e/99999999-0000-0000-0000-00000000000e/portrait-480.webp',
      'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000e/portrait-480.webp',
      'dddddddd-0000-0000-0000-00000000000d/portrait-480.webp',
      'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/../x.webp',
      'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait.jpg',
      'not-a-uuid/99999999-0000-0000-0000-00000000000d/portrait-480.webp'
    ] loop
      begin
        insert into storage.objects (bucket_id, name) values ('agent-photos', bad);
        raise exception 'a portrait went in under %', bad;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end;
  delete from storage.objects
   where bucket_id = 'agent-photos' and name = 'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait-480.webp';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'the owner cannot remove their portrait'; end if;
  insert into storage.objects (bucket_id, name)
  values ('agent-photos', 'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait-1080.webp');
end $$;
reset role;

-- E's owner, whose wizard state has no review yet: they cannot start one.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a4","role":"authenticated"}';
do $$ begin
  update public.agency_profiles set onboarding = '{"last_step": 1, "review": {"return_note": "מאושר"}}'
   where agency_id = 'dddddddd-0000-0000-0000-00000000000e';
  if (select onboarding from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000e')
     <> '{"last_step": 1}'::jsonb then
    raise exception 'an owner wrote the operator''s review notes';
  end if;
end $$;
reset role;

-- ═══ a draft's Admin and User: they read, they do not edit ══════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$
declare
  n integer;
begin
  if (select count(*) from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 1 then
    raise exception 'a draft''s Admin cannot read its profile';
  end if;
  update public.agency_profiles set email = 'admin@example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a draft''s Admin edited the profile'; end if;
  update public.agents set full_name = 'x' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a draft''s Admin edited the agent'; end if;
  begin
    insert into public.testimonials (name, quote, agency_id, agent_id, consent_confirmed_at)
    values ('x', 'y', 'dddddddd-0000-0000-0000-00000000000d', '99999999-0000-0000-0000-00000000000d', now());
    raise exception 'a draft''s Admin wrote a testimonial';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name)
    values ('agent-photos', 'dddddddd-0000-0000-0000-00000000000d/99999999-0000-0000-0000-00000000000d/portrait-768.webp');
    raise exception 'a draft''s Admin uploaded a portrait';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'a draft''s Admin sent it for approval';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$
declare
  n integer;
begin
  update public.agency_profiles set email = 'user@example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a draft''s User edited the profile'; end if;
end $$;
reset role;

-- ═══ submit ══════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare
  v_detail text;
begin
  begin
    perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'an incomplete draft was sent for approval';
  exception when check_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'incomplete' then raise; end if;
    if v_detail <> 'agency_profiles.default_whatsapp_message,agency_profiles.licence_entity,agency_profiles.notify_emails,'
                   'agents.grammatical_gender,agents.professional_title,agents.licence_number,agents.licence_types,'
                   'agents.has_institutional_affiliation,agents.bio.headline,agents.bio.career' then
      raise exception 'submit named the wrong missing fields: %', v_detail;
    end if;
  end;
  begin
    perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000e');
    raise exception 'an owner sent another agency for approval';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  update public.agency_profiles
     set default_whatsapp_message = 'שלום', licence_entity = 'בעלת הרישיון — מתכננת פיננסית',
         notify_emails = array['owner@example.com']
   where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  update public.agents
     set grammatical_gender = 'f', professional_title = 'מתכננת פיננסית', licence_number = 'L-0001',
         licence_types = array['pension_agent'], has_institutional_affiliation = true,
         bio = '{"headline": "שלום", "career": "עשרים שנה"}'
   where id = '99999999-0000-0000-0000-00000000000d';

  -- Affiliated, but naming no body: still incomplete.
  begin
    perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'an affiliation without its bodies was accepted';
  exception when check_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'agents.affiliations' then raise exception 'expected agents.affiliations, got %', v_detail; end if;
  end;
  update public.agents set affiliations = array['גוף מוסדי'] where id = '99999999-0000-0000-0000-00000000000d';

  perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');
  if (select status from public.agencies where id = 'dddddddd-0000-0000-0000-00000000000d') <> 'pending_review' then
    raise exception 'submit did not move the draft to pending_review';
  end if;
  begin
    perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'a pending agency was sent again';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'wrong_status' then raise; end if;
  end;
  -- The owner cannot activate, or return, their own.
  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'an owner activated their agency';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.return_agency('dddddddd-0000-0000-0000-00000000000d', 'x');
    raise exception 'an owner returned their agency';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
reset role;

-- ═══ the operator: return, gates, activate ═══════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$
declare
  v_detail text;
begin
  -- Not by a direct write: activation goes through its gates.
  begin
    update public.agencies set status = 'active' where id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the operator activated a pending agency by a direct write';
  exception when insufficient_privilege then
    if sqlerrm <> 'use_onboarding_functions' then raise; end if;
  end;

  begin
    perform public.return_agency('dddddddd-0000-0000-0000-00000000000d', '  ');
    raise exception 'a return without a note was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'field_required' then raise; end if;
  end;
  perform public.return_agency('dddddddd-0000-0000-0000-00000000000d', 'נא לתקן את מספר הרישיון');
  if (select status from public.agencies where id = 'dddddddd-0000-0000-0000-00000000000d') <> 'draft'
     or (select onboarding #>> '{review,return_note}' from public.agency_profiles
          where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'נא לתקן את מספר הרישיון' then
    raise exception 'return_agency did not return the agency with its note';
  end if;
  begin
    perform public.return_agency('dddddddd-0000-0000-0000-00000000000d', 'שוב');
    raise exception 'a draft was returned';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'a draft was activated';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- The operator may send it on the owner's behalf.
  perform public.submit_agency_for_review('dddddddd-0000-0000-0000-00000000000d');

  -- Completeness is checked again: the draft can move after it was sent.
  update public.agency_profiles set notify_emails = null where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'an agency that lost a required field was activated';
  exception when check_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'incomplete' or v_detail <> 'agency_profiles.notify_emails' then
      raise exception 'activate missed the completeness check: % %', sqlerrm, v_detail;
    end if;
  end;
  update public.agency_profiles set notify_emails = array['owner@example.com'] where agency_id = 'dddddddd-0000-0000-0000-00000000000d';

  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'an agency was activated with its three gates closed';
  exception when check_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'gates_closed' then raise; end if;
    if v_detail <> 'agents.licence_verified_at,agencies.data_processing_agreement_date,agency_profiles.disclosures_approved_at' then
      raise exception 'activate named the wrong gates: %', v_detail;
    end if;
  end;

  -- Gate 1: the licence, checked on the register. Stamped with who and when.
  update public.agents set licence_verified_at = '2001-01-01', licence_verified_by = null
   where id = '99999999-0000-0000-0000-00000000000d';
  if (select licence_verified_by from public.agents where id = '99999999-0000-0000-0000-00000000000d') <> 'eeeeeeee-0000-0000-0000-0000000000a0'
     or (select licence_verified_at from public.agents where id = '99999999-0000-0000-0000-00000000000d') < now() - interval '1 minute'
     or (select verified_licence_number from public.agents where id = '99999999-0000-0000-0000-00000000000d') <> 'L-0001' then
    raise exception 'the licence check was not stamped by the operator, now, for this number';
  end if;
  -- Gate 2: the processing agreement (a direct write; the status does not move).
  update public.agencies set data_processing_agreement_date = '2026-10-15' where id = 'dddddddd-0000-0000-0000-00000000000d';
  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'activated without approved disclosures';
  exception when check_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'agency_profiles.disclosures_approved_at' then raise exception 'expected the disclosures gate, got %', v_detail; end if;
  end;
  -- Gate 3: the disclosures.
  update public.agency_profiles set disclosures_approved_at = now()
   where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  if (select disclosures_approved_by from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d')
     <> 'eeeeeeee-0000-0000-0000-0000000000a0' then
    raise exception 'the disclosures approval was not stamped by the operator';
  end if;
  -- The operator sets the domain.
  update public.agency_profiles set domain = 'draft.example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';

  perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
  if (select status from public.agencies where id = 'dddddddd-0000-0000-0000-00000000000d') <> 'active'
     or (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v1' then
    raise exception 'activate did not make the agency live with its first consent version';
  end if;
end $$;
reset role;

-- ═══ after activation ════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare
  n integer;
begin
  if public.agency_role('dddddddd-0000-0000-0000-00000000000d') is distinct from 'owner' then
    raise exception 'the owner of a live agency has no agency_role()';
  end if;

  -- A new licence number: the check lapses, the site keeps the checked number,
  -- the notice moves on, the disclosures need approving again.
  update public.agents set licence_number = 'L-0002' where id = '99999999-0000-0000-0000-00000000000d';
  if (select licence_verified_at from public.agents where id = '99999999-0000-0000-0000-00000000000d') is not null
     or (select licence_verified_by from public.agents where id = '99999999-0000-0000-0000-00000000000d') is not null then
    raise exception 'a changed licence number kept its verification';
  end if;
  if (select verified_licence_number from public.agents where id = '99999999-0000-0000-0000-00000000000d') <> 'L-0001' then
    raise exception 'the checked licence number was lost';
  end if;
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v2' then
    raise exception 'a changed licence number did not bump consent_version';
  end if;
  if (select disclosures_approved_at from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') is not null then
    raise exception 'a changed licence number kept the disclosures approval';
  end if;

  -- Removing a licensee is the operator's.
  delete from public.agents where id = '99999999-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner deleted their agent'; end if;
end $$;
reset role;

-- ── a visitor, while the new number awaits its check ─────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  if (select count(*) from public.public_agent_cards where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 1 then
    raise exception 'a live agency''s checked licensee is not on its public card';
  end if;
  if (select licence_number from public.public_agent_cards where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'L-0001' then
    raise exception 'the public card shows an unchecked licence number';
  end if;
  if exists (select 1 from public.public_agent_cards where agency_id = 'dddddddd-0000-0000-0000-00000000000e') then
    raise exception 'a draft agency''s licensee is on a public card';
  end if;
  begin
    perform 1 from public.agents limit 1;
    raise exception 'anon reads the agents table';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.success_cases where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 1 then
    raise exception 'a live agency''s published success case is hidden';
  end if;
  if exists (select 1 from public.success_cases where agency_id = 'dddddddd-0000-0000-0000-00000000000e') then
    raise exception 'a draft agency''s success case is public';
  end if;
  -- Testimonials: the public read is as before — agency 1's rows.
  if not exists (select 1 from public.testimonials where name = 'ותיקה') then
    raise exception 'agency 1''s testimonials are no longer public';
  end if;
  if exists (select 1 from public.testimonials where agency_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'the public read of testimonials widened';
  end if;
end $$;
reset role;

-- The operator checks the new number and approves the disclosures again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$ begin
  update public.agents set licence_verified_at = now() where id = '99999999-0000-0000-0000-00000000000d';
  update public.agency_profiles set disclosures_approved_at = now() where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  if (select verified_licence_number from public.agents where id = '99999999-0000-0000-0000-00000000000d') <> 'L-0002' then
    raise exception 'a new check did not record the new number';
  end if;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  -- Licence types: the check lapses, the checked number stays on the card.
  update public.agents set licence_types = array['pension_agent', 'life_agent'] where id = '99999999-0000-0000-0000-00000000000d';
  if (select licence_verified_at from public.agents where id = '99999999-0000-0000-0000-00000000000d') is not null then
    raise exception 'changed licence types kept the verification';
  end if;
  if (select verified_licence_number from public.agents where id = '99999999-0000-0000-0000-00000000000d') <> 'L-0002' then
    raise exception 'changed licence types lost the checked number';
  end if;
  if (select disclosures_approved_at from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') is not null then
    raise exception 'changed licence types kept the disclosures approval';
  end if;
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v2' then
    raise exception 'changed licence types bumped consent_version';
  end if;

  update public.agents set grammatical_gender = 'm' where id = '99999999-0000-0000-0000-00000000000d';
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v3' then
    raise exception 'a changed gender did not bump consent_version';
  end if;
  -- The name: the checked number goes too, so the card hides the licensee.
  update public.agents set full_name = 'שם חדש' where id = '99999999-0000-0000-0000-00000000000d';
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v4' then
    raise exception 'a changed name did not bump consent_version';
  end if;
  if (select verified_licence_number from public.agents where id = '99999999-0000-0000-0000-00000000000d') is not null then
    raise exception 'a changed name kept the checked number';
  end if;
  update public.agents set bio = bio || '{"family": "שני ילדים"}' where id = '99999999-0000-0000-0000-00000000000d';
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v4' then
    raise exception 'a bio edit bumped consent_version';
  end if;
  update public.agency_profiles set licence_entity = 'שם חדש — מתכנן פיננסי' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v5' then
    raise exception 'a changed licence line did not bump consent_version';
  end if;
  -- Still not the domain, now that it is live.
  begin
    update public.agency_profiles set domain = null where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'the owner cleared the domain';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The operator approves the disclosures once more, for the next block.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$ begin
  update public.agency_profiles set disclosures_approved_at = now() where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
end $$;
reset role;

-- A second licensee, added by the owner of the live agency: off the card
-- until checked, and the notice and its approval move on.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  insert into public.agents (id, agency_id, full_name, licence_types, has_institutional_affiliation)
  values ('99999999-0000-0000-0000-0000000000d2', 'dddddddd-0000-0000-0000-00000000000d', 'שותף לא בדוק',
          array['pension_advisor'], false);
  if (select disclosures_approved_at from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') is not null then
    raise exception 'a new licensee kept the disclosures approval';
  end if;
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v6' then
    raise exception 'a new licensee did not bump consent_version';
  end if;
end $$;
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  if exists (select 1 from public.public_agent_cards where id = '99999999-0000-0000-0000-0000000000d2') then
    raise exception 'an unchecked licensee of a live agency is on a public card';
  end if;
  if exists (select 1 from public.public_agent_cards where id = '99999999-0000-0000-0000-00000000000d') then
    raise exception 'a renamed licensee is on the card before a new check';
  end if;
end $$;
reset role;

-- The live agency's Admin writes testimonials (testimonials_write_admin), and
-- an agency other than agency 1 needs consent even without a licensee.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  begin
    insert into public.testimonials (name, quote, agency_id) values ('בלי הסכמה', 'y', 'dddddddd-0000-0000-0000-00000000000d');
    raise exception 'a new agency''s testimonial without consent was saved';
  exception when check_violation then null;
  end;
  insert into public.testimonials (name, quote, agency_id, consent_confirmed_at)
  values ('עם הסכמה', 'y', 'dddddddd-0000-0000-0000-00000000000d', now());
  if (select consent_confirmed_by from public.testimonials where name = 'עם הסכמה') <> 'eeeeeeee-0000-0000-0000-0000000000a2' then
    raise exception 'the Admin''s consent was not stamped';
  end if;
end $$;
reset role;

-- The operator removes the second licensee: the notice moves on again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$
declare
  n integer;
begin
  delete from public.agents where id = '99999999-0000-0000-0000-0000000000d2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'the operator could not remove a licensee'; end if;
  if (select consent_version from public.agency_profiles where agency_id = 'dddddddd-0000-0000-0000-00000000000d') <> 'v7' then
    raise exception 'removing a licensee did not bump consent_version';
  end if;
end $$;
reset role;

-- The view has no other door.
do $$ begin
  if has_table_privilege('anon', 'public.public_agent_cards', 'insert')
     or has_table_privilege('authenticated', 'public.public_agent_cards', 'update')
     or has_table_privilege('anon', 'public.agents', 'select')
     or has_table_privilege('authenticated', 'public.agents', 'truncate') then
    raise exception 'agents or its public view grants more than select';
  end if;
end $$;

-- ── suspension is not onboarding ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$ begin
  update public.agencies set status = 'suspended' where id = 'dddddddd-0000-0000-0000-00000000000d';
  begin
    perform public.activate_agency('dddddddd-0000-0000-0000-00000000000d');
    raise exception 'activate_agency reinstated a suspended agency';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;

-- A suspended agency's owner holds nothing, in onboarding as everywhere else.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare
  n integer;
begin
  if public.onboarding_role('dddddddd-0000-0000-0000-00000000000d') is not null then
    raise exception 'onboarding_role() answered for a suspended agency';
  end if;
  update public.agency_profiles set email = 'suspended@example.com' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner of a suspended agency edited its profile'; end if;
  update public.agents set bio = '{}' where agency_id = 'dddddddd-0000-0000-0000-00000000000d';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'the owner of a suspended agency edited its agent'; end if;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a0","role":"authenticated"}';
do $$ begin
  update public.agencies set status = 'active' where id = 'dddddddd-0000-0000-0000-00000000000d';
  begin
    update public.agencies set status = 'draft' where id = 'dddddddd-0000-0000-0000-00000000000d';
    raise exception 'a live agency went back to draft by a direct write';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  update public.agencies set status = 'suspended' where id = 'dddddddd-0000-0000-0000-00000000000d';
end $$;
reset role;
do $$ begin
  if (select status from public.agencies where id = 'dddddddd-0000-0000-0000-00000000000d') <> 'active' then
    raise exception 'an owner changed their agency''s status';
  end if;
  if public.next_consent_version('2026-10-agents-v5') <> '2026-10-agents-v6'
     or public.next_consent_version(null) <> 'v1'
     or public.next_consent_version('abc') <> 'abc-2' then
    raise exception 'next_consent_version counts wrongly';
  end if;
end $$;

rollback;
