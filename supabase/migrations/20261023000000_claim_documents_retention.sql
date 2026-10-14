-- Claim documents are kept two months, then deleted (user, 2026-10-14).
--
-- The claim-documents bucket holds what visitors attach to a claim report —
-- photos and PDFs of up to 10 MB each — and is by far the largest thing the
-- site stores. Dorit gets each file by a signed link in the claim's mail
-- (valid a week) and keeps what the claim needs in the client's own file; the
-- site does not have to keep a copy for ever. The claim's text record, and the
-- path of each document in it, stay; only the files go.
--
-- Storage objects cannot be deleted in SQL — Supabase refuses a direct delete
-- from storage.objects, and one that got through would orphan the file in the
-- object store. So this lists what is due, and the `claim-documents-purge`
-- Edge Function deletes it through the Storage API, called nightly below the
-- same way masleka-remind is: pg_net, with the shared cron secret from Vault.

-- The names of claim documents past retention, oldest first, at most p_limit.
-- Service role only: the purge function is its one caller.
create function public.claim_documents_expired(p_limit integer default 500)
returns setof text
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'claim-documents'
     and o.created_at < now() - interval '2 months'
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;

-- Calls the purge function. The address and the secret are the ones
-- masleka_call_remind already reads from Vault (the site's functions URL and
-- its cron secret); until both are set this does nothing, quietly.
create function public.claim_documents_call_purge() returns void
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
    url := rtrim(base_url, '/') || '/functions/v1/claim-documents-purge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-site-cron', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so `from public` alone would leave these open (A-69).
revoke execute on function public.claim_documents_expired(integer) from public, anon, authenticated;
revoke execute on function public.claim_documents_call_purge()     from public, anon, authenticated;
grant execute on function public.claim_documents_expired(integer) to service_role;
grant execute on function public.claim_documents_call_purge()     to service_role;

-- Nightly at 03:15. Guarded, so a database without pg_cron or pg_net still
-- takes the migration; the function can be called by hand there.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('claim-documents-purge', '15 3 * * *', 'select public.claim_documents_call_purge();');
  else
    raise notice 'pg_cron or pg_net is not available: claim documents are not purged on a schedule';
  end if;
end
$do$;
