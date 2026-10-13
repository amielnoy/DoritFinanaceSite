-- Clearinghouse analysis, PR A — the request pipeline.
-- docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md
--
-- A client authorises Dorit at the pension clearinghouse (המסלקה הפנסיונית)
-- and hands over the power-of-attorney code and their ID number through
-- /masleka. Both are stored only as AES-GCM ciphertext made by the Edge
-- Functions with MASLEKA_KEY, which this database never sees. They exist only
-- while the request waits for a staff member to submit it in the
-- clearinghouse portal, and never longer than nine days.
--
-- Ships dark: nothing writes here until MASLEKA_ENABLED is "true" on the
-- functions, so applying this migration changes no behaviour by itself.

-- ── the requests ────────────────────────────────────────────────────────────

create table public.masleka_requests (
  id                       uuid primary key default gen_random_uuid(),
  agency_id                uuid not null default '00000000-0000-0000-0000-000000000001'
                             references public.agencies(id),
  -- Null for a request a staff member made by hand (a lead from the phone).
  lead_id                  uuid references public.leads(id) on delete set null,
  client_name              text not null check (length(btrim(client_name)) between 1 and 80),
  contact_email            text check (contact_email is null or length(contact_email) <= 254),
  -- SHA-256 of the link's token. The token itself is never stored, so the
  -- database cannot rebuild a link; a reminder or a staff member issues a new one.
  token_hash               text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at         timestamptz not null default now() + interval '30 days',
  status                   text not null default 'invited'
                             check (status in ('invited', 'code_received', 'submitted', 'completed', 'expired', 'cancelled')),
  code_ciphertext          text,
  id_ciphertext            text,
  -- Kept after the wipe, with the client's name, so PR B can match a file to a request.
  id_last4                 text check (id_last4 is null or id_last4 ~ '^[0-9]{4}$'),
  created_by               uuid references auth.users(id) on delete set null,
  submitted_by             uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  client_invited_at        timestamptz,
  client_reminded_at       timestamptz,
  code_received_at         timestamptz,
  ciphertext_wiped_at      timestamptz,
  submitted_at             timestamptz,
  -- Business day 7 after submission, when the clearinghouse deletes the download.
  clearinghouse_deletes_at timestamptz,
  ready_reminded_at        timestamptz,
  deadline_reminded_at     timestamptz,
  completed_at             timestamptz,
  expired_at               timestamptz,
  cancelled_at             timestamptz,
  updated_at               timestamptz not null default now(),
  -- Ciphertext exists only while a request waits to be submitted. הגשתי moves
  -- the status and nulls both values in one statement; a write that tried to
  -- move the status and keep either value is refused here, whatever wrote it.
  constraint masleka_ciphertext_only_while_waiting check (
    (code_ciphertext is null and id_ciphertext is null)
    or (status = 'code_received' and code_received_at is not null)
  )
);

create index masleka_requests_agency_status on public.masleka_requests (agency_id, status);

create trigger masleka_requests_touch before update on public.masleka_requests
  for each row execute function public.touch_updated_at();

-- Who revealed which value of which request, and when. user_id has no foreign
-- key on purpose: an audit row outlives the account it names.
create table public.masleka_access_log (
  id         bigint generated always as identity primary key,
  agency_id  uuid not null default '00000000-0000-0000-0000-000000000001'
               references public.agencies(id),
  request_id uuid not null references public.masleka_requests(id) on delete cascade,
  user_id    uuid not null,
  field      text not null check (field in ('id', 'code')),
  at         timestamptz not null default now()
);

create index masleka_access_log_request on public.masleka_access_log (request_id);

-- ── row-level security and grants ───────────────────────────────────────────

alter table public.masleka_requests   enable row level security;
alter table public.masleka_access_log enable row level security;

create policy masleka_requests_read_member on public.masleka_requests
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
create policy masleka_access_log_read_member on public.masleka_access_log
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());

-- Every write goes through an Edge Function holding the service key; the
-- browser reads, and reads only the columns below. The ciphertext and the
-- token hash are not among them: a member's session that leaked would still
-- not carry them out.
revoke all on public.masleka_requests, public.masleka_access_log from anon, authenticated;
grant select (id, agency_id, lead_id, client_name, contact_email, status, id_last4, token_expires_at, created_at, client_invited_at, client_reminded_at, code_received_at, submitted_at, clearinghouse_deletes_at, completed_at, expired_at, cancelled_at) on public.masleka_requests to authenticated;
grant select on public.masleka_access_log to authenticated;
grant select, insert, update on public.masleka_requests to service_role;
grant select, insert on public.masleka_access_log to service_role;

-- ── staff ───────────────────────────────────────────────────────────────────

-- Staff are a platform admin or a member of agency 1, in any role. The Edge
-- Functions ask this on every call, so a membership deleted a minute ago is
-- refused on the next one. memberships is revoked from service_role, hence
-- security definer.
create function public.staff_role(p_user_id uuid) returns text
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select case
    when exists (select 1 from public.profiles where id = p_user_id and role = 'admin') then 'admin'
    else (select m.role from public.memberships m
           where m.user_id = p_user_id
             and m.agency_id = '00000000-0000-0000-0000-000000000001')
  end;
$$;

-- The browser's question: which screens to offer. Decides nothing — RLS and
-- the functions decide.
create function public.my_staff_role() returns text
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select public.staff_role(auth.uid());
$$;

-- Every staff member's address, for the pipeline's notices.
create function public.masleka_staff_emails() returns text[]
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(p.email)), '{}')
    from public.profiles p
   where p.email is not null and p.email <> ''
     and (p.role = 'admin'
          or exists (select 1 from public.memberships m
                      where m.user_id = p.id
                        and m.agency_id = '00000000-0000-0000-0000-000000000001'));
$$;

-- ── housekeeping ────────────────────────────────────────────────────────────

-- An unused link expires at 30 days; a submission whose download the
-- clearinghouse deleted two weeks ago is no longer waiting for anything.
create function public.masleka_expire() returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  changed integer;
begin
  update public.masleka_requests
     set status = 'expired', expired_at = now()
   where (status = 'invited' and token_expires_at <= now())
      or (status = 'submitted' and clearinghouse_deletes_at <= now() - interval '14 days');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- The hard limit: no ciphertext older than nine days, whatever its status.
-- A request still waiting with its values wiped cannot be submitted, so it
-- expires with them; staff send a fresh link.
create function public.masleka_wipe_stale() returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  changed integer;
begin
  update public.masleka_requests
     set code_ciphertext = null,
         id_ciphertext = null,
         ciphertext_wiped_at = now(),
         status = case when status = 'code_received' then 'expired' else status end,
         expired_at = case when status = 'code_received' then now() else expired_at end
   where (code_ciphertext is not null or id_ciphertext is not null)
     and coalesce(code_received_at, created_at) <= now() - interval '9 days';
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- The hourly reminder run: one POST to masleka-remind with the shared secret.
-- The address and the secret live in Vault (names below), never in a
-- migration; until both are set this does nothing, quietly.
create function public.masleka_call_remind() returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base_url text;
  secret   text;
begin
  begin
    select decrypted_secret into base_url from vault.decrypted_secrets where name = 'masleka_functions_url';
    select decrypted_secret into secret   from vault.decrypted_secrets where name = 'masleka_cron_secret';
  exception when undefined_table or invalid_schema_name then
    return;
  end;
  if base_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/masleka-remind',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-masleka-cron', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so `from public` alone would leave these open (A-69).
revoke execute on function public.staff_role(uuid) from public, anon, authenticated;
revoke execute on function public.masleka_staff_emails() from public, anon, authenticated;
revoke execute on function public.masleka_expire() from public, anon, authenticated;
revoke execute on function public.masleka_wipe_stale() from public, anon, authenticated;
revoke execute on function public.masleka_call_remind() from public, anon, authenticated;
revoke execute on function public.my_staff_role() from public, anon;
grant execute on function public.staff_role(uuid) to service_role;
grant execute on function public.masleka_staff_emails() to service_role;
grant execute on function public.masleka_expire() to service_role;
grant execute on function public.masleka_wipe_stale() to service_role;
grant execute on function public.masleka_call_remind() to service_role;
grant execute on function public.my_staff_role() to authenticated;

-- ── schedules ───────────────────────────────────────────────────────────────

-- Hourly rather than nightly: the nine-day wipe is then never more than an
-- hour late. Guarded, so a database without pg_cron (or pg_net) still takes
-- the migration; the functions above can be called by hand there, and
-- supabase/tests/masleka_check.sql calls them directly.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('masleka-housekeeping', '5 * * * *', 'select public.masleka_wipe_stale(); select public.masleka_expire();');
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      begin
        create extension if not exists pg_net with schema extensions;
        perform cron.schedule('masleka-remind', '20 * * * *', 'select public.masleka_call_remind();');
      exception when others then
        raise notice 'pg_net could not be enabled: masleka reminders are not scheduled (%)', sqlerrm;
      end;
    else
      raise notice 'pg_net is not available: masleka reminders are not scheduled';
    end if;
  else
    raise notice 'pg_cron is not available: masleka housekeeping and reminders are not scheduled';
  end if;
end
$do$;
