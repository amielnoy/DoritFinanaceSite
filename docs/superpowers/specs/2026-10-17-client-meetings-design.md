# Saving a client's meetings with Dorit

**Date:** 2026-10-17 · **Status:** D1–D6 approved by Amiel on 2026-10-17. Rollout step 1 (data and server) is built; see "Decided while building" at the end.
Supersedes one line of the personal-area design (2026-10-06): its "read only —
changing a booking is Dorit's conversation" stays true for *changing*, but a
client may now *ask* for a change from the page (§6).

## Why

A meeting is saved once, and only the first one. `meetings` holds one row per
lead (`meetings_lead_id_key unique (lead_id)`), and only `submit-lead` writes
it — when a visitor books through the site. Everything that happens after that
first booking is stored nowhere:

- the annual review, the follow-up after the clearinghouse analysis, the
  second meeting about insurance — Dorit sets these by phone, and the database
  never hears of them;
- what came out of a meeting: there is `notes`, but it is Dorit's working
  field, never shown to the client, and it belongs to the booking, not to what
  was said;
- the client's `/account` shows at most that one first booking, as a topic, a
  time and "ביומן" / "ממתינה לאישור דורית".

A regular client — someone who already works with Dorit (`leads.status =
'client'`) — has no record of their meetings with her, and neither does she,
outside her calendar.

**Outcome:** every meeting between Dorit and a client is saved as its own row,
on the client's record. The client sees, in `/account`, their next meeting
(with a way to put it in their own calendar and to ask for a change) and their
past meetings, each with the summary Dorit chose to share.

**Success looks like:**

- Dorit adds a follow-up meeting to a client from the leads screen; the client,
  signed in, sees it under "הפגישה הבאה" within one refresh.
- After the meeting Dorit writes a summary for the client and publishes it; the
  client sees it under the past meeting. Her internal notes never appear.
- A client asks to move a meeting; Dorit gets a mail and sees the request on
  the lead. The meeting itself does not move until she moves it.
- Someone signed in with a different email sees none of it (the personal-area
  rule, unchanged).

## Scope

**In:** many meetings per lead; staff create, update and close meetings; a
client-facing summary separate from internal notes; a read door for the client
(`my_meetings()`); add-to-calendar (.ics and Google link) for the client; a
"request a change" action; the `/account` meetings tab; the staff meetings
panel on a lead; retention and privacy text.

**Out (later phases):** the client booking a slot themselves from free/busy
(the booking flow stays as it is); video links generated automatically;
shared follow-up checklists with ticking (§9, phase 2); reminders by SMS or
WhatsApp; documents attached to a meeting (claim documents already have their
own path).

## Decisions (approved 2026-10-17)

| # | Decision | Proposal | Why |
|---|---|---|---|
| D1 | What a meeting belongs to | **The lead** (`lead_id`), many per lead | The lead is already the client record: retention, assignment (`assigned_user_id`), `can_see_lead` and the personal-area email rule all hang off it. A separate `clients` table would be a second identity to keep in step. |
| D2 | Who writes meetings | **Server** for site bookings (as today); **staff who can see the lead** for everything else; **never the client directly** | Insert is revoked from `authenticated` today ("Meetings are written by the server"). Staff writes are a new, narrow policy bound to `can_see_lead` + `lead_in_agency`. |
| D3 | What the client sees | Only columns named in `meetings_for()` — never `notes`, `calendar_status`, `agency_id`, ids of staff | Same pattern as `enquiries_for`: the function is the only door; a column added later is invisible until added to it on purpose. |
| D4 | Summary for the client | A separate `client_summary` + `summary_published_at`; unpublished is invisible | Dorit writes for herself and for the client differently. Publishing is an explicit act, so a draft never leaks. |
| D5 | Client actions | **Ask** to reschedule or cancel (a request row + mail to Dorit); never change the meeting | Moving a meeting is a conversation; the request makes it a recorded one. |
| D6 | Add to calendar | Generated in the browser from the row (Israel time); no server mail | Nothing new leaves the database; works for any calendar. |

## Data

### Migration 1 — additive (`20261103000000_client_meetings.sql`)

```sql
alter table public.meetings
  add column status          text not null default 'scheduled'
    check (status in ('scheduled','done','cancelled','no_show')),
  add column mode            text check (mode in ('office','phone','video')),
  add column location        text,          -- address, or the video link
  add column duration_min    smallint check (duration_min between 10 and 240),
  add column client_summary  text,          -- written for the client
  add column summary_published_at timestamptz,
  add column created_by      uuid references auth.users(id), -- null = server
  add column kind            text not null default 'first'
    check (kind in ('first','follow_up','annual_review','other'));

-- A change the client asked for. The meeting itself is untouched.
create table public.meeting_requests (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  agency_id   uuid not null references public.agencies(id),
  kind        text not null check (kind in ('reschedule','cancel')),
  note        text check (char_length(note) <= 500),
  status      text not null default 'open' check (status in ('open','handled')),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
```

Existing rows become `status = 'scheduled'` (or `'done'` when `scheduled_at <
now()`, in the same migration), `kind = 'first'`.

### Migration 2 — narrowing (`20261104000000_client_meetings_many.sql`)

```sql
alter table public.meetings drop constraint meetings_lead_id_key;
create index meetings_lead_id_scheduled on public.meetings (lead_id, scheduled_at);
```

The `unique (lead_id)` is what `submit-lead` upserts on (`on_conflict=lead_id`,
twice: the booking and then the calendar outcome). Before the constraint goes,
`submit-lead` must write the booking with `insert … returning id` and update
the calendar outcome **by that id**. Shipping migration 2 first would make the
second upsert fail with "no unique constraint matching". The order is the
point of splitting the migrations.

### Policies

```sql
-- Staff who can see the lead add a meeting to it, in its own agency.
create policy meetings_insert_lead on public.meetings
  for insert to authenticated
  with check (public.can_see_lead(lead_id) and public.lead_in_agency(lead_id, agency_id));
grant insert on public.meetings to authenticated;
```

`meetings_update_lead` and `meetings_delete_admin` stay as they are.
`meeting_requests`: staff read and update through `can_see_lead` on the
meeting's lead (a `request_lead(meeting_id)` helper, like `lead_in_agency`);
**no insert policy** — clients write only through `request_meeting_change`.

### The client's door

```sql
-- service_role only, like enquiries_for.
create function public.meetings_for(p_email text)
returns table (
  id uuid, scheduled_at timestamptz, duration_min smallint, topic text,
  kind text, status text, mode text, location text,
  client_summary text, summary_published_at timestamptz,
  in_calendar boolean, open_request text
) …
  where lower(trim(l.email)) = lower(trim(p_email))
    and l.anonymized_at is null
  -- client_summary is null unless summary_published_at is set
  order by m.scheduled_at desc nulls last;

-- authenticated: meetings_for(my_email()), or nothing for an unverified address.
create function public.my_meetings() …

-- authenticated: one open request per meeting; the meeting must be one of
-- my_meetings(). Returns the request id. Mails Dorit through the trigger below.
create function public.request_meeting_change(p_meeting uuid, p_kind text, p_note text) …
```

**Never returned:** `notes`, `timing` (the visitor's raw words — already shown
on the enquiry), `calendar_status` (only its boolean), `lead_id`, `agency_id`,
`created_by`, `track`. `meetings_for` is held to that list by a contract test,
exactly as `enquiries_for` is held to its 11 columns.

`id` is returned because the request action needs it. It is a random uuid and
grants nothing on its own: `request_meeting_change` checks ownership again.

## Server

- **`submit-lead`:** booking insert by id (above); a signed-in caller whose
  verified email matches an existing lead **in the same agency** gets the new
  meeting on that lead (`kind = 'follow_up'`) instead of a second lead. An
  anonymous caller is unchanged.
- **`meeting-request` Edge Function** (or a database webhook on
  `meeting_requests` insert): mails `NOTIFY_EMAILS` + the lead's assigned user.
  Mail carries the meeting time and the request kind, never the note's text in
  the subject. Israel time (`timeZone: 'Asia/Jerusalem'`, A-63), `rid` in the
  answer, no error message (AGENTS.md).
- Calendar for staff-created meetings: out of scope for v1 — Dorit creates them
  from her diary, so they are already in it. `in_calendar` is true when
  `calendar_status` says so **or** `created_by` is not null.

## Frontend

### Client — `/account`, tab "הפגישות שלי"

Order: the next upcoming meeting as its own card; then other upcoming; then
past (most recent first); cancelled last, collapsed.

- **Next meeting card:** date and time (Israel), duration, topic, mode and
  place; buttons **"הוספה ליומן"** (menu: Google / Apple-Outlook .ics) and
  **"בקשה לשינוי"**. When a request is open the button reads "הבקשה נשלחה —
  דורית תחזור אליך" and is disabled.
- **Past meeting:** date, topic, `status` label (התקיימה / בוטלה / לא
  התקיימה); the published summary under "מה סיכמנו"; nothing when none is
  published — not an empty box.
- **Change request dialog:** two choices (מועד אחר / ביטול), an optional note
  (≤ 500), a line saying the meeting stays as it is until Dorit confirms.
- Empty state: "עוד אין כאן פגישות" + the existing booking link.
- Everything rendered as text, never markdown (personal-area rule).

`AccountPort` gains `myMeetings(): Promise<ClientMeeting[]>` and
`requestMeetingChange(id, kind, note)`. Supabase adapter only — the Base44
bridge is not extended (auth is moving off Base44).

### Staff — the lead's drawer, section "פגישות"

List of the lead's meetings, newest first; **"פגישה חדשה"** (date, time,
duration, mode, place, kind, topic); on a past meeting **"סימון כהתקיימה"**,
the internal notes field and the client summary field with **"פרסום ללקוח"**
(and "ביטול פרסום"). Open client requests appear as a banner on the meeting
with "טופל". Visible to whoever `can_see_lead` — a User sees only their
assigned leads' meetings, as today.

## Retention and privacy

- `anonymize_stale_leads` also nulls `client_summary`, `location` and the
  requests' `note` for an anonymised lead. A `status = 'client'` lead is never
  anonymised (unchanged), so a regular client's history is kept for as long as
  they are a client.
- Privacy policy: add that meeting summaries Dorit publishes are shown in the
  personal area to the verified address on the enquiry. **Open item for Dorit's
  compliance adviser** (as with the personal area): the summary is an account
  of the meeting, not advice in writing — it must not replace the documents
  regulation requires (e.g. a pension-marketing explanation document), and the
  page carries `compliance.pensionMarketing` under the summaries.

## Tests

- Contract: `meetings_for` returns exactly the columns above; `notes` never;
  `client_summary` null while unpublished; `request_meeting_change` refuses a
  meeting that is not the caller's, and a second open request.
- Contract (agency roles): `meetings_insert_lead` binds `lead_in_agency`; a
  User cannot add a meeting to an unassigned lead or to another agency.
- Unit: ordering (next / upcoming / past / cancelled); .ics generation in
  Israel time across a DST change (the clock contract).
- Component: the account tab — next card, published vs unpublished summary,
  request flow, open-request state; the staff panel — publish/unpublish.
- `submit-lead`: booking + calendar outcome written by id; the existing-lead
  match for a verified signed-in caller, and never across agencies.

## Rollout

1. Migration 1 + `submit-lead` by-id writes + `my_meetings` (no UI). CI green.
2. Staff panel behind `VITE_MEETINGS_STAFF`; Dorit adds her real follow-ups for
   a week.
3. Migration 2 (drop unique) once every writer writes by id.
4. Client tab behind `VITE_MEETINGS_CLIENT`, after the privacy wording is
   approved.

## Phase 2 (not designed here)

`meeting_items (meeting_id, owner 'client'|'dorit', text, done_at)` — the
follow-ups agreed in a meeting ("להביא טופס 106", "דורית שולחת השוואת
דמי ניהול"), with the client ticking their own through an RPC.

## Decided while building (step 1, 2026-10-17)

- **Migration versions.** The draft named `20261031000000` and
  `20261101000000`; production had already applied other migrations under both
  (`20261031000000_invitee_confirmed.sql`, `20261101000000_lead_conversation_ref.sql`).
  Migration 1 is `20261103000000`, migration 2 will be `20261104000000`.
- **Rebooking (Amiel, 2026-10-17): the consultation booking form only.** A
  signed-in caller with a verified address that matches a lead in the same
  agency gets the meeting on that lead (`kind = 'follow_up'`); the lead's own
  fields are not overwritten, and Dorit is mailed as for any booking. An
  interview or the quick contact form still makes a lead of its own.
  The match is `lead_for_email()`, an exact `lower(trim())` comparison —
  never `ilike`, where `_` matches any character and would file the meeting
  under someone else's lead.
- **Until migration 2.** A lead holds one meeting while `meetings_lead_id_key`
  exists, so `lead_for_email()` does not offer a lead that already has one —
  the rebooking makes a new lead, as before, instead of failing on the key —
  and staff can add a meeting only to a lead that has none. Both lift with no
  deploy when migration 2 drops the key.
- **Two readers fixed in migration 1.** `enquiries_for` joins the lead's first
  booking only (a follow-up would have repeated the enquiry), and
  `anonymize_stale_leads` judges a lead by its latest meeting (an old meeting
  would have made a lead with a recent one look stale).
- **The request mail: the `meeting-request` Edge Function**, not a database
  webhook. The client calls it with their session; it runs
  `request_meeting_change` under that session, then mails `NOTIFY_EMAILS`, the
  lead's assigned user and the agency's owners and admins
  (`meeting_request_recipients()`) — so Dorit hears of it even on an
  unassigned lead. The mail carries the kind, the time in Israel and the
  topic; the client's note stays on the lead, behind sign-in.
- **A change can be asked only for a scheduled meeting** — not one that is
  done, cancelled or missed.
- **`meeting_requests` grants.** Supabase's default privileges hand a new table
  to `anon` and `authenticated` in full, so the migration revokes them before
  granting staff `select` and `update (status, handled_at)` only.

## Step 3 (2026-10-17)

`20261104000000_client_meetings_many.sql` drops `meetings_lead_id_key` and adds
`meetings_lead_id_scheduled (lead_id, scheduled_at)`. Checked first: no Edge
Function, page, Base44 function, script or migration upserts `meetings` on
`lead_id` (`tests/contract/client-meetings-many.contract.test.ts` now holds
that), no SQL function in production does, and the only triggers on `meetings`
are `meetings_fill_lead_id` and `meetings_touch`. Once applied, a signed-in
client's rebooking joins their booked lead and staff can add a second meeting
to it — `lead_for_email()` and the staff insert lift with no deploy.

## Step 4 (2026-10-17)

The client tab is built behind `VITE_MEETINGS_CLIENT` and stays off until
Dorit's compliance adviser approves the privacy wording (Rollout 4). Built as
the canvas "הפגישות שלי — לקוח" shows, with one omission: its "כדאי להביא" line
is phase 2's checklist (`meeting_items`, not designed here). The change request
goes through the `meeting-request` function, not the RPC directly, so Dorit is
always mailed. Calendar files carry UTC instants (…Z), which hold Israel's hour
across a daylight-saving change.

