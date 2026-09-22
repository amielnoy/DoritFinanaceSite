-- Grants for `service_role`, which the first migration missed.
--
-- It lists anon and authenticated, because those are the roles the browser
-- arrives as. The backend functions are neither: they act as `service_role`,
-- and with "automatically expose new tables" off nothing is implicit — a role
-- absent from a grant has no access, whatever else is true of it.
--
-- Bypassing RLS is not the same as having privileges. `service_role` skips the
-- policies and is still refused by the grant, with 42501 and a hint naming the
-- exact statement missing.
--
-- This would not have announced itself. The mirror in submitLead and
-- upsertContact never throws — Base44 is authoritative and a failed shadow
-- write must not cost a visitor their enquiry — so every lead would have been
-- written to Base44, logged as `lead.mirror_failed` where nobody was watching,
-- and Supabase would have stayed empty while the migration looked done.
grant select, insert, update, delete on public.leads        to service_role;
grant select, insert, update, delete on public.contacts     to service_role;
grant select, insert, update, delete on public.blog_posts   to service_role;
grant select, insert, update, delete on public.testimonials to service_role;

-- Read-only on profiles: the functions need to resolve who someone is, never to
-- decide what they may be. Granting admin is an act that belongs to an admin.
grant select on public.profiles to service_role;
