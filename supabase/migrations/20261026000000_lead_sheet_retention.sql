-- The leads sheet, held to the database's retention (Architecture N-02).
--
-- 20261025000000_lead_retention.sql anonymizes a lead 24 months after its
-- last contact, unless it is a client, but "the row in the Google Sheet" was
-- out of its reach: SQL cannot edit a spreadsheet. The Edge Function
-- sheet-retention does that, nightly at 04:30, after the 03:45 anonymization.
-- Which rows go is still decided here, by the same rule, so the exemption and
-- the period are written once:
--
--   lead_sheet_live(ids) answers which of the sheet's ids still belong to a
--   live lead — one that exists and is not anonymized. Every other row (its
--   lead anonymized, or deleted from /admin/leads as a deletion request asks)
--   loses its personal cells.
--
-- The sheet's id is the lead's Supabase id, or its Base44 id on rows written
-- before the switch.

create or replace function public.lead_sheet_live(p_ids text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select x
  from unnest(p_ids) as x
  where exists (
    select 1
    from public.leads l
    where l.anonymized_at is null
      and (
        l.base44_id = x
        -- The cast only for a well-formed uuid: CASE, unlike OR, guarantees the
        -- order, so a Base44 id never reaches ::uuid.
        or l.id = (case when x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x::uuid end)
      )
  );
$$;

-- The nightly call, as claim_documents_call_purge makes it: the functions URL
-- and the site's cron secret from Vault, and nothing if either is missing.
create or replace function public.lead_sheet_call_retention()
returns void
language plpgsql
security definer
set search_path = public
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
    url := rtrim(base_url, '/') || '/functions/v1/sheet-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-site-cron', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so `from public` alone would leave these open (A-69).
revoke execute on function public.lead_sheet_live(text[])        from public, anon, authenticated;
revoke execute on function public.lead_sheet_call_retention()    from public, anon, authenticated;
grant execute on function public.lead_sheet_live(text[])         to service_role;
grant execute on function public.lead_sheet_call_retention()     to service_role;

-- Nightly at 04:30, after the 03:45 anonymization. Guarded, so a database
-- without pg_cron or pg_net still takes the migration.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('lead-sheet-retention', '30 4 * * *', 'select public.lead_sheet_call_retention();');
  else
    raise notice 'pg_cron or pg_net is not available: the leads sheet is not held to retention on a schedule';
  end if;
end
$do$;
