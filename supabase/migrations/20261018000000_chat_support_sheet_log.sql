-- The FAQ chat's conversations, logged to the Google Sheet's Support tab by
-- the function itself (Phase 3 PR 2). Base44's agent called logSupportChat at
-- the end of a chat when it remembered to; here a sweep logs every support
-- conversation once it has been idle for 30 minutes (chat/sweep.ts).
--
-- sheet_logged_at: null until a sweep claims the row. The claim is one
-- filtered PATCH (sheet_logged_at=is.null), so two sweeps never log one
-- conversation twice.
alter table public.chat_conversations
  add column sheet_logged_at timestamptz;

create index chat_conversations_unlogged on public.chat_conversations (last_message_at)
  where sheet_logged_at is null;

-- Every 15 minutes, pg_net posts to the chat function's sweep route. The URL
-- and the token live in Vault, set by hand (README); until both exist this
-- does nothing, so a local `supabase start` never calls production.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function public.chat_sweep_tick()
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base_url text;
  token text;
begin
  begin
    select decrypted_secret into base_url from vault.decrypted_secrets where name = 'chat_sweep_url';
    select decrypted_secret into token from vault.decrypted_secrets where name = 'chat_sweep_token';
  exception when undefined_table or invalid_schema_name then
    return;
  end;
  if base_url is null or token is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/chat',
    headers := jsonb_build_object('content-type', 'application/json', 'x-chat-sweep', token),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name; a bare `from public` would leave the tick open.
revoke execute on function public.chat_sweep_tick() from public, anon, authenticated, service_role;

select cron.schedule(
  'chat-support-sheet-log',
  '*/15 * * * *',
  $$select public.chat_sweep_tick()$$
);
