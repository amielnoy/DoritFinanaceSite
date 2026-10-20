# Adding a lead by hand: a lead someone on the team brought in

**Date:** 2026-10-20 · **Status:** draft for review. Nothing here is built.
Extends `2026-10-15-agency-roles-design.md` (roles, assignment, `can_see_lead`)
and `2026-10-17-client-meetings-design.md` (staff-created meetings).

## Why

Every lead today comes from the site. `leads` has no insert path for a
signed-in person: `20261013010000_no_public_lead_inserts.sql` revoked insert
from `anon` and `authenticated`, and only server functions (`submit-lead`,
`submit-claim`, the escalation path) write rows, each with a `source` from the
site (`consultation`, `detailed`, `quick`, `claim`, `escalation`, `interview`).

But much of an agency's business is brought in by the agents themselves: a
call from a friend of a client, a conversation at an event, a referral from
an accountant, an existing policyholder who asks about pension. Those people
are worked in a notebook or WhatsApp and the system never sees them. So:

- they are not in the agency's list, not assigned, and nobody else can pick
  them up if the agent is away;
- they get none of what hangs off a lead: meetings, the clearinghouse request,
  the personal area, retention;
- nobody can see who brought what, which is the question an Owner asks first.

**Outcome:** any member of the agency (User, Admin, Owner) can open a lead by
hand from the leads screen. It becomes an ordinary lead, recorded with who
brought it and how, and with a record that the person was told how their
details are used.

**Success looks like:**

- A User adds "יוסי כהן, 050…, הפניה מרו״ח" from their phone in under a
  minute; it appears in "הפניות שלי", assigned to them.
- An Admin adds a lead and assigns it to a User in the same form; the User
  gets the usual assignment mail.
- The Owner filters the list by "הובאה ע״י הצוות" and sees, per member, how
  many leads each brought this month.
- Adding a phone that already belongs to a lead the person can see opens that
  lead instead of making a second one.
- A User cannot create a lead in another agency, assign it to someone else,
  or write `source`, `status = 'escalated'` or consent fields directly.

## Scope

**In:** a "פנייה חדשה" form on the leads screen; a server write path for
staff; who brought it (`brought_by`) and how (`intake`); the privacy notice
record; duplicate check by phone; optional first meeting in the same form;
list column, filter and a per-member count; notices; tests.

**Out (later):** CSV/bulk import of an agent's old contacts (needs its own
privacy answer — those people were never told); creating a lead from a
WhatsApp chat in one click; commission or reward tracking on top of
`brought_by`; sending the privacy notice by SMS (no SMS sender yet).

## Decisions (proposed — each needs Amiel's yes)

| # | Decision | Proposal | Why |
|---|---|---|---|
| D1 | Write path | A new Edge Function **`create-lead`** that validates and then calls the RPC **`create_staff_lead`** under the caller's session | Same shape as `invite-user` → `set_member_role`: the function validates and does the side effects (sheet, notices); the database decides whether this caller may write this row. Direct insert stays revoked. |
| D2 | Who may add | **Every role** (`has_role(agency,'user')`) | Bringing clients is the agent's job, not an admin task. |
| D3 | Assignment on create | **User:** always assigned to themselves, no choice. **Admin+:** choose an assignee, default themselves, "ללא שיוך" allowed | Keeps the roles rule "only Admin+ assign". A User who could assign on insert could hand leads around. |
| D4 | Who brought it | New column **`brought_by`** — set by the server to the caller, **never changes**, even when the lead is reassigned | Assignment answers "who works it now"; `brought_by` answers "whose client is this". They drift apart, so they are two columns. |
| D5 | Source and how it came | `source = 'staff'` (new value); new column **`intake`**: `phone`, `in_person`, `referral`, `event`, `existing_client`, `other`. `channel` is set to `referral` for `referral`/`existing_client`, otherwise `direct` | `source` stays "which door"; `intake` is the staff-side detail. `channel` keeps meaning marketing attribution, so the tracking tab doesn't get new values. |
| D6 | Privacy notice | Required checkbox "יידעתי את הפונה…" with the notice text beside it; stored as `consent_version = 'staff-intake-v1'`, `consent_at = now()`, plus **`notice_method`** (`verbal`, `email`, `whatsapp`) | The person never saw the site's consent panel. Amendment 13's duty to inform still applies, and the record is the evidence (COMPLIANCE §6). No lead without the checkbox. |
| D7 | Duplicates | Check the normalised phone in the same agency before creating. Visible to the caller → show it and offer "פתיחת הפנייה הקיימת" (or "פנייה נוספת לאותו אדם"). Not visible → create, and mark `duplicate_of` for Admins only | A User must not learn that a number belongs to another User's client, but the agency must not end up with two people working the same client unknowingly. |
| D8 | Starting status | Choice of `new` / `contacted` / `client`; default **`contacted`** | The agent has usually already talked to them. `escalated` and `partial` are server states and are refused. |

## Data

### Migration (additive) — `20261105000000_staff_leads.sql`

```sql
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('consultation','detailed','quick','claim','escalation','interview','staff'));

alter table public.leads
  add column brought_by    uuid references auth.users(id) on delete set null,
  add column intake        text check (intake in
                             ('phone','in_person','referral','event','existing_client','other')),
  add column referrer_note text check (char_length(referrer_note) <= 120), -- "רו״ח משה", not a contact record
  add column notice_method text check (notice_method in ('verbal','email','whatsapp')),
  add column duplicate_of  uuid references public.leads(id) on delete set null;

-- A staff lead always says who brought it and how they were told.
alter table public.leads add constraint leads_staff_fields check (
  source is distinct from 'staff'
  or (brought_by is not null and intake is not null and notice_method is not null
      and consent_version is not null and consent_at is not null)
) not valid;
alter table public.leads validate constraint leads_staff_fields;

create index leads_brought_by_created on public.leads (brought_by, created_at)
  where brought_by is not null;
```

`brought_by` goes `null` when the member's Auth account is deleted; the list
then shows "חבר/ה שכבר לא בסוכנות", as it does for assignees.

The `leads` before-update trigger from agency roles also refuses changes to
`brought_by`, `source`, `intake`, `consent_version`, `consent_at` and
`notice_method` (Admin+ included; only the platform operator may correct them).
`duplicate_of` may be cleared by Admin+ ("לא כפילות").

### The RPC

```sql
-- security definer; EXECUTE to authenticated only (revoke public, anon by name).
create function public.create_staff_lead(
  p_agency_id   uuid,
  p_name        text,
  p_phone       text,         -- already validated and normalised by create-lead
  p_email       text,
  p_topic       text,
  p_notes       text,         -- internal; goes to leads.notes
  p_intake      text,
  p_referrer    text,
  p_status      text,         -- new | contacted | client
  p_notice      text,         -- verbal | email | whatsapp
  p_assignee    uuid,         -- ignored for a User
  p_duplicate_ok boolean      -- the caller saw the visible match and chose a second lead
) returns table (lead_id uuid, duplicate text)  -- duplicate: null | 'visible' | 'hidden'
```

Inside, in this order:

1. `has_role(p_agency_id,'user')` or `is_admin()`, else `forbidden`.
2. `p_status in ('new','contacted','client')`, `p_intake`, `p_notice` in their
   lists; lengths as `LEAD_FIELD_LIMITS`.
3. Assignee: a User → `auth.uid()`. Admin+ → `p_assignee`, which must be a
   member of `p_agency_id` (or null).
4. Duplicate: newest lead in the agency, `anonymized_at is null`, same
   digits. If `can_see_lead` on it and not `p_duplicate_ok` → return
   `(that id, 'visible')` **without inserting**. If not visible → insert with
   `duplicate_of` set and return `'hidden'` (the caller learns only that it was
   flagged for an Admin, never whose it is).
5. Insert with `source = 'staff'`, `brought_by = auth.uid()`,
   `consent_version = 'staff-intake-v1'`, `consent_at = now()`,
   `assigned_at/assigned_by` set, `channel` per D5.

Nothing in the arguments sets `source`, `brought_by`, consent or `agency_id`
of someone else: those come from the function, not the caller.

### What the client sees

`enquiries_for` already returns `source`; nothing else changes. A staff lead
with a verified email shows in the client's `/account` as **"פנייה דרך
הצוות"** (`SOURCE_LABELS` in `Account.tsx`). `notes`, `intake`,
`referrer_note`, `brought_by` are not in `enquiries_for` and stay out — the
contract test that pins its columns already guards this. Staff text is
written to `notes`, **never** to `summary` or `message`, because `summary` is
shown to the client.

## Server — `create-lead` Edge Function

- Gate: `requireAgencyRole(req, agencyId, 'user')`.
- Validate: `contactPhone(phone)` (same rule as `submit-lead`, D-01), name
  required, email shape, `LEAD_FIELD_LIMITS`; `redact()` on `notes` and
  `topic` (ID numbers, card and account numbers never stored — COMPLIANCE §6).
- Limit: 60 creates per member per hour (`submission_limits`), so a script
  with a stolen session cannot fill the table.
- Call `create_staff_lead` **with the caller's session**.
- On a `'visible'` duplicate: answer `409 { duplicate: 'visible', leadId }`
  and write nothing.
- After the insert: append the sheet row (`source = staff`, as for site leads);
  if an Admin assigned it to someone else, the existing `assign-lead` mail
  ("שויכה אלייך פנייה חדשה", no personal details); an ops notice to the
  agency's Admins and Owners through `_shared/ops-notice.ts` —
  "{member} הוסיף/ה פנייה" with the topic and the link, no name or phone.
  On `'hidden'` duplicates the notice says "כפילות אפשרית" for Admins.
- If `notice_method = 'email'` and an email was given: send the
  **staff-intake privacy notice** (who Dorit's agency is, what is kept, why,
  for how long, who receives it, the rights and the privacy-policy link) via
  dorit-mailer. A failed mail does not undo the lead; the answer says
  `noticeSent: false` and the form tells the member to send it another way.
- Israel time, `rid` in every answer, no error text leaked (AGENTS.md).

## Frontend

### The form — "פנייה חדשה"

A button next to the CSV export on `/admin/leads`, for every role
(`can("leads.create")` in `permissions.ts`). Opens a side sheet (full screen
on a phone — this will mostly be used from the phone right after a call).

Fields, in order:

1. **שם** (required), **טלפון** (required, checked as typed), **אימייל**
2. **נושא** — the same topic list the site uses, plus "אחר"
3. **איך הגיע/ה** — `intake` as chips: שיחת טלפון · פגישה · הפניה · אירוע ·
   לקוח/ה קיים/ת · אחר. With הפניה, a short field "מי הפנה" (≤ 120, "e.g.
   רו״ח משה").
4. **מצב** — חדשה / נוצר קשר / לקוח/ה (default נוצר קשר)
5. **הערות פנימיות** — "לא מוצגות ללקוח"
6. **שיוך** — Admin+ only: dropdown of members, default "אני"
7. **קבענו כבר פגישה** — toggle that opens the client-meetings fields (date,
   time, mode, place); written through `meetings_insert_lead` after the lead
8. **יידוע** (required): the notice text in a collapsible box, then a
   checkbox "יידעתי את הפונה איך ישמשו הפרטים שלו/ה", and how: בעל פה /
   במייל (sends it; disabled without an email) / בוואטסאפ (shows the text with
   a copy button).

"שמירה" stays disabled until name, phone, intake and the notice are filled.

**Duplicate states:**

- *Visible:* the sheet shows the existing lead (name, status, date, assignee)
  with **"פתיחת הפנייה הקיימת"** and **"פנייה חדשה לאותו אדם"**. The second
  resends with `duplicate_ok`.
- *Hidden:* the lead is created; the confirmation adds "המספר כבר קיים
  בסוכנות — מנהל/ת יבדוק/תבדוק".

After saving: a toast, the drawer of the new lead opens, the list refreshes.

### The list

- `SOURCE_LABEL.staff = "דרך הצוות"`.
- New column **"הובאה ע״י"** (Admin+; a User sees only their own anyway), and
  an `intake` tag beside the source.
- Filter chip **"דרך הצוות"** for everyone; Admin+ also **"כפילות אפשרית"**
  with "לא כפילות" / "מיזוג" (merge is manual for now: open both).
- A small "הובאו החודש" strip for Admin+: count per member, from
  `brought_by` and `created_at` in Israel time.
- CSV export gains `brought_by` (name), `intake`, `referrer_note`.
- The lead drawer shows "נוספה ידנית ע״י {member} · {intake} · יידוע:
  {notice_method}" under the header.

`LeadAdminPort` gains `createLead(input) → { leadId, duplicate }`. Supabase
adapter only.

## Retention and privacy

- Retention is unchanged: 24 months from the last contact, `client` never
  anonymised. `anonymize_stale_leads` also nulls `referrer_note` (it names a
  third person).
- **Open item for Dorit's compliance adviser:** the wording of
  `staff-intake-v1`, and whether a verbal notice with a checkbox is enough
  evidence, or a written notice (email/WhatsApp) should be required. The design
  stores `notice_method` either way, so the rule can tighten without a
  migration.
- Privacy policy: add that a lead can also be opened by a member of the
  agency who spoke with the person, with the same use and retention.
- The form never asks for ID number, salary, savings or medical details, and
  `redact()` removes ID/card/account numbers if typed into the free text.

## Tests

- `supabase/tests/staff_leads_check.sql` (role matrix):
  - User creates in own agency → assigned to self, `brought_by` = self,
    `source = 'staff'`; `p_assignee` ignored.
  - Admin creates and assigns to a member; assigning to a non-member refused.
  - Non-member, member of a suspended agency, other agency → refused.
  - `p_status = 'escalated'` / `'partial'` refused.
  - No direct insert on `leads` for `authenticated` still holds.
  - Update trigger refuses changes to `brought_by`, `source`, consent fields.
  - Duplicate: visible → no row, returns id; hidden → row with `duplicate_of`,
    no id of the hidden lead returned.
  - `leads_staff_fields` check rejects a `staff` row without notice fields.
- Contract: `enquiries_for` columns unchanged; `notes`/`referrer_note` never
  returned.
- Edge function (`tests/helpers/edge-function.ts`): invalid phone 400; rate
  limit 429; 409 on visible duplicate; notice mail sent / failure reported
  without losing the lead; ops notice carries no name or phone.
- Component: required fields, User sees no assignee field, both duplicate
  states, the meeting toggle, WhatsApp copy text.
- `permissions.ts` contract: `leads.create` for user/admin/owner matches the gate.

## Rollout

1. Migration + RPC + `create-lead`, no UI. CI green.
2. The notice wording to the compliance adviser; `staff-intake-v1` text
   approved before anyone can use the form.
3. Form and list changes behind `VITE_STAFF_LEADS`; Dorit and one User try it
   for a week.
4. Privacy policy line, then turn the flag on for the agency.
