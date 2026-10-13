-- No direct inserts into leads or contacts from the browser.
--
-- Every enquiry reaches these tables through a server function holding the
-- service key (submit-claim, and Base44's submitLead/escalateToHuman mirrors),
-- which validates, limits and pins status and source. The public insert grant
-- let anyone with the publishable key write a row straight to PostgREST
-- instead — any columns, including status and base44_id — skipping all of
-- that. Nothing in the browser uses it: the admin screen reads, updates and
-- deletes under Dorit's session, and inserts nothing.
drop policy leads_insert_public on public.leads;
drop policy contacts_insert_public on public.contacts;

revoke insert on public.leads    from anon, authenticated;
revoke insert on public.contacts from anon, authenticated;
