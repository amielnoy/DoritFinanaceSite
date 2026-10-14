-- Two optional per-article fields, Supabase only (like slug; Base44's BlogPost
-- has neither): the headline of the article's contact boxes
-- (src/lib/articleCta.ts; unset, the general line) and the image a shared link
-- shows (og:image / twitter:image; unset, image_url, then the portrait).
-- scripts/seed-blog.mjs writes both from a repo article's front matter.
--
-- Apply BEFORE the code that selects them is deployed: the site selects
-- these columns by name, and a missing column fails the whole query.
alter table public.blog_posts
  add column if not exists cta_headline text
    check (cta_headline is null or char_length(cta_headline) between 1 and 160),
  add column if not exists og_image text
    check (og_image is null or (og_image ~ '^https://' and char_length(og_image) <= 500));
