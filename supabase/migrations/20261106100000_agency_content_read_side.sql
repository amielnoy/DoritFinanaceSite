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
-- by anyone who named it. So the table-level read goes and the public columns
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

-- ── testimonials: no public read for other agencies, not here ──────────────
-- Agency 1's rows stay public through testimonials_read_member_or_fixed_agency,
-- unchanged. An outside agency's public testimonials need a read policy for a
-- live agency's consented rows and, in the same change, an agency_id filter on
-- every testimonials reader (the public listTestimonials and
-- SupabaseContentAdminService), whatever VITE_AGENCY_CONTENT says: without the
-- filter, agency 1's site would list them. No outside agency goes live before
-- Rollout 5, so both wait for it.

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
-- A site is resolved by its domain, so a live agency with no domain has no
-- site, and its phone and email must not be listable by anyone who asks.
-- Do not drop either condition, and do not add columns without asking whether
-- a visitor may see them.
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
   where a.status = 'active'
     and p.domain is not null;

revoke all on public.public_agency_sites from anon, authenticated, service_role;
grant select on public.public_agency_sites to anon, authenticated;
