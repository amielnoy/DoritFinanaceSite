create table if not exists public.test_results (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null,
  environment text not null,
  project text not null,
  build_id text not null,
  build_number integer,
  git_commit text,
  git_branch text,
  run_type text,
  test_id text not null,
  test_name text not null,
  full_name text,
  status text not null,
  start_time timestamptz,
  end_time timestamptz,
  duration_ms integer not null,
  duration_seconds integer not null,
  suite text,
  feature text,
  story text,
  severity text,
  owner text,
  tags text[] not null default '{}',
  host text,
  worker text,
  error_message text,
  error_trace text,
  steps_count integer not null default 0,
  attachments_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Upgrades a table created before a column existed: `create table if not exists`
-- leaves an existing table alone, so each later column is added here too.
-- Re-running this file brings any dashboard database up to date.
alter table public.test_results add column if not exists run_type text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'test_results_run_type_check'
                    and conrelid = 'public.test_results'::regclass) then
    alter table public.test_results add constraint test_results_run_type_check
      check (run_type in ('nightly', 'e2e', 'local'));
  end if;
end
$$;

-- Rows uploaded before run_type: a local one is known; a CI one cannot be told
-- nightly from e2e after the fact and stays null until retention removes it.
update public.test_results set run_type = 'local'
 where run_type is null and environment = 'local';

create index if not exists test_results_timestamp on public.test_results (timestamp desc);
create index if not exists test_results_test_id on public.test_results (test_id, timestamp desc);
create index if not exists test_results_build_id on public.test_results (build_id);

alter table public.test_results enable row level security;
