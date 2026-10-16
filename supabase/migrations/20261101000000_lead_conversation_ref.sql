-- Which conversation an interview lead came from (review 2026-10-15, item 9).
--
-- submit-lead used to find a visitor's open interview by phone plus a name
-- prefix: anyone who knew a number and a first name could complete — and
-- overwrite — someone else's interview. A later save now names the
-- conversation the page or the chat function holds, and only a lead carrying
-- that reference is updated. Without one, a save is a new lead.
alter table public.leads
  add column conversation_ref text
    check (conversation_ref is null or conversation_ref ~ '^[A-Za-z0-9:_-]{8,100}$');

create index leads_conversation_ref_idx on public.leads (conversation_ref)
  where conversation_ref is not null;
