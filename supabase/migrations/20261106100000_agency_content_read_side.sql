-- The new-agency wizard, Rollout step 2: the read side
-- (docs/superpowers/plans/2026-10-21-agency-content-step2.md).
--
-- What the public site will read from the database instead of its constants,
-- behind VITE_AGENCY_CONTENT (off). Nothing here changes what a visitor sees
-- today: agency 1's testimonials stay public, and the views only add a way in.
--
-- It fixes review M-2 first. testimonials was granted to anon whole by the
-- initial schema, so the consent stamp 20261106000000 added
-- (consent_confirmed_by, an account id, and consent_confirmed_at) was readable
-- by anyone who named it. Opening other agencies' testimonials to visitors
-- below would widen that, so the table-level read goes and the public columns
-- are granted by name. Every reader names its columns already
-- (tests/security/agency-content.security.test.ts); service_role keeps its
-- table-level grant (20260922000000), so the Edge Functions and scripts that
-- write and reconcile are unaffected.

-- ── testimonials: column grants (review M-2) ───────────────────────────────
revoke select on public.testimonials from anon, authenticated;
grant select (id, base44_id, agency_id, agent_id, name, role, quote, image_url, rating, source,
              source_url, sort_order, created_at, updated_at) on public.testimonials to anon, authenticated;
-- The wizard shows a member when consent was confirmed; who confirmed it stays
-- the database's.
grant select (consent_confirmed_at) on public.testimonials to authenticated;

-- ── testimonials: a live agency's, with consent ────────────────────────────
-- Agency 1's rows stay public through testimonials_read_member_or_fixed_agency,
-- unchanged, consent stamp or not (its legacy rows have none). Any other
-- agency's row is public once the agency is live and the reviewer's consent is
-- recorded. The policy reads consent_confirmed_at although anon has no grant
-- on it: RLS evaluates policies without column privileges
-- (supabase/tests/agency_content_check.sql proves it).
create policy testimonials_read_public_active on public.testimonials
  for select to anon, authenticated
  using (agency_id <> '00000000-0000-0000-0000-000000000001'
         and consent_confirmed_at is not null
         and public.agency_is_active(agency_id));

-- ── success cases: what proof.c1…c7 show beside the body ───────────────────
-- The chip above each case (proof.cN.tag), and whether its metric is an
-- estimate (the "basis" line of c2 and c6), so the database renders them as
-- home.json does.
alter table public.success_cases
  add column tag                text check (char_length(tag) <= 60),
  add column metric_is_estimate boolean not null default false;

-- ── public_agency_sites: a site's contact details ──────────────────────────
-- What the header, footer and contact buttons show, looked up by domain. A
-- definer view (security_invoker = false, said out loud), built like
-- public_agent_cards: anon has no grant on agency_profiles and must not get
-- one — that would expose notify_emails, the onboarding state and the
-- operator's approval — so the view reads as its owner, and its filter is the
-- only thing keeping drafts out: a live agency.
-- Do not drop the filter, and do not add columns without asking whether a
-- visitor may see them.
create view public.public_agency_sites with (security_invoker = false) as
  select p.agency_id,
         p.domain,
         p.display_name,
         p.phone_e164,
         p.phone_display,
         p.whatsapp,
         p.email,
         p.default_whatsapp_message,
         p.service_area
    from public.agency_profiles p
    join public.agencies a on a.id = p.agency_id
   where a.status = 'active';

revoke all on public.public_agency_sites from anon, authenticated, service_role;
grant select on public.public_agency_sites to anon, authenticated;
