-- Proves allow_submission holds windows longer than a day (20261114000000):
-- invite-client's 2 a year and create-lead's 1 in 30 days, which the day-only
-- function refused, so withinLimit let every request through. Every block
-- raises on a wrong answer, so a clean run is the assertion.
\set ON_ERROR_STOP on
begin;

set local role service_role;

-- A year's window is taken, and holds: two, then refused.
do $$ begin
  if not public.allow_submission('long:year', 31536000, 2) then raise exception '1st of 2 a year refused'; end if;
  if not public.allow_submission('long:year', 31536000, 2) then raise exception '2nd of 2 a year refused'; end if;
  if public.allow_submission('long:year', 31536000, 2) then raise exception '3rd of 2 a year allowed'; end if;
  if (select min(expires_at) from public.submission_limits where key = 'long:year') < now() + interval '364 days' then
    raise exception 'a year-window row expires too soon';
  end if;
end $$;

-- Two days on, the pruning (run by any call) leaves the year's rows, and they still count.
reset role;
update public.submission_limits
   set at = at - interval '2 days', expires_at = expires_at - interval '2 days'
 where key = 'long:year';
set local role service_role;
do $$ begin
  perform public.allow_submission('long:other', 3600, 5);
  if (select count(*) from public.submission_limits where key = 'long:year') <> 2 then
    raise exception 'a year-window row was pruned after two days';
  end if;
  if public.allow_submission('long:year', 31536000, 2) then raise exception 'the year limit forgot its rows after two days'; end if;
end $$;

-- 30 days, as create-lead's notice: one, then refused; past the window, allowed again and the old row gone.
do $$ begin
  if not public.allow_submission('long:month', 2592000, 1) then raise exception 'the 30-day first refused'; end if;
  if public.allow_submission('long:month', 2592000, 1) then raise exception 'a second in 30 days allowed'; end if;
end $$;
reset role;
update public.submission_limits
   set at = at - interval '31 days', expires_at = expires_at - interval '31 days'
 where key = 'long:month';
set local role service_role;
do $$ begin
  if not public.allow_submission('long:month', 2592000, 1) then raise exception 'still refused after 31 days'; end if;
  if (select count(*) from public.submission_limits where key = 'long:month') <> 1 then
    raise exception 'the 31-day-old row was not pruned';
  end if;
end $$;

-- An hour's row goes after its hour, not after a day.
reset role;
insert into public.submission_limits (key, at, expires_at) values ('long:hour', now() - interval '2 hours', now() - interval '1 hour');
set local role service_role;
do $$ begin
  perform public.allow_submission('long:other', 3600, 5);
  if exists (select 1 from public.submission_limits where key = 'long:hour') then
    raise exception 'an expired hour row was kept';
  end if;
end $$;

-- Up to 366 days; past that, refused, not silently allowed.
do $$ begin
  if not public.allow_submission('long:max', 31622400, 1) then raise exception '366 days refused'; end if;
  begin
    perform public.allow_submission('long:over', 31622401, 1);
    raise exception 'a window past 366 days was accepted';
  exception when raise_exception then
    if sqlerrm not like 'allow_submission:%' then raise; end if;
  end;
end $$;

-- Still closed to everyone but the service role.
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.allow_submission('long:auth', 3600, 5);
    raise exception 'authenticated could call allow_submission';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
\echo 'submission_limits_long_windows_check: OK'
