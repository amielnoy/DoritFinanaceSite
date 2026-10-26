-- Proves allow_submission counts, refuses past the limit, keeps keys apart,
-- and is closed to everyone but the service role. Run against a local
-- `supabase start`. Every block raises on a wrong answer, so a clean run is
-- the assertion.
\set ON_ERROR_STOP on
begin;

-- ── the service role: counts up to the limit, then refuses ──────────────────
set local role service_role;

do $$ begin
  if not public.allow_submission('check:a', 3600, 2) then raise exception '1st of 2 refused'; end if;
  if not public.allow_submission('check:a', 3600, 2) then raise exception '2nd of 2 refused'; end if;
  if public.allow_submission('check:a', 3600, 2) then raise exception '3rd of 2 allowed'; end if;
  -- A refused request is not counted: still exactly two rows for the key.
  if (select count(*) from public.submission_limits where key = 'check:a') <> 2 then
    raise exception 'a refused request was counted';
  end if;
  -- Another key has its own budget.
  if not public.allow_submission('check:b', 3600, 2) then raise exception 'keys share a budget'; end if;
end $$;

-- Outside the window, old rows no longer count.
reset role;
update public.submission_limits set at = now() - interval '2 hours' where key = 'check:a';
set local role service_role;
do $$ begin
  if not public.allow_submission('check:a', 3600, 2) then raise exception 'an expired request still counted'; end if;
end $$;

-- Rows past their own window are pruned on the way through (20261114000000:
-- by expires_at, no longer by a fixed day).
reset role;
insert into public.submission_limits (key, at, expires_at) values ('check:old', now() - interval '25 hours', now() - interval '1 hour');
set local role service_role;
do $$ begin
  perform public.allow_submission('check:c', 3600, 5);
  if exists (select 1 from public.submission_limits where key = 'check:old') then
    raise exception 'a day-old row was not pruned';
  end if;
end $$;

-- Bad arguments are refused, not silently allowed.
do $$ begin
  begin
    perform public.allow_submission('', 3600, 5);
    raise exception 'an empty key was accepted';
  exception when raise_exception then
    if sqlerrm not like 'allow_submission:%' then raise; end if;
  end;
end $$;

-- ── anon and authenticated: no way in ───────────────────────────────────────
reset role;
set local role anon;
do $$ begin
  begin
    perform public.allow_submission('check:anon', 3600, 5);
    raise exception 'anon could call allow_submission';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.submission_limits;
    raise exception 'anon could read submission_limits';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}';
do $$ begin
  begin
    perform public.allow_submission('check:auth', 3600, 5);
    raise exception 'a signed-in visitor could call allow_submission';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
