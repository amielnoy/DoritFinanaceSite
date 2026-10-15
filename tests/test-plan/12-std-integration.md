# STD-12 — Integration Tests

**Suite:** `integration` · **Runner:** `npm run test:integration` (Vitest, node)
**Location:** `tests/integration/` · **Cases:** 161 declared cases (IDs in section 4; a range such as `X-001..014` counts each ID); `npm run test:integration` runs 625 including `it.each` / `describe.each` expansions

---

## 1. Purpose

Execute the Base44 backend functions and look at what came out.

Nothing else in the repository runs them. They sit outside `tsconfig.json`, they
import the Base44 SDK from a `npm:` specifier, and in production they execute on
Deno inside Base44 — so the type-checker never sees them, the frontend suites
never reach them, and the contract suite reads their *source* rather than their
behaviour.

That difference is not academic. A source check confirms `escapeHtml(` sits next
to `firstName`. It cannot tell you whether the escaped value actually reached the
HTML, whether the plain-text copy was escaped by mistake, or whether a bounce to
one recipient silently dropped the other two. These tests can, because they call
the function.

## 2. Environment

`tests/helpers/base44-function.ts` loads a function's `entry.ts` and runs its
default export against a recording client. Entity writes and reads,
`Core.SendEmail`, connector lookups and outbound `fetch` are all captured rather
than performed, so a run touches no network, no mailbox and no live data. The
harness can be told to fail any of them — `failLeadWrite`, `failLeadLookup`,
`failEmailTo`, `failFetch`, a `null` connector token — which is how the failure
paths below are reached.

`existingLeads` seeds rows the function can find *before* it writes. Without a
readable store the interview lookup always misses, every case takes the create
path, and the upsert in §4.11 would be exercised by nothing.

Its result exposes `status`, `json`, `leads`, `leadUpdates`, `emails`,
`mailTo(address)` and `callsTo(host)`.

## 3. Coverage

| Function | Where it is called from |
|---|---|
| `submitLead` | every form on the site, and the interview agent |
| `escalateToHuman` | all three on-site agents |
| `submitClaim` | the claims form |
| `submit-claim` (Edge) | a claim, saved to Supabase and announced — the same cases as `submitClaim`, plus its own |
| `submit-lead` / `escalate-to-human` / `log-support-chat` (Edge) | the same callers as their Base44 versions, behind `VITE_LEAD_FUNCTIONS=supabase`; the same cases run against both |
| `upsertContact` | no caller yet — built for a channel that supplies a phone number, dormant per B-8 |
| `logSupportChat` | the support agent, at the end of every conversation |
| `adminLead` | `/admin/leads` — an admin's status change and delete, written to Supabase and then Base44 |
| `dorit-mailer` | every message the backend sends — a Cloudflare Pages Function, run in-process here |

`createConsultationEvent` is not yet executed here. See §6.

## 4. Test cases

### 4.1 `submitLead` — the enquiry lands — `INT-LEAD-001..009`

Stores the lead, mails all three recipients and books the calendar in one call;
pins `status` to `new` rather than trusting the caller; gives the agency and the
operations team the same details in **both** the HTML and the text copy; adds the
operational appendix to the operations copy only; reports the calendar and sheet
outcome inside it; sends every copy as HTML with a plain-text twin; breaks the
staff copy into titled blocks; and skips the visitor's confirmation when no
address was given.

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
payload survives as escaped text a client displays; a hostile phone number is
stripped to digits before it reaches an `href`; the plain-text copy is left
unescaped on purpose, because escaping it would only make the mail unreadable;
and the record stores the raw value, so it matches what was submitted.

### 4.3 `submitLead` — identifiers a visitor volunteered — `INT-LEAD-016/017`

An ID number or card number in a model-written summary is redacted before anyone
receives it, in every copy, and the text says a value was omitted rather than
deleting it silently.

### 4.4 `submitLead` — what survives a failure — `INT-LEAD-018..024`

No name or no phone refuses and writes nothing. A failed entity write fails
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
interview to both staff copies, and the pre-schema free-text path still works —
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

### 4.9 `submitLead` / `escalateToHuman` — the operations mailboxes — `INT-LEAD-061..064`, `INT-ESC-018/019`

The operations copy goes to more than one mailbox. Every mailbox receives the
identical copy, appendix included, while the agency's stays free of it; and each
mailbox is its own delivery attempt, verified from both directions — the first
bouncing must not cost the second, nor the second the first. The risk being
pinned is not the happy path but a future simplification: one `try` around the
whole loop would let the first bounce swallow the rest of the list silently.
For escalations the same cases add that a partial delivery still reports
`notified: true`, since an escalation that reached nobody is a regulatory
failure and one that reached two of three is not.

### 4.10 `dorit-mailer` — the one endpoint a stranger can reach — `INT-MAIL-001..015`

Everything else on this site needs a Base44 session or a form; the mailer
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
escaping and `redact()` the Base44 functions apply), and that a form submission
fans out to every configured mailbox. Failure cases: one rejected mailbox still
reports success for the others, no mailbox taking it reports 502, and the
provider's error text — which can quote the API key — never reaches the
response.

The Worker is loaded and executed in-process, the way the Base44 harness loads
an entry point. Nothing else in the repository runs this file.

### 4.11 `submitClaim` — the claim lands — `INT-CLAIM-001..013`

Previously a known gap, now executed. Stores the claim and tells the agency,
both operations mailboxes and the reporter; gives every staff mailbox the same
report; pins `status` and `source` rather than taking them from the caller;
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
rather than lost. Edge only: the Base44 rollback backend reports
`updatesInterviews` false, and the questionnaire never sends it details.

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

### 4.18 `upsertContact` — one person, however they spelled their number — `INT-CONTACT-001..017`

These cover code that nothing currently calls, and they are here rather than
deleted on purpose: the function is dormant per B-8, not abandoned, and the day
a channel supplying phone numbers is switched on is the day nobody will remember
what it was supposed to do.

Such a channel changes the shape of the problem. On the site a visitor types a
phone number into a field that enforces its format, once. There the number
arrives with the message, in whatever form the channel hands over, from someone
who may have written last month under a different name and no email at all.

So the cases are about the two things that actually go wrong. One person becomes
several rows when their number is spelled three ways — `972501234567` from the
channel, `050-123-4567` from a form, `+972 50 123 4567` typed by hand — and
three rows mean Dorit rings someone she has already spoken to as a stranger.
And a second message erases what the first established: an update has to carry
what was learned, not what was sent, or a bare "hello" blanks the name.

The rest are restraint and failure. A note taken from a WhatsApp message goes
through `redact()`, because such a channel is where people paste an ID number
without being asked for one. A failed lookup creates rather than losing the contact — a
duplicate is an annoyance, a dropped enquiry is someone nobody calls back. The
`saved` block returns what was stored rather than echoing the request, since the
agent reads it back to confirm details and confirming the request would be
theatre. Nothing is mailed: recording a contact is not an enquiry, and if it
notified anyone, every "היי" would reach Dorit's inbox. A new contact appends a
row to `Contacts`; a returning one does not, because a row per message would
turn the list of people into a second event log.

### 4.19 `logSupportChat` — what was actually asked — `INT-SUPPORT-001..012`

The event log records that someone got in touch and the contact list records who
they are. Neither records the question, which is the only one of the three that
can say what to write next or where the agent keeps stopping.

Recording a conversation is also the most intrusive thing on this site, so most
of these cases are about restraint: the transcript is redacted and capped, the
outcome comes from a fixed list rather than being phrased freshly by the model
each time, and a call carrying nothing to record is refused rather than writing
an empty row. The phone column is normalised by the same function
`upsertContact` uses. The site chat has no number, so today that column is
always empty — it is pinned anyway, because two tabs of one spreadsheet
normalised differently cannot be read together, and that would only surface long
after this was written.

Failure is the point of the last three. The agent is told not to report this
call to the visitor, so the function has to leave it nothing to report: a
refusing sheet, an unauthorised connector and a missing `SHEET_ID` all answer
`200`, and the conversation the visitor already had is unaffected.

### 4.21 `adminLead` — an admin's writes to a lead — `INT-ADL-001..031`

An admin's status change and delete used to reach Base44 only, so Supabase kept
every status at "new" and kept a lead Dorit had deleted — which the visitor's
personal area still showed. The function writes Supabase first and Base44
second: both writes are idempotent, so a failure part-way leaves the lead in the
admin list and the retry completes it. The other order would drop the lead from
the list and leave its Supabase copy with no way back to it.

`INT-ADL-001` to `004` are who may call: nobody signed in (and a `403` from the
SDK) is `401`, a Base44 outage is `500`, a signed-in non-admin is `403` — each
with the request id and no write anywhere. `INT-ADL-005` to `020` are the strict
validation: an unknown or missing action, a status outside the five the entity
declares, and a missing, blank, numeric, over-long or filter-widening id are all
`400` with nothing written; each of the five statuses is accepted.
`INT-ADL-021` and `022` pin the status write (`PATCH leads?base44_id=eq.<id>`
with only `{status}`, then `Lead.update`) and its order. `INT-ADL-023` pins the
delete (`DELETE`, then `Lead.delete`; the `meetings` row goes by `on delete
cascade`). `INT-ADL-024` to `030` are failure: Supabase refusing or unreachable
is `502` with `error` and `rid` only, and Base44 is never called; Base44
refusing after Supabase succeeded is `502` with no internal message; Supabase
not configured still writes Base44; and every refusal carries exactly `error`
and `rid`. `INT-ADL-031` is a retried delete: when Base44 answers `404` because
an earlier delete went through and only its response was lost, the function
answers `200` — the lead is gone from both stores, and an error there would
leave the admin stuck on one that no retry could clear.

### 4.22 `submit-claim` — the claim, on Supabase — `INT-CLM-EDGE-001..011`

Every `submitClaim` case runs against both implementations (`describe.each` in
`submit-claim.integration.test.ts`), and two cases compare what they send: the
reporter's HTML must be identical, and the staff report identical apart from
its timestamp line. `submit-claim-edge.integration.test.ts` holds what only the
Edge Function does: the row it writes (today's fields, no Base44 id, `leadId`
is its uuid), the service-key insert ahead of any mail, a non-JSON body
answered as 400 with nothing touched, missing Supabase credentials as 500 with
no mail, a database refusal that quotes the row kept out of the log, and the
CORS answers — a preflight that does nothing, the site's origin on every
answer, none for a stranger's.

### 4.23 The lead functions on Supabase — one suite, two implementations

`submit-lead.integration.test.ts`, `escalate-to-human.integration.test.ts` and
`log-support-chat.integration.test.ts` run their cases with `describe.each`
over Base44 and Edge, as §4.22 does for the claim, so the Edge functions keep
the guards, answers, mail and sheet rows the Base44 ones have. Differences are
their own cases: Edge `submit-lead` writes the Google event and sheet row
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
sheet append, PostgREST helpers). The live smoke asks `submit-lead` and
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

### 4.24 `contentAdmin` — the article's address — `INT-CNT-001..008`

`content-admin.integration.test.ts`. The slug is the Supabase mirror's alone,
so it is validated and checked for uniqueness before Base44 is written — a
refusal from the mirror's unique constraint would arrive after the Base44 row
exists. An update is a PATCH by `base44_id` carrying only what changed, so a
publish toggle touches `published` and nothing else; a PATCH that finds no row
is a failure, never a silently created row.

| ID | Title | Expected result |
|---|---|---|
| INT-CNT-001 | "refuses to create an article with %s, before writing anything" (4) | 400 with `error` and `rid`; no Base44 create; no `blog_posts` call |
| INT-CNT-002 | "refuses a slug another article has with 409, before writing Base44" | 409 "הכתובת כבר בשימוש במאמר אחר."; no create, no mirror POST |
| INT-CNT-003 | "writes the slug to the mirror and keeps it out of Base44" | Base44 fields have no `slug`; the mirror POST has `slug: koteret` |
| INT-CNT-004 | "updates the mirror in place with a PATCH of only what changed" | `PATCH …?base44_id=eq.post-1` with `{ published: false }`; no slug lookup |
| INT-CNT-005 | "never sends a null or empty slug to the mirror" | An update without a slug sends a body with no `slug` key; a null or empty slug is 400 with no write; a create always sends the validated slug |
| INT-CNT-006 | "lets an article keep its own slug, and sends it to the mirror only" | 200; Base44 update has no `slug`; PATCH carries it |
| INT-CNT-007 | "fails an update whose mirror row is missing" | 500 |
| INT-CNT-008 | "refuses to rename an article to a slug another one has" | 409; no Base44 update |

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

### 4.26 `masleka-reveal` — a member decrypts one value — `INT-MSKREV-001..020`

`tests/integration/masleka-reveal.integration.test.ts`, through the in-process
harness with its clearinghouse fakes (`MaslekaFake`: sessions for
`GET /auth/v1/user`, roles for the `staff_role` RPC). Every call proves its
caller (`staffCaller`); the request is read by its UUID-checked id and agency 1
with named columns; the access row (who, which request, which field — its
agency copied from the request) is written before the value is unsealed with
`<id>:<field>` as its context, and a failed write reveals nothing.

| ID | Title | Expected result |
|---|---|---|
| INT-MSKREV-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 exactly `{ error: 'disabled', rid }`; no fetch |
| INT-MSKREV-002 | "stays dark for anything but exactly true, before reading the body" | `TRUE`, `1`, `yes`, `true1` with a non-JSON body: 404 `disabled` (not `invalid`); no fetch |
| INT-MSKREV-003 | "refuses a caller with no session" | 401 `unauthorized` + rid; no `masleka_requests` call; no log row |
| INT-MSKREV-004 | "refuses a session the auth server does not recognise" | 401; no `staff_role` call; no `masleka_requests` call |
| INT-MSKREV-005 | "refuses a signed-in user who is not staff, and logs no access" | 403 `forbidden` + rid; no log row; no `masleka_requests` call |
| INT-MSKREV-006 | "a membership removed between two calls is refused on the second" | 200 then 403 with the same session; no value, no log row on the second |
| INT-MSKREV-007 | "asks the auth server and staff_role about the caller on every call" | One `GET /auth/v1/user` with the bearer token; one `staff_role` with `{ p_user_id }` |
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
| INT-MSKSUB-011 | "does not find a request that is not there, or not the agency's, and leaves the other agency's values alone" | 404 `not_found`; other agency's ciphertext untouched |
| INT-MSKSUB-012 | "scopes the write to the agency, whatever the body says" | `agency_id=eq.<AGENCY_1>`; body's agency, status and `submitted_by` ignored |
| INT-MSKSUB-013 | "refuses an id that is not one, before touching the table" | 400 `invalid` (not a UUID, injection, non-string, missing, bad JSON); no `masleka_requests` call |
| INT-MSKSUB-014 | "lowercases the id once it is validated, so the filter and the answer agree" | Upper-case UUID: 200; filter `id=eq.<lowercase>` |
| INT-MSKSUB-015 | "never writes a ciphertext, a name or the session token to a log line" | Across success, failed write and outsider: every line has `rid`; no ciphertext, client name, last4 or session token |
| INT-MSKSUB-016 | "answers the browser's preflight and does nothing else" | 204, site origin allowed; no fetch |

### 4.28 `masleka-create` — a hand-made request, or a fresh link — `INT-MSKNEW-001..023`

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
| INT-MSKNEW-020 | "does not touch another agency's request, or one that is not there" | 409; hash unchanged |
| INT-MSKNEW-021 | "answers 500 and no link when the update fails" | 500 `failed`; no link |
| INT-MSKNEW-022 | "refuses a request that is no longer waiting for a code" | 409; hash unchanged |
| INT-MSKNEW-023 | "refuses an id that is not one" | 400 `invalid`; no `masleka_requests` call |

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
| INT-CDP-007 | "says nothing of it when no file is stored on the site" | No such line — the Base44 and Edge mails still match |

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

## 5. Pass criteria

All 171 declared cases pass (vitest: 751 with expansions). These assert behaviour, not shape — a failure means the
function now does something different, so fix the function rather than the
expectation.

## 6. Known gaps

- **`createConsultationEvent`** is not executed here. It is no longer on the
  interview agent either — `submitLead` writes the diary itself, in the request
  that saved the lead, and *that* path **is** covered: `submit-lead.integration.test.ts`
  drives the provider loop, asserts the agreed hour reaches the calendar, and
  asserts that a refusal is reported per calendar rather than as one flat
  failure. What is left uncovered is the function's own HTTP surface, which now
  has a live caller only if the adapter's `requestConsultationEvent` is wired
  up; today nothing calls it.

That one belongs in [10-known-issues.md](10-known-issues.md) until it is covered.
`submitClaim` was on this list and no longer is — §4.10 executes it.

### Resend delivery to the agency

`tests/integration/resend.integration.test.ts` runs all three notification entry
points with mocked Resend HTTP and backend secrets. It checks fixed recipients,
configured sender and authorization, missing key/sender, HTTP 401/403/429/500,
network failures, and malformed successful responses. Failures retain the enquiry
and allow operations notifications to proceed. The helper parity check guards
against drift across isolated entry points. No test sends real email.
The shared harness injects Deno environment access and records Resend deliveries
alongside existing Base44 deliveries for the existing recipient/content tests.
