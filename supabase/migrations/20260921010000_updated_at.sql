-- `updated_at`, which the first migration missed.
--
-- Base44 keeps an implicit `updated_date` alongside `created_date`, and on 2 of
-- the 25 production leads the two differ — so it records something real (a
-- status moving off "new", most likely) rather than being a mirror of creation.
-- Dropping it in the backfill would quietly lose when a lead was last worked.
--
-- Backfill inserts an explicit value; the trigger only fires on UPDATE, so
-- historical timestamps survive the import intact.

alter table public.leads        add column updated_at timestamptz not null default now();
alter table public.contacts     add column updated_at timestamptz not null default now();
alter table public.blog_posts   add column updated_at timestamptz not null default now();
alter table public.testimonials add column updated_at timestamptz not null default now();

create function public.touch_updated_at() returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_touch        before update on public.leads
  for each row execute function public.touch_updated_at();
create trigger contacts_touch     before update on public.contacts
  for each row execute function public.touch_updated_at();
create trigger blog_posts_touch   before update on public.blog_posts
  for each row execute function public.touch_updated_at();
create trigger testimonials_touch before update on public.testimonials
  for each row execute function public.touch_updated_at();
