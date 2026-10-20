create table if not exists public.test_results (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null,
  environment text not null,
  project text not null,
  build_id text not null,
  build_number integer,
  git_commit text,
  git_branch text,
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

create index if not exists test_results_timestamp on public.test_results (timestamp desc);
create index if not exists test_results_test_id on public.test_results (test_id, timestamp desc);
create index if not exists test_results_build_id on public.test_results (build_id);

alter table public.test_results enable row level security;
