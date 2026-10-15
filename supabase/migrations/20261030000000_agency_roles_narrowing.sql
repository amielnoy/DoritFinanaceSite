-- Agency roles, step 2 of 2: the narrowing
-- (docs/superpowers/specs/2026-10-15-agency-roles-design.md, Rollout 3).
--
-- Ships in one release with the Edge Functions and the frontend that read the
-- new roles. Before it: assign the open leads (scripts/assign-open-leads.mjs),
-- or every User's list goes blank.
--
-- After this, can_see(agency) means "a member of an active agency" and is no
-- longer the read rule for lead data: can_see_lead is. Every policy on lead
-- data is replaced below; tests/contract/agency-roles-schema.contract.test.ts
-- fails if a select policy on lead data still rests on can_see alone.

-- ── roles: map, then narrow ────────────────────────────────────────────────
insert into public.membership_events (agency_id, actor_id, target_user_id, action, old_role, new_role)
select agency_id, null, user_id, 'role_changed', role, 'user'
  from public.memberships where role in ('agent', 'staff');
update public.memberships set role = 'user' where role in ('agent', 'staff');
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'admin', 'user'));

-- ── can_see: a member of an active agency ──────────────────────────────────
-- Keeps its name and callers (agency rows, profiles, drafts, testimonials);
-- now respects suspension. Granted to anon as before: anon has no uid, so it
-- answers false.
create or replace function public.can_see(p_agency_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.has_role(p_agency_id, 'user')
$$;

-- ── the lead-level helpers every related table asks ────────────────────────

-- Whether a lead belongs to an agency. Every check below that accepts a lead
-- for a row binds the two, or a User could file a row under another agency
-- by naming their own lead (a cross-tenant write).
create function public.lead_in_agency(p_lead_id uuid, p_agency_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.id = p_lead_id and l.agency_id = p_agency_id)
$$;

-- The same for a clearinghouse request, and — when the row names a lead too —
-- that it is the request's own lead.
create function public.request_in_agency(p_request_id uuid, p_agency_id uuid, p_lead_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.masleka_requests r
     where r.id = p_request_id
       and r.agency_id = p_agency_id
       and (p_lead_id is null or r.lead_id is null or r.lead_id = p_lead_id)
  )
$$;

-- A row of an agency that may hang off a lead, or be someone's own lead-less
-- work: Admin+ and the operator always; a User for their assigned lead, or for
-- a lead-less row they created.
create function public.can_work(p_agency_id uuid, p_lead_id uuid, p_created_by uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.has_role(p_agency_id, 'admin')
      or public.is_admin()
      or (p_lead_id is not null and public.lead_in_agency(p_lead_id, p_agency_id) and public.can_see_lead(p_lead_id))
      or (p_lead_id is null and p_created_by = auth.uid() and public.has_role(p_agency_id, 'user'))
$$;

create function public.can_work_request(p_request_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.masleka_requests r
     where r.id = p_request_id
       and public.can_work(r.agency_id, r.lead_id, r.created_by)
  )
$$;

create function public.can_work_snapshot(p_snapshot_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.clearinghouse_snapshots s
     where s.id = p_snapshot_id
       and ( public.can_work(s.agency_id, s.lead_id, s.created_by)
          or (s.request_id is not null and public.can_work_request(s.request_id)) )
  )
$$;

-- A chat transcript: as its lead; a conversation with no lead is Admin+.
create function public.can_see_conversation(p_conversation_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.chat_conversations c
     where c.id = p_conversation_id
       and ( public.has_role(c.agency_id, 'admin')
          or public.is_admin()
          or (c.lead_id is not null and public.can_see_lead(c.lead_id)) )
  )
$$;

-- ── leads ──────────────────────────────────────────────────────────────────
drop policy leads_read_admin on public.leads;
create policy leads_read_admin on public.leads
  for select to authenticated
  using (public.has_role(agency_id, 'admin')
         or (assigned_user_id = auth.uid() and public.can_see(agency_id))
         or public.is_admin());
drop policy leads_update_admin on public.leads;
create policy leads_update_admin on public.leads
  for update to authenticated
  using (public.has_role(agency_id, 'admin')
         or (assigned_user_id = auth.uid() and public.can_see(agency_id))
         or public.is_admin())
  with check (public.has_role(agency_id, 'admin')
              or (assigned_user_id = auth.uid() and public.can_see(agency_id))
              or public.is_admin());
drop policy leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads
  for delete to authenticated
  using (public.has_role(agency_id, 'admin') or public.is_admin());

-- ── meetings ───────────────────────────────────────────────────────────────
drop policy meetings_read_admin on public.meetings;
create policy meetings_read_admin on public.meetings
  for select to authenticated using (public.can_see_lead(lead_id) or public.is_admin());
drop policy meetings_write_admin on public.meetings;
create policy meetings_update_lead on public.meetings
  for update to authenticated
  using (public.can_see_lead(lead_id) or public.is_admin())
  with check ((public.can_see_lead(lead_id) and public.lead_in_agency(lead_id, agency_id)) or public.is_admin());
create policy meetings_delete_admin on public.meetings
  for delete to authenticated using (public.has_role(agency_id, 'admin') or public.is_admin());
-- Meetings are written by the server.
revoke insert on public.meetings from authenticated;

-- ── contacts: no lead link, so Admin+ ──────────────────────────────────────
drop policy contacts_read_admin on public.contacts;
create policy contacts_read_admin on public.contacts
  for select to authenticated using (public.has_role(agency_id, 'admin') or public.is_admin());
drop policy contacts_update_admin on public.contacts;
create policy contacts_update_admin on public.contacts
  for update to authenticated
  using (public.has_role(agency_id, 'admin') or public.is_admin())
  with check (public.has_role(agency_id, 'admin') or public.is_admin());
drop policy contacts_delete_admin on public.contacts;
create policy contacts_delete_admin on public.contacts
  for delete to authenticated using (public.has_role(agency_id, 'admin') or public.is_admin());

-- ── chat ───────────────────────────────────────────────────────────────────
drop policy chat_conversations_read_member_or_admin on public.chat_conversations;
create policy chat_conversations_read_lead on public.chat_conversations
  for select to authenticated using (public.can_see_conversation(id));
drop policy chat_messages_read_member_or_admin on public.chat_messages;
create policy chat_messages_read_lead on public.chat_messages
  for select to authenticated using (public.can_see_conversation(conversation_id));
drop policy chat_usage_read_member_or_admin on public.chat_usage;
create policy chat_usage_read_lead on public.chat_usage
  for select to authenticated using (public.can_see_conversation(conversation_id));

-- ── clearinghouse requests (masleka) ───────────────────────────────────────
drop policy masleka_requests_read_member on public.masleka_requests;
create policy masleka_requests_read_lead on public.masleka_requests
  for select to authenticated using (public.can_work(agency_id, lead_id, created_by));
-- Admin+ read every reveal; a User reads their own.
drop policy masleka_access_log_read_member on public.masleka_access_log;
create policy masleka_access_log_read on public.masleka_access_log
  for select to authenticated
  using (public.has_role(agency_id, 'admin')
         or (user_id = auth.uid() and public.can_see(agency_id))
         or public.is_admin());

-- ── clearinghouse analysis ─────────────────────────────────────────────────
drop policy clearinghouse_snapshots_member on public.clearinghouse_snapshots;
create policy clearinghouse_snapshots_read_lead on public.clearinghouse_snapshots
  for select to authenticated
  using (public.can_work(agency_id, lead_id, created_by)
         or (request_id is not null and public.can_work_request(request_id)));
-- A named lead is checked on its own, whatever request comes with it: in the
-- row's agency and one the caller may see — or a User could pin their own
-- lead-less request to another User's lead.
create policy clearinghouse_snapshots_insert_lead on public.clearinghouse_snapshots
  for insert to authenticated
  with check ((lead_id is null or (public.lead_in_agency(lead_id, agency_id) and public.can_see_lead(lead_id)))
              and (request_id is null or public.request_in_agency(request_id, agency_id, lead_id))
              and (public.can_work(agency_id, lead_id, created_by)
                   or (request_id is not null and public.can_work_request(request_id))));
create policy clearinghouse_snapshots_delete_admin on public.clearinghouse_snapshots
  for delete to authenticated using (public.has_role(agency_id, 'admin') or public.is_admin());

drop policy clearinghouse_reviews_member on public.clearinghouse_reviews;
create policy clearinghouse_reviews_read_lead on public.clearinghouse_reviews
  for select to authenticated using (public.can_work_snapshot(snapshot_id));
create policy clearinghouse_reviews_insert_lead on public.clearinghouse_reviews
  for insert to authenticated with check (public.can_work_snapshot(snapshot_id));
create policy clearinghouse_reviews_update_lead on public.clearinghouse_reviews
  for update to authenticated
  using (public.can_work_snapshot(snapshot_id))
  with check (public.can_work_snapshot(snapshot_id));
create policy clearinghouse_reviews_delete_admin on public.clearinghouse_reviews
  for delete to authenticated
  using (exists (select 1 from public.clearinghouse_snapshots s
                  where s.id = snapshot_id
                    and (public.has_role(s.agency_id, 'admin') or public.is_admin())));

drop policy clearinghouse_published_items_member on public.clearinghouse_published_items;
create policy clearinghouse_published_items_read_lead on public.clearinghouse_published_items
  for select to authenticated using (public.can_work_snapshot(snapshot_id));

-- Publishing to the client is part of working the lead: the same check.
create or replace function public.clearinghouse_publish(p_snapshot uuid, p_client_email text, p_items jsonb)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_client_email, '')));
  v_item   jsonb;
  v_pos    integer := 0;
begin
  if p_snapshot is null or not public.can_work_snapshot(p_snapshot) then
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

create or replace function public.clearinghouse_unpublish(p_snapshot uuid)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_snapshot is null or not public.can_work_snapshot(p_snapshot) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.clearinghouse_snapshots set published_at = null, published_by = null where id = p_snapshot;
end;
$$;

create or replace function public.clearinghouse_mark_answers_seen(p_snapshot uuid)
returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_snapshot is null or not public.can_work_snapshot(p_snapshot) then
    raise exception 'not_found' using errcode = '42501';
  end if;
  update public.clearinghouse_published_items
     set staff_seen_at = now()
   where snapshot_id = p_snapshot and client_updated_at is not null;
end;
$$;

-- ── testimonials and articles ──────────────────────────────────────────────
drop policy testimonials_write_admin on public.testimonials;
create policy testimonials_write_admin on public.testimonials
  for all to authenticated
  using (public.has_role(agency_id, 'admin') or public.is_admin())
  with check (public.has_role(agency_id, 'admin') or public.is_admin());

-- A User writes drafts; publishing, unpublishing and deleting are Admin+. A
-- shared-library post (agency_id null) stays the operator's: has_role(null, …)
-- is false.
drop policy blog_posts_write_admin on public.blog_posts;
create policy blog_posts_insert on public.blog_posts
  for insert to authenticated
  with check (public.has_role(agency_id, 'admin')
              or (published = false and public.has_role(agency_id, 'user'))
              or public.is_admin());
create policy blog_posts_update on public.blog_posts
  for update to authenticated
  using (public.has_role(agency_id, 'admin')
         or (published = false and public.has_role(agency_id, 'user'))
         or public.is_admin())
  with check (public.has_role(agency_id, 'admin')
              or (published = false and public.has_role(agency_id, 'user'))
              or public.is_admin());
create policy blog_posts_delete on public.blog_posts
  for delete to authenticated
  using (public.has_role(agency_id, 'admin') or public.is_admin());

-- ── the agency profile: the Owner's ────────────────────────────────────────
drop policy agency_profiles_write_admin on public.agency_profiles;
create policy agency_profiles_insert_operator on public.agency_profiles
  for insert to authenticated with check (public.is_admin());
create policy agency_profiles_update_owner on public.agency_profiles
  for update to authenticated
  using (public.has_role(agency_id, 'owner') or public.is_admin())
  with check (public.has_role(agency_id, 'owner') or public.is_admin());
create policy agency_profiles_delete_operator on public.agency_profiles
  for delete to authenticated using (public.is_admin());

-- ── members: read by the agency, changed only through the functions ────────
drop policy memberships_read_self_or_admin on public.memberships;
create policy memberships_read_member on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.can_see(agency_id) or public.is_admin());
drop policy memberships_write_admin on public.memberships;
revoke insert, update, delete on public.memberships from authenticated;

-- The members screen names each member: a profile is readable by whoever
-- shares an agency with it.
create policy profiles_select_agency_peer on public.profiles
  for select to authenticated
  using (exists (select 1 from public.memberships m
                  where m.user_id = profiles.id and public.can_see(m.agency_id)));

-- ── staff functions take the agency ────────────────────────────────────────
drop function public.my_staff_role();
drop function public.staff_role(uuid);

-- Someone's role in one active agency, for the Edge Functions (memberships is
-- revoked from service_role). The platform operator is asked separately.
create function public.staff_role(p_user_id uuid, p_agency_id uuid) returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.role
    from public.memberships m
    join public.agencies a on a.id = m.agency_id
   where m.user_id = p_user_id
     and m.agency_id = p_agency_id
     and a.status = 'active'
$$;

-- The browser's question: which screens to offer. Decides nothing.
create function public.my_agency_role(p_agency_id uuid) returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.agency_role(p_agency_id)
$$;

-- Who hears about a request: its lead's assignee, or whoever created a
-- lead-less one, plus the agency's Admins and Owners. Not every member: Users
-- do not see each other's clients.
drop function public.masleka_staff_emails();
create function public.masleka_staff_emails(p_request_id uuid) returns text[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with r as (
    select q.agency_id, coalesce(l.assigned_user_id, case when q.lead_id is null then q.created_by end) as handler
      from public.masleka_requests q
      left join public.leads l on l.id = q.lead_id
     where q.id = p_request_id
  )
  select coalesce(array_agg(distinct lower(p.email)), '{}')
    from r
    join public.memberships m on m.agency_id = r.agency_id
    join public.profiles p on p.id = m.user_id
   where p.email is not null and p.email <> ''
     and (m.role in ('owner', 'admin') or m.user_id = r.handler)
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
revoke execute on function public.lead_in_agency(uuid, uuid)           from public, anon, authenticated;
revoke execute on function public.request_in_agency(uuid, uuid, uuid)  from public, anon, authenticated;
revoke execute on function public.can_work(uuid, uuid, uuid)          from public, anon, authenticated;
revoke execute on function public.can_work_request(uuid)              from public, anon, authenticated;
revoke execute on function public.can_work_snapshot(uuid)             from public, anon, authenticated;
revoke execute on function public.can_see_conversation(uuid)          from public, anon, authenticated;
revoke execute on function public.staff_role(uuid, uuid)              from public, anon, authenticated;
revoke execute on function public.my_agency_role(uuid)                from public, anon, authenticated;
revoke execute on function public.masleka_staff_emails(uuid)          from public, anon, authenticated;
grant execute on function public.lead_in_agency(uuid, uuid)        to authenticated;
grant execute on function public.request_in_agency(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_work(uuid, uuid, uuid)       to authenticated;
grant execute on function public.can_work_request(uuid)           to authenticated;
grant execute on function public.can_work_snapshot(uuid)          to authenticated;
grant execute on function public.can_see_conversation(uuid)       to authenticated;
grant execute on function public.my_agency_role(uuid)             to authenticated;
grant execute on function public.staff_role(uuid, uuid)           to service_role;
grant execute on function public.masleka_staff_emails(uuid)       to service_role;
