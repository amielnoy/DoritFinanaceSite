# STD-01 — Unit Tests

**Suite:** `unit` · **Runner:** `npm run test:unit` (Vitest) · **Location:** `tests/unit/`
**Cases:** 237 · **Environment:** node, except files ending `.dom.test.ts` (jsdom)

`tests/unit/seo.dom.test.ts` also runs under `npm run test:unit`; its 19 cases
are specified in [11-std-seo](11-std-seo.md) beside the e2e cases they pair
with, and are not repeated here.

---

## 1. Purpose

Verify the repository's pure logic in isolation: the pension fee projection that
drives the site's headline calculator, the routing/class helpers, the
security-sensitive `?returnTo=` guard, the contact configuration that four
different call-to-action shapes derive from, the admin data services, the
published FAQ and self-assessment content, the submission state machine every
form shares, and the two maintenance scripts that can change or delete
something outside the repository.

## 2. Test items

| Item | Source |
|---|---|
| `computePensionFees`, `formatIls` | `src/lib/pension-fee.ts` |
| `createPageUrl` | `src/utils/index.ts` |
| `cn` | `src/lib/utils.js` |
| `safeReturnTo` | `src/lib/authReturnTo.js` |
| `CONTACT` | `src/config/contact.js` |
| `useSubmission`, `submissionErrorMessage` | `src/hooks/useSubmission.ts` |
| `Base44LeadAdminService`, `Base44ContentAdminService` | `src/services/base44/` |
| `SupabaseAuthService` | `src/services/supabase/SupabaseAuthService.ts` |
| FAQ content | `src/content/faq.ts` |
| Insurance self-assessment | `src/lib/insurance-assessment.ts` |
| `reconcile-stores`, `prune-vercel-deployments` | `scripts/*.mjs` |
| `planSeed`, `mirrorRow`, `readExecResult` | `scripts/seed-blog.mjs` |
| `invokeFunction`, `responseBody` — through `Base44LeadService`, `Base44SupportService` | `src/services/base44/invoke.ts` |

> **Note.** `computePensionFees` was extracted from `PensionFeeCalculator.tsx`
> during this work so the maths could be exercised without a DOM. The component
> now consumes it; behaviour is unchanged.

## 3. Approach

Deterministic, no I/O, no mocks. Financial figures are asserted both as exact
values where arithmetic is closed-form (total contributions, deposit fees) and
as invariants where it is iterative (balance > contributions, fees monotone in
the fee rate). Hostile input is exercised because every field is a free-text
`<input type=number>` a visitor can clear.

## 4. Test cases

### 4.1 Pension fee maths — `tests/unit/pension-fee.test.ts`

| ID | Title | Preconditions / input | Expected result |
|---|---|---|---|
| UNIT-PFC-001 | "returns the site's default scenario with coherent totals" | ₪2,000/mo, 2% deposit fee, 0.5% annual, 25 y, 5% return | `totalDeposited = 600,000`; `totalDepositFees ≈ 12,000`; `totalFees = deposit + annual`; `balance > totalDeposited`; `lostToFees > 0` |
| UNIT-PFC-002 | "is fee-free when both fee rates are zero" | Both fee rates 0 | All fee totals 0; `lostToFees ≈ 0` |
| UNIT-PFC-003 | "compounds nothing when the expected return is zero" | ₪1,000/mo, 10 y, 0% return, no fees | `balance ≈ 120,000` |
| UNIT-PFC-004 | "charges deposit fees exactly as a share of gross contributions" | 6% deposit fee | `totalDepositFees = totalDeposited × 0.06` |
| UNIT-PFC-005 | "monotonically shrinks the balance as fees rise" | Annual fee 0.1 / 0.5 / 1.5% | Balance strictly decreasing; `lostToFees` increasing |
| UNIT-PFC-006 | "grows the balance as the horizon lengthens" | 5 y vs 30 y | Longer horizon yields larger balance and contributions |
| UNIT-PFC-007 | "treats empty strings, junk and undefined as zero instead of NaN" | `""`, `"abc"` in every field | Every returned figure is finite and `0` |
| UNIT-PFC-008 | "accepts numeric strings from the `<input type=number>` fields" | All inputs as strings | Identical to the numeric-input result |
| UNIT-PFC-009 | "never produces negative or non-finite figures for negative years" | `years = -5` | Zero contributions and balance; finite `lostToFees` |
| UNIT-PFC-010 | "floors fractional years to whole months rather than looping oddly" | `years = 1.5` | 18 monthly contributions |
| UNIT-PFC-011 | "renders whole shekels with the ILS symbol" | `formatIls(1234.6)` | Contains `₪` and `1,235`; no decimal part |
| UNIT-PFC-012 | "survives NaN and undefined-ish values" | `formatIls(NaN)`, `formatIls(0)` | Returns a `₪` string, never throws |

### 4.2 Helpers — `tests/unit/utils.dom.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-UTL-001 | "prefixes a leading slash" | `createPageUrl("Home") === "/Home"` |
| UNIT-UTL-002 | "turns spaces into hyphens so page names stay URL-safe" | `"Blog Admin"` → `/Blog-Admin` |
| UNIT-UTL-003 | "handles the empty name without producing a double slash" | `""` → `/` |
| UNIT-UTL-004 | "joins conditional class names" | Falsy entries dropped |
| UNIT-UTL-005 | "lets the later Tailwind class win a conflict" | `cn("px-2","px-4") === "px-4"` |
| UNIT-UTL-006 | "returns an empty string for no input" | `cn() === ""` |

> jsdom is required only because `src/lib/utils.js` reads `window` at module
> scope (`isIframe`); see [10-known-issues](10-known-issues.md).

### 4.3 Open-redirect guard — `tests/unit/auth-return-to.dom.test.ts`

| ID | Title | Input | Expected result |
|---|---|---|---|
| UNIT-RET-001 | "defaults to / when no returnTo is present" | no query | `"/"` |
| UNIT-RET-002 | "keeps a plain same-origin path" | `/admin/leads` | `"/admin/leads"` |
| UNIT-RET-003 | "keeps normal app query params on the target path" | `/blog?page=2` | `"/blog?page=2"` |
| UNIT-RET-004 | "accepts an absolute same-origin URL and reduces it to a path" | `<origin>/claims` | `"/claims"` |
| UNIT-RET-005..012 | "rejects …" (8 cases) | `https://evil.com/`, `//evil.com`, `/\evil.com`, `/.//evil.com`, `\/evil.com`, `javascript:alert(1)`, `http://evil.com/steal`, `//evil.com/%2f..` | `"/"` for every one |
| UNIT-RET-013 | "never returns a value that could become protocol-relative" | all of the above | Result starts with exactly one `/`, contains no `\`, has no scheme |
| UNIT-RET-014..019 | "drops ?`<param>`=" (6 cases) | `access_token`, `clear_access_token`, `app_id`, `app_base_url`, `functions_version`, `from_url` | Param absent from the result |
| UNIT-RET-020 | "strips the bootstrap params but preserves the rest of the query" | `/oauth/consent?ctx=abc123&access_token=pwned` | `ctx` kept, `access_token` gone |

### 4.4 Contact configuration — `tests/unit/contact-config.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-CNT-001 | "exposes an E.164 dial number" | Matches `^\+972\d{9}$` |
| UNIT-CNT-002 | "exposes a wa.me number with no plus and no leading zero" | Matches `^972\d{9}$` |
| UNIT-CNT-003 | "keeps the wa.me number in sync with the dial number" | `whatsapp === phoneE164.replace("+","")` |
| UNIT-CNT-004 | "keeps the display number in sync with the dial number" | Digits of `phoneDisplay` reconstruct `phoneE164` |
| UNIT-CNT-005 | "exposes a valid contact email" | Matches an email shape |
| UNIT-CNT-006 | "`<file>` does not hardcode the phone number or email" | One case per first-party source file under `src/`, so the count grows with the tree |

> UNIT-CNT-006 is generated from the file list, not written out: a second copy
> of the number is the failure mode this suite exists to catch, and a copy is
> only ever added in a file nobody thought to list. The number and the address
> may appear in `src/config/contact.js` and nowhere else.

### 4.5 Supabase auth adapter — `tests/unit/supabase-auth.test.ts`

`AuthPort` over Supabase. The semantics `AuthContext` depends on: the role comes
from `profiles` rather than the token, and failures carry the reason the context
distinguishes on.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SBA-001 | "reports the signed-in user with the role from profiles" | id, email, full_name, role |
| UNIT-SBA-002 | "reads the role from the table, never from the token" | A revoked role cannot survive in a stale JWT |
| UNIT-SBA-003 | "defaults a null role to user" | `role === "user"` |
| UNIT-SBA-004 | "asks for sign-in with the reason AuthContext looks for" | 403 + `auth_required` |
| UNIT-SBA-005 | "separates not-provisioned from not-signed-in" | 403 + `user_not_registered` |
| UNIT-SBA-006 | "sends the visitor to Google, returning where they started" | `signInWithOAuth` with `redirectTo` |
| UNIT-SBA-007 | "signs out before redirecting, not after" | `signOut` precedes navigation |
| UNIT-SBA-008 | "answers hasStoredToken synchronously" | Reflects the injected checker |
| UNIT-SBA-009 | "routes redirectToLogin through the same Google flow" | Both doors reach Google, with `prompt: select_account` so the visitor always chooses the account |
| UNIT-SBA-010 | "signs in with an address and a password" | Credentials forwarded verbatim |
| UNIT-SBA-011 | "throws on bad credentials, which Supabase reports without rejecting" | Rejects with the provider's message |
| UNIT-SBA-012 | "does not navigate: the caller owns the guarded destination" | Resolves without redirecting |

### 4.6 Store reconciliation — `tests/unit/reconcile.test.ts`

The gate phase 4 rests on: the flip is safe once the two stores have agreed for
a sustained stretch, and "agreed" has to be checkable. Exits non-zero on drift
so it can gate the cutover rather than merely describe it.

| ID | Title | Expected result |
|---|---|---|
| UNIT-REC-001 | "is silent when they agree, despite blanks spelled differently" | `""` and NULL are not a disagreement |
| UNIT-REC-002 | "reports a lead the mirror never copied" | Listed as missing |
| UNIT-REC-003 | "reports a Supabase row with no counterpart" | Listed as orphaned |
| UNIT-REC-004 | "reports an update that reached only one store" | Listed as mismatched |
| UNIT-REC-005 | "names every field that differs, not just the first" | All differing fields |
| UNIT-REC-006 | "matches contacts on the phone number, however punctuated" | No false drift |
| UNIT-REC-007 | "compares a rating by value" | `5` equals `"5"` |
| UNIT-REC-008 | "compares published by truth, not spelling" | Real drift still caught |

### 4.7 Vercel preview pruning — `tests/unit/prune-vercel.test.ts`

The one rule in the nightly prune that can destroy something. Age decides what
goes; two guards decide what never does. Both guards are asserted here rather
than left to the `target=preview` API filter, so that widening that query later
cannot quietly turn a janitor into a production reaper.

| ID | Title | Expected result |
|---|---|---|
| UNIT-PRV-001 | "deletes an unaliased preview past the age limit" | `{ ok: true }` |
| UNIT-PRV-002 | "keeps a preview that is not yet old enough" | `too-new` |
| UNIT-PRV-003 | "keeps a preview aged exactly the age limit" | `too-new` — the boundary is kept, not deleted |
| UNIT-PRV-004 | "keeps an old preview that still has an alias" | `aliased` — an alias is evidence of use |
| UNIT-PRV-005 | "keeps a production deployment however old" | `not-preview` |
| UNIT-PRV-006 | "keeps a deployment with no target rather than guessing" | `not-preview` |

### 4.8 Admin data services — `tests/unit/admin-services.test.ts`

The two services the admin screens talk to, exercised against a recording
store. What matters here is the request that leaves: a partial update must stay
partial, because the admin forms send only the field that changed and anything
the service adds of its own would overwrite a column nobody edited.

| ID | Title | Expected result |
|---|---|---|
| UNIT-ADM-001 | "asks for leads newest-first" | Sorted descending by creation |
| UNIT-ADM-002 | "accepts a caller-chosen page size" | Limit forwarded |
| UNIT-ADM-003 | "returns an array when the store answers with nothing" | `[]`, never `undefined` |
| UNIT-ADM-004 | "patches only the status when a lead is moved along" | One field in the payload |
| UNIT-ADM-005 | "deletes by id" | Delete called with the id |
| UNIT-ADM-006 | "lists every article, drafts included" | No published filter |
| UNIT-ADM-007 | "creates an article with published coerced to a boolean" | `true`/`false`, not `"on"` |
| UNIT-ADM-008 | "forwards a partial update without inventing the fields it was not given" | Payload has exactly the edited keys |
| UNIT-ADM-009 | "defaults a testimonial's rating and source rather than sending empty ones" | Defaults applied |
| UNIT-ADM-010 | "keeps a rating the visitor actually chose" | Explicit value survives |
| UNIT-ADM-011 | "removes an article and a testimonial by id" | Delete called on both entities |

### 4.9 FAQ content — `tests/unit/faq-content.test.ts`

`src/content/faq.ts` is published copy that also feeds the `FAQPage` structured
data (SEO-LD-*), so a duplicate or dangling entry is both a reader-facing and a
rich-result defect.

| ID | Title | Expected result |
|---|---|---|
| UNIT-FAQ-001 | "has unique, stable ids" | No duplicate id |
| UNIT-FAQ-002 | "puts every entry in a declared category, and no category is empty" | Categories and entries agree both ways |
| UNIT-FAQ-003 | "has a question and an answer of substance on every entry" | No placeholder or stub copy |
| UNIT-FAQ-004 | "numbers the home-page tips 1..n with no gaps or repeats" | Contiguous from 1 |
| UNIT-FAQ-005 | "resolves every home-page common question to a real entry, once" | No dangling reference, no repeat |
| UNIT-FAQ-006 | "does not repeat an answer under two questions" | Distinct answers |

### 4.10 Insurance self-assessment — `tests/unit/insurance-assessment.test.ts`

The questionnaire maps answers to suggested cover. It is guidance on a
regulated subject, so the rules are asserted individually rather than through
the rendered result, and the unanswered case is asserted too — a visitor who
abandons the form halfway still gets a screen.

| ID | Title | Expected result |
|---|---|---|
| UNIT-ASM-001 | "asks four questions, each with a stable id and at least two options" | Shape of the questionnaire |
| UNIT-ASM-002 | "always suggests supplementary health cover" | Present in every result |
| UNIT-ASM-003 | "makes life cover a priority for parents, couples and anyone with a mortgage" | Prioritised on those answers |
| UNIT-ASM-004 | "treats loss of working capacity as critical for the self-employed" | Critical priority |
| UNIT-ASM-005 | "raises critical-illness cover only on a medical or family history" | Not raised otherwise |
| UNIT-ASM-006 | "puts pension planning first for someone approaching retirement" | Ranked first |
| UNIT-ASM-007 | "never returns the same insurance type twice, and gives every result a reason" | Deduplicated; every item carries its reason |
| UNIT-ASM-008 | "copes with unanswered questions" | A result, not a throw |

### 4.11 Submission state machine — `tests/unit/use-submission.dom.test.ts`

`useSubmission` is what all three lead forms share, so its double-submit guard
is the single place that stops one enquiry being filed twice.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SUB-001 | "names what failed to send" | Message identifies the form |
| UNIT-SUB-002 | "takes the fallback address from config, never from the copy" | Reads `CONTACT`, matching UNIT-CNT-006 |
| UNIT-SUB-003 | "starts idle" | `idle` |
| UNIT-SUB-004 | "moves idle → sending → sent and reports success" | States in order; success reported |
| UNIT-SUB-005 | "moves to error with the right copy and reports failure" | `error` + the UNIT-SUB-001 message |
| UNIT-SUB-006 | "runs the task once when submitted twice concurrently" | One invocation — the double-submit guard |
| UNIT-SUB-007 | "clears the previous error when resubmitting" | No stale error on retry |
| UNIT-SUB-008 | "reset returns it to idle" | `idle` |

### The agent adapter — `agent-service.test.ts`

Nine cases on `Base44AgentService`, all of them failure paths, because the
failure paths are what was wrong. Nothing in the battery had ever exercised a
failing `/agents/` call.

| ID | Title | Expected result |
|---|---|---|
| UNIT-AGT-001 | "does not spend a turn on a send that failed" | 45 failed sends all reach the backend; the cap never fires. Counting attempts rather than model invocations meant an outage eventually reported itself as "השיחה הגיעה לאורכה המרבי" |
| UNIT-AGT-002 | "still refuses once the visitor has actually taken the maximum turns" | `AgentLimitError("too_many_turns")` after 40 successful sends |
| UNIT-AGT-003 | "refuses an over-long message without calling the backend at all" | `AgentLimitError("too_long")`; `addMessage` never called |
| UNIT-AGT-004 | "fails with its own error instead of handing undefined to the SDK" | `agent_conversation_gone`; `addMessage` never called |
| UNIT-AGT-005 | "keeps ordinary user and assistant turns unchanged" | Both pass through |
| UNIT-AGT-006 | "drops a message the platform marked hidden" | `[]` |
| UNIT-AGT-007 | "drops a system message rather than dressing it as the agent" | `[]` — `role === "user"` is false for `system`, so it used to render in an assistant bubble |
| UNIT-AGT-008 | "drops content that is not a non-empty string" | `[]` for an object, a missing `content` and an empty one. An object reaches `<ReactMarkdown>` as a React child and, with no error boundary above the chat, whites out the SPA |
| UNIT-AGT-009 | "passes the survivors through in order" | Order preserved after filtering |

### 4.12 Seeding the articles into both stores — `tests/unit/seed-blog.test.ts`

The repo's articles are written to Base44 first — the site and the blog
recommender still read it — and mirrored to Supabase on `base44_id`. The case
worth pinning is what a re-run must not do: take down a post Dorit has
published. See [A-65](10-known-issues.md).

| ID | Title | Expected result |
|---|---|---|
| UNIT-SEED-001 | "creates an article Base44 has never seen, as a draft" | `op: create`, `published: false` |
| UNIT-SEED-002 | "updates the post with the same title instead of adding a second one" | `op: update` on the matched id |
| UNIT-SEED-003 | "leaves a published post published when the content is re-seeded" | The update payload carries no `published` |
| UNIT-SEED-004 | "carries the Base44 id, so the two copies are one row" | Mirror row has `base44_id` |
| UNIT-SEED-005 | "mirrors the published state Base44 actually holds" | Mirror `published` follows Base44, not the file |
| UNIT-SEED-006 | "finds the marked result among the CLI's own output" | Parsed past npm notices and the update banner |
| UNIT-SEED-007 | "says the CLI may be signed out rather than parsing nothing" | Throws naming `base44 login` |

### 4.13 Reading a function's answer — `tests/unit/function-receipts.test.ts`

`functions.invoke` resolves to the whole axios response, not the body
(`interceptResponses: false` in the SDK). These feed the adapters that shape —
every other fake returns a bare body, which is how A-67 went unseen.

| ID | Title | Expected result |
|---|---|---|
| UNIT-RCP-001 | "reports an interview that saved as saved" | `ok: true`, `rid` read from the body |
| UNIT-RCP-002 | "reports a lead that saved as saved" | `ok: true` |
| UNIT-RCP-003 | "still accepts a bare body, as the in-memory fakes return" | `ok: true` |
| UNIT-RCP-004 | "reports a handoff that reached Dorit as one that did" | `ok: true`, `contact` from the body — not the fallback |

### 4.14 Personal area adapters — `account-services.test.ts`

One mapper and two adapters behind `AccountPort`. The Base44 cases are fed the
SDK's real axios-wrapped response and the rejection the SDK really throws — an
AxiosError with `.status` and the body under `.response.data`, because the SDK
builds its functions client with `interceptResponses: false` — not a bare body,
because a bare body is what hid the wrapper before. One case keeps the
Base44Error shape (`.status`, `.data`) so both work.

| ID | Title | Expected result |
|---|---|---|
| UNIT-ACC-001 | "maps a row to the page's shape" | snake_case columns become the camelCase `Enquiry` |
| UNIT-ACC-002 | "survives an old enquiry with no profile" | `profile` is `[]` for a null profile and a null summary |
| UNIT-ACC-003 | "drops a profile that is not label/value pairs rather than crashing" | An object gives `[]`; malformed pairs are filtered out and valid ones kept |
| UNIT-ACC-004 | "reads my_enquiries over RPC" | `rpc("my_enquiries")` called; rows mapped |
| UNIT-ACC-005 | "turns an RPC error into AccountLoadError" | Rejects with `AccountLoadError` |
| UNIT-ACC-006 | "reads the body out of the axios wrapper" | `invoke("myAccount", {})`; one enquiry returned |
| UNIT-ACC-007 | "names a 401 as signed out, a 403 as unverified, else failed — keeping the rid, off the AxiosError the SDK throws" | `signed_out`, `unverified`, and `failed` for 500, each with the rid read from `response.data` |
| UNIT-ACC-008 | "names RPC error 42501 as signed out" | `AccountLoadError("signed_out")` — `my_enquiries` is revoked from anon |
| UNIT-ACC-009 | "names RPC error PGRST301 as signed out" | `signed_out` — JWT missing, expired or invalid |
| UNIT-ACC-010 | "names an unrecognised RPC error code as failed" | `failed`; Supabase never yields `unverified` |
| UNIT-ACC-011 | "fails with the rid when the body says ok:false" | `failed` with the rid |
| UNIT-ACC-012 | "fails with the rid when ok:true carries no enquiries array" | `failed` with the rid, not an empty list |
| UNIT-ACC-013 | "also reads a Base44Error-shaped rejection (status and data on the error)" | 403 with `data.rid` gives `unverified` and the rid |
| UNIT-ACC-014 | "failureOf: reads an AxiosError: status and body under response" | `{ status: 500, body: { rid } }` |
| UNIT-ACC-015 | "failureOf: prefers the response status when the error has none of its own" | Status and body taken from `response` |
| UNIT-ACC-016 | "failureOf: reads a Base44Error: status and data on the error" | Status and body taken from the error itself |
| UNIT-ACC-017 | "failureOf: gives nothing for a body that is not an object, or a non-error" | `body` is undefined for an HTML string, `undefined` or a string rejection |

### 4.15 Lead events for GA4 — `tests/unit/analytics.dom.test.ts`

What a visitor did, never who they are. `track` passes on only the parameters
it knows, so a name, phone or email cannot reach Google even if a caller adds
one; a blocked or throwing tag never breaks the page.

| ID | Title | Expected result |
|---|---|---|
| UNIT-GA4-001 | "sends the event and its parameters to gtag" | `gtag("event", name, params)` |
| UNIT-GA4-002 | "drops any parameter it does not know, so personal data cannot ride along" | `email`, `phone`, `name` removed |
| UNIT-GA4-003 | "does nothing when the tag is blocked" | No throw without `gtag` |
| UNIT-GA4-004 | "never throws, even when gtag does" | No throw |
| UNIT-GA4-005 | "marks the agency's own browsing as internal" | `traffic_type: internal` added |
| UNIT-GA4-006 | "is set by ?internal=1 and cleared by ?internal=0" | Flag toggles |
| UNIT-GA4-007 | "counts a submitted form as a lead" | `generate_lead {method: contact_form}` |
| UNIT-GA4-008 | "names the chat that started and the one that asked for a person" | `chat_start` / `chat_handoff` carry `method` |
| UNIT-GA4-009 | "every event it sends is in the catalogue the admin panel shows" | Every sent name is in `LEAD_EVENTS` |
| UNIT-GA4-010 | "reports a phone link with the section it sits in" | `click_phone {location: <section id>}` |
| UNIT-GA4-011 | "prefers an explicit data-track-location" | `data-track-location` wins |
| UNIT-GA4-012 | "reports mail links and the start-conversation call to action" | `click_email`, `cta_click` |
| UNIT-GA4-013 | "ignores every other link" | Nothing sent |
| UNIT-GA4-014 | "registers once, however often it is called" | One listener |

## 5. Pass criteria

All 303 cases pass. Any failure is a functional defect, not an environment issue —
these tests have no external dependencies.
