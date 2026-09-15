# STD-12 — Integration Tests

**Suite:** `integration` · **Runner:** `npm run test:integration` (Vitest, node)
**Location:** `tests/integration/` · **Cases:** 45

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
default export against a recording client. Entity writes, `Core.SendEmail`,
connector lookups and outbound `fetch` are all captured rather than performed, so
a run touches no network, no mailbox and no live data. The harness can be told to
fail any of them — `failLeadWrite`, `failEmailTo`, `failFetch`, a `null`
connector token — which is how the failure paths below are reached.

Its result exposes `status`, `json`, `leads`, `emails`, `mailTo(address)` and
`callsTo(host)`.

## 3. Coverage

| Function | Where it is called from |
|---|---|
| `submitLead` | every form on the site, and the booking and interview agents |
| `escalateToHuman` | all three on-site agents |

`submitClaim`, `createConsultationEvent` and `createOutlookEvent` are not yet
executed here. See §6.

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

### 4.7 `escalateToHuman` — handing over — `INT-ESC-001..005`

Records the escalation and notifies both inboxes, stamps the record with the
consent wording the visitor was shown, always hands the contact channels back to
the agent whatever else failed, and flags the reasons that must not wait in a
queue.

### 4.7 `escalateToHuman` — a reason the model made up — `INT-ESC-006..010`

The reason arrives from a language model, so it is clamped to the declared
vocabulary. `__proto__` and `constructor` are clamped to `uncertain` rather than
resolving off the prototype chain; anything simply invented, or missing, is
clamped too; a declared reason is kept exactly as given.

### 4.8 `escalateToHuman` — redaction and precedence — `INT-ESC-011..017`

Identifiers are redacted before the record is written *and* before the
notification is sent, while an ordinary summary is left alone. The notification
outranks the record throughout: a visitor with no contact details, an invalid
phone number, or a failed write still produces a notification, and the agent
still receives contact channels even when every mailbox bounces. The handing
agent is named, so a pattern is visible later.

## 5. Pass criteria

All 45 cases pass. These assert behaviour, not shape — a failure means the
function now does something different, so fix the function rather than the
expectation.

## 6. Known gaps

- **`submitClaim` is not executed here.** Its customer confirmation shares the
  template `submitLead` uses, and `agents.contract.test.ts` pins the two copies
  byte-identical, but no test calls the function. Its escaping is therefore
  guaranteed by duplication rather than by execution.
- **`createConsultationEvent` and `createOutlookEvent`** are only observed
  indirectly, through the `Promise.allSettled` that `submitLead` fires at them.

Both belong in [10-known-issues.md](10-known-issues.md) until they are covered.
