-- How long acting on an article takes ("רבע שעה"), shown on the blog's cards.
-- Optional: an article with no single action has none, and shows no chip.
-- Mirrors BlogPost.action_time; scripts/seed-blog.mjs writes both.
alter table public.blog_posts
  add column if not exists action_time text;
