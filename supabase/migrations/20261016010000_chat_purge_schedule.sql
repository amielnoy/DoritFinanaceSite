-- The nightly purge of chat transcripts past their delete_after (12 months;
-- 1 day for evaluation runs). A separate migration because it needs pg_cron.
-- pg_cron is already enabled in production (1.6.4, in pg_catalog), so the
-- `create extension if not exists` below is a no-op there; it is kept for a
-- fresh or local database. Applying this to production is the user's call,
-- as with every migration.
create extension if not exists pg_cron;

select cron.schedule(
  'chat-purge-nightly',
  '15 1 * * *',
  $$select public.purge_chat_conversations()$$
);
