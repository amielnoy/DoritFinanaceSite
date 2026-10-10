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
  ('ISO-A2-LEAD', 'לקוח ב׳', '050-000-1002', 'aaaaaaaa-0000-0000-0000-000000000002'),
  -- A third lead with no meeting of its own yet, so the new
  -- meetings_write_admin coverage below has an FK target that doesn't
  -- collide with meetings.lead_base44_id's existing unique constraint.
  ('ISO-A1-LEAD-2', 'לקוח א׳ 2', '050-000-1003', '00000000-0000-0000-0000-000000000001');
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

-- Crafted insert naming a different agency is refused for contacts too
-- (mirrors the leads crafted-insert test above). Verified by weakening
-- contacts_insert_public's WITH CHECK to `(true)`: this block then raises.
do $$ begin
  begin
    insert into public.contacts (phone, name, agency_id)
      values ('050-000-9998', 'רמאי', 'aaaaaaaa-0000-0000-0000-000000000002');
    raise exception 'a contact was inserted naming an agency other than the fixed one';
  exception when insufficient_privilege then null;
  end;
end $$;

-- leads_update_admin's WITH CHECK, checked against its actual definition
-- rather than through a crafted UPDATE: Postgres independently re-validates
-- that an UPDATE's new row still satisfies the table's SELECT policy (there
-- is no "update a row into invisibility" escape — confirmed empirically),
-- and leads_read_admin's SELECT policy is the identical can_see(agency_id)
-- or is_admin() expression. That makes any reassignment attempt fail for
-- the same reason regardless of what WITH CHECK itself says: weakening
-- leads_update_admin's WITH CHECK to `(true)` does not change the existing
-- reassignment test's outcome at all (verified directly — it stays clean
-- either way), so a crafted-UPDATE test cannot isolate this clause. This
-- checks its definition directly, which does catch that same weakening.
do $$ begin
  if (
    select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polrelid = 'public.leads'::regclass and polname = 'leads_update_admin'
  ) is distinct from '(can_see(agency_id) OR is_admin())' then
    raise exception 'leads_update_admin''s WITH CHECK no longer enforces agency scoping';
  end if;
end $$;

-- contacts_update_admin's WITH CHECK: same reasoning and same fix as
-- leads_update_admin above (contacts_read_admin's SELECT policy is the
-- identical, exception-free can_see(agency_id) or is_admin() expression).
do $$ begin
  if (
    select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polrelid = 'public.contacts'::regclass and polname = 'contacts_update_admin'
  ) is distinct from '(can_see(agency_id) OR is_admin())' then
    raise exception 'contacts_update_admin''s WITH CHECK no longer enforces agency scoping';
  end if;
end $$;

-- testimonials_write_admin's WITH CHECK, isolated from the read policy's
-- public exception (unlike leads/contacts above, this one IS isolable
-- through a crafted UPDATE): reassigning agency 2's own testimonial into
-- the one fixed agency would stay readable under
-- testimonials_read_member_or_fixed_agency regardless of membership (its
-- own "agency_id = the fixed agency" clause), so Postgres's "don't update
-- a row into invisibility" safety net does not save us here — only WITH
-- CHECK does. Verified by weakening testimonials_write_admin's WITH CHECK
-- to `(true)`: this block then raises.
do $$ begin
  begin
    update public.testimonials set agency_id = '00000000-0000-0000-0000-000000000001'
      where name = 'לקוחה ב׳';
    raise exception 'agency 2 member reassigned their testimonial into agency 1';
  exception when insufficient_privilege then null;
  end;
end $$;

-- meetings_write_admin's WITH CHECK: meetings has no separate insert
-- policy (it is `for all`), and INSERT has no prior row to protect, so,
-- unlike UPDATE, there is no new-row-must-stay-visible safety net —
-- WITH CHECK is the only gate. A crafted insert naming a different agency
-- exercises it directly. Verified by weakening meetings_write_admin's
-- WITH CHECK to `(true)`: this block then raises.
do $$ begin
  begin
    insert into public.meetings (lead_base44_id, scheduled_at, agency_id)
      values ('ISO-A1-LEAD-2', now() + interval '3 days', '00000000-0000-0000-0000-000000000001');
    raise exception 'agency 2 member inserted a meeting naming agency 1';
  exception when insufficient_privilege then null;
  end;
end $$;

-- blog_posts_write_admin's WITH CHECK, isolated the same way testimonials'
-- is above: reassigning agency 2's own published post to the one fixed
-- agency stays readable under blog_posts_read_published_or_admin's own
-- public-exception clause, so only WITH CHECK stands between this and a
-- successful reassignment. Verified by weakening blog_posts_write_admin's
-- WITH CHECK to `(true)`: this block then raises.
do $$ begin
  begin
    update public.blog_posts set agency_id = '00000000-0000-0000-0000-000000000001'
      where title = 'מאמר ב׳';
    raise exception 'agency 2 member reassigned their blog post into agency 1';
  exception when insufficient_privilege then null;
  end;
end $$;

-- memberships has zero coverage above, and it is the table can_see()
-- itself trusts. Verified by weakening memberships_write_admin's WITH
-- CHECK to `(true)`: this block then raises.
do $$ begin
  begin
    insert into public.memberships (user_id, agency_id, role)
      values ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'owner');
    raise exception 'agency 2 member added themselves to agency 1''s membership list';
  exception when insufficient_privilege then null;
  end;
end $$;

-- agencies and agency_profiles have zero coverage above. Both write
-- policies are is_admin()-only (not can_see()-based, since neither is
-- member-editable in this phase), so USING already excludes every row for
-- a non-admin uniformly — an UPDATE attempt would affect zero rows
-- silently regardless of WITH CHECK (confirmed empirically), making WITH
-- CHECK only observable through INSERT, which USING does not gate at all.
-- Verified by weakening agencies_write_admin's / agency_profiles_write_admin's
-- WITH CHECK to `(true)`: each block below then raises.
do $$ begin
  begin
    insert into public.agencies (name, status) values ('סוכנות גנובה', 'active');
    raise exception 'agency 2 member (non-admin) inserted a new agency';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  begin
    insert into public.agency_profiles (
      agency_id, display_name, phone_e164, phone_display, whatsapp, email,
      default_whatsapp_message, licence_entity, licence_number, licence_regulator
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', '+972500000000', '050-000-0000',
      '972500000000', 'b@example.com', 'הודעה', 'סוכנות ב׳', 'L-2', 'רשות'
    );
    raise exception 'agency 2 member created their own agency''s profile without being admin';
  exception when insufficient_privilege then null;
  end;
end $$;

-- blog_posts insert with a null (shared-library) agency_id: can_see(null)
-- is always false, so this is covered by the same blog_posts_write_admin
-- policy as the reassignment test above, exercised through its one
-- insert-shaped edge case. Verified by weakening blog_posts_write_admin's
-- WITH CHECK to `(true)`: this block then raises.
do $$ begin
  begin
    insert into public.blog_posts (title, body, published, agency_id)
      values ('גנוב', 'תוכן', false, null);
    raise exception 'agency 2 member inserted a null-agency blog post';
  exception when insufficient_privilege then null;
  end;
end $$;

-- leads delete refused. A DELETE that matches zero rows under RLS doesn't
-- throw, so this checks the post-condition rather than assuming an
-- exception (matching the shared-blog-post-write test's style above) — and
-- the post-condition has to be read bypassing this actor's own read
-- policy, which would hide agency 1's row whether or not it was actually
-- deleted (confirmed empirically: querying as the agency-2 actor always
-- shows zero rows here, deleted or not, since they can never see it either
-- way — that reads as "deleted" regardless of the real outcome).
do $$ begin
  delete from public.leads where base44_id = 'ISO-A1-LEAD';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.leads where base44_id = 'ISO-A1-LEAD') = 0 then
    raise exception 'agency 2 member deleted an agency 1 lead';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- leads_delete_admin's USING, checked against its actual definition for
-- the same reason leads_update_admin's WITH CHECK is above: a DELETE also
-- requires the target row to satisfy applicable SELECT policies (the same
-- "don't act on a row you can no longer see" mechanism), and
-- leads_read_admin's SELECT policy is the identical can_see(agency_id) or
-- is_admin() expression — so the post-condition check just above stays
-- clean whether leads_delete_admin's USING is correct or weakened to
-- `true` (confirmed empirically), and cannot catch that weakening on its
-- own.
do $$ begin
  if (
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polrelid = 'public.leads'::regclass and polname = 'leads_delete_admin'
  ) is distinct from '(can_see(agency_id) OR is_admin())' then
    raise exception 'leads_delete_admin''s USING no longer enforces agency scoping';
  end if;
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
  -- 3, not 2: ISO-A1-LEAD-2 (added above as an FK target for the
  -- meetings_write_admin coverage) is a third lead, fixed from agency 1.
  if (select count(*) from public.leads) <> 3 then
    raise exception 'platform admin cannot read both agencies'' leads';
  end if;
  if (select count(*) from public.blog_posts) <> 4 then
    raise exception 'platform admin cannot read every blog post, published or not';
  end if;
end $$;

rollback;
