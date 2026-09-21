-- Phase 0 — the five Base44 entities as tables, with their twelve RLS rules.
--
-- Nothing reads or writes these yet. Phase 0 exists so the schema and the
-- policies can be reviewed on their own, before any traffic depends on them.
--
-- Enums from the .jsonc entities become CHECK constraints rather than native
-- Postgres enum types: altering a CHECK is a cheap DDL, altering an enum is not,
-- and `escalation_reason` already carries ten values that will grow.
--
-- Every table carries `base44_id`: the correlation key that lets the dual-write
-- phases prove the two stores agree. It is what makes the flip in phase 4 safe
-- rather than hopeful, and it is nullable only because rows created after the
-- flip have no Base44 counterpart.

-- ── identity ────────────────────────────────────────────────────────────────

-- Supabase owns auth.users; the app's own facts about a person live here.
-- Mirrors Base44's User entity, whose role defaulted to "user".
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  role       text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- Every policy below asks this one question.
--
-- `security definer` matters: it reads profiles with the function owner's
-- rights, so the profiles policies do not re-enter RLS and recurse. `stable`
-- lets Postgres evaluate it once per statement instead of once per row.
create function public.is_admin() returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- A profile appears the moment someone first signs in, matching Base44's
-- default of "user". Nobody is an admin by signing up.
create function public.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── the four content tables ─────────────────────────────────────────────────

-- An enquiry: one approach, at one moment, with whatever was given.
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  base44_id         text unique,
  name              text not null,
  phone             text not null,
  email             text,
  source            text check (source in ('consultation','detailed','quick','claim','escalation','interview')),
  topic             text,
  timing            text,
  message           text,
  status            text not null default 'new' check (status in ('new','contacted','closed','escalated','partial')),
  escalation_reason text check (escalation_reason in (
                      'regulated_advice','product_recommendation','numbers_or_returns',
                      'claim_or_policy','complaint','privacy_request','sensitive_data',
                      'out_of_scope','user_request','uncertain')),
  handled_by_agent  text,
  -- Which consent wording the visitor was shown, and when. The evidentiary half
  -- of the duty to inform under חוק הגנת הפרטיות (תיקון 13) — not decoration.
  consent_version   text,
  consent_at        timestamptz,
  created_at        timestamptz not null default now()
);

-- The person behind the enquiries. Phone is the key because on WhatsApp it is
-- what exists: the message arrives from a number, before any name is given.
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  base44_id  text unique,
  phone      text not null unique,
  name       text,
  email      text,
  channel    text not null default 'other' check (channel in ('whatsapp','site','phone','other')),
  notes      text,
  last_seen  timestamptz,
  created_at timestamptz not null default now()
);

create table public.blog_posts (
  id         uuid primary key default gen_random_uuid(),
  base44_id  text unique,
  title      text not null,
  excerpt    text,
  body       text not null,
  image_url  text,
  tags       text,
  published  boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.testimonials (
  id         uuid primary key default gen_random_uuid(),
  base44_id  text unique,
  name       text not null,
  -- The reviewer's context ("customer since 2019"). Deliberately NOT an
  -- authorisation role, despite sitting a few lines from policies that check one.
  role       text,
  quote      text not null,
  image_url  text,
  rating     numeric check (rating >= 1 and rating <= 5),
  source     text check (source in ('google','midrag')),
  created_at timestamptz not null default now()
);

create index on public.leads (created_at desc);
create index on public.blog_posts (published, created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.profiles     enable row level security;
alter table public.leads        enable row level security;
alter table public.contacts     enable row level security;
alter table public.blog_posts   enable row level security;
alter table public.testimonials enable row level security;

-- profiles: you may read yourself; admins read everyone.
--
-- There is deliberately NO update policy for a normal user. Granting one over
-- your own row makes `role` self-service, and admin becomes a thing anybody can
-- award themselves. Only an admin may write here.
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_write_admin on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- leads + contacts: anyone may submit, only an admin may look.
-- This is Base44's `create: true` — the public forms post without signing in.
create policy leads_insert_public on public.leads
  for insert to anon, authenticated with check (true);
create policy leads_read_admin on public.leads
  for select to authenticated using (public.is_admin());
create policy leads_update_admin on public.leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy leads_delete_admin on public.leads
  for delete to authenticated using (public.is_admin());

create policy contacts_insert_public on public.contacts
  for insert to anon, authenticated with check (true);
create policy contacts_read_admin on public.contacts
  for select to authenticated using (public.is_admin());
create policy contacts_update_admin on public.contacts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contacts_delete_admin on public.contacts
  for delete to authenticated using (public.is_admin());

-- blog_posts: drafts are no longer world-readable.
--
-- Base44 had `read: true`, and the published-only filter lived in the content
-- adapter. The contract test says keeping it there means no caller can
-- accidentally list drafts — but nothing stopped a direct query, so an
-- unpublished post was one request away from anyone. The rule now says what the
-- adapter only asked for.
create policy blog_posts_read_published_or_admin on public.blog_posts
  for select to anon, authenticated using (published = true or public.is_admin());
create policy blog_posts_write_admin on public.blog_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- testimonials: public read.
--
-- Base44 spelled this `read: null` rather than `read: true` as BlogPost does.
-- The reviews widget plainly renders for signed-out visitors, so public read is
-- the observed behaviour and is what we reproduce. The discrepancy is an open
-- item in the spec: verify before trusting it.
create policy testimonials_read_public on public.testimonials
  for select to anon, authenticated using (true);
create policy testimonials_write_admin on public.testimonials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
