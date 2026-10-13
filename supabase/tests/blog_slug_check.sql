-- Proves the slug migration on rows shaped like production's: each live title
-- gets its file's slug; a second row with the same title, a draft no file
-- names and a row with no Base44 id get `post-` slugs; a write that sends no
-- slug (what the code running before this PR does) gets the fallback from the
-- trigger, including through an upsert, and never overwrites an existing slug;
-- and the constraints refuse a malformed, Base44-shaped or duplicate slug.
--
-- Run against a local `supabase start`, after `supabase db reset`, from the
-- repository root:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/blog_slug_check.sql
-- Every block raises on a wrong answer, so a clean run is the assertion.
\set ON_ERROR_STOP on
begin;

-- Undo the migration inside this transaction, seed rows as production held
-- them before it, and apply the real file again on top of them. The trigger
-- goes first: it names `new.slug`, which the seed inserts below no longer have.
drop trigger blog_posts_fill_slug on public.blog_posts;
alter table public.blog_posts drop column slug;

insert into public.blog_posts (base44_id, title, body, published, created_at) values
  ('aaaaaaaaaaaaaaaaaaaaaaa1', 'להוריד דמי ניהול בפנסיה: המהלך הפשוט ביותר, צעד אחר צעד', 'b', true, '2026-10-01'),
  -- One title, two rows: the published one takes the slug, though it is newer.
  ('aaaaaaaaaaaaaaaaaaaaaaa2', 'ביטוח נסיעות לחו״ל: שלוש בדיקות לפני שקונים עוד פוליסה', 'b', false, '2026-09-01'),
  ('aaaaaaaaaaaaaaaaaaaaaaa3', 'ביטוח נסיעות לחו״ל: שלוש בדיקות לפני שקונים עוד פוליסה', 'b', true, '2026-10-02'),
  -- One of the two live articles older than the repo files.
  ('aaaaaaaaaaaaaaaaaaaaaaa4', 'פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?', 'b', true, '2026-08-01'),
  -- A draft no file names, with an id that needs cleaning.
  ('B44_Odd.ID', 'טיוטה בלי קובץ', 'b', false, '2026-10-03'),
  -- A row that never had a Base44 id.
  (null, 'שורה שנוצרה רק ב-Supabase', 'b', false, '2026-10-04');

\ir ../migrations/20261014000000_blog_slug.sql

do $$ begin
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa1') is distinct from 'horadat-dmei-nihul' then
    raise exception 'a repo article did not get its file name as its slug';
  end if;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa3') is distinct from 'bituach-nesiot' then
    raise exception 'the published copy of a duplicated title did not get the slug';
  end if;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa2') is distinct from 'post-aaaaaaaaaaaaaaaaaaaaaaa2' then
    raise exception 'the draft copy of a duplicated title should fall back to its Base44 id';
  end if;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa4') is distinct from 'pensia-beidan-ha-ai' then
    raise exception 'an older live article did not get its hand-picked slug';
  end if;
  if (select slug from public.blog_posts where base44_id = 'B44_Odd.ID') is distinct from 'post-b44-odd-id' then
    raise exception 'an untidy Base44 id was not cleaned into a valid slug';
  end if;
  if (select slug from public.blog_posts where title = 'שורה שנוצרה רק ב-Supabase') !~ '^post-[0-9a-f]{8}-[0-9a-f]{4}-' then
    raise exception 'a row with no Base44 id should fall back to its uuid';
  end if;
  if exists (select 1 from public.blog_posts where slug is null) then
    raise exception 'a row was left without a slug';
  end if;
end $$;

-- The fallback trigger: the writers running before this PR send no slug.
do $$ begin
  -- contentAdmin's create mirror, today: a plain upsert with no slug, new row.
  insert into public.blog_posts (base44_id, title, body, published)
    values ('bbbbbbbbbbbbbbbbbbbbbbb1', 'חדש בלי כתובת', 'b', false)
    on conflict (base44_id) do update set title = excluded.title, body = excluded.body, published = excluded.published;
  if (select slug from public.blog_posts where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb1') is distinct from 'post-bbbbbbbbbbbbbbbbbbbbbbb1' then
    raise exception 'an upsert-insert without a slug did not get the fallback';
  end if;
  -- The same upsert against an existing row must not touch its slug.
  insert into public.blog_posts (base44_id, title, body, published)
    values ('aaaaaaaaaaaaaaaaaaaaaaa1', 'להוריד דמי ניהול בפנסיה: המהלך הפשוט ביותר, צעד אחר צעד', 'b2', true)
    on conflict (base44_id) do update set title = excluded.title, body = excluded.body, published = excluded.published;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa1') is distinct from 'horadat-dmei-nihul' then
    raise exception 'an upsert without a slug overwrote an existing slug';
  end if;
  -- A plain insert without a slug, and one with no Base44 id either.
  insert into public.blog_posts (base44_id, title, body) values ('bbbbbbbbbbbbbbbbbbbbbbb2', 'בלי כתובת', 'b');
  if (select slug from public.blog_posts where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb2') is distinct from 'post-bbbbbbbbbbbbbbbbbbbbbbb2' then
    raise exception 'an insert without a slug did not get the fallback';
  end if;
  insert into public.blog_posts (title, body) values ('בלי כתובת ובלי מזהה', 'b');
  if (select slug from public.blog_posts where title = 'בלי כתובת ובלי מזהה') !~ '^post-[0-9a-f]{8}-' then
    raise exception 'an insert with no slug and no Base44 id did not fall back to its uuid';
  end if;
  -- A slug that is sent is kept.
  insert into public.blog_posts (base44_id, title, body, slug) values ('bbbbbbbbbbbbbbbbbbbbbbb3', 'עם כתובת', 'b', 'im-ktovet');
  if (select slug from public.blog_posts where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb3') is distinct from 'im-ktovet' then
    raise exception 'the trigger replaced a slug that was sent';
  end if;
end $$;

-- The constraints, row by row.
do $$ begin
  begin
    update public.blog_posts set slug = null where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb3';
    raise exception 'a slug was cleared to null';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'Has-Capitals');
    raise exception 'an uppercase slug was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'double--hyphen');
    raise exception 'a double hyphen was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'trailing-');
    raise exception 'a trailing hyphen was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'עברית');
    raise exception 'a Hebrew slug was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'abcdefabcdefabcdefabcdef');
    raise exception 'a slug shaped like a Base44 id was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'horadat-dmei-nihul');
    raise exception 'a duplicate slug was accepted';
  exception when unique_violation then null;
  end;
  insert into public.blog_posts (title, body, slug) values ('תקין', 'b', 'kebab-case-2026');
end $$;

-- An anonymous visitor reads a published article's slug, and never a draft's.
set local role anon;
do $$ begin
  if (select count(*) from public.blog_posts where slug = 'horadat-dmei-nihul') <> 1 then
    raise exception 'anon cannot read a published article by its slug';
  end if;
  if exists (select 1 from public.blog_posts where slug = 'post-aaaaaaaaaaaaaaaaaaaaaaa2') then
    raise exception 'anon read a draft by its slug';
  end if;
end $$;

rollback;
