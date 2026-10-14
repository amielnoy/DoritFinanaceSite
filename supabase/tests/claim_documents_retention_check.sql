-- Claim-document retention, against a local `supabase start`: every block
-- raises on a wrong answer, so a clean run is the assertion. Rolled back.
\set ON_ERROR_STOP on
begin;

insert into storage.objects (bucket_id, name, created_at) values
  ('claim-documents', '00000000-0000-0000-0000-000000000001/old.pdf',   now() - interval '2 months 1 day'),
  ('claim-documents', '00000000-0000-0000-0000-000000000001/older.pdf', now() - interval '6 months'),
  ('claim-documents', '00000000-0000-0000-0000-000000000001/new.pdf',   now() - interval '59 days'),
  ('content-images',  'old-cover.jpg',                                 now() - interval '1 year');

do $$ begin
  if (select array_agg(n) from public.claim_documents_expired(10) n)
       <> array['00000000-0000-0000-0000-000000000001/older.pdf', '00000000-0000-0000-0000-000000000001/old.pdf'] then
    raise exception 'expected exactly the two claim files past two months, oldest first';
  end if;
  if (select count(*) from public.claim_documents_expired(1)) <> 1 then
    raise exception 'the limit was not applied';
  end if;
end $$;

-- Nobody but the service role may list them, nor start the purge.
set local role anon;
do $$ begin
  begin
    perform public.claim_documents_expired(10);
    raise exception 'anon listed claim documents';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.claim_documents_call_purge();
    raise exception 'a signed-in user started the purge';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Without its Vault secrets the call does nothing, and does not fail.
do $$ begin
  perform public.claim_documents_call_purge();
end $$;

rollback;
