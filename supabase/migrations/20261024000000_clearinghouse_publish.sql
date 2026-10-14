-- The personal snapshot (תמונת מצב), phase 4: Dorit publishes a client's
-- snapshot and the recommendations she approved; the client reads them in the
-- personal area and answers each one.
--
-- Builds on 20261021000000_clearinghouse_analysis.sql. Published
-- recommendations are frozen copies: a later change to a rule or to Dorit's
-- draft never changes what a client was already shown. Nothing here is
-- reachable by a visitor except through my_snapshot() and
-- respond_to_recommendation(), which answer only for the signed-in user's
-- verified address (my_email(), as my_enquiries() does).

-- ── Dorit's own recommendations and priorities ──────────────────────────────

-- A review row may carry a title and a priority: for a rule's finding they
-- override its own; for a recommendation Dorit wrote herself (finding_key
-- "custom:<uuid>") they are the recommendation.
alter table public.clearinghouse_reviews
  add column title    text check (title is null or length(btrim(title)) between 1 and 160),
  add column priority text check (priority is null or priority in ('important', 'check'));

grant insert (title, priority) on public.clearinghouse_reviews to authenticated;
grant update (title, priority) on public.clearinghouse_reviews to authenticated;

-- ── publishing ──────────────────────────────────────────────────────────────

alter table public.clearinghouse_snapshots
  -- Whose personal area shows it: the address the client signs in with.
  add column client_email text check (client_email is null or (length(client_email) <= 254 and client_email = lower(btrim(client_email)))),
  add column published_at timestamptz,
  add column published_by uuid references auth.users(id) on delete set null;

create index clearinghouse_snapshots_client on public.clearinghouse_snapshots (client_email, published_at desc)
  where published_at is not null;

create table public.clearinghouse_published_items (
  id                uuid primary key default gen_random_uuid(),
  snapshot_id       uuid not null references public.clearinghouse_snapshots(id) on delete cascade,
  position          integer not null check (position >= 0),
  title             text not null check (length(btrim(title)) between 1 and 160),
  body              text not null check (length(btrim(body)) between 1 and 4000),
  priority          text not null check (priority in ('important', 'check')),
  -- The client's answer: still open, "כן, לטפל בזה", or "יש לי שאלה".
  client_status     text not null default 'open' check (client_status in ('open', 'accepted', 'question')),
  client_note       text check (client_note is null or length(client_note) <= 1000),
  client_updated_at timestamptz,
  -- Dorit saw the answer (the review screen marks it); a newer answer clears it.
  staff_seen_at     timestamptz,
  unique (snapshot_id, position)
);

alter table public.clearinghouse_published_items enable row level security;

-- Staff read the items (and the clients' answers) of their agency's snapshots.
create policy clearinghouse_published_items_member on public.clearinghouse_published_items
  for select to authenticated
  using (exists (
    select 1 from public.clearinghouse_snapshots s
     where s.id = snapshot_id and (public.can_see(s.agency_id) or public.is_admin())));

revoke all on public.clearinghouse_published_items from anon, authenticated;
grant select on public.clearinghouse_published_items to authenticated;

-- Publish (or republish) a snapshot to a client: the address, and the
-- approved recommendations in order. A republish replaces the items, so a
-- client's earlier answers go with them — the review screen says so first.
create function public.clearinghouse_publish(p_snapshot uuid, p_client_email text, p_items jsonb)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_agency uuid;
  v_email  text := lower(btrim(coalesce(p_client_email, '')));
  v_item   jsonb;
  v_pos    integer := 0;
begin
  select agency_id into v_agency from public.clearinghouse_snapshots where id = p_snapshot;
  if v_agency is null or not (public.can_see(v_agency) or public.is_admin()) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  delete from public.clearinghouse_published_items where snapshot_id = p_snapshot;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.clearinghouse_published_items (snapshot_id, position, title, body, priority)
    values (p_snapshot, v_pos, btrim(v_item->>'title'), btrim(v_item->>'body'), v_item->>'priority');
    v_pos := v_pos + 1;
  end loop;

  update public.clearinghouse_snapshots
     set client_email = v_email, published_at = now(), published_by = auth.uid()
   where id = p_snapshot;
end;
$$;

-- Take a snapshot back out of the client's area; the items stay for the record.
create function public.clearinghouse_unpublish(p_snapshot uuid)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from public.clearinghouse_snapshots where id = p_snapshot;
  if v_agency is null or not (public.can_see(v_agency) or public.is_admin()) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.clearinghouse_snapshots set published_at = null, published_by = null where id = p_snapshot;
end;
$$;

-- Dorit has read the clients' answers on this snapshot.
create function public.clearinghouse_mark_answers_seen(p_snapshot uuid)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from public.clearinghouse_snapshots where id = p_snapshot;
  if v_agency is null or not (public.can_see(v_agency) or public.is_admin()) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.clearinghouse_published_items
     set staff_seen_at = now()
   where snapshot_id = p_snapshot and client_updated_at is not null;
end;
$$;

-- ── what a client may see ───────────────────────────────────────────────────

-- The newest snapshot published to an address, with its recommendations —
-- the only columns a client is shown. Service role only, like enquiries_for.
create function public.snapshot_for(p_email text)
returns jsonb
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select jsonb_build_object(
           'taken_at', s.taken_at,
           'published_at', s.published_at,
           'data', s.data,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', i.id, 'title', i.title, 'body', i.body, 'priority', i.priority,
                      'client_status', i.client_status, 'client_note', i.client_note)
                    order by i.position)
               from public.clearinghouse_published_items i
              where i.snapshot_id = s.id), '[]'::jsonb))
    from public.clearinghouse_snapshots s
   where nullif(lower(btrim(p_email)), '') is not null
     and s.client_email = lower(btrim(p_email))
     and s.published_at is not null
   order by s.published_at desc
   limit 1
$$;

create function public.my_snapshot()
returns jsonb
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select public.snapshot_for(public.my_email())
$$;

-- "כן, לטפל בזה" / "יש לי שאלה" (or back to open), on an item of the
-- caller's own published snapshot only.
create function public.respond_to_recommendation(p_item uuid, p_status text, p_note text default null)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_email text := public.my_email();
begin
  if v_email is null then
    raise exception 'unverified' using errcode = '42501';
  end if;
  if p_status not in ('open', 'accepted', 'question') or length(coalesce(p_note, '')) > 1000 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update public.clearinghouse_published_items i
     set client_status = p_status,
         client_note = nullif(btrim(coalesce(p_note, '')), ''),
         client_updated_at = now(),
         staff_seen_at = null
    from public.clearinghouse_snapshots s
   where i.id = p_item
     and s.id = i.snapshot_id
     and s.published_at is not null
     and s.client_email = v_email;
  if not found then
    raise exception 'not_found' using errcode = '42501';
  end if;
end;
$$;

-- Supabase's default privileges hand EXECUTE on a new function to anon and
-- authenticated by name, so revoking from `public` alone closes nothing.
revoke all on function public.clearinghouse_publish(uuid, text, jsonb)          from public, anon, authenticated;
revoke all on function public.clearinghouse_unpublish(uuid)                      from public, anon, authenticated;
revoke all on function public.clearinghouse_mark_answers_seen(uuid)              from public, anon, authenticated;
revoke all on function public.snapshot_for(text)                                 from public, anon, authenticated;
revoke all on function public.my_snapshot()                                      from public, anon, authenticated;
revoke all on function public.respond_to_recommendation(uuid, text, text)        from public, anon, authenticated;
grant execute on function public.clearinghouse_publish(uuid, text, jsonb)        to authenticated;
grant execute on function public.clearinghouse_unpublish(uuid)                    to authenticated;
grant execute on function public.clearinghouse_mark_answers_seen(uuid)            to authenticated;
grant execute on function public.snapshot_for(text)                               to service_role;
grant execute on function public.my_snapshot()                                    to authenticated;
grant execute on function public.respond_to_recommendation(uuid, text, text)      to authenticated;
