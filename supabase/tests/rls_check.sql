-- Proves the twelve rules actually behave. Run against a local `supabase start`.
-- Every block raises on a wrong answer, so a clean run is the assertion.
\set ON_ERROR_STOP on
begin;

-- Two people. Inserting into auth.users should fire the trigger and create
-- their profiles automatically — which is the first thing under test.
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','boss@example.com'),
       ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','staff@example.com');

do $$ begin
  if (select count(*) from public.profiles) <> 2 then
    raise exception 'trigger did not create both profiles';
  end if;
  if (select count(*) from public.profiles where role = 'user') <> 2 then
    raise exception 'new users should default to role=user, nobody is born admin';
  end if;
end $$;

update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

-- Seed as the table owner, bypassing RLS, so the reads below have something to find.
insert into public.leads (name, phone) values ('ראובן','050-000-0001');
insert into public.blog_posts (title, body, published) values ('published','b', true), ('draft','b', false);
insert into public.testimonials (name, quote) values ('לקוחה','מצוין');

-- ── anonymous visitor ───────────────────────────────────────────────────────
set local role anon;

insert into public.leads (name, phone) values ('אנונימי','050-000-0002');  -- create: true

do $$ begin
  if (select count(*) from public.leads) <> 0 then
    raise exception 'anon can read leads — customer enquiries are exposed';
  end if;
  if (select count(*) from public.blog_posts) <> 1 then
    raise exception 'anon should see exactly the published post, not drafts';
  end if;
  if (select count(*) from public.testimonials) <> 1 then
    raise exception 'anon cannot read testimonials — the reviews widget would break';
  end if;
end $$;

-- ── signed in, not an admin ─────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads) <> 0 then
    raise exception 'a non-admin signed-in user can read leads';
  end if;
  if (select count(*) from public.blog_posts) <> 1 then
    raise exception 'a non-admin should still see only published posts';
  end if;
end $$;

-- The privilege-escalation check: promoting yourself must not work.
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if (select role from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'admin' then
    raise exception 'a user promoted themselves to admin';
  end if;
end $$;

-- ── admin ───────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$ begin
  if (select count(*) from public.leads) <> 2 then
    raise exception 'admin cannot read all leads (expected the seeded one plus the anon submission)';
  end if;
  if (select count(*) from public.blog_posts) <> 2 then
    raise exception 'admin cannot see drafts';
  end if;
end $$;

rollback;
