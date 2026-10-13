-- The chat function's own records: one row per conversation, its redacted
-- messages, and the tokens each model call used. Phase 3,
-- docs/superpowers/specs/2026-10-13-chat-off-base44-design.md ("Data").
--
-- Only the `chat` Edge Function writes, with the service role. An agency member
-- or a platform admin reads their own agency's rows (Dorit's "שיחה" tab on
-- /admin/leads); anon reads nothing.

create table public.chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.agencies(id),
  role            text not null check (role in ('interview', 'support', 'procedures', 'blog')),
  -- sha256 of the token handed to the page; the token itself is never stored.
  token_hash      text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  consent_version text not null check (length(consent_version) between 1 and 64),
  consent_at      timestamptz not null,
  status          text not null default 'open'
                    check (status in ('open', 'closed', 'lead_saved', 'escalated')),
  -- A client's deletion request deletes their lead, and their transcript with it.
  lead_id         uuid references public.leads(id) on delete cascade,
  -- When the conversation was handed to a person. Apart from status, which
  -- holds one value: a lead saved and a hand-off made are both facts.
  escalated_at    timestamptz,
  turns           integer not null default 0 check (turns >= 0),
  -- channel, campaign, landingPath — from the page's first request, never the model.
  attribution     jsonb not null default '{}'::jsonb,
  is_eval         boolean not null default false,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  delete_after    timestamptz not null default (now() + interval '12 months')
);
create index chat_conversations_lead on public.chat_conversations (lead_id);
create index chat_conversations_delete_after on public.chat_conversations (delete_after);

create table public.chat_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  agency_id       uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.agencies(id),
  role            text not null check (role in ('user', 'assistant', 'tool')),
  -- Already redacted by the function. A tool row is "<tool>: <status>" only.
  content         text not null check (length(content) <= 8000),
  created_at      timestamptz not null default now()
);
create index chat_messages_conversation on public.chat_messages (conversation_id, id);

create table public.chat_usage (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  agency_id       uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.agencies(id),
  model           text not null,
  input_tokens    integer not null default 0 check (input_tokens >= 0),
  cached_tokens   integer not null default 0 check (cached_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  created_at      timestamptz not null default now()
);
create index chat_usage_agency_created on public.chat_usage (agency_id, created_at);

-- One row per agency per month in which the budget was reached: the insert that
-- succeeds is the one that sends the staff email, so it is sent once.
create table public.chat_budget_alerts (
  agency_id uuid not null references public.agencies(id),
  month     text not null check (month ~ '^\d{4}-\d{2}$'),
  sent_at   timestamptz not null default now(),
  primary key (agency_id, month)
);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_usage enable row level security;
alter table public.chat_budget_alerts enable row level security;

create policy chat_conversations_read_member_or_admin on public.chat_conversations
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
create policy chat_messages_read_member_or_admin on public.chat_messages
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
create policy chat_usage_read_member_or_admin on public.chat_usage
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());

-- Supabase's default privileges grant every new public table to anon and
-- authenticated by name; take them back, then give authenticated reads only.
revoke all on public.chat_conversations, public.chat_messages, public.chat_usage, public.chat_budget_alerts from anon, authenticated;
grant select on public.chat_conversations, public.chat_messages, public.chat_usage to authenticated;
grant select, insert, update, delete on public.chat_conversations, public.chat_messages, public.chat_usage, public.chat_budget_alerts to service_role;

-- This month's tokens per model, for the budget check. Summed here so the
-- function reads a handful of rows, not every usage row of the month.
create function public.chat_month_usage(p_agency_id uuid, p_since timestamptz)
  returns table (model text, input_tokens bigint, cached_tokens bigint, output_tokens bigint)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select u.model, sum(u.input_tokens), sum(u.cached_tokens), sum(u.output_tokens)
    from public.chat_usage u
   where u.agency_id = p_agency_id and u.created_at >= p_since
   group by u.model;
$$;
revoke execute on function public.chat_month_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_month_usage(uuid, timestamptz) to service_role;

-- The nightly purge: conversations past delete_after, with their messages and
-- usage by cascade. Returns how many conversations went.
create function public.purge_chat_conversations()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  gone integer;
begin
  delete from public.chat_conversations where delete_after < now();
  get diagnostics gone = row_count;
  return gone;
end;
$$;
revoke execute on function public.purge_chat_conversations() from public, anon, authenticated;
grant execute on function public.purge_chat_conversations() to service_role;
