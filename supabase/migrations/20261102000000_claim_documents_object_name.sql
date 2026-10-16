-- A claim document may be uploaded only under the name the claim form makes
-- (review 2026-10-15, item 10): agency 1's folder, a fresh random uuid, then
-- the sanitized file name (src/services/supabase/SupabaseUploadService.ts,
-- agencyObjectPath). The bucket used to take any name from anyone, so an
-- anonymous caller could choose — and squat — paths of their own. The upload
-- flow is unchanged: it already names every file this way.
drop policy claim_documents_insert_public on storage.objects;
create policy claim_documents_insert_public on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'claim-documents'
    and name ~ '^00000000-0000-0000-0000-000000000001/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,200}$'
  );
