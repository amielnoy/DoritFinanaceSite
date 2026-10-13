-- The nightly purge of chat transcripts past their delete_after (12 months;
-- 1 day for evaluation runs). A separate migration because it needs pg_cron,
-- which this project has not used before: enable it first (Dashboard →
-- Database → Extensions → pg_cron), then apply this. Applying it to
-- production is the user's call, as with every migration.
create extension if not exists pg_cron;

select cron.schedule(
  'chat-purge-nightly',
  '15 1 * * *',
  $$select public.purge_chat_conversations()$$
);
