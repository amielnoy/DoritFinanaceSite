-- Proves the claim-documents bucket's one rule actually behaves. Run against
-- a local `supabase start`. Every block raises on a wrong answer, so a clean
-- run is the assertion.
\set ON_ERROR_STOP on
begin;

-- ── anonymous visitor ───────────────────────────────────────────────────────
set local role anon;

insert into storage.objects (bucket_id, name)
values ('claim-documents', '00000000-0000-0000-0000-000000000001/anon-upload.pdf');

do $$ begin
  -- The insert above must have gone through; this is not the assertion, the
  -- reads below are. A failed insert would already have raised insufficient_
  -- privilege and stopped the script before reaching here.
  if (select count(*) from storage.objects where bucket_id = 'claim-documents') <> 0 then
    raise exception 'anon can read what it just uploaded — there is no select policy, there should be no read';
  end if;
end $$;

-- A different bucket is not implicitly open just because one is.
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('some-other-bucket', 'x');
    raise exception 'anon inserted into a bucket with no policy for it';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── signed in, not an admin ─────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}';

insert into storage.objects (bucket_id, name)
values ('claim-documents', '00000000-0000-0000-0000-000000000001/authenticated-upload.pdf');

do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'claim-documents') <> 0 then
    raise exception 'a signed-in visitor can read claim documents directly — reads must go through signed URLs only';
  end if;
end $$;

-- ── the bucket itself ────────────────────────────────────────────────────────
reset role;
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'claim-documents' and public = false) then
    raise exception 'claim-documents is missing or public — it must be a private bucket';
  end if;
  if (select file_size_limit from storage.buckets where id = 'claim-documents') is null then
    raise exception 'claim-documents has no file size limit';
  end if;
  if (select allowed_mime_types from storage.buckets where id = 'claim-documents') is null then
    raise exception 'claim-documents has no mime-type allow-list';
  end if;
end $$;

rollback;
