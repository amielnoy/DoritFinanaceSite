-- Saving a client's meetings with Dorit, migration 2 of 2 — many meetings per
-- lead (docs/superpowers/specs/2026-10-17-client-meetings-design.md, Rollout 3).
--
-- `meetings_lead_id_key unique (lead_id)` held a lead to one meeting, and
-- submit-lead used to upsert on it (`on_conflict=lead_id`, twice). Since
-- 20261103000000 and the code that shipped with it, every writer writes by id:
-- submit-lead inserts its booking and updates the calendar outcome by the id it
-- got back, and staff insert through meetings_insert_lead. Checked before this
-- was written (and held by tests/contract/client-meetings-many.contract.test.ts):
-- no Edge Function, page, Base44 function, script or SQL function upserts
-- meetings on lead_id.
--
-- With the key gone, lead_for_email() offers a lead that already has a
-- meeting (a signed-in client's rebooking joins it) and staff can add a second
-- meeting to a booked lead — both with no deploy.
alter table public.meetings drop constraint meetings_lead_id_key;

-- What the key's index gave the lead's meetings, in the order they are read.
create index meetings_lead_id_scheduled on public.meetings (lead_id, scheduled_at);
