-- Phase 1's own gate: a member of one agency reads zero rows of another, in
-- every agency-scoped table. Run against a local `supabase start`, same as
-- rls_check.sql and account_check.sql. Every block raises on a wrong answer,
-- so a clean run is the assertion.
--
-- Uses only its own synthetic fixtures, never the migration's real Dorit
-- seed row — same self-containment as rls_check.sql's boss@example.com /
-- staff@example.com.
\set ON_ERROR_STOP on
begin;

-- Agency 1 already exists (seeded by the tenant-schema migration). Agency 2
-- is this test's own fixture.
insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- Three people: a member of agency 1 only, a member of agency 2 only, and a
-- platform admin with no membership row in either agency.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000001','authenticated','authenticated','agency1-member@example.com'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000002','authenticated','authenticated','agency2-member@example.com'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000003','authenticated','authenticated','platform-admin@example.com');

insert into public.memberships (user_id, agency_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');

update public.profiles set role = 'admin' where id = 'bbbbbbbb-0000-0000-0000-000000000003';

-- Seed as the table owner, bypassing RLS, so the reads below have something
-- to find in both agencies.
insert into public.leads (base44_id, name, phone, agency_id) values
  ('ISO-A1-LEAD', 'לקוח א׳', '050-000-1001', '00000000-0000-0000-0000-000000000001'),
  ('ISO-A2-LEAD', 'לקוח ב׳', '050-000-1002', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into public.contacts (phone, name, agency_id) values
  ('050-000-2001', 'איש קשר א׳', '00000000-0000-0000-0000-000000000001'),
  ('050-000-2002', 'איש קשר ב׳', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into public.testimonials (name, quote, agency_id) values
  ('לקוחה א׳', 'מצוין', '00000000-0000-0000-0000-000000000001'),
  ('לקוחה ב׳', 'מעולה', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into public.meetings (lead_base44_id, scheduled_at, agency_id) values
  ('ISO-A1-LEAD', now() + interval '1 day', '00000000-0000-0000-0000-000000000001'),
  ('ISO-A2-LEAD', now() + interval '2 days', 'aaaaaaaa-0000-0000-0000-000000000002');
-- A published post for each agency, plus one null-agency (shared-library)
-- published post and one null-agency draft.
insert into public.blog_posts (title, body, published, agency_id) values
  ('מאמר א׳', 'תוכן', true, '00000000-0000-0000-0000-000000000001'),
  ('מאמר ב׳', 'תוכן', true, 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('מאמר משותף', 'תוכן', true, null),
  ('טיוטה משותפת', 'תוכן', false, null);

-- ── as a member of agency 2 only ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads where agency_id = '00000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'agency 2 member read an agency 1 lead';
  end if;
  if (select count(*) from public.contacts where agency_id = '00000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'agency 2 member read an agency 1 contact';
  end if;
  -- Testimonials and agency 1's own published posts are public-exception
  -- content — there is one live public site right now (no Phase 4 host
  -- routing yet), and rls_check.sql/account_check.sql already require `anon`
  -- to read both; a policy that blocked them for an authenticated member of
  -- a *different* agency while still allowing a fully anonymous visitor
  -- would be incoherent, not stricter. True per-agency isolation for this
  -- content starts to mean something once a second agency has its own live
  -- site. Agency 2's own (unpublished-to-the-world) content stays invisible.
  if (select count(*) from public.testimonials where agency_id = '00000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'agency 2 member cannot read agency 1''s public testimonial';
  end if;
  if (select count(*) from public.meetings where agency_id = '00000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'agency 2 member read an agency 1 meeting';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר א׳') <> 1 then
    raise exception 'agency 2 member cannot read agency 1''s own published blog post';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר ב׳') <> 1 then
    raise exception 'agency 2 member cannot read their own blog post';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר משותף') <> 1 then
    raise exception 'agency 2 member cannot read the shared published post';
  end if;
  if (select count(*) from public.blog_posts where title = 'טיוטה משותפת') <> 0 then
    raise exception 'agency 2 member read an unpublished shared draft';
  end if;
end $$;

-- The public insert policy accepts only the one fixed agency id right now —
-- a caller naming any other agency, even one they are a member of, is
-- refused. There is no live public form for agency 2 yet (Phase 4's work);
-- the check is on the value, not on who is asking.
do $$ begin
  begin
    insert into public.leads (name, phone, agency_id)
      values ('רמאי', '050-000-9999', 'aaaaaaaa-0000-0000-0000-000000000002');
    raise exception 'a lead was inserted naming an agency other than the fixed one';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Cannot reassign a row they can see into someone else's agency.
do $$ begin
  begin
    update public.leads set agency_id = '00000000-0000-0000-0000-000000000001'
      where base44_id = 'ISO-A2-LEAD';
    raise exception 'agency 2 member reassigned a lead into agency 1';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Cannot write a shared (null-agency) post — can_see(null) is always false.
do $$ begin
  begin
    update public.blog_posts set title = 'נגנב' where title = 'מאמר משותף';
    if (select count(*) from public.blog_posts where title = 'נגנב') > 0 then
      raise exception 'agency 2 member wrote to a shared blog post';
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── as a member of agency 1 only — the reverse ──────────────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 lead';
  end if;
  if (select count(*) from public.contacts where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 contact';
  end if;
  if (select count(*) from public.testimonials where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 testimonial';
  end if;
  if (select count(*) from public.meetings where agency_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 0 then
    raise exception 'agency 1 member read an agency 2 meeting';
  end if;
  if (select count(*) from public.blog_posts where title = 'מאמר ב׳') <> 0 then
    raise exception 'agency 1 member read agency 2''s own blog post';
  end if;
end $$;

-- ── as the platform admin, with no membership row in either agency ─────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads) <> 2 then
    raise exception 'platform admin cannot read both agencies'' leads';
  end if;
  if (select count(*) from public.blog_posts) <> 4 then
    raise exception 'platform admin cannot read every blog post, published or not';
  end if;
end $$;

rollback;
