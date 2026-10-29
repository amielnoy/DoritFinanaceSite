# STD-12 — Integration Tests

**Suite:** `integration` · **Runner:** `npm run test:integration` (Vitest, node)
**Location:** `tests/integration/` · **Cases:** 92 declared cases (161 before B2 task 7 retired `INT-CCE-001..003`, `INT-CONTACT-001..017`/`020..023` and `INT-ADL-001..031` and `INT-CNT-001..014`: 69; IDs in section 4; a range such as `X-001..014` counts each ID); `npm run test:integration` runs 704 (848 before task 7) including `it.each` / `describe.each` expansions

---

## 1. Purpose

Execute the Supabase Edge Functions and look at what came out.

Nothing else in the repository runs them. They are Deno modules outside
`tsconfig.json`, and in production they execute on Supabase rather than on the
CI runner — so the type-checker never sees them, the frontend suites never reach
them, and the contract suite reads their *source* rather than their behaviour.

That difference is not academic. A source check confirms `escapeHtml(` sits next
to `firstName`. It cannot tell you whether the escaped value actually reached the
HTML, whether the plain-text copy was escaped by mistake, or whether a bounce to
one recipient silently dropped the other two. These tests can, because they call
the function.

## 2. Environment

`tests/helpers/edge-function.ts` bundles a function's `handler.ts` and the
`_shared` modules it imports with esbuild into one CommonJS chunk and evaluates
it with `fetch` and `Deno` passed in. Supabase REST calls, Google APIs, the
mailer and the limiter are answered and recorded rather than reached, so a run
touches no network, no mailbox and no live data. The harness can be told to fail
any of them — `failGoogle`, `failLimiter`, `overLimit`, `failEmailTo`,
`failFetch`, and the like — which is how the failure paths below are reached.
It also exports `MAILER_URL`, `EmailCall` and `FetchCall`, which the suites share.

`existingLeads` seeds rows the function can find *before* it writes. Without a
readable store the interview lookup always misses, every case takes the create
path, and the upsert in §4.12 would be exercised by nothing.

Its result exposes `status`, `json`, `leads`, `leadUpdates`, `emails`,
`mailTo(address)` and `callsTo(host)`.

## 3. Coverage

| Function | Where it is called from |
|---|---|
| `submit-claim` (Edge) | the claims form: a claim, saved to Supabase and announced |
| `submit-lead` / `escalate-to-human` (Edge) | every form, and the chat's `submitLead` and `escalateToHuman` tools |
| `log-support-chat` (Edge) | the chat function's sweep, once per closed support or procedures conversation |
| `upsertContact` | (retired 2026-10-29, Base44 exit B2 task 7) |
| `adminLead` | (retired 2026-10-29, Base44 exit B2 task 7) |
| `dorit-mailer` | every message the backend sends — a Cloudflare Pages Function, run in-process here |

`createConsultationEvent` is retired (§4.2e).

## 4. Test cases

### 4.1 `submitLead` — the enquiry lands — `INT-LEAD-001..009`

Stores the lead, mails all three recipients and books the calendar in one call;
pins `status` to `new` rather than trusting the caller; gives the agency the
details in **both** the HTML and the text copy, and the operations team a notice
with **none** of them (N-02: the kind, topic, record id, the delivery and a link
to `/admin/leads` — `_shared/ops-notice.ts`); reports the calendar and sheet
outcome in that notice only; sends every copy as HTML with a plain-text twin;
breaks Dorit's copy into titled blocks; and skips the visitor's confirmation when
no address was given.

The last two exist because the staff copy used to go out as text alone, and Gmail
collapsed its newlines into a single running paragraph — eight fields, no line
breaks, unreadable on a phone. `INT-LEAD-007/008` state the fix as something that
can fail.

### 4.2 `submitLead` — a name that is really a payload — `INT-LEAD-010..015`

The confirmation is sent from the agency's verified domain to an address the
visitor typed, and the visitor also supplies the name and the topic. Unescaped,
that is a phishing message carrying the agency's branding and the attacker's
link — not an XSS in the sender's own browser.

So: no live markup reaches the visitor's HTML mail, or the staff HTML either; the
payload survives as escaped text a client displays; a form whose phone is a
payload is refused before anything is written (D-01), and an interview's —
the one source not refused for its phone's shape — is stripped to digits
before it reaches an `href`; the plain-text copy is left
unescaped on purpose, because escaping it would only make the mail unreadable;
and the record stores the raw value, so it matches what was submitted.

### 4.2a `submit-lead` — how often (review 2026-10-15) — `INT-LEAD-110..113`

A public door with no sign-in: each caller is counted by a hash of their address, like submit-claim's `claim-ip`. The staff's mail and the diary are capped for every caller together, so a flood from many addresses cannot fill Dorit's inbox. Past the cap the lead is still saved.

| ID | Title | Expected result |
|---|---|---|
| INT-LEAD-110 | "counts the caller by a hash of the address, never the address itself" | `lead-ip:<64 hex>`; the address appears in no limiter key |
| INT-LEAD-111 | "refuses a caller over the hourly limit, and writes and mails nothing" | 429 with `rid`; no lead, mail or invitation |
| INT-LEAD-112 | "past the hourly staff cap, saves the lead and confirms to the visitor, but mails no staff and books nothing" | 200; one lead; `staff_notify_capped`; the visitor's confirmation goes out; no mail to Dorit or ops; no invitation; no calendar call |
| INT-LEAD-113 | "asks the staff cap once per enquiry, and not for a partial interview" | One `lead-staff-notify` per full enquiry; none for a partial one |

### 4.2b `escalate-to-human` — how often, and what it accepts (review 2026-10-15) — `INT-ESC-030..041`

A hand-off that does not reach a person is a regulatory failure, so the limits never stand between an urgent reason and the staff. A chat's hand-off arrives from the chat function's server, so one address stands for all its visitors: the per-caller limit is generous.

| ID | Title | Expected result |
|---|---|---|
| INT-ESC-030 | "holds back the staff mail over the hourly cap, and still records the hand-off" (changed) | `mail.skipped` logged at **error** level, so it alerts; the lead and the sheet row are written |
| INT-ESC-031..032 | "never holds back an urgent hand-off (%s), whatever the caps say" | `complaint`, `privacy_request` with both caps exceeded: 200, staff mailed |
| INT-ESC-033 | "refuses a caller over the hourly hand-off limit, for a reason that is not urgent, writing nothing" | 429 with `rid`; `escalate-ip:<64 hex>`; no lead, no mail |
| INT-ESC-034..038 | "refuses a %s longer than its ceiling, writing and mailing nothing" | name 80, phone 30, topic 200, agent 60, email 254: 400 |
| INT-ESC-039 | "drops an address that is not one, and still hands over" | 200; `email_invalid`; the lead's email empty; the injected recipient mailed nowhere |

### 4.2c `log-support-chat` — how often (review 2026-10-15) — `INT-SUPPORT-020..022`

| ID | Title | Expected result |
|---|---|---|
| INT-SUPPORT-020 | "counts a caller by a hash of the address, and every caller together (review 2026-10-15)" | `support-ip:<64 hex>` (60 an hour), then `support-log` (300 an hour, above the sweep's 40); the address appears in no key |
| INT-SUPPORT-021..022 | "refuses past the %s limit with 429 and rid, and writes no row" | Either limit: 429 with `rid`; no sheet row |

### 4.2d `submit-claim` — whose address is counted (review 2026-10-15)

`submit-claim-edge.integration.test.ts` "how often" changed. "does not limit a request with no forwarded address" became "limits a request with no address under the one key such callers share": `claim-ip:` + the hash of `no-address`. A new case, "counts the address the gateway appended, not one the client put first", checks `6.6.6.6, 203.0.113.7` → the hash of `203.0.113.7`. The same `clientIp` serves submit-lead, escalate-to-human, log-support-chat, masleka-code and the chat. The `ip &&` guards that skipped a limit without an address are gone.

### 4.2e `createConsultationEvent` — retired — `INT-CCE-001..003`

**Retired 2026-10-29** — Base44 exit B2 task 7: the in-process Base44 harness and `create-consultation-event.integration.test.ts` are deleted with the `base44/` folder; no Edge Function replaces it

| ID | Title | Expected result |
|---|---|---|
| INT-CCE-001 | (retired 2026-10-29, Base44 exit B2 task 7: the in-process Base44 harness and `create-consultation-event.integration.test.ts` are deleted with the `base44/` folder; no Edge Function replaces it) | — |
| INT-CCE-002 | (retired 2026-10-29, Base44 exit B2 task 7: the in-process Base44 harness and `create-consultation-event.integration.test.ts` are deleted with the `base44/` folder; no Edge Function replaces it) | — |
| INT-CCE-003 | (retired 2026-10-29, Base44 exit B2 task 7: the in-process Base44 harness and `create-consultation-event.integration.test.ts` are deleted with the `base44/` folder; no Edge Function replaces it) | — |

### 4.2f `submit-lead` — an interview's saves meet by the conversation (review 2026-10-15)

A later save (complete, or the questionnaire's details) updates an earlier one only if both name the same `conversationRef`, which is stored as `leads.conversation_ref` (migration `20261101000000`). Nothing else matches: not the phone, not the name, not the address. A save without a reference is a new lead.
- **The senders:** the chat tool sends `chat:<conversation id>` and the needs wizard one `wizard:<uuid>` per run (rows from before the Base44 exit may carry `base44:<conversation id>`).
- **Fixtures:** the "partial interview" and "details" suites carry `REF`, and the leads they should adopt carry the same `conversation_ref`.
- **"whose interview it is", rewritten:**
  - the same number and name from another conversation is not adopted;
  - nothing is adopted without a reference;
  - a malformed reference is ignored and not stored;
  - a completed interview is not reopened;
  - the visitor's own interview is completed by its reference, whatever name it now gives;
  - a new interview lead stores its reference.
- **Changed:** "does not fill in another run's lead on the same phone and name" (details), and "does not adopt a Base44-era partial save by phone and name" (Edge-only).

### 4.3 `submitLead` — identifiers a visitor volunteered — `INT-LEAD-016/017`

An ID number or card number in a model-written summary is redacted before anyone
receives it, in every copy, and the text says a value was omitted rather than
deleting it silently.

### 4.4 `submitLead` — what survives a failure — `INT-LEAD-018..024`

No name or no phone refuses and writes nothing. Neither does a phone Dorit
cannot call back (`abc`, `123`, a foreign number) from any source but the
interview, while an Israeli mobile or landline, with or without `+972`, is
stored (D-01, manual test 2026-10-14); the claim's Edge function refuses the
same numbers (`submit-claim-edge`, "what it refuses"). A failed entity write fails
loudly and mails nobody — an enquiry nobody can find is worse than an enquiry
that bounced. Past that point everything is best-effort: a bouncing mailbox, a
refusing calendar and a missing connector token each leave the lead stored, the
other recipients told, and the outcome named in the operational appendix.

### 4.5 `submitLead` — the calendar event — `INT-LEAD-025..030`

Books nothing for a quick contact form; honours an explicit `scheduledAt`, **at
the hour it names**; falls back to tomorrow morning when no time was agreed;
asks for a reminder and sets the Israel timezone; authorises with the connector
token and never returns it to the caller.

The hour is the part that matters and the part this used to miss: the assertion
was `toContain("2026-10-01")` — the day only — and passed just as happily on
`2026-10-01T14:00:00.000Z`, which is what the code was sending. An offset in the
string overrides the separate `timeZone` field in both Graph and Google, so a
14:00 meeting was booked at 17:00 and the suite agreed. It now pins the exact
wall-clock string and the absence of any offset.

### 4.6 `submitLead` — a finished introduction interview — `INT-LEAD-031..038`

The interview agent used to end at `Lead.create`: the approved profile was
stored and nobody was told. It ends at `submitLead` now, under
`source='interview'`, and these run that path. Both staff copies go out as HTML
with a plain-text twin and carry the whole profile in each half; the subject and
the headline both name it an interview rather than an enquiry; the profile gets
its own heading in the layout; the record keeps the `[ראיון היכרות]` marker and
the interview source; and — when the agent sends no `scheduledAt` — no calendar
slot is booked and the operations mail says **"לא נקבע מועד"** rather than "לא
רלוונטי", which read like a decision and is how this went unnoticed. A further
case books the slot an interview *did* agree, at the hour it agreed. Two cases cover what is specific to a model-written record: the profile
itself passes through `redact()`, unlike a message a visitor typed, and the
visitor's own confirmation names the topic without mailing the bullets back. A
last case pins that the staff copies still go out when no address was given.

### 4.6a `submitLead` — what it stores about the meeting — `INT-LEAD-080..087`

*(Ids out of sequence on purpose: these cases belong here by subject, but taking `039..048` would have renumbered four later sections and every id they are referenced by.)*

The agreed time used to be stored nowhere: no field on the Base44 `Lead`, no
column in Supabase, no table of its own — it existed only as an argument on its
way to a calendar API. These pin the four meeting columns on `leads`, the
`meetings` row keyed on the lead, that the row carries no name, phone or email
(the lead is one join away and cascades on delete), and that the calendar
outcome is written back beside the intent — including the case where an
interview agreed nothing, which is the shape the original fault had.

Two of them are about timezone rather than storage: 10:00 Israel must be stored
as `07:00Z` in September and `08:00Z` in January. Writing the wall-clock string
into a `timestamptz` would have Postgres read it as UTC, reproducing the same
three-hour shift as §4.5 — except stored, and with no log line to catch it.

These are also the first tests in the repo to exercise the Supabase mirror at
all. It short-circuits unless `SUPABASE_URL` and the service key are set, and no
test had ever set them, so every earlier case ran with mirroring silently off.

### 4.6b `submitLead` — the personal area's view — `INT-LEAD-090..092`

Task 2 adds three nullable columns to `leads`: `summary text`, `profile jsonb`,
and `track_label text`, populated from the interview's redacted summary and
structured answers. These cases pin that the summary the mail showed is stored
unchanged; that the profile, like the mail's text, is never more than what was
redacted and never less; that non-interviews store no profile at all, leaving the
fields null rather than present-but-empty; and that a 9-digit Israeli ID number
in the profile does not survive redaction.

### 4.7 `submitLead` — the interview schema — `INT-LEAD-039..048`

The interview hands over named fields rather than a paragraph, under a track
derived from the visitor's goal, and these run all of it. Every field of a track
renders with its label and the track names itself; a key the model invented is
dropped from both the mail and the record; a field belonging to another track
does not render; an unanswered field is omitted rather than printed as a dash;
an identifier echoed into a field is redacted everywhere; the record stores the
same fields that were mailed, so the two cannot disagree. Two cases cover the
rest of the contract: the collect-not-advise declaration rides on every
interview to Dorit's copy (the operations notice carries no interview), and the pre-schema free-text path still works —
that is what a mid-deploy agent is still sending.

### 4.8 `submitLead` — every declared track — `INT-LEAD-049..060`

One case per track in `INTERVIEW_TRACKS`, each rendering a full profile and
asserting that the track's label and every value it carried reach the agency in
both halves of the mail and the stored record. A thirteenth case reads the track
names out of the function and fails unless this file carries a fixture for each
— that guard exists because two tracks were covered and five were not, which is
the failure a table invites: the schema grows, the suite stays green, and nobody
notices that `savings` has never been rendered once.

Three further cases cover a track that is missing or invented: the common fields
still arrive, track-specific fields are dropped rather than guessed at, and a
track name the model made up behaves exactly like none. A last case escapes
markup placed inside a profile value — the same defect class as the hostile-name
case in §4.2, one layer further in, because the profile is model-written text
interpolated into HTML that staff open.

### 4.9 `submitLead` / `escalateToHuman` — the operations mailboxes — `INT-LEAD-061..064`, `INT-ESC-018..020`

The operations copy goes to more than one mailbox. Since N-02 it is a notice, not
the enquiry: every mailbox receives the identical notice — a link to
`/admin/leads`, no visitor — while the agency's copy is the whole enquiry and
free of the delivery report. A hand-off tells the team it happened and why,
never who asked or what they said (`INT-ESC-020`). Each
mailbox is its own delivery attempt, verified from both directions — the first
bouncing must not cost the second, nor the second the first. The risk being
pinned is not the happy path but a future simplification: one `try` around the
whole loop would let the first bounce swallow the rest of the list silently.
For escalations the same cases add that a partial delivery still reports
`notified: true`, since an escalation that reached nobody is a regulatory
failure and one that reached two of three is not.

### 4.10 `dorit-mailer` — the one endpoint a stranger can reach — `INT-MAIL-001..015`

Everything else on this site needs a session or a form; the mailer
answers a POST from anyone who knows its URL, and sends from the agency's
verified domain when it does. So the first block is about refusing, and it
covers every way in: a rendered message with no token and with the wrong token,
a caller-named recipient on any payload type, an ordinary `contact` submission,
an `intake` submission — the browser-facing types are authenticated too, because
nothing posts here from a browser and an open path with no user is only a
surface — and, the one that matters most, a deployment with no `MAILER_TOKEN`
configured at all, which must fail closed rather than open.

The rest pin that the sender identity comes from the environment and not from
the caller, that Reply-To is the agency rather than the visitor, that a rendered
body passes through untouched (rebuilding it would discard the templates,
escaping and `redact()` the Edge functions apply), and that a form submission
fans out to every configured mailbox. Failure cases: one rejected mailbox still
reports success for the others, no mailbox taking it reports 502, and the
provider's error text — which can quote the API key — never reaches the
response.

The Worker is loaded and executed in-process, the way the Edge harness loads
a handler. Nothing else in the repository runs this file.

### 4.11 `submitClaim` — the claim lands — `INT-CLAIM-001..013`

Previously a known gap, now executed. Stores the claim and tells the agency,
both operations mailboxes and the reporter; gives Dorit the whole report and the
operations mailboxes a notice without the reporter's details (N-02); pins `status` and `source` rather than taking them from the caller;
says so when no documents were attached; skips the confirmation when no address
was given. The mailbox cases mirror §4.9. The failure cases pin that a claim
nobody stored fails loudly and mails nobody — worse than an unmailed claim,
because the reporter believes it is in hand — and that a bounced confirmation
costs the message and never the record. A last case escapes markup in a name
arriving from a public form.

### 4.11b `submitLead` — the row it appends to the sheet — `INT-LEAD-079..084`

The Google Sheets log existed and had never run: `SHEET_ID` was a hardcoded
empty string, so `appendEventRow` returned before touching the network and every
case took that branch. The column order was pinned by a contract test; what
landed in a row was pinned by nothing — and an interview would have written a
name and a phone number with the interview missing.

These append for real against a stubbed Sheets API: one row in the pinned column
order, the interview's track, derived meeting topic and profile text in the
cells that were empty, and an identifier redacted before it reaches the sheet —
which matters more here than anywhere, since the sheet is the copy that outlives
deleting the Lead. Two more pin that no sheet is touched when none is
configured, that a failed append never costs the enquiry, and that a *partial*
interview writes no row at all: logging someone who started and left would
retain their details in the one place a deletion request does not reach.

### 4.11d `submitLead` — the links in the copy Dorit reads — `INT-LEAD-088..093`

The summary document and the sheet row were linked from the operational
appendix, and the appendix is deliberately suppressed in the agency copy. So the
operations team had the addresses and the person acting on the enquiry did not —
she found the document by searching Drive.

The cause was ordering, not the template: her mail went out immediately after
the save, before the calendar, the sheet row and the document existed, so there
was no address to put in it. Her send now happens after all three.

These pin both links in both halves of her mail; that they arrive without the
rest of the appendix, record id included; that the operations copy still prints
each address exactly once rather than twice; that a missing sheet or a failed
document omits its row instead of rendering a dead link; and — the case that
guards the fix itself — that her send really is ordered after both writes. The
same move is why the sheet, document and calendar fetches each carry an
`AbortSignal.timeout`: an unresponsive Google used to delay an appendix, and
would now delay the one message somebody is waiting on.

### 4.11d `submitLead` — what an interview puts in the sheet — `INT-LEAD-094..099`

Everything the interview collected landed in `תקציר` as free text: life stage,
goal, concern, clearinghouse interest, employer, seniority, products, fees —
eight structured answers flattened into one cell. The sheet could display them
and do nothing else with them. It could not be asked *who wants a clearinghouse
pull* or *which interviews finished*, which are the two questions it exists for.

The four fields asked in every interview now have columns, because those are the
ones comparable across interviews; track-specific fields stay in the summary,
since a column filled in a third of rows is worse than prose. Two more carry the
agreed slot — distinct from the free-text `מועד מבוקש`, and the only one that
sorts — and the completeness count.

These pin each common field in its own cell, the slot in the diary's format,
the completeness line, that a non-interview leaves the new cells **empty rather
than absent** (a short row slides every later column under the wrong heading),
and that the full profile still reaches the summary so nothing was traded away
for the columns. The row's length is checked against the function's own header
list rather than a number copied beside it.

Two defects fixed alongside, both in the copy that outlives deleting the Lead:
a phone number was stored as a number, losing its leading zero, and the
timestamp was UTC in a sheet read in Israel.

### 4.11c `escalateToHuman` — the notification is readable — `INT-ESC-020..028`

The handover went out as plain text only, and clients folded it into one running
line: reason, name, phone and the conversation summary with no separation. It is
the message Dorit opens on a phone to decide whether to call somebody back, so
that was the one thing it had to support. Same defect as A-14, fixed for
enquiries and left here.

These assert the layout, not only the content: HTML with the text alongside
rather than instead of it, four titled blocks, the phone rendered as a `tel:`
link, an urgent reason marked so a complaint does not look like an out-of-scope
question, and the plain statement that nothing was stored — because in that case
the mail is the only record of the enquiry. Two more cover what rendering
introduced: a name that is really a payload is escaped, and redaction still
holds now the summary appears twice, since a value stripped from the HTML but
not the text would be the worst of both.

### 4.12 `submitLead` — a partial interview, and the upsert — `INT-LEAD-065..072`

Contact details used to be collected last, so a visitor who answered four
questions and closed the tab left nothing at all. The agent now saves once as
soon as it has a name and a number, and again at the end. These pin that the
partial save stores the row and mails nobody — mailing on everyone who starts
answering would turn the inbox into noise — and that the completing call
*updates that row* rather than creating a second, which is also what stops a
visitor running the interview three times from producing three leads.

Four cases pin what the lookup must not adopt: an interview older than the
six-hour window, another phone number's interview, a lead that was never an
interview, and — when the lookup itself fails — a created row rather than a lost
one, because a duplicate is a nuisance and a dropped interview is not
recoverable. A last case pins that every other source still takes the create
path untouched.

### 4.12b `submit-lead` — the questionnaire's details, after its lead was saved — `INT-LEAD-100..105`

The short questionnaire (2026-10-14) saves its lead — and mails Dorit — at its
second step, then sends its four optional answers as `stage: "details"`. These
pin that the details fill in that lead (the visitor's: same phone, same person,
an interview, saved as `new` within 30 minutes) with one follow-up mail whose
subject starts "פרטים נוספים — ", and that anything else — no recent lead, an
older one, another person's, a non-interview — is saved as a lead of its own
rather than lost. 

| ID | Title |
|---|---|
| INT-LEAD-100 | "fills in the visitor's lead from a few minutes ago instead of creating a second" |
| INT-LEAD-101 | "tells Dorit once more, under a subject that says these are further details" |
| INT-LEAD-102 | "saves the details as a lead of their own when there is no recent one to fill in" |
| INT-LEAD-103 | "does not fill in a lead older than half an hour" |
| INT-LEAD-104 | "does not fill in another person's lead on the same phone" |
| INT-LEAD-105 | "does not fill in a lead that was never an interview" |

### 4.12c `submit-lead` — urgency and the clearinghouse report — `INT-LEAD-106..108`

The questionnaire's `urgency` and `clearinghouse_report` (2026-10-14) are in the
profile and the mail (`INTERVIEW_EXTRA`), outside the completeness count.

| ID | Title |
|---|---|
| INT-LEAD-106 | "puts 🔴 דחוף at the head of Dorit's mail when the visitor said it is urgent" |
| INT-LEAD-107 | "leaves the subject as it was for any other urgency" |
| INT-LEAD-108 | "records whether a clearinghouse report exists, without taking it for the pull" |

### 4.13 `submitLead` — how complete the interview was — `INT-LEAD-073..075`

A thorough seven-field interview and a two-answer one used to produce mails that
looked alike at a glance. The mail now carries "3 מתוך 7 שדות נענו", and
separates a field the visitor did not know from one that was never asked: the
first is a fact about the visitor, the second is a gap in the interview, and
they are not interchangeable to someone preparing a meeting.

### 4.14 `submitLead` — the topic the interview no longer asks for — `INT-LEAD-076..078`

`topic` and `profile.concern` were the same fact supplied twice, and after the
schema change `topic` was not rendered in the staff mail at all. It is now
derived from the concern, falling back to an explicit `topic` when no concern
was recorded, and left alone for every other source.

### 4.15 `escalateToHuman` — handing over — `INT-ESC-001..005`

Records the escalation and notifies both inboxes, stamps the record with the
consent wording the visitor was shown, always hands the contact channels back to
the agent whatever else failed, and flags the reasons that must not wait in a
queue.

### 4.16 `escalateToHuman` — a reason the model made up — `INT-ESC-006..010`

The reason arrives from a language model, so it is clamped to the declared
vocabulary. `__proto__` and `constructor` are clamped to `uncertain` rather than
resolving off the prototype chain; anything simply invented, or missing, is
clamped too; a declared reason is kept exactly as given.

### 4.17 `escalateToHuman` — redaction and precedence — `INT-ESC-011..017`

Identifiers are redacted before the record is written *and* before the
notification is sent, while an ordinary summary is left alone. The notification
outranks the record throughout: a visitor with no contact details, an invalid
phone number, or a failed write still produces a notification, and the agent
still receives contact channels even when every mailbox bounces. The handing
agent is named, so a pattern is visible later.

### 4.18 `upsertContact` — retired — `INT-CONTACT-001..017`

**Retired 2026-10-29** — Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness; the function was dormant and has no Edge port

| ID | Title | Expected result |
|---|---|---|
| INT-CONTACT-001..017 | (retired 2026-10-29, Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness; the function was dormant and has no Edge port) | — |

### 4.18a `upsertContact` — retired — `INT-CONTACT-020..023`

**Retired 2026-10-29** — Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness

| ID | Title | Expected result |
|---|---|---|
| INT-CONTACT-020 | (retired 2026-10-29, Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness) | — |
| INT-CONTACT-021 | (retired 2026-10-29, Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness) | — |
| INT-CONTACT-022 | (retired 2026-10-29, Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness) | — |
| INT-CONTACT-023 | (retired 2026-10-29, Base44 exit B2 task 7: `upsert-contact.integration.test.ts` is deleted with the Base44 harness) | — |

### 4.19 `log-support-chat` — what was actually asked — `INT-SUPPORT-001..012`

The event log records that someone got in touch. It does not record the question, which is the only one of the three that
can say what to write next or where the agent keeps stopping.

Recording a conversation is also the most intrusive thing on this site, so most
of these cases are about restraint: the transcript is redacted and capped, the
outcome comes from a fixed list rather than being phrased freshly by the model
each time, and a call carrying nothing to record is refused rather than writing
an empty row. The phone column is normalised (`972…`, `050-…` and `+972 …` read
as one number). The site chat has no number, so today that column is always
empty — it is pinned anyway, so a channel that does carry one cannot write it in
a second spelling.

Failure is the point of the last three. The agent is told not to report this
call to the visitor, so the function has to leave it nothing to report: a
refusing sheet, an unauthorised connector and a missing `SHEET_ID` all answer
`200`, and the conversation the visitor already had is unaffected.

### 4.21 `adminLead` — retired — `INT-ADL-001..031`

**Retired 2026-10-29** — Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites

| ID | Title | Expected result |
|---|---|---|
| INT-ADL-001..004 | (retired 2026-10-29, Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites) | — |
| INT-ADL-005..020 | (retired 2026-10-29, Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites) | — |
| INT-ADL-021..022 | (retired 2026-10-29, Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites) | — |
| INT-ADL-023 | (retired 2026-10-29, Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites) | — |
| INT-ADL-024..030 | (retired 2026-10-29, Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites) | — |
| INT-ADL-031 | (retired 2026-10-29, Base44 exit B2 task 7: `admin-lead.integration.test.ts` is deleted with the Base44 harness; the admin writes go to Supabase directly and are covered by the unit and e2e suites) | — |

### 4.22 `submit-claim` — the claim, on Supabase — `INT-CLM-EDGE-001..011`

`submit-claim.integration.test.ts` runs the Edge Function through the claim cases
(`INT-CLAIM-001..013`).
`submit-claim-edge.integration.test.ts` holds what only the
Edge Function does: the row it writes (today's fields, no Base44 id, `leadId`
is its uuid), the service-key insert ahead of any mail, a non-JSON body
answered as 400 with nothing touched, missing Supabase credentials as 500 with
no mail, a database refusal that quotes the row kept out of the log, and the
CORS answers — a preflight that does nothing, the site's origin on every
answer, none for a stranger's.

### 4.23 The lead functions on Supabase

`submit-lead.integration.test.ts`, `escalate-to-human.integration.test.ts` and
`log-support-chat.integration.test.ts` run their cases through the Edge
functions. Behaviour particular to the Edge functions has its own cases: Edge `submit-lead` writes the Google event and sheet row
through the service account (the event in the calendar `GOOGLE_CALENDAR_ID`
names, without attendees), mails Dorit and `amielnoy@outlook.com` an `.ics`
invitation by mail instead of using Outlook — independently of the Google event
— and answers an empty request with `400` and
`ready: { db, mailer, google }`; `log-support-chat` answers `200` with
`sheet: "לא מוגדר"` when `SHEET_ID` is unset; each Edge function has a "what
only it does" block. `dorit-mailer.integration.test.ts` adds the invitation
cases: one `text/calendar` REQUEST attached to the Resend call, none without
`ics`, one over 20 kB refused rather than clipped, and `ics` ignored on other
message types. The shared Edge modules have unit tests: `edge-google.test.ts`
(service-account token: two scopes, cached for the hour, failure named without
the endpoint's words), `edge-ics.test.ts` (the invitation: UTC, escaping,
75-octet folding, size limit) and `edge-google-apis.test.ts` (calendar event,
sheet append — `sheetCell` stores a leading-zero number, and any value that
starts with `=`, `+`, `-`, `@`, a tab or a carriage return, as text behind a
leading apostrophe, so a visitor's words never run as a formula — PostgREST helpers). The live smoke asks `submit-lead` and
`log-support-chat` an empty question in production.

Invitations independent of the Google event — `INT-INV-001..007`, in the Edge
"what only it does" block of `submit-lead.integration.test.ts`:

| ID | Title | Expected result |
|---|---|---|
| INT-INV-001 | "sends both with a local UID and a warning when the Google call fails; the lead is saved" | 200; one lead; `.ics` to Dorit, `amielnoy@outlook.com` and the Gmail fallback with `UID:lead-<id>@govari-fin.co.il`; `calendar_google_failed`; ops mail `אירוע ביומן Google לא נוצר`, `נשלחו 3/3` |
| INT-INV-002 | "sends both, with no Google request for the event, when GOOGLE_CALENDAR_ID is unset" | 3 invitations (Gmail fallback included); no call to `/calendar/v3/calendars/` |
| INT-INV-003 | "keeps the other invitation, says 1/2 and saves the lead when one invitation fails" | 200; lead saved; invitation to Dorit only; `נשלחו 1/2`; an `invite_failed` warning |
| INT-INV-004 | "is organised by the site, never by an attendee" | ORGANIZER `notifications@mail.govari-fin.co.il` (the mailer's From), not an attendee |
| INT-INV-005..006 | "puts a 10:00 Israel slot at the right instant in %s" (2) | Summer `07:00Z`–`07:30Z`; winter `08:00Z`–`08:30Z` |
| INT-INV-007 | "reports ready.google from the service account alone" | `ready.google: true` with `GOOGLE_CALENDAR_ID` unset |

With the Google event created, the one existing case asserts that the two
invitations carry the event's own UID and that none goes to `amielnoy@gmail.com`.

### 4.24 `contentAdmin` — retired — `INT-CNT-001..014`

**Retired 2026-10-29** — Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`

| ID | Title | Expected result |
|---|---|---|
| INT-CNT-001 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-002 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-003 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-004 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-005 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-006 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-007 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-008 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-009 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-010 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-011 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-012 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-013 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |
| INT-CNT-014 | (retired 2026-10-29, Base44 exit B2 task 7: `content-admin.integration.test.ts` is deleted with the Base44 harness; the Edge `content-admin` is covered by `content-admin-edge.integration.test.ts`) | — |

### 4.25 `masleka-code` — the client hands over the code — `INT-MSKCODE-001..036`

`tests/integration/masleka-code.integration.test.ts`, through the in-process
harness with its clearinghouse fakes (`MaslekaFake`). The function reads the
request's id by the token's hash, seals both values with that id and the field
as context (`<id>:code`, `<id>:id`), then accepts through one conditional PATCH
that repeats the read's conditions (`token_hash`, `status=eq.invited`,
`token_expires_at=gt.<now>`) plus the id, so a submission that lands in
between — or any replay — matches nothing.

A failure says what is known (decision 2026-10-14): before the accepting
write, or a write the database refused with a status of its own
(`update_http_4xx`/`500`), nothing was stored — `not_saved`, and the page asks
the client to send again; a write cut off on the way may have landed —
`failed`. Either way, and when the key is missing, every staff member gets an
alert, at most once an hour per link (`masleka-alert:<hash>`, after an
in-isolate check) and five an hour in all (`masleka-alerts`).

| ID | Title | Expected result |
|---|---|---|
| INT-MSKCODE-001 | "answers disabled and touches nothing while MASLEKA_ENABLED is unset" | 404 `disabled` + rid; no fetch at all, no mail; row unchanged |
| INT-MSKCODE-002 | "stays dark for anything but exactly true, before reading the body" | `TRUE`, `1`, `yes`, `true1` with a non-JSON body: 404 `disabled` (not `link_invalid`); no fetch |
| INT-MSKCODE-003 | "stores both values sealed and moves the request to code_received" | Answer keys are `ok`, `rid` in that order; both open with their own context; `id_last4` 0018 |
| INT-MSKCODE-004 | "binds each sealed value to its request and its field" | The code under `<id>:id`, the ID under `<id>:code`, the code under another row's id: `sealed_invalid` |
| INT-MSKCODE-005 | "pads a short ID before sealing it" | `00018` stored as `000000018` |
| INT-MSKCODE-006 | "accepts only through one conditional update that names its columns and carries nothing the caller typed" | One PATCH; every `masleka_requests` call filters `token_hash=eq.<sha256>`, `status=eq.invited`, `token_expires_at=gt.<ISO>`; `select=` names columns, never `*`, a ciphertext or `token_hash`; no token, code or ID in a URL; the PATCH's keys are exactly id, select, status, token_expires_at, token_hash |
| INT-MSKCODE-007 | "never echoes the code or the ID — not in the answer, not in any mail" | Neither value in the answer or any mail |
| INT-MSKCODE-008 | "never writes the code, the ID, the token or the address to a log line" | Across success, `bad_id`, `bad_code` and a DB failure: no code, ID, token, token hash, IP or client name in any line |
| INT-MSKCODE-009 | "tells every staff member, once each" | One notice per staff address; subject "קוד מסלקה חדש לטיפול — רונית מזרחי" |
| INT-MSKCODE-010 | "falls back to Dorit's mailbox when the staff list cannot be read, and still accepts the code" | 200; one notice to dorit@ |
| INT-MSKCODE-011 | "still accepts the code when a notice cannot be delivered" | 200; row `code_received`; the other notice still sent |
| INT-MSKCODE-012 | "a second submission of the same link is refused and changes nothing" | 404 `link_invalid`; row identical to after the first; first ciphertext kept; no mail |
| INT-MSKCODE-013 | "loses the race to a submission that lands between its read and its update" | The PATCH is sent and matches nothing: 404 `link_invalid`; the winner's values kept; no mail |
| INT-MSKCODE-014 | "refuses an expired link" | `link_invalid`; row unchanged |
| INT-MSKCODE-015 | "refuses a link whose request was already submitted" | `link_invalid` |
| INT-MSKCODE-016 | "refuses a well-formed token nobody issued" | `link_invalid` |
| INT-MSKCODE-017 | "refuses the old token once the reminder has rotated the link" | 404 `link_invalid`; row unchanged |
| INT-MSKCODE-018 | "answers expired, used, rotated and unknown links in exactly the same words" | Expired, `code_received`, `submitted`, `expired`, rotated, unknown and malformed: each 404 `{ error: 'link_invalid', rid }` and nothing else; no PATCH; no mail |
| INT-MSKCODE-019 | "refuses a malformed token without asking the database" | No `masleka_requests` call |
| INT-MSKCODE-020 | "refuses an ID that fails the check digit, before storing anything" | 400 `bad_id`; no `masleka_requests` call |
| INT-MSKCODE-021 | "refuses a code that cannot be one" | 400 `bad_code`; no `masleka_requests` call |
| INT-MSKCODE-022 | "answers a non-JSON body as a bad link" | `link_invalid` |
| INT-MSKCODE-023 | "counts every call against its address and its link, never by the raw values" | `allow_submission` with `masleka-ip:<sha256(ip)>` 3600/10, then `masleka-link:<token hash>` 3600/5 |
| INT-MSKCODE-024 | "refuses a flood from one address" | 429 `rate_limited`; no PATCH |
| INT-MSKCODE-025 | "refuses a flood on one link" | 429 `rate_limited`; no PATCH |
| INT-MSKCODE-026 | "stores nothing when there is no key to seal with, or the key is not 32 bytes" | Missing, 16-byte and non-base64 key: 503 `unavailable` + rid; no `masleka_requests` call; row unchanged; one alert per staff address, "מסירת קוד מסלקה נכשלה", naming `MASLEKA_KEY` |
| INT-MSKCODE-027 | "reports a refused write as not saved, with its rid and nothing else" | PATCH answers 500: exactly `{ error: 'not_saved', rid }`; row unchanged |
| INT-MSKCODE-028 | "answers the browser's preflight and does nothing else" | 204; no fetch |
| INT-MSKCODE-029 | "answers not_saved when the link cannot be read, and tells every staff member once" | The read answers 500: 500 `{ error: 'not_saved', rid }`; one alert per staff address, no name; no PATCH |
| INT-MSKCODE-030 | "names the client in the alert when the link was read before the write was refused" | Subject "מסירת קוד מסלקה נכשלה — רונית מזרחי"; "התבקש לנסות שוב"; the rid |
| INT-MSKCODE-031 | "answers failed, never not_saved, when the write was cut off and may have landed" | PATCH throws (no answer): 500 `{ error: 'failed', rid }`; alert says "לא ברור אם הקוד נשמר" |
| INT-MSKCODE-032 | "puts no code, ID, token or link in an alert" | For all four failure paths: no code, ID, token, token hash or `masleka#t=` in any mail |
| INT-MSKCODE-033 | "alerts at most once an hour per link, and at most five times an hour in all" | `allow_submission` with `masleka-alert:<token hash>` 3600/1 and `masleka-alerts` 3600/5 |
| INT-MSKCODE-034 | "sends no alert for a retry inside the hour, and still tells the client it did not go through" | Either limit over: `not_saved`, no mail |
| INT-MSKCODE-035 | "still answers not_saved when no alert can be delivered" | Every staff address refused: 500 `not_saved` |
| INT-MSKCODE-036 | "raises no alert for what the client got wrong: a bad link, ID or code, or too many tries" | Unknown token, bad ID, bad code, link flood: no mail, no `masleka-alert` limiter call |

### 4.26 `masleka-reveal` — a member decrypts one value — `INT-MSKREV-001..024`

`tests/integration/masleka-reveal.integration.test.ts`, through the in-process
harness with its clearinghouse fakes (`MaslekaFake`: sessions for
`GET /auth/v1/user`, per-user roles, lead assignments and the
`can_work_request` RPC asked under the caller's token). Every call proves its
caller (`sessionCaller`, then `allowRequest`: the request's lead's assignee, or
the creator of a lead-less request, and Admin+); the request is read by its UUID-checked id and agency 1
with named columns; the access row (who, which request, which field — its
agency copied from the request) is written before the value is unsealed with
`<id>:<field>` as its context, and a failed write reveals nothing.

| ID | Title | Expected result |
|---|---|---|
| INT-MSKREV-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 exactly `{ error: 'disabled', rid }`; no fetch |
| INT-MSKREV-002 | "stays dark for anything but exactly true, before reading the body" | `TRUE`, `1`, `yes`, `true1` with a non-JSON body: 404 `disabled` (not `invalid`); no fetch |
| INT-MSKREV-003 | "refuses a caller with no session" | 401 `unauthorized` + rid; no `masleka_requests` call; no log row |
| INT-MSKREV-004 | "refuses a session the auth server does not recognise" | 401; no `can_work_request` call; no `masleka_requests` call |
| INT-MSKREV-005 | "refuses a signed-in user who is not staff, and logs no access" | 403 `forbidden` + rid; no log row; no `masleka_requests` call |
| INT-MSKREV-006 | "a membership removed between two calls is refused on the second" | 200 then 403 with the same session; no value, no log row on the second |
| INT-MSKREV-007 | "asks the auth server, then the database under the caller's own session, on every call" | One `GET /auth/v1/user` with the bearer token; one `can_work_request` with `{ p_request_id }` and the caller's bearer |
| INT-MSKREV-008 | "decrypts the ID for a member, never cached, and logs who asked" | `{ ok, value, rid }` in that order; `no-store`; one log row whose keys are exactly agency_id, at, field, id, request_id, user_id |
| INT-MSKREV-009 | "decrypts the code" | Value; one log row, field `code` |
| INT-MSKREV-010 | "opens each value only with its own request and field as the context" | The code's ciphertext in the ID column, and an ID sealed for another row: 500 `failed`, no value |
| INT-MSKREV-011 | "has nothing to give unless the request is waiting with its code" | `invited`, `submitted`, `completed`, `expired`, `cancelled`: 409 `not_available`; no log row |
| INT-MSKREV-012 | "does not find another agency's request" | 404 `not_found`; no log row |
| INT-MSKREV-013 | "refuses a field it does not hold, or an id that is not one" | `phone`, a non-UUID, a UUID with a PostgREST filter appended, no id, a non-JSON body: 400 `invalid`; no `masleka_requests` call |
| INT-MSKREV-014 | "logs the agency the request belongs to and the caller the auth server named, whatever the body says" | Body's `agencyId`/`agency_id`/`userId` ignored: log row agency 1, user the session's |
| INT-MSKREV-015 | "reads the request once, by its checked id and agency, naming its columns, and never changes it" | One GET; `id=eq.<uuid>`, `agency_id=eq.<agency 1>`; `select=` names columns, never `*` or `token_hash`; no PATCH |
| INT-MSKREV-016 | "reveals nothing when the access log cannot be written" | 500 exactly `{ error: 'failed', rid }`; no value |
| INT-MSKREV-017 | "reveals nothing from a value that fails its tag, and the attempt stays logged" | 500; no value; one log row (written before decrypting) |
| INT-MSKREV-018 | "reveals nothing without the key, or with one that is not 32 bytes" | Missing, 16-byte, non-base64: 503 `unavailable` + rid; no `masleka_requests` call; no log row |
| INT-MSKREV-019 | "never writes a revealed value or the session token to a log line" | Across success (both fields), log failure, wrong context and an outsider: no code, ID, session token, ciphertext or client name in any line |
| INT-MSKREV-020 | "answers the browser's preflight and does nothing else" | 204 with the site's origin allowed; no fetch |
| INT-MSKREV-021 | "reveals on a request whose lead is assigned to them, and logs the reveal first" | A User: 200 with the value; one log row with their id |
| INT-MSKREV-022 | "refuses a request on another User's lead, and reveals and logs nothing" | 403 `forbidden` + rid; no log row |
| INT-MSKREV-023 | "refuses a request on an unassigned lead" | 403; no log row |
| INT-MSKREV-024 | "reveals on a request with no lead that they created, not on one somebody else did" | 200 for their own; 403 and no log row for another's |

### 4.27 `masleka-submitted` — הגשתי wipes the ciphertext — `INT-MSKSUB-001..016`

| ID | Title | Expected result |
|---|---|---|
| INT-MSKSUB-001 | "answers disabled while MASLEKA_ENABLED is unset, before reading the body" | 404 `disabled` + rid; no `masleka_requests` call; ciphertext untouched |
| INT-MSKSUB-002 | "refuses a caller with no session, and an outsider" | 401 `unauthorized`, 403 `forbidden`; no PATCH; ciphertext untouched |
| INT-MSKSUB-003 | "wipes both values, marks the request submitted and records who and when" | Nulls; `submitted`; `submitted_by`; `ciphertext_wiped_at` = `submitted_at` = now |
| INT-MSKSUB-004 | "sets the clearinghouse's deletion date, business day 7, in the same write" | `clearinghouse_deletes_at` not null, = `addBusinessDays(submitted_at, 7)`, in the one PATCH |
| INT-MSKSUB-005 | "does it in one write that is conditional on the request still waiting" | One PATCH filtered `id`, `agency_id`, `status=eq.code_received`; exactly the seven wipe fields |
| INT-MSKSUB-006 | "asks for the updated rows with an explicit select that leaves out the ciphertexts and the token hash" | `select=id`, `return=representation`; no call names a ciphertext, the hash or `*` |
| INT-MSKSUB-007 | "does not call a second click done: the request is already submitted" | 409 `already_submitted`, no `ok`; times unchanged |
| INT-MSKSUB-008 | "loses a race gracefully: a concurrent הגשתי that landed first is a refusal, not 'done'" | PATCH matches zero rows: 409 `already_submitted`, no `ok` |
| INT-MSKSUB-009 | "a failed wipe is reported as a failure, not as done" | 500 `failed`, no `ok`; row still `code_received` with both ciphertexts |
| INT-MSKSUB-010 | "refuses a request that is not waiting with a code, and changes nothing" | `invited`, `completed`, `expired`, `cancelled`: 409 `not_available`; row unchanged |
| INT-MSKSUB-011 | "does not find a request that is not there, or not the agency's, and leaves the other agency's values alone" | Not there: 403 `forbidden`, refused by `can_work_request` before anything is read or written; another agency's: 404 `not_found` (the agency filter); its ciphertext untouched |
| INT-MSKSUB-012 | "scopes the write to the agency, whatever the body says" | `agency_id=eq.<AGENCY_1>`; body's agency, status and `submitted_by` ignored |
| INT-MSKSUB-013 | "refuses an id that is not one, before touching the table" | 400 `invalid` (not a UUID, injection, non-string, missing, bad JSON); no `masleka_requests` call |
| INT-MSKSUB-014 | "lowercases the id once it is validated, so the filter and the answer agree" | Upper-case UUID: 200; filter `id=eq.<lowercase>` |
| INT-MSKSUB-015 | "never writes a ciphertext, a name or the session token to a log line" | Across success, failed write and outsider: every line has `rid`; no ciphertext, client name, last4 or session token |
| INT-MSKSUB-016 | "answers the browser's preflight and does nothing else" | 204, site origin allowed; no fetch |

### 4.28 `masleka-create` — a hand-made request (optionally on a lead), a fresh link, or a reissue — `INT-MSKNEW-001..039`

| ID | Title | Expected result |
|---|---|---|
| INT-MSKNEW-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 |
| INT-MSKNEW-002 | "refuses a caller with no session, and an outsider" | 401, 403; no row; an outsider cannot rotate a link |
| INT-MSKNEW-003 | "answers disabled before reading the body or calling anything" | 404 `disabled` + rid; no fetch |
| INT-MSKNEW-004 | "creates an invited request, mails the client the link, and returns it for copying" | Row with hash of the returned token; invitation carries the link; `no-store` |
| INT-MSKNEW-005 | "only returns the link when the staff member will send it themselves" | No mail; `client_invited_at` null |
| INT-MSKNEW-006 | "mails nobody when there is no address" | `contact_email` null; no mail |
| INT-MSKNEW-007 | "still returns the link when the invitation mail fails" | 200, `invited: false` |
| INT-MSKNEW-008 | "refuses an empty or overlong name" | 400 `invalid_name` |
| INT-MSKNEW-009 | "refuses an address that is not one" | 400 `invalid_email`; no row |
| INT-MSKNEW-010 | "takes the agency and the creator from the server, never the body" | `agency_id` = agency 1, `created_by` = caller; body's agency, creator, status, lead and hash ignored |
| INT-MSKNEW-011 | "mails the invitation with a clickable https button to the link, as the client's role" | `href` = the https link; one mail |
| INT-MSKNEW-012 | "keeps the name and address within their limits" | 80-char name ok; non-string name/address and 254+ address refused |
| INT-MSKNEW-013 | "answers 500 without a link when the request cannot be stored" | 500 `failed`, no `ok`, no link, no mail |
| INT-MSKNEW-014 | "never writes the link, the token, the name or the address to a log line" | Across create, mail failure, fresh link, outsider and failed write: every line has `rid`; none carries them |
| INT-MSKNEW-015 | "answers the browser's preflight and does nothing else" | 204, site origin allowed; no fetch |
| INT-MSKNEW-016 | "replaces the token, restarts its thirty days and stops the automatic reminder" | New hash; expiry >= 29 days on; `client_reminded_at` set |
| INT-MSKNEW-017 | "writes one conditional update scoped to the agency, naming the columns it gets back" | One PATCH: `id` (lowercased), `agency_id`, `status=eq.invited`, `select=id`, `return=representation`; three fields |
| INT-MSKNEW-018 | "makes the old link stop working: the stored hash no longer matches it" | Stored hash is the new token's only |
| INT-MSKNEW-019 | "extends the expiry, never shortens it: thirty days from now whatever was left" | Near and lapsed expiries both become >= 29 days on |
| INT-MSKNEW-020 | "does not touch another agency's request, or one that is not there" | Another agency's: 409, hash unchanged; one that is not there: 403 `forbidden`, no PATCH |
| INT-MSKNEW-024 | "lets a User start a request by hand, as theirs, and fresh-link only their own (agency roles)" | A User's new request has `created_by` = them and no lead; a fresh link for another's lead-less request: 403, hash unchanged; for their own: 200 |
| INT-MSKNEW-021 | "answers 500 and no link when the update fails" | 500 `failed`; no link |
| INT-MSKNEW-022 | "refuses a request that is no longer waiting for a code" | 409; hash unchanged |
| INT-MSKNEW-023 | "refuses an id that is not one" | 400 `invalid`; no `masleka_requests` call |
| INT-MSKNEW-025 | "lets a User start a request on their own lead, and stores the lead" (for a lead) | 200; `lead_id` the lead, `created_by` the User |
| INT-MSKNEW-026 | "refuses a User another User's lead with 403, and stores nothing" (for a lead) | 403 `forbidden` with `rid`; no row |
| INT-MSKNEW-027 | "lets an Admin start one on any of the agency's leads" (for a lead) | 200; `lead_id` another User's lead, `created_by` the Admin |
| INT-MSKNEW-028 | "refuses a lead of another agency, even one the caller can see" (for a lead) | 403 (`lead_in_agency` false); no row |
| INT-MSKNEW-029 | "refuses a lead id that is not one, asking nothing about it" (for a lead) | `not-a-uuid`, a number, an object: 400; `can_see_lead` never asked |
| INT-MSKNEW-030 | "keeps today's request when the lead is left out or null: lead-less, the caller's own" (for a lead) | 200; `lead_id` null, `created_by` the caller; `can_see_lead` never asked |
| INT-MSKNEW-031 | "sends the request back to the client: the code, the ID and its last digits wiped, a fresh link" (a reissue) | 200, `invited: false`; the row `invited`, both ciphertexts, `id_last4` and `code_received_at` null, `ciphertext_wiped_at` set; the hash is the new link's |
| INT-MSKNEW-032 | "writes one conditional update that matches only a request still waiting to be submitted" (a reissue) | One PATCH: `id=eq.`, `agency_id=eq.`, `status=eq.code_received`, `select=id` |
| INT-MSKNEW-033..036 | "never reopens or wipes a request that is %s" (a reissue) | `invited`, `submitted`, `completed`, `expired`: 409 `not_available`, nothing changed, no link |
| INT-MSKNEW-037 | "leaves a code that just arrived alone when the fresh link was a plain one" (a reissue) | A plain fresh link on a `code_received` row: 409; the ciphertexts kept |
| INT-MSKNEW-038 | "is for whoever may work the request: another User is refused and nothing changes" (a reissue) | Another User: 403, nothing changed; the creator: 200 |
| INT-MSKNEW-039 | "never writes the link, the token or a ciphertext to a log line" (a reissue) | `reissued: true` logged; no link, token, ciphertext or last digits |

### 4.29 `masleka-remind` — the hourly chase — `INT-MSKREM-001..037`

Time is fixed with `vi.setSystemTime` (Date only) at Sunday 2026-10-18 13:00 Israel.

| ID | Title | Expected result |
|---|---|---|
| INT-MSKREM-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 |
| INT-MSKREM-002 | "refuses everything when no secret is configured" | 503; no table read |
| INT-MSKREM-003 | "refuses everything when the secret is shorter than 32 characters" | 503 for a 31-character secret even when the header matches; no table read, no staff lookup, no mail |
| INT-MSKREM-004 | "refuses a caller without the secret, or with another" | 401 for none, a wrong one, a prefix and a longer string; no table read, no mail |
| INT-MSKREM-005 | "does nothing at all while the switch is off, even for the right secret" | 404 `disabled`; no fetch, no mail |
| INT-MSKREM-006 | "tells staff the files are ready four hours after הגשתי" | One notice per staff address for the 5-hour-old submission only; marked |
| INT-MSKREM-007 | "sends one digest when several are ready" | One mail per address, "— 2 לקוחות" |
| INT-MSKREM-008 | "tells staff on business day 5 that the clearinghouse deletes in two days" | Deadline notice for the Sunday-before submission; marked |
| INT-MSKREM-009 | "does not warn before business day 5" | No deadline notice at 08:00 UTC |
| INT-MSKREM-010 | "ignores requests PR B has completed" | Completed row untouched |
| INT-MSKREM-011 | "claims each staff notice in one conditional update that checks it was never sent" | One PATCH per kind, filtered on `status=eq.submitted` and the marker `is.null` |
| INT-MSKREM-012 | "sends nothing when another run has already claimed the notice" | Marker set by a rival run before the claim: zero rows back, no staff mail |
| INT-MSKREM-013 | "gives the claim back when no staff address could be mailed, so the next run tries again" | Both markers null again; warnings `ready_not_sent`, `deadline_not_sent` |
| INT-MSKREM-014 | "takes business day 5 from the business calendar: a Thursday submission is due the next Thursday" | Not due at 08:00 UTC Thursday 15 Oct, due at 09:00 (`addBusinessDays`) |
| INT-MSKREM-015 | "never carries a code, an ID or ciphertext in a mail, and never asks for the ciphertext columns" | No ciphertext marker in any mail; no `masleka_requests` URL names a ciphertext column |
| INT-MSKREM-016 | "does not say 'deleted in two days' at or after business day 7" | No notice and no marker at business day 7 (Tue 20 Oct); still sent the day before |
| INT-MSKREM-017 | "never repeats a reminder" | Second run sends nothing |
| INT-MSKREM-018 | "reminds a client once, a week after the invitation, with a new link" | One reminder; stored hash = new token (rotated after the send); original `token_expires_at` kept; others untouched |
| INT-MSKREM-019 | "the old link stops working once the reminder has rotated it" | `masleka-code` refuses the old token, accepts the new |
| INT-MSKREM-020 | "puts the reminder back when the client's mail fails, so the next run tries again" | `client_reminded_at` null; warning |
| INT-MSKREM-021 | "pins the claim and the rotation as two updates: the claim never touches the hash, the rotation only follows our own marker" | Two PATCHes: the claim sets only `client_reminded_at` (filtered `is.null`, `status=eq.invited`); the rotation sets only `token_hash`, filtered `client_reminded_at=eq.<now>` |
| INT-MSKREM-022 | "keeps the old link working when the reminder mail fails" | Hash still the old token's, marker null; `masleka-code` still accepts the old token |
| INT-MSKREM-023 | "leaves the hash alone and warns when the row stopped being invited before the rotation" | A code arriving after the mail: hash untouched; warning `client_rotate_failed` |
| INT-MSKREM-024 | "warns, and the old link still works, when the rotation update fails" | Hash untouched; warning `client_rotate_failed` |
| INT-MSKREM-025 | "one failing client claim does not stop the other clients" | Other client reminded; warning `client_claim_failed`; `clients: 1` |
| INT-MSKREM-026 | "does not remind a client whose link a person sent by hand, or one whose link has expired" | Hand-sent (marker set) and expired rows: no mail, hash unchanged |
| INT-MSKREM-027 | "sends nothing to a client when another run has already claimed the reminder" | Rival marker: zero rows back, no mail, `clients: 0` |
| INT-MSKREM-028 | "writes no name, address, token or link to a log line" | Across a clean run and a failing-mail run: none of the names, addresses, secret, link or old token in any line |
| INT-MSKREM-029 | "answers how many it sent" | `{ready: 1, deadline: 1, clients: 1, warnings: []}` (and `wiped`) |
| INT-MSKREM-030 | "tells every staff member once per wiped request, naming the client, and marks it told" | Two requests the nine-day wipe expired before הגשתי (`expired`, `code_received_at` set, no `submitted_at`): one "קוד מסלקה נמחק לפני הגשה — <name>" per request per staff address; address and "קוד חדש" in the text; `wipe_notified_at` = now; `wiped: 2` (decision 2026-10-14) |
| INT-MSKREM-031 | "says nothing about a request that expired without a code, was submitted, or was already announced" | No code, a submission, a marker already set, still `code_received`: no mail, no claim, `wiped: 0` |
| INT-MSKREM-032 | "claims each notice in one conditional update that checks it was never sent" | One PATCH setting only `wipe_notified_at`, filtered `id`, `agency_id`, `status=eq.expired`, `wipe_notified_at=is.null`, `code_received_at=not.is.null`, `submitted_at=is.null` |
| INT-MSKREM-033 | "never repeats a wipe notice" | Second run on the first run's rows: no mail |
| INT-MSKREM-034 | "sends nothing when another run has already claimed the notice" | Rival marker: zero rows back, no mail, `wiped: 0` |
| INT-MSKREM-035 | "gives the claim back when no staff address could be mailed, so the next run tries again" | Markers null again; warning `wipe_not_sent` |
| INT-MSKREM-036 | "one failing claim does not stop the other notices" | The other request still announced; warning `wipe_claim_failed`; `wiped: 1` |
| INT-MSKREM-037 | "never asks for the ciphertext columns, and writes no name or address to a log line" | No `masleka_requests` URL names a ciphertext column; no name or address in any line |

### 4.30 `submit-lead` — the clearinghouse request — `INT-LEADMSK-001..024`

`tests/integration/submit-lead-masleka.integration.test.ts`. The dark cases fix the clock (`vi.setSystemTime`, Date only) and compare against the output re-captured from submit-lead after #170 landed, at the merge a8f7a9f.

| ID | Title | Expected result |
|---|---|---|
| INT-LEADMSK-001 | "answers, mails and logs an interested interview exactly as before the pipeline, whatever the off value" | For `MASLEKA_ENABLED` unset, "", "false", "TRUE", "1", "yes", "true1": same answer, every mail's halves byte-identical (hash), same log lines; no `masleka` call |
| INT-LEADMSK-002 | "answers, mails and logs a declined or unasked interview exactly as before the pipeline" | Same, for a declined and a never-asked interview |
| INT-LEADMSK-003 | "keeps today's mandate mail, and creates no request, while the switch is off" | No `masleka_requests` call; one visitor mail with the POA link in both halves |
| INT-LEADMSK-004 | "creates a request for an interview that asked for the pull, and its one confirmation carries the link as a button instead of the mandate" | One `invited` row in agency 1 tied to the lead, `created_by` null, hash of the mailed token; exactly one visitor mail (Ruling 21) with `<a href="https://govari-fin.co.il/masleka#t=…"` (Ruling 13) and the plain link in the text half; no POA; `client_invited_at` set |
| INT-LEADMSK-005 | "says nothing about the clearinghouse to a visitor who declined" | No request call; one visitor mail; no link, no "מסלקה" |
| INT-LEADMSK-006 | "creates nothing for an interview that is still partial" | No request call; no mail |
| INT-LEADMSK-007 | "falls back to the mandate when the request cannot be created, and the lead, the staff copies and the calendar still happen" | 200 `ok`; `masleka_request_failed`; lead, calendar event and every staff copy; one visitor mail with the POA link and no `masleka#t=` |
| INT-LEADMSK-008 | "leaves the request not invited when the confirmation carrying the link cannot be sent, and the lead still lands" | 200; `client_confirmation_failed…`; row with `client_invited_at` null and no PATCH; lead, calendar, staff copies |
| INT-LEADMSK-009 | "still answers 200 when the confirmation went out but could not be marked" | Confirmation carries the link; `client_invited_at` null; `masleka_invite_mark_failed` warning and log line |
| INT-LEADMSK-010 | "never takes the link from the request body" | Interested visitor (Ruling 5), switch off and on: no body-supplied link in any mail; on, the real link is rendered; off, the body cannot suppress the mandate |
| INT-LEADMSK-011 | "creates the request without mailing when there is no address, or none that is one" | Row with `contact_email` and `client_invited_at` null; no visitor mail |
| INT-LEADMSK-012 | "sends no link to an address over its daily confirmation limit" | Row created, not invited; no visitor mail |
| INT-LEADMSK-013 | "puts the link only in the client's confirmation — never in a log line, the answer or a staff copy" | Token absent from every log line (each with `rid`), the answer, staff and calendar mails; `masleka.request_created` logged |
| INT-LEADMSK-014 | "keeps the answer's shape: ok, rid, leadId and warnings, nothing more" | Keys exactly `ok`, `rid`, `leadId`, `warnings` (Ruling 8), on success and on a failed request |
| INT-LEADMSK-015 | "reuses the open request: no second row, a new link mailed, the old one replaced, the reminder restarted" | Same contact with an `invited` request: no POST; one row whose hash is the mailed token's; `token_expires_at` later; `client_invited_at` now; `client_reminded_at` null; `lead_id` and name kept; `masleka.request_reused` logged; token in no log line (decision 2026-10-14) |
| INT-LEADMSK-016 | "rotates only after the confirmation went out, in one conditional update on a still-invited request" | One PATCH filtered `id`, `agency_id`, `status=eq.invited`; fields exactly `client_invited_at`, `client_reminded_at`, `token_expires_at`, `token_hash` |
| INT-LEADMSK-017 | "keeps the old link working when the confirmation cannot be sent" | Mail refused: row unchanged, no PATCH |
| INT-LEADMSK-018 | "keeps the old link and sends nothing over the address's daily limit" | Row unchanged; no visitor mail |
| INT-LEADMSK-019 | "warns when the request stopped being invited before the rotation" | Code arrives during the mail: hash kept; warning `masleka_rotate_failed` |
| INT-LEADMSK-020 | "matches the contact by phone, address and name, however each was typed" | `+972-54-…`, `972…`, upper-case padded address, first name only: reused |
| INT-LEADMSK-021 | "opens a new request when anything about the contact differs, or the old one cannot take a code" | Another phone, address, or name; no address on the old request; a hand-made request; a lead that is gone; `code_received`; expired link; another agency: a second row, the first untouched |
| INT-LEADMSK-022 | "never reuses for an interview with no address: it opens a new request, as before" | Two rows |
| INT-LEADMSK-023 | "a completed interview sent twice ends with one request and one working link" | Second run over the first's lead and request: one row, hash of the second mail's token |
| INT-LEADMSK-024 | "falls back to a new request when the lookup fails" | Leads lookup 500: 200, a second row |

### 4.31 `claim-documents-purge` — claim files kept two months — `INT-CDP-001..007`

`claim-documents-purge.integration.test.ts` fakes the rpc `claim_documents_expired` and the Storage API's bulk delete; the last two cases are in `submit-claim.integration.test.ts`.

| ID | Title | Expected result |
|---|---|---|
| INT-CDP-001 | "refuses a call without the cron secret, and one when no secret is configured" | 401 / 503; nothing deleted |
| INT-CDP-002 | "deletes what is past retention through the Storage API, and says how many" | `DELETE /storage/v1/object/claim-documents` with the names; `{deleted: 3, batches: 1}` |
| INT-CDP-003 | "drains a backlog in batches of 500, and stops at ten a night" | 1,200 → 500 + 500 + 200; 6,000 → 5,000 deleted, 1,000 left for the next night |
| INT-CDP-004 | "does nothing when nothing is due" | No delete call |
| INT-CDP-005 | "reports a refused delete as a failure, and never logs a file's name" | 500; no path in any log line |
| INT-CDP-006 | "tells Dorit to keep a stored file, since the site deletes it after two months" | The staff mail carries the line for a `storage:claim-documents/…` file |
| INT-CDP-007 | "says nothing of it when no file is stored on the site" | No such line |

### 4.32 `sheet-retention` — the leads sheet keeps what the database keeps — `INT-SRET-001..007`

`sheet-retention.integration.test.ts` fakes the Sheets API (read, `values:batchClear`) and the rpc `lead_sheet_live` (Architecture N-02).

| ID | Title | Expected result |
|---|---|---|
| INT-SRET-001 | "refuses a call without the cron secret, and one when no secret is configured" | 401 / 503; nothing cleared |
| INT-SRET-002 | "does nothing, and says so, when no sheet is configured" | `skipped: sheet_not_configured`; no Sheets call |
| INT-SRET-003 | "empties an Events row whose lead is anonymized or deleted, and keeps a live lead's" | The ids asked once; rows 3 and 4 → `G:J`, `M`, `O:R`; the live and the already-empty rows untouched |
| INT-SRET-004 | "goes by the row's own date when it names no lead: 24 months" | ISO text, a serial date and `dd.mm.yyyy` past 24 months cleared; within kept; an unreadable date left and counted |
| INT-SRET-005 | "empties a Support row's phone and transcript after 12 months, and nothing else" | `C` and `G` of the rows past 12 months |
| INT-SRET-006 | "fails without clearing anything when the database cannot say who is live" | 500; no clear |
| INT-SRET-007 | "logs counts, never a cell" | No name, phone, email or transcript in the answer |

### 4.33 `invite-user` — "הוספת משתמש" — `INT-INV-001..018`

`invite-user.integration.test.ts` fakes Supabase Auth (the session, the admin create), PostgREST (profiles, agencies under RLS), the `staff_role`, `set_member_role` and `invitee_for` RPCs over independent Auth/profile addresses, and lets the mailer stub record the invitation. The callers are the platform operator, an agency Admin, an Owner, and a signed-in member with no role.

| ID | Title | Expected result |
|---|---|---|
| INT-INV-001 | "refuses a caller with no session, and one who is not an admin" | 401 / 403; no account, no membership |
| INT-INV-002..005 | "refuses %s, and changes nothing" | A bad address, an unknown role (the old `agent`), a malformed or missing organization: 400 |
| INT-INV-006 | "makes an account for an address never seen, adds the membership, and mails the invitation" | Lower-cased address; `email_confirm: true`; the membership; the mail with the organization, the role in Hebrew (`משתמש/ת`) and the sign-in link; no `/auth/v1/invite` |
| INT-INV-007 | "adds an existing account without making another, and changes the role of a member already there" | No create; the role replaced through `set_member_role`; no direct `memberships` call |
| INT-INV-014 | "lets an agency Admin add a User, through set_member_role under the Admin's own session" | 200; the membership; one `set_member_role` with the Admin's token and `{ p_agency_id, p_user_id, p_role: 'user' }` |
| INT-INV-015 | "refuses an agency Admin who would add an Admin or an Owner, before any account is made" | 403; no account, no membership |
| INT-INV-016 | "lets the Owner add an Admin" | 200; role `admin` |
| INT-INV-017 | "names the role in Hebrew in the invitation" | `מנהל/ת` |
| INT-INV-018 | "answers the database's refusals as the person can read them, never as a failure" | `forbidden` → 403, no mail; `last_owner` → 409 naming the owner; `rid` on both |
| INT-INV-008 | "keeps the membership and says so when the invitation mail does not go" | 200, `mailed: false`, `invite_email_failed` |
| INT-INV-009 | "refuses an address Auth holds but no profile does, rather than guess at an account" | 409; no membership |
| INT-INV-010 | "invites the current Auth owner when another profile still carries their address" | Membership goes to the current owner, never the historical profile match |
| INT-INV-011 | "never grants a former Auth owner access when the old address is now unused" | New account invited; former owner receives no membership |
| INT-INV-012 | "fails closed when the authoritative address lookup is unavailable" | 500; no account creation, membership or mail |
| INT-INV-013 | "uses the verified admin session for tenant tables while keeping Auth and identity lookup server-side" | The agency read and `set_member_role` carry the caller's bearer; account creation and `invitee_for` keep service credentials |

### 4.34 The agency-roles functions — `member-admin`, `assign-lead`, `claim-document-link` — `INT-ROLE-001..018`

`tests/integration/agency-roles-edge.integration.test.ts`, through the in-process harness. Agency 1 has an Owner, an Admin and two Users; the platform operator has no membership; an outsider is signed in with no role. The harness answers `staff_role`, `can_see_lead` (under the caller's token), `set_member_role` / `remove_member` (recorded, or refused with a given reason), and the leads trigger's `assignee_not_member`. The database's own rules are `agency_roles_check.sql`.

| ID | Title | Expected result |
|---|---|---|
| INT-ROLE-001 | "refuses a caller with no session, and changes nothing" | `member-admin`: 401; no RPC |
| INT-ROLE-002 | "sets a role through set_member_role, as the caller" | `{ ok, warnings: [], rid }`; one call with the caller's session and `{ p_agency_id, p_user_id, p_role }` |
| INT-ROLE-003 | "removes a member, and lets anyone leave by their own id" | `remove_member` for the target; `leave` uses the caller's id whatever the body says |
| INT-ROLE-004 | "hands over ownership in order: the new Owner first, then the caller steps down" | Two calls: target → `owner`, then caller → `admin` |
| INT-ROLE-005..007 | "answers the database's %s with %s and a message a person reads, never its text" | `forbidden` 403, `last_owner` 409, `not_found` 404; `rid`; the reason word is not in the message |
| INT-ROLE-008 | "refuses an unknown role or op, or an id that is not one, before asking anything" | 400; no RPC |
| INT-ROLE-009 | "assigns as the caller, and mails the assignee a link to the lead and nothing about the client" | `assign-lead`: the PATCH carries the Admin's bearer; mail "שויכה אלייך פנייה חדשה" with `…/admin/leads?lead=<id>`; neither the client's name nor phone in text or HTML |
| INT-ROLE-010 | "refuses a User, and the operator assigns without a membership" | User: 403, no write, no mail; operator: 200 |
| INT-ROLE-011 | "puts a lead back in the queue, and tells nobody" | `assigned_user_id: null`; no mail |
| INT-ROLE-012 | "answers the trigger's refusal of someone outside the agency, and mails nobody" | 400 naming membership; no mail |
| INT-ROLE-013 | "does not mail an Admin who takes a lead themselves" | 200; no mail |
| INT-ROLE-014 | "answers 404 for a lead that is not there, and 400 for an id that is not one" | 404 / 400 |
| INT-ROLE-015 | "signs a short link for the assignee, never cached" | `claim-document-link`: 200 with a signed `claim-documents` URL; `no-store`; `can_see_lead` asked with the caller's bearer |
| INT-ROLE-016 | "refuses another User, and signs nothing" | 403; no sign call |
| INT-ROLE-017 | "refuses a document that is not on that lead, even for an Admin" | 404; no sign call |
| INT-ROLE-018 | "refuses a path that is not an object name, before asking anything" | `..`, empty, 301 characters: 400; no `can_see_lead` |

Weakening `assign-lead`'s gate to `user`, or dropping `claim-document-link`'s lead check, fails INT-ROLE-010, -015 and -016.

`content-admin-edge.integration.test.ts` gates per action (agency roles): a User writes and edits drafts, asked in agency 1; a User who would publish, edit a live article, unpublish, delete, or add or delete a testimonial is refused 403 and nothing is written; an agency Admin does all of them; a shared-library article (no agency) is the operator's alone; a `published` that is not a boolean (`"true"`, `1`, `null`) is refused 400 before the gate, which compares with `=== true` while PostgREST would cast it. Its refusal cases now assert "nothing is written": an edit or delete reads its row's agency first, and a caller with no session reads nothing at all. Fixture tokens are 20+ characters, as `bearer()` requires.

### 4.35 A client's meetings — `submit-lead` by id, and `meeting-request` — `INT-MTG-001..021`

docs/superpowers/specs/2026-10-17-client-meetings-design.md, rollout 1. `submit-lead` inserts its booking and hands back the id, and writes the calendar outcome to that id — never an upsert on `lead_id`, the key migration 2 drops. A signed-in client booking from the consultation form joins their own lead (the user's decision of 2026-10-17). `meeting-request` runs `request_meeting_change` under the client's session and mails staff without the client's note.

`tests/integration/submit-lead.integration.test.ts`, "Edge — a client's meetings, written by id":

| ID | Title | Expected result |
|---|---|---|
| INT-MTG-001 | "writes the calendar outcome to the booking it inserted, by that id" | One insert; the outcome a PATCH `id=eq.<booking>`; no `on_conflict` |
| INT-MTG-002 | "updates an open interview's booking instead of adding one per save" | No insert; the first booking updated |
| INT-MTG-003 | "puts a signed-in client's booking on their own lead, as a follow-up" | No new lead; `kind: follow_up` on the existing lead; the lead untouched; mail sent |
| INT-MTG-004 | "asks for the lead in agency 1 only" | `lead_for_email` with the verified address and agency 1 |
| INT-MTG-005 | "never crosses agencies: another agency's lead with the address is not offered" | A new lead, `kind: first` |
| INT-MTG-006 | "makes a new lead for an anonymous visitor, even with a matching address" | No lookup |
| INT-MTG-007 | "makes a new lead when the session's address is not verified" | `my_email()` refused; no lookup |
| INT-MTG-008 | "matches only the booking form: a signed-in client's interview is its own lead" | `my_email()` never asked |

`tests/integration/meeting-request.integration.test.ts`:

| ID | Title | Expected result |
|---|---|---|
| INT-MTG-009 | "asks Postgres with the client's own session, and answers the request id" | The RPC with the client's bearer; `requestId`, `notified: true`, `rid` |
| INT-MTG-010 | "tells the team, the assigned user and the agency's admins — once each" | Recipients merged and de-duplicated |
| INT-MTG-011 | "never carries the client's note, in the subject or anywhere in the mail" | Subject `בקשה לשינוי פגישה: מועד אחר`; no note text |
| INT-MTG-012 | "gives the meeting's time in Israel, not UTC" | 10:00, not 08:00 |
| INT-MTG-013..015 | "answers Postgres's %s as %i, and mails nobody" | `already_open` 409, `not_found` 404, `unverified` 403 |
| INT-MTG-016 | "asks nothing without a session" | 401; no RPC |
| INT-MTG-017..020 | "refuses a malformed request before asking Postgres (%j)" | 400 for a bad id, kind, long or non-text note |
| INT-MTG-021 | "keeps the request when the mail does not go, and says so" | 200, `notified: false` |

## 5. Pass criteria

All declared cases pass (vitest: 704 with expansions). These assert behaviour, not shape — a failure means the
function now does something different, so fix the function rather than the
expectation.

## 6. Known gaps

- **`createConsultationEvent`** was retired with the Base44 harness (§4.2e); `submit-lead` writes the diary itself, and that path is covered by `submit-lead.integration.test.ts`.

### Resend delivery to the agency

`tests/integration/resend.integration.test.ts` runs all three notification entry
points with mocked Resend HTTP and backend secrets. It checks fixed recipients,
configured sender and authorization, missing key/sender, HTTP 401/403/429/500,
network failures, and malformed successful responses. Failures retain the enquiry
and allow operations notifications to proceed. The helper parity check guards
against drift across isolated entry points. No test sends real email.
The shared harness injects Deno environment access and records Resend deliveries
alongside the recipient/content tests.
