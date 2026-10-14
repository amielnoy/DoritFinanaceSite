-- Clearinghouse analysis — snapshots and Dorit's review of the findings.
-- docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md (amended 2026-10-14)
--
-- A snapshot is a client's clearinghouse report, parsed in the staff member's
-- browser and trimmed there (src/lib/clearinghouse/snapshot.ts): no full ID,
-- no family members' names, no free text. The raw ZIP and XML are never
-- uploaded. The analysis's findings are computed from the snapshot each time
-- and never stored; what is stored is Dorit's decision on each one.
--
-- Nothing writes a snapshot until the parser (PR B) ships, so applying this
-- migration changes no behaviour by itself.

-- ── snapshots ───────────────────────────────────────────────────────────────

create table public.clearinghouse_snapshots (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null default '00000000-0000-0000-0000-000000000001'
                      references public.agencies(id),
  -- The request it answers; a snapshot outlives a deleted request.
  request_id        uuid references public.masleka_requests(id) on delete set null,
  lead_id           uuid references public.leads(id) on delete set null,
  client_name       text not null check (length(btrim(client_name)) between 1 and 80),
  taken_at          timestamptz not null,
  interface_version text not null check (length(interface_version) between 1 and 16),
  data              jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  -- Kept 24 months, then purged nightly (below); a newer snapshot for the same
  -- request replaces this one (PR B deletes the older one). The browser cannot
  -- set it: its insert grant (below) leaves this column out.
  delete_after      timestamptz not null default now() + interval '24 months'
);

create index clearinghouse_snapshots_agency on public.clearinghouse_snapshots (agency_id, created_at desc);
create index clearinghouse_snapshots_request on public.clearinghouse_snapshots (request_id);

-- ── review decisions ────────────────────────────────────────────────────────

-- One row per finding Dorit decided on. A finding with no row is a draft.
-- `finding_key` is analysis.ts's `Finding.key` (rule + accounts), so a decision
-- stays attached when the rules' wording improves.
create table public.clearinghouse_reviews (
  snapshot_id  uuid not null references public.clearinghouse_snapshots(id) on delete cascade,
  finding_key  text not null check (length(finding_key) between 1 and 300),
  status       text not null check (status in ('approved', 'rejected')),
  -- Dorit's wording when she edited the draft; null keeps the draft's own.
  final_text   text check (final_text is null or length(final_text) between 1 and 4000),
  reviewed_by  uuid references auth.users(id) on delete set null default auth.uid(),
  reviewed_at  timestamptz not null default now(),
  primary key (snapshot_id, finding_key)
);

-- Who decided and when is the database's to say, on every insert and update.
create function public.clearinghouse_reviews_stamp() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end;
$$;

create trigger clearinghouse_reviews_stamp before insert or update on public.clearinghouse_reviews
  for each row execute function public.clearinghouse_reviews_stamp();

-- ── row-level security and grants ───────────────────────────────────────────

alter table public.clearinghouse_snapshots enable row level security;
alter table public.clearinghouse_reviews   enable row level security;

-- Staff only: a member of the snapshot's agency, or a platform admin.
create policy clearinghouse_snapshots_member on public.clearinghouse_snapshots
  for all to authenticated
  using (public.can_see(agency_id) or public.is_admin())
  with check (public.can_see(agency_id) or public.is_admin());

create policy clearinghouse_reviews_member on public.clearinghouse_reviews
  for all to authenticated
  using (exists (
    select 1 from public.clearinghouse_snapshots s
     where s.id = snapshot_id and (public.can_see(s.agency_id) or public.is_admin())))
  with check (exists (
    select 1 from public.clearinghouse_snapshots s
     where s.id = snapshot_id and (public.can_see(s.agency_id) or public.is_admin())));

revoke all on public.clearinghouse_snapshots, public.clearinghouse_reviews from anon, authenticated;
-- A snapshot is written once and never edited: the parser inserts it, the
-- delete button (or a newer snapshot) removes it. The insert names its columns,
-- so the retention date, the author and the timestamps stay the database's.
grant select, delete on public.clearinghouse_snapshots to authenticated;
grant insert (agency_id, request_id, lead_id, client_name, taken_at, interface_version, data)
  on public.clearinghouse_snapshots to authenticated;
grant select, delete on public.clearinghouse_reviews to authenticated;
grant insert (snapshot_id, finding_key, status, final_text) on public.clearinghouse_reviews to authenticated;
grant update (status, final_text) on public.clearinghouse_reviews to authenticated;

-- ── purge ───────────────────────────────────────────────────────────────────

create function public.clearinghouse_purge() returns integer
  language sql
  security definer
  set search_path = ''
as $$
  with gone as (
    delete from public.clearinghouse_snapshots where delete_after <= now() returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.clearinghouse_purge() from public, anon, authenticated;
grant execute on function public.clearinghouse_purge() to service_role;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('clearinghouse-purge', '35 2 * * *', 'select public.clearinghouse_purge();');
  else
    raise notice 'pg_cron is not available: clearinghouse snapshots are not purged on a schedule';
  end if;
end
$do$;
