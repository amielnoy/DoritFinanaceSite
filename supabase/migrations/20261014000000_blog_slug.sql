-- Articles get a readable address: /blog/<slug> instead of /blog/<Base44 id>.
--
-- The slug lives only here. Base44's BlogPost has no such field, and the
-- admin's writes go Base44-first through the `contentAdmin` function, which
-- passes the slug to this mirror alone (PR 1 of
-- docs/superpowers/specs/2026-10-13-seo-ai-visibility-design.md).
--
-- The backfill names every article that was live when this was written: the
-- 20 under content/blog/ by their file names (the value scripts/seed-blog.mjs
-- writes from now on), and the two older ones by hand. It matches on the exact
-- title, the one field both the files and the rows hold. A title held by two
-- rows gives its slug to one of them, published first and then the older, so
-- the unique constraint below cannot fail on a duplicate.
--
-- Every other row gets `post-<its Base44 id>`, or its own uuid if it never had
-- one: a draft no file names, or a live article whose title was edited since.
-- That way the constraints hold for every row. A published row given such a
-- slug is named in a NOTICE: its address works, but it deserves a real one
-- from /admin/blog.
--
-- A row inserted without a slug gets the same fallback, from a BEFORE INSERT
-- trigger. The code running when this was written never sends a slug:
-- contentAdmin, scripts/seed-blog.mjs and scripts/publish-blog.mjs. With the
-- trigger they keep working once the column is NOT NULL, so this migration can
-- go to production before the code that writes real slugs. The trigger covers
-- an upsert's insert too (EXCLUDED carries the filled value), and a conflict
-- update that does not name `slug` leaves an existing slug alone. The fallback
-- always starts `post-`, so it is never a bare 24-hex value, which would
-- collide with the old-URL route.
--
-- No begin/commit here: supabase/tests/blog_slug_check.sql re-applies this file
-- inside its own transaction, and a commit would end it. For the same reason
-- every object below is created re-runnably.
--
-- The slug rule is spelled in four places that cannot import one another:
-- here, src/lib/articlePath.ts, base44/functions/contentAdmin/entry.ts and
-- scripts/published-articles.mjs. tests/contract/article-slug.contract.test.ts
-- fails when they drift.

alter table public.blog_posts add column slug text;

-- `post-<Base44 id>`, lowercased, every run of other characters one hyphen,
-- trimmed of hyphens at either end; `post-<uuid>` when no Base44 id is left.
-- scripts/backfill-from-base44.mjs spells the same rule in JS (it runs with
-- triggers off).
create or replace function public.blog_posts_fallback_slug(p_base44_id text, p_id uuid)
  returns text
  language sql immutable set search_path = '' as $$
  select 'post-' || coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(p_base44_id, '')), '[^a-z0-9]+', '-', 'g')), ''),
    p_id::text)
$$;

create or replace function public.blog_posts_fill_slug() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.slug is null then
    new.slug := public.blog_posts_fallback_slug(new.base44_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists blog_posts_fill_slug on public.blog_posts;
create trigger blog_posts_fill_slug
  before insert on public.blog_posts
  for each row execute function public.blog_posts_fill_slug();

with wanted(title, slug) as (
  values
    ('עזבתם עבודה? שלושה דברים לעשות בחודש הראשון', 'azavtem-avoda'),
    ('ביטוח חיים למשכנתא: כך בודקים אם אפשר לשלם פחות — בלי להחליף בנק', 'bituach-chaim-mashkanta'),
    ('ביטוח נסיעות לחו״ל: שלוש בדיקות לפני שקונים עוד פוליסה', 'bituach-nesiot'),
    ('חיסכון לכל ילד: ההחלטה של שתי דקות שרוב ההורים לא קיבלו', 'chisachon-lechol-yeled'),
    ('המעסיק באמת מפקיד? בדיקה של עשר דקות בין התלוש לקרן', 'hafkadot-maasik'),
    ('הר הביטוח: איך בודקים אם אתם משלמים פעמיים על אותו ביטוח בריאות', 'har-habituach-kfilut'),
    ('לקרוא נכון את גמל נט ופנסיה נט — ומה באמת משפר את התוצאה', 'hashvaa-gemel-net-pensia-net'),
    ('החזר מס לשכירים: שש סיבות שכנראה מגיע לכם כסף — ואיך מבקשים אותו לבד', 'hechzer-mas-lesachirim'),
    ('להוריד דמי ניהול בפנסיה: המהלך הפשוט ביותר, צעד אחר צעד', 'horadat-dmei-nihul'),
    ('כסף שנשכח: איך מאתרים קופות, פוליסות וחשבונות בנק רדומים בעשר דקות', 'kesef-shenishkach'),
    ('מסלול ההשקעה בקרן הפנסיה: בדיקה של רבע שעה, פעם בשנה', 'maslul-hashkaa'),
    ('מי באמת מטפל בכספים הגדולים של חייכם?', 'mi-metapel-bakesafim-hagdolim'),
    ('מוטבים: הטופס של חמש דקות שרוב האנשים לא מילאו', 'mutavim'),
    ('התחתנתם או נולד ילד: רשימת העדכונים הפיננסיים בעמוד אחד', 'nolad-yeled-hitchatantem'),
    ('אובדן כושר עבודה: שלוש שאלות לשאול את קרן הפנסיה שלכם — בשיחת טלפון אחת', 'ovdan-kosher-avoda'),
    ('שגרת הבדיקה השנתית: סדר תפעולי לכל מכשיר פיננסי', 'shigrat-bdika-shnatit'),
    ('עצמאים: מה להפקיד עד 31 בדצמבר כדי לא לוותר על הטבת מס', 'sof-shana-atzmaim'),
    ('תיק המשפחה: ערב אחד שחוסך למשפחה חודשים של חיפושים', 'tik-hamishpacha'),
    ('טופס 101: חמש דקות בתחילת השנה שחוסכות מס עודף כל השנה', 'tofes-101'),
    ('התשואה נטו: ארבעה משתנים שאתם באמת שולטים בהם', 'tsua-neto-arbaa-mishtanim'),
    ('ביטוח בריאות דיגיטלי: אבחון מרחוק וכיסוי מיידי', 'bituach-briut-digitali'),
    ('פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?', 'pensia-beidan-ha-ai')
),
chosen as (
  select distinct on (w.slug) b.id, w.slug
  from wanted w
  join public.blog_posts b on b.title = w.title
  order by w.slug, b.published desc, b.created_at asc
)
update public.blog_posts b
   set slug = chosen.slug
  from chosen
 where b.id = chosen.id;

update public.blog_posts
   set slug = public.blog_posts_fallback_slug(base44_id, id)
 where slug is null;

do $$
declare r record;
begin
  for r in
    select slug, title from public.blog_posts
     where published and slug like 'post-%'
     order by created_at
  loop
    raise notice 'published article given a fallback slug: % (%)', r.slug, r.title;
  end loop;
end $$;

alter table public.blog_posts
  alter column slug set not null,
  add constraint blog_posts_slug_key unique (slug),
  add constraint blog_posts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint blog_posts_slug_not_base44_id check (slug !~ '^[0-9a-f]{24}$');
