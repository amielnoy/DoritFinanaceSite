# A personal area for signed-in visitors

**Date:** 2026-10-06 · **Status:** design approved in conversation; spec awaiting review.

## Why

Signing in gives an ordinary user nothing. The only pages behind a login are
`/admin/leads` and `/admin/blog`, and both are for admins. A visitor who left
an enquiry, finished the interview or booked a meeting has no place to see
what they told Dorit, or when they are meeting her.

**Outcome:** a signed-in user opens `/account` and sees their details, their
meetings and the interview summaries they submitted — nothing they did not
give or were not already told, and nothing of anyone else's.

**Success looks like:**

- A visitor who finished the interview, then signs in with the same email,
  sees that interview and its meeting.
- Someone signed in with a different email sees none of it.
- It works with the sign-in production uses today (Base44) and the one the
  migration is moving to (Supabase), without building the page twice.

## Scope

**In:** a read-only `/account` page; linking enquiries to a user by verified
email; storing the interview's summary and answers so there is something to
show; the database functions, the Base44 bridge function, the port and both
adapters; the privacy-policy and COMPLIANCE.md text.

**Out:** editing or cancelling a meeting from the page; uploading documents;
conversation history; managing admins or roles; any change to what admins see.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| How an enquiry belongs to a user | **Verified email equals the enquiry's email** (option 1) | Works for every past and future enquiry. Exposes nothing new: the confirmation mail already sent these details to that address. |
| Where the data is read from | **Supabase** | Meetings exist only there (`meetings`); the migration is heading there. One source, not two. |
| Which sign-ins it serves | **Both**, behind one `AccountPort` | Production signs in through Base44 today. A Supabase-only page would ship to nobody until the auth flip. |
| What the user can do | **Read only** | Changing a booking is Dorit's conversation to have, not a form. |

### The risk the email rule accepts

If a visitor types someone else's address, that person — once signed in —
sees the enquiry. They have already received it: the confirmation mail goes to
the same address with the same details. The page adds a place to see it again,
not a new recipient. Accepted on that basis; option 2 (a claim link in the
confirmation mail) remains available if it ever stops being true.

## What exists today

- `public.leads` and `public.meetings` in Supabase, mirrored from Base44 by
  `submitLead` with the service-role key (`mirrorLeadToSupabase`,
  `mirrorMeetingToSupabase`, `on_conflict` on the Base44 id).
- `leads` has `email`, `track`, `notes`, `meeting_topic`, `scheduled_at`;
  `meetings` has `scheduled_at`, `topic`, `timing`, `calendar_status`, keyed
  on `lead_base44_id`.
- **The interview's answers are stored nowhere.** The profile and the summary
  reach the mail, the Sheets row and the Google Doc, and neither database.
- `public.profiles` with `role`, `is_admin()`, and RLS that lets an
  authenticated user read only their own profile.
- `contentAdmin` already shows how a Base44 function verifies a caller against
  Supabase (`X-Supabase-Auth`, `/auth/v1/user`) and reads with the service key.

## Design

### 1. Data — one migration

```sql
alter table public.leads
  add column summary text,
  add column profile jsonb;
```

`submitLead` sends both in its existing mirror. `profile` is the output of
`buildInterviewProfile` — already filtered to the known fields, already
through `redact()`, and already labelled as the mail labels it — stored as an
array of `[label, value]` pairs. So the stored copy is never more than what was
mailed, and the page needs no copy of the schema to display it.
Enquiries from before this change have no summary; the page says so rather
than showing an empty block as if nothing had been asked.

### 2. Who is asking — `my_email()`

```sql
create function public.my_email() returns text
  language sql security definer stable set search_path = public as $$
  select lower(trim(email)) from auth.users
   where id = auth.uid() and email_confirmed_at is not null
$$;
```

Null for an unconfirmed address, so an unverified sign-up sees nothing. Google
sign-in confirms the address; the migration spec already drops password
accounts, and any that remain must confirm before they match.

### 3. What they may see — `enquiries_for(email)`, and `my_enquiries()`

One function decides the columns, so there is one place to review what a
visitor can see:

- `enquiries_for(p_email text)` — `security definer`, **granted to
  `service_role` only.** Returns, for leads whose `lower(trim(email)) =
  p_email`: `created_at`, `source`, `track`, `meeting_topic`, `timing`,
  `scheduled_at`, `summary`, `profile`, and from the joined meeting
  `calendar_status`. Newest first.
- `my_enquiries()` — `security definer`, granted to `authenticated`. Returns
  `enquiries_for(my_email())`, or nothing when `my_email()` is null.

**Never returned:** `id`, `base44_id`, `phone`, `status`,
`escalation_reason`, `handled_by_agent`, `consent_*`, `notes` (Dorit's working
field). The `leads` and `meetings` tables gain **no** policy for ordinary
users — the functions are the only door, so a column added later is invisible
until someone adds it to the function on purpose.

### 4. The Base44 bridge — `myAccount`

A new Base44 function for users signed in through Base44:

1. `base44.auth.me()` identifies the caller; no user → 401.
2. The caller's email, lowercased and trimmed. **Open item, resolved in the
   plan before this step is built:** whether Base44 exposes that an address
   is verified. If it cannot be established, the bridge serves Google-sourced
   Base44 accounts only, or the page waits for the Supabase flip.
3. Calls `enquiries_for(email)` over PostgREST RPC with the service key.
4. Returns `{ ok, rid, enquiries }` — through the same `json()` shape
   `contentAdmin` uses, never an error message (AGENTS.md: return the `rid`).

### 5. Port and adapters

```ts
interface Enquiry {
  createdAt: string;
  source: string;
  track?: string;
  meetingTopic?: string;
  timing?: string;
  scheduledAt?: string;
  calendarStatus?: string;
  summary?: string;
  /** `[label, value]` pairs, as the summary mail shows them. */
  profile?: Array<[string, string]>;
}

interface AccountPort {
  myEnquiries(): Promise<Enquiry[]>;
}
```

- `SupabaseAccountService` — `supabase.rpc("my_enquiries")`.
- `Base44AccountService` — `invokeFunction(client, "myAccount", {})`, which
  reads the body out of the SDK's axios wrapper (A-67).
- `src/services/index.ts` picks by `AUTH_PROVIDER`, as it does for `AuthPort`.

### 6. The page — `/account`

Behind `ProtectedRoute` (any signed-in user; admins included).

- **הפרטים שלי** — name and email from the sign-in.
- **הפגישות שלי** — upcoming first, then past: date and time, topic, and a
  plain status: "ממתינה לאישור דורית" until the calendar took it, "ביומן"
  after.
- **סיכומי ההיכרות שלי** — date, track label, and the stored `[label, value]`
  pairs as they are, so a visitor reads exactly what Dorit read.
- **Rights** — a line and a link to request access, correction or deletion,
  matching the privacy policy.
- **Empty and partial states** — "עוד אין כאן פניות"; and always, "פניות שנשלחו
  בלי כתובת מייל, או מכתובת אחרת, אינן מופיעות כאן". An unconfirmed address gets
  its own line rather than an empty list.

Header: a "האזור שלי" link when signed in; admins also see links to the admin
pages.

### 7. Errors

A failed load shows a short message with the `rid` and a retry, and leaves the
rest of the page standing. A 401 from the bridge sends the visitor to sign in
again. Nothing on this page can fail into a white screen: the data is rendered
as text, never as markdown or HTML.

## Testing

| Layer | What it proves |
|---|---|
| `supabase/tests` (SQL) | `my_enquiries()` returns only the caller's rows; a different email gets none; an unconfirmed email gets none; `enquiries_for` is not callable by `authenticated`; no excluded column appears; `leads` and `meetings` still refuse a direct read |
| Unit | both adapters, fed the SDK's real response shapes (the A-67 lesson) |
| Component | the page's states: loading, empty, with meetings, with summaries, unconfirmed, error with `rid` |
| Contract | `myAccount` returns nothing from the excluded list; the migration's grants; `submitLead`'s mirror sends `summary` and `profile` only after `redact()` |
| Integration | `submitLead` mirrors the summary and profile; `myAccount` refuses an anonymous call |
| e2e | signed in (stubbed), `/account` shows the matching enquiry and nothing else; signed out, it redirects to `/login` |

## Disclosure

- **Privacy policy:** a paragraph on the personal area — what it shows, that
  it matches by the email given in the enquiry, and how to ask for access,
  correction or deletion.
- **COMPLIANCE.md:** the matching rule, the risk it accepts and why, and the
  list of columns a visitor can see.
- **Known issues / STDs:** the new cases, as for every change.

## Order of work

1. Migration: `summary`, `profile`, `my_email()`, `enquiries_for()`,
   `my_enquiries()`, with the SQL tests.
2. `submitLead` mirrors `summary` and `profile`.
3. Resolve the Base44 verification open item; build `myAccount`.
4. `AccountPort`, both adapters, and the composition root.
5. `/account`, the header link, and the disclosure text.
6. Docs and STDs.

## Open items

- **Base44 email verification** (section 4). Decides whether the bridge
  serves every Base44 account or only Google-sourced ones.
- **Old enquiries** have no stored summary. Backfilling from the Google Docs
  is possible but not planned; the page states the gap instead.
