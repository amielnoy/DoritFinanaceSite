-- allow_submission, for windows longer than a day.
--
-- 20261012120000 took windows of at most a day and pruned every row older than
-- a day. Two callers since asked for more: invite-client (2 a client a year)
-- and create-lead's notice (1 an address in 30 days). The function refused
-- those windows with an exception, and withinLimit (_shared/guard.ts) reads a
-- failed limiter as "allow" — so neither limit held at all.
--
-- Now each row carries its own expiry, the end of the window it was counted
-- in, and the pruning goes by that. Windows of up to 366 days. The signature
-- and the answers are unchanged, so no caller changes.

alter table public.submission_limits
  add column expires_at timestamptz not null default now() + interval '1 day';

-- The rows already there were counted under windows of at most a day, and the
-- old pruning would have dropped them a day after `at`.
update public.submission_limits set expires_at = at + interval '1 day';

create index submission_limits_expires_at on public.submission_limits (expires_at);
drop index public.submission_limits_at;

-- true when this request is within the limit (and is now counted), false when
-- it is over. Rows past their own window are pruned on the way through.
create or replace function public.allow_submission(p_key text, p_window_seconds integer, p_max integer)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  recent integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    raise exception 'allow_submission: bad key';
  end if;
  if p_window_seconds not between 1 and 31622400 or p_max < 1 then
    raise exception 'allow_submission: bad window or max';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  delete from public.submission_limits where expires_at < now();

  select count(*) into recent
  from public.submission_limits
  where key = p_key and at > now() - make_interval(secs => p_window_seconds);

  if recent >= p_max then
    return false;
  end if;

  insert into public.submission_limits (key, expires_at)
  values (p_key, now() + make_interval(secs => p_window_seconds));
  return true;
end;
$$;

revoke execute on function public.allow_submission(text, integer, integer) from public, anon, authenticated;
grant execute on function public.allow_submission(text, integer, integer) to service_role;
