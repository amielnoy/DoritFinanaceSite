-- supabase/migrations/20261009000000_lead_channel.sql
--
-- Marketing-channel attribution, as its own field — not a reuse of `source`,
-- which already means "which form" (consultation/quick/claim/escalation/
-- interview). See docs/superpowers/specs/2026-10-09-lead-source-attribution-design.md.

alter table public.leads
  add column channel  text check (channel in (
                         'google','facebook','instagram','linkedin','ai_assistant',
                         'email','sms','referral','direct','unknown'
                       )),
  add column campaign text;
