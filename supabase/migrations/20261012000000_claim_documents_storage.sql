-- Claim document uploads: a private Supabase Storage bucket, the first piece
-- of "Off Base44" (see docs/superpowers/specs/2026-10-10-multi-agent-platform-design.md).
-- Replaces Base44's Core.UploadFile behind the existing UploadPort — see
-- src/services/supabase/SupabaseUploadService.ts.
--
-- The claim form posts without signing in, matching leads/contacts: anon may
-- insert, nothing else. Reads happen only through signed URLs (bypass RLS,
-- long-lived — see the adapter), never through a select policy, so there is
-- none here.
--
-- Folder-per-agency, using the same fixed-agency literal Phase 1 established
-- (AGENCY_1_ID = '00000000-0000-0000-0000-000000000001') — host-based
-- resolution doesn't exist until a later phase.
--
-- The current Base44 flow has no file-size or file-type check at all, client
-- or server side. The bucket's own limits close that gap as a side effect of
-- this migration, not a separate change.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-documents',
  'claim-documents',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
);

create policy claim_documents_insert_public on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'claim-documents');
