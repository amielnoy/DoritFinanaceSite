# STD-12 — Integration Tests

**Suite:** `integration` · **Runner:** `npm run test:integration` (Vitest, node)
**Location:** `tests/integration/` · **Cases:** 168

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
| `upsertContact` | no caller yet — built for a channel that supplies a phone number, dormant per B-8 |
| `logSupportChat` | the support agent, at the end of every conversation |
| `dorit-mailer` | every message the backend sends — a Cloudflare Pages Function, run in-process here |

`createConsultationEvent` and `createOutlookEvent` are not yet executed here.
See §6.

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

Books nothing for a quick contact form; honours an explicit `scheduledAt`; falls
back to tomorrow morning when no time was agreed; asks for a reminder and sets
the Israel timezone; authorises with the connector token and never returns it to
the caller.

### 4.6 `submitLead` — a finished introduction interview — `INT-LEAD-031..038`

The interview agent used to end at `Lead.create`: the approved profile was
stored and nobody was told. It ends at `submitLead` now, under
`source='interview'`, and these run that path. Both staff copies go out as HTML
with a plain-text twin and carry the whole profile in each half; the subject and
the headline both name it an interview rather than an enquiry; the profile gets
its own heading in the layout; the record keeps the `[ראיון היכרות]` marker and
the interview source; no calendar slot is booked, because an interview agrees no
time. Two cases cover what is specific to a model-written record: the profile
itself passes through `redact()`, unlike a message a visitor typed, and the
visitor's own confirmation names the topic without mailing the bullets back. A
last case pins that the staff copies still go out when no address was given.

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

## 5. Pass criteria

All 200 cases pass. These assert behaviour, not shape — a failure means the
function now does something different, so fix the function rather than the
expectation.

## 6. Known gaps

- **`createConsultationEvent` and `createOutlookEvent`** are only observed
  indirectly, through the `Promise.allSettled` that `submitLead` fires at them.

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
