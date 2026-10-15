# Agencies and their roles: Owner, Admin, User

Status: decided, 2026-10-15. Extends
`2026-10-10-multi-agent-platform-design.md` and
`2026-10-10-multi-agent-phase1-tenant-schema-design.md`.

## Why

The 2026-10-15 review found that roles mean nothing in the database.
`memberships.role` is `owner | agent | staff`, but `can_see(agency_id)` asks
only whether a membership exists, so every member can delete every lead,
publish an article or reveal a power-of-attorney code. Now that `invite-user`
makes adding people routine, that gap is live.

This design replaces the three roles with **Owner, Admin, User**, makes
each one mean something in RLS and in every Edge Function, and gives Users
only the leads assigned to them.

## Decisions (Amiel, 2026-10-15)

1. **Masleka reveal:** Users may reveal the ID number and POA code — for
   requests they can see (their assigned leads, or requests they created).
2. **Lead visibility:** Users see **only leads assigned to them**, and
   everything hanging off those leads. Unassigned leads are Admin+.
3. **Agency details:** only the **Owner** edits the agency profile — every
   field, contact details included.
4. **Migration:** every existing non-owner member (`agent` and `staff`)
   becomes a **User**. Owners stay Owners.

## Two kinds of "admin" — keep them apart

| Name in this doc | Where it lives | Who | Scope |
|---|---|---|---|
| **Platform operator** | `profiles.role = 'admin'`, `is_admin()` | Amiel (whoever runs the platform) | Every agency. Creates agencies and their first owner |
| **Agency Admin** | `memberships.role = 'admin'` | People an agency's owner trusts to run the office | One agency |

The code keeps `is_admin()` for now, but the UI and docs call it "מפעיל
הפלטפורמה", never "מנהל". Rename it `is_platform_operator()` in a later
cleanup. **Dorit becomes the Owner of agency 1, not a platform operator**
(Rollout step 7).

## Roles

Ranked: `owner` > `admin` > `user`. A higher role can do everything a
lower one can.

| Role | Hebrew label | Who it is for |
|---|---|---|
| `owner` | בעלים | The licensee who owns the agency and its customers' data (the data controller). Dorit for agency 1 |
| `admin` | מנהל/ת | Office manager or senior agent: sees every lead, assigns them, publishes, manages Users |
| `user` | משתמש/ת | Agent or office staff: works the leads assigned to them |

Mapping existing rows: `owner → owner`; `agent → user`; `staff → user`.
Nobody becomes Admin automatically — the Owner promotes whoever should be.

Whether someone is a **licensee** (licence number, affiliations, calendar)
is a separate fact. It belongs to the `agents` table from the platform
design, not to the role.

## Lead assignment

New column `leads.assigned_user_id uuid null references auth.users(id) on delete set null`.

- **New leads arrive unassigned** (null). Admins see them in a "לא שויכו"
  queue and assign them. Automatic assignment (round-robin, by topic,
  by agent page) is the platform design's later step and plugs into the same
  column.
- **Only Admin+ assign or reassign.** A trigger refuses a change to
  `assigned_user_id` unless the caller is `has_role(agency_id,'admin')` or
  the platform operator. The assignee must be a member of the lead's agency
  (checked in the same trigger).
- **Assignment notifies the assignee** by mail through dorit-mailer
  ("שויכה אלייך פנייה חדשה"), with no personal details in the mail — only a
  link to the lead.
- **When someone leaves or is removed,** their leads in that agency go back
  to unassigned (done inside `remove_member`), so nothing is orphaned and
  Admins see them in the queue.
- `assigned_at` and `assigned_by` are stored with the lead for history.

### What "a User can see a lead" covers

One helper decides it, and every related table asks the same question:

```sql
-- True for Admin+ in the lead's agency, for the User it is assigned to,
-- and for the platform operator.
create function public.can_see_lead(p_lead_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
     where l.id = p_lead_id
       and ( public.has_role(l.agency_id, 'admin')
          or (l.assigned_user_id = auth.uid() and public.has_role(l.agency_id, 'user'))
          or public.is_admin() )
  )
$$;
```

| Table | A User sees rows where |
|---|---|
| `leads` | `assigned_user_id = auth.uid()` |
| `meetings` | `can_see_lead(lead_id)` |
| `chat_conversations`, `chat_messages` | `can_see_lead(lead_id)` (via the conversation); conversations with no lead are Admin+ |
| `masleka_requests`, `masleka_access_log` | `can_see_lead(lead_id)`, or `created_by = auth.uid()` when `lead_id` is null |
| `clearinghouse_snapshots`, reviews, published items | as their request/lead: `can_see_lead(lead_id)` or `created_by = auth.uid()` |
| Claim documents (storage) | the signed URL is issued only for a lead the caller can see |
| `contacts` | none — contacts have no lead link, so they are Admin+ |

Because Users only ever read their own leads, **CSV export is allowed for
everyone**: it exports what the person can already see.

## Permissions

✓ = allowed, — = refused by the database or the function, not just hidden.
"Own" = leads assigned to the User and the rows linked to them.

| Area | Action | User | Admin | Owner | Platform operator |
|---|---|---|---|---|---|
| Leads, meetings | Read | own | all | all | all |
| | Change status, add notes | own | ✓ | ✓ | ✓ |
| | Assign / reassign | — | ✓ | ✓ | ✓ |
| | Delete | — | ✓ | ✓ | ✓ |
| | Export CSV | own | all | all | all |
| Contacts | Read, edit | — | ✓ | ✓ | ✓ |
| Chat transcripts | Read | own | all | all | all |
| Claim documents | Open (signed URL) | own | all | all | all |
| Clearinghouse (masleka) | Create request, see status | own | all | all | all |
| | **Reveal ID number / POA code** | **own** | all | all | all |
| | Publish analysis to the client | own | all | all | all |
| Blog | Create and edit drafts | ✓ | ✓ | ✓ | ✓ |
| | Publish, unpublish, delete | — | ✓ | ✓ | ✓ |
| | Shared-library articles (`agency_id null`) | — | — | — | ✓ |
| Testimonials | Add, edit, delete | — | ✓ | ✓ | ✓ |
| Members | See the agency's members | ✓ | ✓ | ✓ | ✓ |
| | Invite / remove a **User** | — | ✓ | ✓ | ✓ |
| | Invite / remove / change an **Admin** | — | — | ✓ | ✓ |
| | Make someone **Owner**, transfer ownership | — | — | ✓ | ✓ |
| | Leave the agency themselves | ✓ | ✓ | ✓ unless last owner | — |
| **Agency profile** | **Any field** (contact, licence, consent version, brand) | — | — | **✓** | ✓ |
| Agency | Create, suspend, DPA date | — | — | — | ✓ |
| Audit | Read membership history and the masleka access log | own reveals | ✓ | ✓ | ✓ |

Publishing a clearinghouse analysis stays with whoever handles the client
(own), because it is part of working the lead, not site content.

### Invariants

1. Every agency always has at least one Owner. The database refuses to
   demote or remove the last one.
2. Nobody can grant a role higher than their own. An Admin manages Users
   only, never another Admin.
3. A membership or assignment change takes effect on the next request.
   Roles and assignments are read from the database on every call, never
   from the JWT or the browser.
4. A suspended agency (`agencies.status = 'suspended'`) gives its members
   no access. Only the platform operator still sees it.
5. Every reveal of an ID number or POA code is logged in
   `masleka_access_log` before the value is decrypted (as today), now by
   Users too.

## Database

One new migration, never an edit to an applied one.

### Roles and the role check

```sql
alter table public.memberships drop constraint memberships_role_check;
update public.memberships set role = case role when 'owner' then 'owner' else 'user' end;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'admin', 'user'));

-- The caller's role in one agency, or null. Null for a suspended agency.
create function public.agency_role(p_agency_id uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select m.role
    from public.memberships m
    join public.agencies a on a.id = m.agency_id
   where m.agency_id = p_agency_id
     and m.user_id = auth.uid()
     and a.status = 'active'
$$;

-- Does the caller hold at least p_min in this agency?
create function public.has_role(p_agency_id uuid, p_min text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce(
    array_position(array['user','admin','owner'], public.agency_role(p_agency_id))
      >= array_position(array['user','admin','owner'], p_min),
    false)
$$;

-- can_see keeps its name and callers ("is a member"), and now respects suspension.
create or replace function public.can_see(p_agency_id uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$ select public.has_role(p_agency_id, 'user') $$;
```

Plus `can_see_lead(lead_id)` above, and the `leads` columns
`assigned_user_id`, `assigned_at`, `assigned_by` with an index on
`(agency_id, assigned_user_id)`.

Grant `agency_role`, `has_role`, `can_see_lead` EXECUTE to `authenticated`
only. Revoke from `public` and `anon` by name, as AGENTS.md requires.

**Note:** `can_see(agency_id)` stops being the read rule for lead data.
Any policy that used it for leads, meetings, chat, masleka or clearinghouse
switches to the lead-level rule. Search every migration for `can_see(` and
replace each one deliberately — leaving one behind re-opens the agency's
whole lead list to Users.

### Policies

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `leads` | `has_role(agency_id,'admin') or assigned_user_id = auth.uid() and can_see(agency_id)` | server only (unchanged) | same as select; trigger guards `agency_id` and assignment | `has_role(…,'admin')` |
| `meetings` | `can_see_lead(lead_id)` | server only | `can_see_lead(lead_id)` | `has_role(…,'admin')` |
| `contacts` | `has_role(…,'admin')` | server only | `has_role(…,'admin')` | `has_role(…,'admin')` |
| `chat_*` | `can_see_lead(lead_id)`; no lead → `has_role(…,'admin')` | server only | — | — |
| `masleka_requests` | `can_see_lead(lead_id) or (lead_id is null and created_by = auth.uid() and can_see(agency_id)) or has_role(…,'admin')` | through the function | through the function | — |
| `clearinghouse_*` | as its request/lead | `can_see_lead(lead_id)` or own | same | `has_role(…,'admin')` |
| `testimonials` | public read unchanged | `has_role(…,'admin')` | `has_role(…,'admin')` | `has_role(…,'admin')` |
| `blog_posts` | unchanged | `published = false and has_role(…,'user')`, or `has_role(…,'admin')` | using/with check: `has_role(…,'admin') or (published = false and has_role(…,'user'))` | `has_role(…,'admin')` |
| `agency_profiles` | `can_see(agency_id)` | operator | `has_role(agency_id,'owner')` or operator | operator |
| `memberships` | `user_id = auth.uid() or can_see(agency_id)` | RPC only | RPC only | RPC only |

Every `or public.is_admin()` stays, so the platform operator is unaffected.
The clearinghouse publish RPCs check `can_see_lead` (or own request)
instead of `can_see(v_agency)`.

`leads` trigger (before update): refuses a change to `agency_id`; refuses a
change to `assigned_user_id`, `assigned_at` or `assigned_by` unless the
caller is Admin+ or the operator; sets `assigned_at`/`assigned_by` itself;
checks the new assignee is a member of the lead's agency.

### Members are changed only through functions

Revoke direct INSERT/UPDATE/DELETE on `memberships` from `authenticated`.

```sql
set_member_role(p_agency_id uuid, p_user_id uuid, p_role text) returns void
remove_member(p_agency_id uuid, p_user_id uuid) returns void   -- also "leave"
```

Rules inside both (security definer, checking the caller itself):

- Caller is the platform operator, or `agency_role(p_agency_id)` is
  `owner` or `admin`. Anyone may remove **themselves**.
- An `admin` caller may only set `p_role = 'user'`, and only touch a target
  whose current role is `user` (or who has no membership yet).
- An `owner` caller may do anything inside the agency.
- `remove_member` also unassigns that person's leads in the agency.
- Both write a row to `membership_events`.

Backstop trigger on `memberships` (before update or delete): if the old row
is `owner` and no other `owner` remains in that agency, raise `last_owner`.
Ownership transfer is "make B owner, then step A down", in that order.

### Audit

```sql
create table public.membership_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  actor_id uuid,            -- null when done by a server job
  target_user_id uuid not null,
  action text not null check (action in ('added','role_changed','removed','left')),
  old_role text, new_role text,
  at timestamptz not null default now()
);
-- Read: has_role(agency_id,'admin') or is_admin(). No direct writes.
```

`masleka_access_log` read: Admin+ see all; a User sees their own reveals.

### Functions that change

- `staff_role(user)` → `staff_role(user, agency)`; `my_staff_role()` →
  `my_agency_role(agency)`.
- `masleka_staff_emails()`: a reminder about a request goes to its lead's
  assignee (or creator), plus the agency's Admins and Owners — not to every
  member, since Users no longer see each other's clients.

## Edge Functions

`_shared/staff.ts` gets one gate that every members-only function uses:

```ts
requireAgencyRole(req, agencyId, min: 'user' | 'admin' | 'owner')
  // → { ok, userId, role, isOperator } | { ok: false, status: 401|403 }
requireLeadAccess(req, leadId)
  // → same shape; asks can_see_lead under the caller's session
```

Both show the token to Auth, then ask the database. Neither trusts claims
or the request body for the role or the assignment.

| Function | Gate today | Gate after |
|---|---|---|
| `invite-user` | platform operator | `admin`; the RPC enforces who may grant what |
| new `member-admin` (change role, remove, leave) | — | calls the RPCs under the caller's session |
| new `assign-lead` (or a direct RLS update) | — | `admin`; mails the assignee |
| `content-admin` (blog, testimonials) | platform operator | per action: `user` for drafts, `admin` for publish/delete/testimonials |
| agency profile edits | operator only (none in UI) | `owner` |
| `masleka-create`, list | any member | `requireLeadAccess` (or own when no lead) |
| `masleka-reveal` | any member | `requireLeadAccess` on the request's lead, or `created_by` for a lead-less request. Logs before decrypting, as today |
| clearinghouse publish | any member (RPC) | lead-level check (RPC) |
| claim document signed URL | any member | `requireLeadAccess` |

`invite-user` keeps resolving or creating the Auth account with the service
role, then calls `set_member_role` **with the caller's session**, so the
database decides whether this caller may grant this role. The invitation
mail names the role in Hebrew.

## Frontend

- **One role source.** `useAgencyRole(agencyId)` calls `my_agency_role`
  through React Query, keyed by user and agency, never cached across
  sign-outs. It returns `{ role, isOperator, can(action) }`; `can()` reads
  `src/config/permissions.ts`, which mirrors the table above, and a
  contract test keeps the two in line.
- **Routes.** `AdminRoute` (platform operator) stays for `/admin/agencies`.
  A new `AgencyRoute min="user"|"admin"|"owner"` replaces `StaffRoute`.
  Routes only choose screens; RLS and the functions decide.
- **Leads (`/admin/leads`).**
  - Users: the title reads "הפניות שלי"; no assign, no delete.
  - Admin+: an "assigned to" column, an assignee dropdown per lead, a "לא
    שויכו" filter chip (and the escalated/partial chips from the review),
    and a count of unassigned leads in the sidebar badge.
- **Users screen (`/admin/users`).** List with role, invite, change role
  (the dropdown offers only roles the caller may grant), remove, leave.
  Owners get "transfer ownership", which does the two steps in order.
  Removing someone shows how many leads will return to the queue.
- **Agency profile screen.** Owner only. Others don't see the menu item.
- **Blog admin:** Users see "Save draft" only; Publish shows for Admin+.
- **Testimonials admin:** Admin+ only.
- **Masleka board:** Users see their own requests, with the reveal button.
- **More than one agency.** A switcher in the admin header, with the
  choice kept in the URL (`?agency=`). Hidden with one membership.

## Edge cases

- **Last owner leaves or is demoted:** refused with `last_owner`.
- **Admin edits themselves:** may leave, may not promote themselves.
- **Re-inviting an existing member:** goes through the same rules.
- **Removed while signed in:** the next request returns 403 and the app
  sends them to sign in with a message. Their leads are back in the queue.
- **Lead reassigned while the old User has it open:** their next request
  for it returns nothing; the screen says the lead was moved.
- **A User reveals a code, then the lead is reassigned:** the reveal stays
  in the access log under their name; they can't reveal it again.
- **Visitor submits a new lead:** unassigned until an Admin assigns it. If
  an agency has no Admin and only one Owner, the Owner sees it as today.
- **Suspended agency:** members get "the account is suspended, contact the
  platform"; nothing is deleted.

## Tests

- `supabase/tests/agency_roles_check.sql`: a matrix for each role
  (user, admin, owner, non-member, member of a suspended agency, operator)
  against each action in the permissions table, including:
  - a User reads their assigned lead and its meeting, chat, masleka request
    and snapshot, and **cannot** read another User's or an unassigned one;
  - a User cannot change `assigned_user_id` or `agency_id`;
  - a User cannot read contacts or update the agency profile; an Admin
    cannot update the agency profile; the Owner can;
  - last-owner, admin-cannot-grant-admin, leave-yourself, and
    remove-member unassigns.
- Extend `agency_isolation_check.sql`: an Owner of agency A has no access to B.
- A guard test that fails if any lead-data policy still uses bare
  `can_see(` for select.
- Edge-function tests through `tests/helpers/edge-function.ts` for
  `invite-user`, `member-admin`, `assign-lead`, `masleka-reveal` (own lead
  allowed, other User's lead refused, reveal logged), `content-admin`.
- Contract test: `src/config/permissions.ts` matches the function gates.
- Update the STDs in `tests/test-plan/`.

## Rollout

1. **Migration A (additive):** `assigned_*` columns, `agency_role`,
   `has_role`, `can_see_lead`, `membership_events`, the RPCs, the triggers.
   Nothing reads them yet, so this is safe to ship alone.
2. **Assign before narrowing.** Before Users lose sight of unassigned
   leads, have Dorit (or a script she approves) assign the open leads, so
   nobody's working list goes blank overnight.
3. **Migration B (narrowing):** role mapping (non-owners → `user`), the new
   policies, revoke direct membership writes. Ship in the same release as
   step 4, because `staff.ts` still recognises `agent`/`staff` until then.
4. **Edge Functions:** `requireAgencyRole`, `requireLeadAccess`,
   `member-admin`, `assign-lead`, the new gates, `invite-user` through the RPC.
5. **Frontend:** `useAgencyRole`, `AgencyRoute`, assignment UI, users
   screen, owner-only profile screen, hidden buttons.
6. Confirm Dorit has an `owner` membership on agency 1 (the tenant
   migration inserted it only if her Auth account already existed). Promote
   anyone who should be an Admin.
7. Only then remove `profiles.role = 'admin'` from Dorit, so she works as
   an Owner and the operator role is only the platform's.
