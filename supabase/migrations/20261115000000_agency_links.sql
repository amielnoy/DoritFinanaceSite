-- The new-agency wizard: an agency's own links (step 3, "פרטי קשר").
--
-- Three optional addresses the owner may give: the agency's website, a
-- WhatsApp group and a Facebook group. The site shows each one in the footer
-- when it is set, and nothing when it is not.
--
-- Written like every other profile column: by the owner (or the operator on
-- the owner's behalf) under agency_profiles_update_onboarding_owner /
-- agency_profiles_update_admin. agency_profiles_guard does not name them, so
-- they are not operator-only, and nothing here changes who may write.
--
-- The patterns are spelled once more in src/lib/agency-links.ts, which the
-- wizard checks as one types and the site checks before it renders a link;
-- tests/contract/agency-links.contract.test.ts fails when the two disagree.

alter table public.agency_profiles
  add column website_url        text check (char_length(website_url) <= 500
                                            and website_url ~ '^https://[^\s/]+\.[^\s/]+(/\S*)?$'),
  add column whatsapp_group_url text check (char_length(whatsapp_group_url) <= 500
                                            and whatsapp_group_url ~ '^https://chat\.whatsapp\.com/\S+$'),
  add column facebook_group_url text check (char_length(facebook_group_url) <= 500
                                            and facebook_group_url ~ '^https://(www\.|m\.|web\.)?facebook\.com/\S+$');

-- ── public_agency_sites: the three links, at the end ───────────────────────
-- A visitor sees them in the footer, so they belong in the view; nothing else
-- is added. `create or replace` keeps the view a definer view and keeps its
-- grants; it may only append columns, which is all this does. The two
-- conditions (a live agency, with a domain) stay exactly as they were.
create or replace view public.public_agency_sites with (security_invoker = false) as
  select p.agency_id,
         p.domain,
         p.display_name,
         p.phone_e164,
         p.phone_display,
         p.whatsapp,
         p.email,
         p.default_whatsapp_message,
         p.service_area,
         p.website_url,
         p.whatsapp_group_url,
         p.facebook_group_url
    from public.agency_profiles p
    join public.agencies a on a.id = p.agency_id
   where a.status = 'active'
     and p.domain is not null;

revoke all on public.public_agency_sites from anon, authenticated, service_role;
grant select on public.public_agency_sites to anon, authenticated;
