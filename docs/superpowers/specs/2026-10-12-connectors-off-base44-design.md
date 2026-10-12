# Connectors off Base44 — leads, hand-offs and the chat log on Supabase

Phase 2 of [the platform design](2026-10-10-multi-agent-platform-design.md),
the piece after [claims and the admin's lead writes](2026-10-12-claims-and-lead-writes-to-supabase-design.md).

## Why this piece

Four Base44 functions are still tied to Base44's connector OAuth, the lock-in
`docs/base44-exit/00-inventory.md` §5 calls "the real lock-in":

| Function | Connectors | Callers |
|---|---|---|
| `submitLead` | `googlecalendar`, `outlook`, `googlesheets`, `googledocs` | the site's forms; the `needs_interview` agent |
| `createConsultationEvent` | `googlecalendar`, `outlook` | stale builds only: it logs every call as `client.stale`, and `requestConsultationEvent` has no caller |
| `escalateToHuman` | `googlesheets` | all four agents |
| `logSupportChat` | `googlesheets` | `support_agent`, `procedures_agent` |

Base44 holds the refresh tokens behind those connectors. When they lapse, the
calendar, the sheet and the docs stop without a sound. This piece replaces them
with a credential that does not expire, and moves the four functions to
Supabase Edge. Afterwards Base44 runs only the chat agents, their three
forwarders and `contentAdmin` — the precondition for Phase 3.

## Decisions taken

All taken with the user on 2026-10-12.

- **A Google service account, not our own OAuth app.** The connectors were
  authorised as `govaridorit@gmail.com`, a consumer Gmail account, so
  domain-wide delegation is not available. Dorit shares her calendar and the
  leads sheet with the service account instead. There is no refresh token, no
  consent screen and no Google verification.
- **No per-enquiry Google Doc.** A service account cannot own Drive files in a
  consumer account ("Service Accounts do not have storage quota"). The Doc is,
  by its own comment, an extra copy of the mail Dorit receives; the same text is
  in her mail, the sheet and the leads screen.
- **No Outlook connector.** It wrote into `amielnoy@outlook.com`'s calendar
  (A-54), not Dorit's.
- **Invites by mail.** Dorit works in her Microsoft 365 Outlook calendar, and
  today's events reach it as attendee invitations. A service account cannot
  add attendees on a consumer calendar (`forbiddenForServiceAccounts`). So the
  event is written to her Google calendar without attendees, and each address
  in `CALENDAR_ATTENDEES` gets a standard `.ics` meeting invitation through
  `dorit-mailer`.
- **The agents stay on Base44 until Phase 3.** A Base44 agent can only call a
  Base44 function, so its three tools become thin forwarders to the Edge
  functions. The logic exists once.
- **Supabase is the only store.** As with claims, Base44's `Lead` stops being
  written.

## Scope

**In:**

- **`supabase/functions/submit-lead/`** — the contact form, the detailed
  enquiry, the consultation (its calendar hold is already `submitLead`'s own;
  `createConsultationEvent` only answers stale builds), and the interview's
  partial and complete saves.
  Same input, same validation and guards (`_shared/guard.ts`), same mail.
- **`supabase/functions/escalate-to-human/`** and
  **`supabase/functions/log-support-chat/`** — the same input and behaviour as
  their Base44 versions, minus connectors.
- **`supabase/functions/_shared/`:**
  - `google.ts` — service-account token: a JWT for `calendar.events` and
    `spreadsheets`, signed RS256 with Web Crypto, exchanged at the key's
    `token_uri`, cached until five minutes before it expires. No Google SDK,
    so the in-process harness runs it unchanged.
  - `calendar.ts` — one event on `calendars/{GOOGLE_CALENDAR_ID}/events`,
    without attendees, with today's reminders (popup 60 min, email 720 min).
  - `sheets.ts` — `appendEventRow`, today's columns in today's order.
  - `ics.ts` — a `METHOD:REQUEST` invitation; see *The invitation*.
  - `rest.ts` gains `selectRows` and `updateRow`, with the service key and
    status-only errors, like `insertRow`.
  - Mail, logging, attribution, device label, CORS and guards are reused as
    they are.
- **`dorit-mailer`** — a rendered message may carry `ics` (a string, at most
  20 kB). It is sent to Resend as one attachment, `invite.ics`, with content
  type `text/calendar; method=REQUEST`.
- **The browser** — `VITE_LEAD_FUNCTIONS` (`base44` by default, `supabase` to
  switch), the same convention as `VITE_UPLOAD_PROVIDER`.
  `SupabaseLeadService` then calls `submit-lead` for `submitLead`,
  `submitInterview` and `requestConsultationEvent`, and the hand-off calls
  `escalate-to-human`.
- **The forwarders (a second PR)** — Base44's `submitLead`, `escalateToHuman`
  and `logSupportChat` become about 30 lines each: read the body, POST it to
  the Edge function with the caller's `user-agent`, and return its status and
  JSON unchanged. No entities, no connectors, no mail.
- **A migration for `meetings`.** A booking is keyed today by
  `lead_base44_id`, `not null` and a foreign key to `leads.base44_id`, and
  `enquiries_for` (the personal area) joins on it. A lead written only to
  Supabase has no `base44_id`, so:
  - `meetings.lead_id uuid unique references leads(id) on delete cascade`,
    backfilled from `lead_base44_id`, then `not null`;
  - a `before insert or update` trigger fills `lead_id` from `lead_base44_id`
    when only the latter is given, so Base44's mirror keeps working until the
    switch;
  - `lead_base44_id` becomes nullable;
  - `enquiries_for` joins on `m.lead_id = l.id`.
- **CI** — `deploy-supabase` already deploys every function in
  `supabase/functions`; the three new ones only need their `config.toml`
  entries (`verify_jwt = false`, as `submit-claim`).
- **Smoke** — an empty request to each new function answers `400`, with
  `ready: { db, mailer, google }` all true.

**Out:**

- `createConsultationEvent`, `upsertContact` (dormant), `contentAdmin` (waits
  for the agents), `submitClaim` and `adminLead` stay deployed and untouched.
  The old ones are the rollback until Base44 is switched off.
- The chat agents and their runtime — Phase 3.
- `leads` needs no change: it has every column the mirror writes, and
  `base44_id` is nullable. (`meetings` does — see *In*.)

## Configuration

Function secrets, set by hand — the CI token cannot write secrets:

| Secret | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the service account's JSON key |
| `GOOGLE_CALENDAR_ID` | `govaridorit@gmail.com` |
| `SHEET_ID` | the leads sheet, as Base44 has it today |

One-time setup outside the repo:

1. In Google Cloud: a project, the Calendar and Sheets APIs enabled, one
   service account, one JSON key. Done by the user — it is account creation.
2. Dorit shares her calendar with the service account's address ("make
   changes to events"), and the leads sheet with it as an editor.
3. Vercel: `VITE_LEAD_FUNCTIONS=supabase` (Production and Preview, non-sensitive)
   at rollout step 2.

Revoking access is un-sharing the calendar and the sheet, or deleting the key.

## The lead, end to end

1. Guards, as today: missing name or phone → `400` with `ready`; an oversized
   field → `400`. For `submit-lead` only, the per-recipient confirmation limit
   applies; there is no per-IP limit, because the interview agent calls it
   from Base44's servers.
2. The record. A contact, detailed or consultation enquiry inserts into
   `leads`. An interview first looks for its open record:
   `select … from leads where phone = $1 and source = 'interview' and status = 'partial'
   and created_at > now() - interval '6 hours'`, then keeps only rows that
   `sameInterviewee` accepts (same name or a name prefix, no conflicting
   email), newest first. A match is updated by `id`; otherwise a row is
   inserted. A failed write is the one hard failure: `500`, and nobody is mailed.
3. The booking, if there is one: an upsert into `meetings` on `lead_id`
   (`on_conflict=lead_id`), as the mirror does now on `lead_base44_id`.
4. Best-effort, in parallel: the Google event, the sheet row, the invites.
   Each failure becomes a warning; none of them changes the answer.
5. Mail, as today: the ops mailboxes, Dorit's copy, and the visitor's
   confirmation with its guards. The ops footer reports the event, the sheet
   row and the invites — no longer the Doc or Outlook.

A partial interview stops after step 2 and mails nobody, as today.

## The invitation

- **Recipients:** `CALENDAR_ATTENDEES` — `dorit@govari-fin.co.il`,
  `amielnoy@gmail.com`, `amielnoy@outlook.com`. The existing contract keeps
  that list inside the notification lists.
- **Content:** `VCALENDAR` with `METHOD:REQUEST`, one `VEVENT`:
  - `UID` is the Google event's `iCalUID`, so the invitation and the calendar
    event are the same meeting.
  - `DTSTART` and `DTEND` are in UTC (`…Z`), which avoids a `VTIMEZONE` block.
  - `ORGANIZER` is `govaridorit@gmail.com`, so replies go to the calendar's owner.
  - `ATTENDEE` is the recipient. `SUMMARY` and `DESCRIPTION` match the event.
  - Text is escaped per RFC 5545 (`\`, `;`, `,`, newlines). Lines are folded at
    75 octets, counted in UTF-8 bytes because the text is Hebrew.
- **Sent** only when the Google event was created, so there is a UID to share.
- **Known risk:** some Outlook versions show an attached invitation as a file
  rather than as a meeting. Rollout step 2 includes one real send to
  `dorit@govari-fin.co.il`. If it arrives as a file, it still opens into her
  calendar with one click, and the mail carries the details and the event link.

## Hand-offs and the chat log

- `escalate-to-human` inserts its lead (`source` as today), appends the sheet
  row, and mails as today.
- `log-support-chat` appends the sheet row only, as today.

Both keep their Base44 versions' validation, guards and answers.

## Rollout

Each step is reversible on its own.

1. **Ship dark.** The first PR adds the three Edge functions, the shared
   modules, the mailer field and the browser switch at its `base44` default.
   CI deploys the functions; nothing calls them.
2. **Wire up and switch the site.** The user sets the secrets; Dorit shares
   the calendar and sheet; the smoke answers `ready` all true. Then
   `VITE_LEAD_FUNCTIONS=supabase` on Vercel and a redeploy. One real test
   enquiry and one consultation, checking the row, the mail, the Google event,
   the sheet row and the invite in Dorit's Outlook.
3. **Switch the agents.** The second PR turns the three Base44 tool functions
   into forwarders, live after the Base44 publish. One test chat interview and
   one hand-off from the support agent.

Two weeks with no traffic on the old paths, then the Base44 connector
authorisations are revoked.

## Rollback

- After step 1: nothing to undo.
- After step 2: unset `VITE_LEAD_FUNCTIONS` and redeploy. The site is back on
  the untouched Base44 functions.
- After step 3: revert the forwarder PR and publish.

## Testing

- **One suite, two implementations.** `submit-lead.integration.test.ts` moves
  to `describe.each` over Base44 `submitLead` and Edge `submit-lead`, as the
  claim suite does. The intended differences are their own cases, not skipped
  assertions: no Doc, no Outlook, invites by mail, no Base44 entity writes.
  The same for `escalateToHuman` and `logSupportChat`.
- **The Edge harness** answers the token endpoint, the calendar insert, the
  Sheets append, and PostgREST `select`/`update` on `leads` and inserts into
  `meetings`. Each can be made to fail.
- **Units:**
  - `google.ts` — with a key pair the test generates: the JWT's claims and
    scopes, the signature verified with the public key, the token reused within
    its hour and renewed after.
  - `ics.ts` — `METHOD:REQUEST`, the UID, UTC times, RFC 5545 escaping of
    Hebrew text with commas, semicolons and newlines, folding at 75 octets.
  - `dorit-mailer` — `ics` becomes one attachment of the right type, only on
    rendered messages, and is refused over its size cap.
- **Contracts:**
  - Each forwarder only forwards: no `entities`, no `connectors`, no mail; it
    passes the body and `user-agent` and returns the Edge status and body.
  - No Edge function mentions `googledocs`, `outlook` or `graph.microsoft.com`.
  - The invitation recipients stay within the notification lists.
- **Smoke:** each new function's empty request → `400`, `ready` all true.

## Known risks

- **Outlook and attached invitations** — see *The invitation*.
- **The service account's key is a long-lived secret.** It cannot expire
  unnoticed, which is the point, but it can leak. It lives only in the
  Supabase function secrets, and rotating it is a new key plus one secret update.
- **Sheet column drift.** The service account appends to the same columns as
  today; `appendEventRow` keeps its existing contract test (identical in every
  writer) until the Base44 writers are gone.
