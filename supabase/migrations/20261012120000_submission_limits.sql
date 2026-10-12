-- Rate limits for the public, no-sign-in entry points, and an admin read on
-- claim documents.
--
-- ── Rate limits ──────────────────────────────────────────────────────────────
-- `submit-claim` and Base44's submitLead/submitClaim take no sign-in, and each
-- sends a branded confirmation to whatever address it is given. Without a
-- limit they send mail from Dorit's verified domain as fast as anyone calls
-- them. One counter table serves every caller: the key says what is being
-- counted ('claim-ip:<hash>', 'confirm-to:<hash>'), never the raw IP or
-- address — the callers hash before they ask.
--
-- Only the service role reaches it, through one function, so the check and the
-- insert happen in one transaction under a per-key advisory lock: two
-- simultaneous requests cannot both see "4 of 5" and both get through.
create table public.submission_limits (
  key text not null,
  at timestamptz not null default now()
);

create index submission_limits_key_at on public.submission_limits (key, at);
create index submission_limits_at on public.submission_limits (at);

alter table public.submission_limits enable row level security;
-- No policies: anon and authenticated have no business here at all.
revoke all on public.submission_limits from anon, authenticated;
grant select, insert, delete on public.submission_limits to service_role;

-- true when this request is within the limit (and is now counted), false when
-- it is over. Rows older than a day are pruned on the way through; no window
-- in use is longer than that.
create function public.allow_submission(p_key text, p_window_seconds integer, p_max integer)
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
  if p_window_seconds not between 1 and 86400 or p_max < 1 then
    raise exception 'allow_submission: bad window or max';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  delete from public.submission_limits where at < now() - interval '1 day';

  select count(*) into recent
  from public.submission_limits
  where key = p_key and at > now() - make_interval(secs => p_window_seconds);

  if recent >= p_max then
    return false;
  end if;

  insert into public.submission_limits (key) values (p_key);
  return true;
end;
$$;

revoke execute on function public.allow_submission(text, integer, integer) from public, anon, authenticated;
grant execute on function public.allow_submission(text, integer, integer) to service_role;

-- ── Claim documents: an admin may read ──────────────────────────────────────
-- Uploads now return a storage path instead of a ten-year signed URL (see
-- src/services/supabase/SupabaseUploadService.ts). `submit-claim` signs a
-- short link for the notification mail with the service key; past that, a
-- link is signed when an admin opens the document. Signing needs a select the
-- signer is allowed, so admins get one. Visitors still get none.
create policy claim_documents_read_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'claim-documents' and public.is_admin());
