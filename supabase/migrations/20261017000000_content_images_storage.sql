-- Article and testimonial images: a public Supabase Storage bucket, step 3 of
-- leaving Base44. Replaces Base44's Core.UploadFile for the admin's two image
-- fields (BlogAdmin cover, testimonial photo) behind the existing UploadPort —
-- see src/services/supabase/SupabaseImageUploadService.ts. The site switches
-- to it with VITE_CONTENT_IMAGES=supabase, which must wait for this migration.
--
-- Public, unlike claim-documents: every visitor's <img> loads these by plain
-- URL (/storage/v1/object/public/content-images/...), which needs no select
-- policy and none is created.
--
-- Admin-only writes. A public bucket anyone could fill would be free hosting
-- under Dorit's name. is_admin() and not can_see(agency): content writes are
-- admin-only in the contentAdmin function too, and an image is only ever
-- uploaded on the way to one of them.
--
-- No update or delete policy: nothing in the site replaces or removes an image
-- (each upload gets a fresh uuid path), so there is nothing to allow.
--
-- Same folder-per-agency layout as claim-documents (AGENCY_1_ID), so a later
-- second agency has somewhere to go.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-images',
  'content-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

create policy content_images_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'content-images' and public.is_admin());
