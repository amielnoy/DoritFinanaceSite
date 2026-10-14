-- Clearinghouse requests: tell staff when the nine-day wipe takes a code
-- nobody submitted (product decision 2026-10-14; README, launch checklist).
--
-- `masleka_wipe_stale()` (20261015000000_masleka_requests.sql) expires a
-- `code_received` request whose values are nine days old. Nobody was told,
-- and the request leaves the board, so the client waited for a meeting
-- prepared from data that was never pulled. The hourly `masleka-remind` run
-- now mails every staff member once per such request — `status = 'expired'`
-- with a `code_received_at` and no `submitted_at`, which only the wipe
-- produces — and this column is its exactly-once marker: the run claims a
-- request by setting it where it is null, and gives it back if no mail went
-- out.
--
-- Ships dark like the rest: only `masleka-remind` writes it, and that
-- function answers 404 until MASLEKA_ENABLED is "true". Not granted to
-- `authenticated` — the board does not read it (the request has left the
-- board by then); `service_role` keeps its table-wide select and update.

alter table public.masleka_requests
  add column wipe_notified_at timestamptz;

comment on column public.masleka_requests.wipe_notified_at is
  'When staff were told the nine-day wipe expired this request before anyone submitted it (masleka-remind). Null: not yet, or not that case.';
