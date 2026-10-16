-- Proves the claim-documents bucket's one rule actually behaves. Run against
-- a local `supabase start`. Every block raises on a wrong answer, so a clean
-- run is the assertion.
\set ON_ERROR_STOP on
begin;

-- ── anonymous visitor ───────────────────────────────────────────────────────
set local role anon;

-- Only the name the claim form makes: agency 1's folder, a random uuid, the
-- sanitized file name (20261102000000). Anything else is refused.
do $$
declare
  bad text;
begin
  foreach bad in array array[
    '00000000-0000-0000-0000-000000000001/anon-upload.pdf',
    'aaaaaaaa-0000-0000-0000-000000000002/1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b-x.pdf',
    '00000000-0000-0000-0000-000000000001/1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b-../x.pdf',
    '00000000-0000-0000-0000-000000000001/1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b-',
    'x.pdf'
  ] loop
    begin
      insert into storage.objects (bucket_id, name) values ('claim-documents', bad);
      raise exception 'a claim document went in under a name the form never makes: %', bad;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

insert into storage.objects (bucket_id, name)
values ('claim-documents', '00000000-0000-0000-0000-000000000001/1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b-anon-upload.pdf');

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
values ('claim-documents', '00000000-0000-0000-0000-000000000001/6f9619ff-8b86-4011-b42d-00c04fc964ff-authenticated-upload.pdf');

do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'claim-documents') <> 0 then
    raise exception 'a signed-in visitor can read claim documents directly — reads must go through signed URLs only';
  end if;
end $$;

-- ── an admin: may read, which is what lets the leads screen sign a link ─────
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ad', 'admin-check@example.test');
insert into public.profiles (id, role) values ('00000000-0000-0000-0000-0000000000ad', 'admin')
  on conflict (id) do update set role = 'admin';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';

do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'claim-documents') < 2 then
    raise exception 'an admin cannot read claim documents — the leads screen could not sign a link';
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
