-- Agency roles, step 1 of 2: additive only
-- (docs/superpowers/specs/2026-10-15-agency-roles-design.md, Rollout 1).
--
-- Adds lead assignment, the role helpers, the membership audit, the two
-- membership functions and their guards. No policy reads any of it yet, so
-- this ships alone; 20261030000000_agency_roles_narrowing.sql maps the old
-- roles and switches the policies.

-- ── roles: allow the new names beside the old ──────────────────────────────
-- Narrowed to ('owner', 'admin', 'user') once the old rows are mapped (step 2).
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'admin', 'user', 'agent', 'staff'));

-- ── lead assignment ────────────────────────────────────────────────────────
alter table public.leads
  add column assigned_user_id uuid references auth.users(id) on delete set null,
  add column assigned_at      timestamptz,
  add column assigned_by      uuid references auth.users(id) on delete set null;

create index leads_agency_assignee_idx on public.leads (agency_id, assigned_user_id);

-- ── who holds what ─────────────────────────────────────────────────────────

-- The caller's role in one agency, or null. Null for a suspended agency, so
-- suspension takes every member's access with it.
create function public.agency_role(p_agency_id uuid) returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.role
    from public.memberships m
    join public.agencies a on a.id = m.agency_id
   where m.agency_id = p_agency_id
     and m.user_id = auth.uid()
     and a.status = 'active'
$$;

-- Does the caller hold at least p_min in this agency? owner > admin > user.
create function public.has_role(p_agency_id uuid, p_min text) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    array_position(array['user', 'admin', 'owner'], public.agency_role(p_agency_id))
      >= array_position(array['user', 'admin', 'owner'], p_min),
    false)
$$;

-- The read rule for lead data: Admin+ in the lead's agency, the User it is
-- assigned to, and the platform operator.
create function public.can_see_lead(p_lead_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
     where l.id = p_lead_id
       and ( public.has_role(l.agency_id, 'admin')
          or (l.assigned_user_id = auth.uid() and public.has_role(l.agency_id, 'user'))
          or public.is_admin() )
  )
$$;

-- Whether p_user_id may receive one of this agency's leads — asked only on
-- behalf of someone who may assign them (Admin+, the operator, or the server
-- with no session), so it tells nobody else who belongs where.
create function public.lead_assignee_ok(p_agency_id uuid, p_user_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select (public.has_role(p_agency_id, 'admin') or public.is_admin() or auth.uid() is null)
     and exists (select 1 from public.memberships m
                  where m.agency_id = p_agency_id and m.user_id = p_user_id)
$$;

-- ── membership history ─────────────────────────────────────────────────────
create table public.membership_events (
  id             bigint generated always as identity primary key,
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  actor_id       uuid,  -- null when done by a server job
  target_user_id uuid not null,
  action         text not null check (action in ('added', 'role_changed', 'removed', 'left')),
  old_role       text,
  new_role       text,
  at             timestamptz not null default now()
);

alter table public.membership_events enable row level security;
-- Read only; the two functions below are the only writers.
create policy membership_events_read_admin on public.membership_events
  for select to authenticated using (public.has_role(agency_id, 'admin') or public.is_admin());
revoke all on public.membership_events from anon, authenticated, service_role;
grant select on public.membership_events to authenticated;

-- ── changing members ───────────────────────────────────────────────────────
--
-- The caller is checked here, not by whoever calls: the platform operator or
-- an Owner may do anything inside the agency; an Admin may only add a User or
-- change someone who is a User into a User; nobody grants above their own role.

create function public.set_member_role(p_agency_id uuid, p_user_id uuid, p_role text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_caller   uuid := auth.uid();
  v_operator boolean := public.is_admin();
  v_mine     text := public.agency_role(p_agency_id);
  v_old      text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'user') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_user_id is null or not exists (select 1 from public.agencies where id = p_agency_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select m.role into v_old
    from public.memberships m
   where m.agency_id = p_agency_id and m.user_id = p_user_id
   for update;

  if not v_operator then
    if v_mine = 'owner' then
      null;
    elsif v_mine = 'admin' then
      if p_role <> 'user' or (v_old is not null and v_old <> 'user') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    else
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if v_old is not distinct from p_role then
    return;
  end if;

  insert into public.memberships (user_id, agency_id, role)
  values (p_user_id, p_agency_id, p_role)
  on conflict (user_id, agency_id) do update set role = excluded.role;

  insert into public.membership_events (agency_id, actor_id, target_user_id, action, old_role, new_role)
  values (p_agency_id, v_caller, p_user_id,
          case when v_old is null then 'added' else 'role_changed' end, v_old, p_role);
end;
$$;

-- Also "leave": anyone may remove themselves. Their leads in the agency go
-- back to the unassigned queue, so nothing is orphaned.
create function public.remove_member(p_agency_id uuid, p_user_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_caller   uuid := auth.uid();
  v_operator boolean := public.is_admin();
  v_mine     text := public.agency_role(p_agency_id);
  v_self     boolean := p_user_id = auth.uid();
  v_old      text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select m.role into v_old
    from public.memberships m
   where m.agency_id = p_agency_id and m.user_id = p_user_id
   for update;
  if v_old is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not (v_operator or v_self or v_mine = 'owner' or (v_mine = 'admin' and v_old = 'user')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.leads
     set assigned_user_id = null
   where agency_id = p_agency_id and assigned_user_id = p_user_id;

  delete from public.memberships
   where agency_id = p_agency_id and user_id = p_user_id;

  insert into public.membership_events (agency_id, actor_id, target_user_id, action, old_role, new_role)
  values (p_agency_id, v_caller, p_user_id, case when v_self then 'left' else 'removed' end, v_old, null);
end;
$$;

-- ── guards ─────────────────────────────────────────────────────────────────

-- Every agency keeps an Owner. Transfer is "make B owner, then step A down".
-- A cascade from a deleted agency or a deleted account is not a demotion.
create function public.memberships_keep_an_owner() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.agency_id <> old.agency_id)
     and exists (select 1 from public.agencies where id = old.agency_id)
     and exists (select 1 from auth.users where id = old.user_id)
     and not exists (select 1 from public.memberships m
                      where m.agency_id = old.agency_id and m.role = 'owner' and m.id <> old.id)
  then
    raise exception 'last_owner' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger memberships_keep_an_owner
  before update or delete on public.memberships
  for each row execute function public.memberships_keep_an_owner();

-- A lead never changes agency, and only Admin+ (or the operator) assigns it,
-- to a member of its agency. The trigger runs as the caller (no security
-- definer), so current_user tells a person's direct write (authenticated)
-- from the server's (service_role) and from remove_member's own unassigning
-- (the function's owner), which it trusts.
create function public.leads_guard_assignment() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_person boolean := current_user in ('authenticated', 'anon');
begin
  if new.agency_id is distinct from old.agency_id and v_person and not public.is_admin() then
    raise exception 'agency_fixed' using errcode = '42501';
  end if;

  if new.assigned_user_id is distinct from old.assigned_user_id
     or new.assigned_at is distinct from old.assigned_at
     or new.assigned_by is distinct from old.assigned_by then
    if v_person and not (public.has_role(old.agency_id, 'admin') or public.is_admin()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if new.assigned_user_id is distinct from old.assigned_user_id then
      if new.assigned_user_id is not null
         and not public.lead_assignee_ok(new.agency_id, new.assigned_user_id) then
        raise exception 'assignee_not_member' using errcode = '23503';
      end if;
      new.assigned_at := case when new.assigned_user_id is null then null else now() end;
      new.assigned_by := case when new.assigned_user_id is null then null else auth.uid() end;
    else
      -- The history columns are the trigger's to write.
      new.assigned_at := old.assigned_at;
      new.assigned_by := old.assigned_by;
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_guard_assignment
  before update on public.leads
  for each row execute function public.leads_guard_assignment();

-- ── grants ─────────────────────────────────────────────────────────────────
-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so each revoke names them.
revoke execute on function public.agency_role(uuid)                    from public, anon, authenticated;
revoke execute on function public.has_role(uuid, text)                 from public, anon, authenticated;
revoke execute on function public.can_see_lead(uuid)                   from public, anon, authenticated;
revoke execute on function public.lead_assignee_ok(uuid, uuid)         from public, anon, authenticated;
revoke execute on function public.set_member_role(uuid, uuid, text)    from public, anon, authenticated;
revoke execute on function public.remove_member(uuid, uuid)            from public, anon, authenticated;
revoke execute on function public.memberships_keep_an_owner()          from public, anon, authenticated;
revoke execute on function public.leads_guard_assignment()             from public, anon, authenticated;
grant execute on function public.agency_role(uuid)                 to authenticated;
grant execute on function public.has_role(uuid, text)              to authenticated;
grant execute on function public.can_see_lead(uuid)                to authenticated;
-- The leads trigger runs as its caller: a person (authenticated) or the server.
grant execute on function public.lead_assignee_ok(uuid, uuid)      to authenticated, service_role;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid)         to authenticated;
