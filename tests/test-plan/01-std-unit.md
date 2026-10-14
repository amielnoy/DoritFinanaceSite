# STD-01 — Unit Tests

**Suite:** `unit` · **Runner:** `npm run test:unit` (Vitest) · **Location:** `tests/unit/`
**Cases:** 858 declared cases (IDs in section 4; a range such as `X-001..014` counts each ID); `npm run test:unit` runs 1447 including `it.each` / `describe.each` expansions · **Environment:** node, except files ending `.dom.test.ts` (jsdom)

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
| `CONTACT` | `src/config/contact.ts` (values from `src/config/agencyProfile.ts`) |
| `useSubmission`, `submissionErrorMessage` | `src/hooks/useSubmission.ts` |
| `Base44LeadAdminService`, `Base44ContentAdminService` | `src/services/base44/` |
| `SupabaseAuthService` | `src/services/supabase/SupabaseAuthService.ts` |
| FAQ content | `src/content/faq.ts` |
| Insurance self-assessment | `src/lib/insurance-assessment.ts` |
| `reconcile-stores`, `prune-vercel-deployments` | `scripts/*.mjs` |
| `planSeed`, `mirrorRow`, `readExecResult` | `scripts/seed-blog.mjs` |
| `articlePath`, `slugProblem`, `isValidSlug` | `src/lib/articlePath.ts` |
| `planReconcile`, `readExecResult` | `scripts/reconcile-leads.mjs` |
| `fetchPublishedArticles`, `planArticles`, `fixtureArticleFor`, `duplicateTitles` | `scripts/published-articles.mjs` |
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
| UNIT-PFC-013 | "grows existing savings alone when nothing is deposited" | `startingBalance` 100,000, 12% a year, 1 y, no deposits | `100,000 × 1.01¹²`; nothing deposited |
| UNIT-PFC-014 | "charges the balance fee on the opening balance and counts it in what fees cost" | 200,000 opening, 0.5% a year, 10 y | Balance fees > 0; `lostToFees` ≥ them |
| UNIT-PFC-015 | "is the calculator's own result when the opening balance is left out or not positive" | `startingBalance` 0 or −5 | Equal to the result without one |

### 4.2 Helpers — `tests/unit/utils.dom.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-UTL-001 | "prefixes a leading slash" | `createPageUrl("Home") === "/Home"` |
| UNIT-UTL-002 | "turns spaces into hyphens so page names stay URL-safe" | `"Blog Admin"` → `/Blog-Admin` |
| UNIT-UTL-003 | "handles the empty name without producing a double slash" | `""` → `/` |
| UNIT-UTL-004 | "joins conditional class names" | Falsy entries dropped |
| UNIT-UTL-005 | "lets the later Tailwind class win a conflict" | `cn("px-2","px-4") === "px-4"` |
| UNIT-UTL-006 | "returns an empty string for no input" | `cn() === ""` |

`tests/unit/utils.node.test.ts` runs in the node environment (no jsdom):

| ID | Title | Expected result |
|---|---|---|
| UNIT-UTL-007 | "has no window in this environment" | `typeof window === "undefined"` |
| UNIT-UTL-008 | "loads and cn() merges classes" | Module imports; `cn("px-2","px-4") === "px-4"` |
| UNIT-UTL-009 | "reports isIframe as false when there is no window" | `isIframe === false` |

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

### Token wipe at boot — `tests/unit/clear-access-token.dom.test.ts`

`?clear_access_token=true` is honoured at boot by `src/lib/clear-access-token.ts` (SEC-TOK-002). It used to run only when the lazily loaded SDK did.

| ID | Title | Input | Expected result |
|---|---|---|---|
| UNIT-TOK-001 | "wipes both token keys when the flag is set" | both keys seeded, `/faq?clear_access_token=true` | returns `true`; both keys `null` |
| UNIT-TOK-002 | "leaves unrelated storage alone" | a Supabase session key beside the tokens | the Supabase key survives |
| UNIT-TOK-003 | "removes only the flag from the URL, keeping the path, other params and hash" | `/blog/x?access_token=new&clear_access_token=true&utm_source=mail#faq` | `/blog/x?access_token=new&utm_source=mail#faq` |
| UNIT-TOK-004 | "drops the `?` when the flag was the only parameter" | `/tools?clear_access_token=true` | `/tools` |
| UNIT-TOK-005..008 | "does nothing for …" (4 cases) | no query, `=false`, `=1`, `=` | returns `false`; token kept; URL unchanged |
| UNIT-TOK-009 | "strips the flag from a path that starts with // without leaving the origin" | `<origin>//evil.example/x?clear_access_token=true` | same origin; path `//evil.example/x`; tokens gone (a relative `//…` would be protocol-relative and make `replaceState` throw at boot) |
| UNIT-TOK-010 | "still wipes, and does not throw, when replaceState throws" | `replaceState` throws `SecurityError` | no throw; both keys `null` |
| UNIT-TOK-011 | "still removes the flag when storage throws" | `removeItem` throws `SecurityError` | returns `true`; flag gone |

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
> may appear in `src/config/agencyProfile.ts` and nowhere else.

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
| UNIT-ADM-004 | "moves a lead along through the adminLead function, not the entity" | `invoke("adminLead", { action: "status", id, status })`; no entity update |
| UNIT-ADM-005 | "deletes through the adminLead function, not the entity" | `invoke("adminLead", { action: "delete", id })`; no entity delete |
| UNIT-ADM-010 | "rejects when the function call fails, so the screen shows its write error" | `setStatus` and `remove` both reject |
| UNIT-ADM-011 | "rejects when the function answers with an error body and no throw" | A body without `ok: true` rejects |
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
| UNIT-SEED-008 | "carries the action time from the front matter to both stores" | `action_time` in the parsed article, the Base44 payload and the mirror row |
| UNIT-SEED-009 | "sends an empty action time for an article that has none" | `action_time: ""` |
| UNIT-SEED-010 | "mirrors the file name as the slug, and keeps it out of the Base44 payload" | Mirror row `slug`; payload has none |
| UNIT-SEED-011 | "takes the slug from the file name" | `horadat-dmei-nihul` |
| UNIT-SEED-012 | "refuses a file name that cannot be an address" | Throws naming kebab-case |
| UNIT-SEED-013 | "carries cta_headline and og_image to Supabase only (Base44's BlogPost has neither)" | In the mirror row; not in the Base44 payload |
| UNIT-SEED-014 | "mirrors an article without them as null, which the column checks accept (an empty string is refused)" | `cta_headline: null`, `og_image: null` |

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
| UNIT-GA4-015 | "marks %s a key event" (7 cases) | `generate_lead`, `click_phone`, `click_whatsapp`, `click_email`, `cta_click`, `chat_start`, `chat_handoff` have `keyEvent: true` in `LEAD_EVENTS` (the user's decision of 2026-10-14) |
| UNIT-GA4-016 | "leaves %s a plain event" (3 cases) | `wizard_start`, `wizard_step`, `preferred_channel_click` have `keyEvent: false` |

The `describe` "calculator_result and click_chat" — the calculator → lead box
on /tools and the ways into the support chat. `tool` is on the allow-list, but
only with a value from `CALCULATOR_TOOLS`, so a figure cannot travel in it.

| ID | Title | Expected result |
|---|---|---|
| UNIT-GA4-020 | "sends calculator_result with the tool's name and nothing else" | `calculator_result {tool: fee_calculator}` / `{tool: insurance_assessment}` |
| UNIT-GA4-021 | "drops a tool value that is not one of the calculators, so a figure cannot ride in it" | `tool: "12000"`, `"₪12,000"`, `"fee_calculator 12000"` all dropped — params `{}` |
| UNIT-GA4-022 | "counts a link to the support chat as click_chat, with where it was" | `/faq#support-chat` and `#support-chat` → `click_chat {location}` (`mobile_sticky_bar`, `header_menu`, a section id) |
| UNIT-GA4-023 | "does not count a link to /faq itself as click_chat" | Nothing sent |
| UNIT-GA4-024 | "counts a chat opened on the page as click_chat, naming the chat and where" | `click_chat {method: ai_support, location: support-chat}` |
| UNIT-GA4-025 | "watches the support agent's own section id" | `SUPPORT_CHAT_HASH === "#" + AGENTS.support.sectionId` |
| UNIT-GA4-026 | "every event it sends is in the catalogue the admin panel shows" | `calculator_result` and `click_chat` are in `LEAD_EVENTS` |
| UNIT-GA4-027 | "marks click_chat a key event and calculator_result a plain one" | `keyEvent` true / false |

### 4.16 Reconciling the lead mirror — `tests/unit/reconcile-leads.test.ts`

The planning step of `scripts/reconcile-leads.mjs`, which finds Supabase `leads`
rows whose lead Base44 no longer holds, rows whose status differs, and Base44
leads with no Supabase row at all (a failed create-time mirror). The script is a
dry run unless given `--apply`, and creates missing copies only with
`--create-missing` as well; what is pinned here is what it would do, and the row
it would write.

| ID | Title | Expected result |
|---|---|---|
| UNIT-REC-001 | "deletes the Supabase rows whose lead is gone from Base44" | `toDelete` holds the orphan's `base44_id` |
| UNIT-REC-002 | "updates a row whose status differs, to Base44's value" | `toUpdate` carries id, from, to |
| UNIT-REC-003 | "plans nothing when the stores agree" | All three lists empty |
| UNIT-REC-004 | "leaves alone a Supabase row with no base44_id" | All three lists empty |
| UNIT-REC-005 | "treats a Base44 lead without a status as the default, new" | No update |
| UNIT-REC-006 | "carries ids and statuses only" | No name or phone in the plan |
| UNIT-REC-007 | "finds the marked line among the CLI's other output" | The JSON after the marker |
| UNIT-REC-008 | "says so when the CLI printed no result" | Throws, naming `base44 login` |
| UNIT-REC-009 | "lists the Base44 leads Supabase never got, as ids only" | `toCreate` holds the id; no name or phone in the plan |
| UNIT-REC-010 | "maps the Base44 lead onto the Supabase columns, keyed by base44_id" | Exactly the shared columns; Base44's own fields (`created_by`, `is_sample`) dropped |
| UNIT-REC-011 | "keeps the original date, so ordering and the 24-month retention stay right" | `created_at` = Base44 `created_date` |
| UNIT-REC-012 | "defaults a missing status to new and an empty constrained value to null" | `status: "new"`, `source: null` |
| UNIT-REC-013 | "drops a value the Supabase check constraint would refuse, rather than failing the row" | Unknown `source` → null; unknown `status` → `"new"` |
| UNIT-REC-014 | "refuses a lead without the two columns Supabase requires" | `null` without a name or a phone |

### 4.17 Reading time — `tests/unit/reading-time.test.ts`

The blog cards' "קריאה: כ־N דק׳": Hebrew read at ~1,100 characters a minute.

| ID | Title | Expected result |
|---|---|---|
| UNIT-READ-001 | "reads Hebrew at about 1,100 characters a minute" | 5,500 characters → 5 |
| UNIT-READ-002 | "rounds to the nearest minute" | 3,849 → 3; 3,850 → 4 |
| UNIT-READ-003 | "never says zero minutes, even for an empty or missing body" | 1 for a short, empty or missing body |

### 4.18 Blog topics and the featured article — `tests/unit/blog-topics.test.ts`

An article belongs to the topic of its own first tag that names one;
`תכנון פיננסי` counts as family only when nothing else matches. The featured
row is live through `FEATURED.until` by the Israeli calendar.

| ID | Title | Expected result |
|---|---|---|
| UNIT-TOP-001 | "takes the article's own first tag that names a topic" | The year-end guide is `tax`, not `pension` |
| UNIT-TOP-002 | "skips tags that name no topic" | `התנהלות שוטפת` is passed over |
| UNIT-TOP-003 | "counts תכנון פיננסי as family only when nothing else matches" | `insurance` when ביטוח follows it; `family` alone |
| UNIT-TOP-004 | "puts a family tag first in family" | `חיסכון, ילדים, …` → `family` |
| UNIT-TOP-005 | "returns null for an article with no topical tag" | `null` for no tags or only general ones |
| UNIT-TOP-006 | "ignores spacing around tags" | Trimmed before matching |
| UNIT-TOP-007 | "counts every post under 'all' and each post under its own topic" | One topic per post |
| UNIT-TOP-008 | "offers the five topics in the page's order" | הכל · פנסיה וגמל · ביטוח · משפחה ואירועי חיים · מיסוי ועצמאים |
| UNIT-TOP-009 | "reads the action times the articles use" | `2 דקות` → 2 … `חודש ראשון` → 43,200 |
| UNIT-TOP-010 | "puts an empty or unreadable time last rather than first" | `Infinity` |
| UNIT-TOP-011 | "is live through the last day, in Israel time" | Live at 23:59 on 31 Dec in Israel, gone at 00:00 |
| UNIT-TOP-012 | "names an article that exists in content/blog" | `FEATURED.title` matches a front-matter title |
| UNIT-TOP-013 | "each land in a topic" | Every repo article has a topic |
| UNIT-TOP-014 | "splits, trims and drops empty tags" | `tagsOf` → clean list; `[]` for none |
| UNIT-TOP-015 | "lists every keyword once, most common first, ties in Hebrew order" | `tagCounts` order: count desc, then `he` collation |
| UNIT-TOP-016 | "counts a tag repeated within one article once" | Count 1 |
| UNIT-TOP-017 | "moves a keyword carried by more than half the articles to the end" | A broad tag sorts after every narrower one |

### 4.19 Public reads without the SDK — `tests/unit/rest-table-client.test.ts`

`RestTableClient` answers the home page's anonymous reads over plain `fetch`,
so supabase-js stays off the critical path. One case builds the same query
through supabase-js and through this client against a recording `fetch` and
requires the same URL, `apikey` and bearer — a supabase-js upgrade that changes
either fails here rather than on the home page.

| ID | Title | Expected result |
|---|---|---|
| UNIT-REST-001 | "builds select, eq, order and limit into PostgREST's query string, in call order" | `select`, `col=eq.v`, `order=col.desc`, `limit=n` |
| UNIT-REST-002 | "orders ascending when asked" | `order=created_at.asc` |
| UNIT-REST-003 | "encodes a filter value that has characters of its own" | Percent-encoded, decoded back intact |
| UNIT-REST-004 | "does not double the slash when the project URL ends with one" | One `/rest/v1/` |
| UNIT-REST-005 | "sends the publishable key as apikey and as the bearer" | GET with both headers |
| UNIT-REST-006 | "is immutable: a branch of a query does not change the query it came from" | The base query has no `limit` |
| UNIT-REST-007 | "returns the rows" | `{ data: rows, error: null }` |
| UNIT-REST-008 | "maps a PostgREST refusal to its message and code" | `{ data: null, error: { message, code } }` |
| UNIT-REST-009 | "names the HTTP status when the error body is not JSON" | `HTTP 502` |
| UNIT-REST-010 | "turns a network failure into an error rather than a rejection" | `{ data: null, error }` |
| UNIT-REST-011 | "reports a 200 that is not a list as an error, not as no rows" | `error`, never `data: []` |
| UNIT-REST-012 | "asks for the same URL with the same anonymous credentials" | Equal to supabase-js's request |
| UNIT-REST-013 | "builds an or filter inside PostgREST's brackets" | `or=(slug.eq.a,base44_id.eq.a)` |
| UNIT-REST-014 | "asks for an or filter exactly as supabase-js does" | Same URL as supabase-js's `.or()` |
| UNIT-REST-015 | "builds a not filter as PostgREST's not.<op>.<value>, with null spelled out" | `lead_id=not.is.null` |
| UNIT-REST-016 | "asks for a not filter exactly as supabase-js does" | Same URL as supabase-js's `.not("lead_id", "is", null)` |

### 4.20 The lazy services front — `tests/unit/lazy-services.test.ts`

`@/services` loads the composition root (both SDKs) on a port's first real
call. Each case was checked by breaking the front the way it describes and
watching it fail.

| ID | Title | Expected result |
|---|---|---|
| UNIT-LAZY-001 | "never subscribes when the caller unsubscribed before the SDKs arrived" | The real `subscribe` is never called |
| UNIT-LAZY-002 | "subscribes once loaded, and its unsubscribe reaches the real one" | Real unsubscribe called once |
| UNIT-LAZY-003 | "fails that call, and the next call loads again rather than repeating the failure" | Second call loads and succeeds |
| UNIT-LAZY-004 | "loads once for many concurrent first calls" | One load |
| UNIT-LAZY-005 | "answers hasStoredToken and getPublicSettings without loading the composition root" | Zero loads |
| UNIT-LAZY-006 | "finds a stored Supabase session without loading the SDK" | `true`, zero loads |

### 4.21 Article addresses — `tests/unit/article-path.test.ts`

Every link to an article is built by `articlePath`, so these cases are what the
cards, the blog's JSON-LD, the post's canonical and the server redirect inherit.
A slug shaped like a Base44 id is refused because `vercel.json` sends every
`/blog/<24 hex>` to the old-link redirect.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SLUG-001 | "is /blog/<slug> when the article has one" | `/blog/horadat-dmei-nihul` |
| UNIT-SLUG-002 | "falls back to the id where the store has no slug (Base44)" | `/blog/<id>`, also for an empty slug |
| UNIT-SLUG-003 | "accepts %j" (5 slugs) | `null`; `isValidSlug` is true |
| UNIT-SLUG-004 | "asks for a slug when there is none" | `SLUG_PROBLEMS.missing` |
| UNIT-SLUG-005 | "refuses %j as not Latin kebab-case" (10 inputs) | `SLUG_PROBLEMS.format` |
| UNIT-SLUG-006 | "refuses a slug shaped like a Base44 id" | `SLUG_PROBLEMS.base44Id`; 23 or 25 hex characters are ordinary slugs |
| UNIT-SLUG-007 | "is false for anything that is not a string" | `false` |
| UNIT-SLUG-008 | "tells a Base44 id, a uuid and a slug apart" | All three are slug-shaped; only the uuid matches `UUID_PATTERN` |

### 4.22 The published articles at build time — `tests/unit/published-articles.test.ts`

The list `prerender.mjs` prebuilds pages for, and that PR 2's sitemap and
llms.txt will read. An answer that cannot be trusted is never "no articles",
and test articles can never reach a deployment.

| ID | Title | Expected result |
|---|---|---|
| UNIT-PUBART-001 | "asks PostgREST for published rows, newest first, with the publishable key" | `published=eq.true`, `order=created_at.desc`; key as `apikey` and bearer |
| UNIT-PUBART-002 | "selects the columns it is asked for" | `select` as given |
| UNIT-PUBART-003 | "returns the rows" | Rows unchanged |
| UNIT-PUBART-004 | "throws on a refusal, naming the status" | `HTTP 401` |
| UNIT-PUBART-005 | "throws on an answer that is not a list" | `not a list` |
| UNIT-PUBART-006..009 | "refuses a row whose slug %j could not be a file under dist/blog" | `../escape`, `Bad`, a Base44 id, `null` → `unusable slug` |
| UNIT-PUBART-010 | "lists the published articles as /blog/<slug> routes" | `["/blog/a", "/blog/b"]` |
| UNIT-PUBART-011 | "warns, and prebuilds no article, when Supabase is not configured" | Warning; no request |
| UNIT-PUBART-012 | "fails when articles are required and Supabase is not configured" | Throws |
| UNIT-PUBART-013 | "warns when Supabase cannot be read and articles are not required" | Warning naming `HTTP 503` |
| UNIT-PUBART-014 | "fails when Supabase cannot be read and articles are required" | Throws `HTTP 503` |
| UNIT-PUBART-015 | "takes the fixture's articles in the e2e build, without asking Supabase" | Fixture routes and rows; no request |
| UNIT-PUBART-016..017 | "refuses the fixture in a Vercel build (%j)" | `VERCEL=1` or `VERCEL_ENV` → throws |
| UNIT-PUBART-018 | "refuses the fixture in a bundle that reads Supabase" | Throws |
| UNIT-PUBART-019 | "refuses a fixture article with an unusable slug" | Throws |
| UNIT-PUBART-020 | "answers the page's Base44 read by the slug at the end of its URL" | The fixture row |
| UNIT-PUBART-021 | "answers null for any other key" | `null` |
| UNIT-PUBART-022 | "names each title more than one route was rendered with" | `{ title, routes }` |
| UNIT-PUBART-023 | "is empty when every title is distinct" | `[]` |
| UNIT-PUBART-024 | "are the app's rule and address" | Same verdicts as `articlePath.ts` |
| UNIT-PUBART-025..029 | "fetchPublishedArticles — every row, or an error" (asks for an exact count and a range; reads page after page until the total is reached; refuses fewer rows than the total; refuses an answer with no total; accepts an empty list when the total says zero) | `Prefer`, `Range-Unit`, `Range: 0-999`; two pages of a three-row list; `incomplete: 1 of 5`; `Content-Range` error; `[]` |
| UNIT-PUBART-030..033 | "loadPublishedArticles — the same rules for every build step" (live rows with the columns asked for; fixture rows; warns when not required; throws when required) | `{ rows, fromFixture, warning }`; `select=slug%2Ctitle`; `HTTP 500` warning or throw |

### 4.23 Reading one article — `tests/unit/supabase-content.test.ts` (`getArticle`)

`/blog/:key` holds a slug, an old Base44 id, or a uuid. One PostgREST request
asks for all three and the slug wins. The key reaches an `or=(…)` filter, so a
key that is not slug-shaped is answered "not found" without a request — a comma
or a bracket in it would rewrite the filter.

| ID | Title | Expected result |
|---|---|---|
| UNIT-ART-001 | "reads the slug with every article" | `slug` in `ARTICLE_COLUMNS` |
| UNIT-ART-002 | "asks for the key as a slug or a Base44 id, in one request" | `or: slug.eq.k,base44_id.eq.k`; no `eq` |
| UNIT-ART-003 | "adds the uuid clause only for a uuid-shaped key" | `…,id.eq.<uuid>` |
| UNIT-ART-004 | "prefers the slug, then the Base44 id, then the uuid" | The slug's row; without it, the Base44 id's |
| UNIT-ART-005 | "returns the article under its Base44 id, with its slug" | `id` is the Base44 id; `slug` present |
| UNIT-ART-006 | "throws a 404 'not found' when no row matches" | `status: 404` |
| UNIT-ART-007 | "never asks about %j" (6 keys) | `status: 404`; no call recorded |
| UNIT-ART-008 | "fails, rather than answering 'not found', when the read fails" | `blog_posts read failed`; no `status` |

### 4.25 Publishing by title — `tests/unit/publish-blog.test.ts` (`publishInSupabase`)

The Supabase half of a publish is a PATCH by `base44_id`: it changes
`published` and nothing else, and a row that is not there is a failure rather
than a row silently created.

| ID | Title | Expected result |
|---|---|---|
| UNIT-PUB-001 | "PATCHes the one row by base44_id" | `PATCH …?base44_id=eq.b44-7`, `{ published: true }`, `return=representation` |
| UNIT-PUB-002 | "fails when no Supabase row has the id, rather than reporting it published" | Throws `no Supabase row` |
| UNIT-PUB-003 | "fails on a refusal, naming the status" | Throws `401` |

### 4.26 The Base44 export backfill — `tests/unit/base44-repair-scripts.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-BKF-001 | "gives an imported article a fallback slug, and never overwrites one already set" | `slug` column with `'post-<lowercased id>'`; no `slug = excluded.slug` |
| UNIT-BKF-002 | "turns %j into what the migration's SQL does" (9 inputs) | Uppercase, symbols, leading/trailing symbols, non-Latin; all-symbols and empty fall back to the uuid |
| UNIT-BKF-003 | "refuses to invent an address from nothing" | Throws `no id` |
| UNIT-BKF-004 | "is spelled the way the migration spells it" | The migration's SQL holds the same regex, trim and `p_id::text` fallback |

### 4.24 The server's answer for an article address — `tests/unit/og-blog-handler.test.ts`

`api/og/blog.ts` reads Supabase with the publishable key and the same
`getArticle` the page uses. Old keys get a 301 to the slug; a not-yet-built slug
gets the shell with its head; anything else is 404 + noindex.

| ID | Title | Expected result |
|---|---|---|
| UNIT-OG-001 | "renders the article's head into the shell, from Supabase" | 200; title, image, canonical on the slug; `or=(slug.eq…,base44_id.eq…)` |
| UNIT-OG-002 | "reads with the publishable key, as an anonymous visitor would" | `apikey` is the publishable key |
| UNIT-OG-003 | "fetches the shell once from the canonical origin, never from the request, and reuses it" | One `fetch(`${SITE_URL}/app`, { redirect: "error" })`, whatever the Host |
| UNIT-OG-016 | "answers 502 + noindex, not a crash, when the shell cannot be fetched" | 502, `noindex`, a visible "המאמר לא נמצא." line and a link to `/blog` |
| UNIT-OG-017 | "still answers 404 + noindex when the shell cannot be fetched, and logs the read once" | 404, `noindex`; one log line |
| UNIT-OG-004 | "answers a Base44 id with a 301 to the article's slug" | `Location: /blog/<slug>`; a day's cache |
| UNIT-OG-005 | "keeps the visitor's own query string, without the id the rewrite added" | `?utm_source=whatsapp&tag=a&tag=b` |
| UNIT-OG-006 | "answers a Supabase uuid the same way" | 301; `id.eq.<uuid>` asked |
| UNIT-OG-007 | "never redirects to a draft — its slug stays private" | 404; no `Location`; slug absent |
| UNIT-OG-008 | "returns 404 and noindex when no article has the key" | 404, `noindex` |
| UNIT-OG-009 | "answers a draft asked for by its slug exactly as a missing one" | 404; title absent |
| UNIT-OG-010 | "treats an article with no published flag as a draft" | 404 |
| UNIT-OG-011 | "does not ask Supabase about a key no article can have" | 404; no request |
| UNIT-OG-012 | "returns 502 and noindex when Supabase fails" | 502 |
| UNIT-OG-013 | "answers 500 without calling Supabase when it is not configured" | 500, `no-store` |
| UNIT-OG-014 | "answers 500 when the route is hit without an id" | 500 |
| UNIT-OG-015 | "rejects non-GET methods" | 405 |
| UNIT-OG-018 | "fetches the shell from, and writes the canonical on, the server's VITE_SITE_URL" | Run as deployed (esbuild bundle, no `import.meta.env`) with only `process.env.VITE_SITE_URL=https://govari-fin.co.il`: shell fetched from `https://govari-fin.co.il/app`; canonical and `og:url` on that host; no Base44 host |

### 4.27 Where the canonical origin comes from — `tests/unit/seo-site-url.test.ts` (`resolveSiteUrl`)

`SITE_URL` in `src/lib/seo.ts` is Vite's `VITE_SITE_URL`, else the server's
(`process.env`, the only one a Vercel function has), else the production
domain `https://govari-fin.co.il` (the old Base44 host until 2026-10-14).
Tested on the pure resolver: under Vitest `import.meta.env` mirrors
`process.env`, so the end-to-end case is UNIT-OG-018.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SURL-001 | "takes Vite's VITE_SITE_URL first, over the server's" | Vite's value |
| UNIT-SURL-002 | "falls back to the server's VITE_SITE_URL when Vite's env lacks it — a Vercel function" | Server's value, for an absent or empty Vite env |
| UNIT-SURL-003 | "falls back to the production domain when neither names one — never the old Base44 host" | `https://govari-fin.co.il`, and not `https://safe-arch-plan.base44.app` |
| UNIT-SURL-004 | "treats a blank value as unset, as the build plugin does" | Empty / whitespace skipped |
| UNIT-SURL-005 | "strips trailing slashes from whichever source wins" | No trailing `/` |

### 4.28 The sitemap and llms files — `tests/unit/seo-files.test.ts`

Pure string builders in `scripts/seo-files.mjs`; the templates are the emitted copies of `public/sitemap.xml` and `public/llms.txt`.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SEOF-001 | "reads the host the site-url plugin already chose" | Origin of the first `<loc>` |
| UNIT-SEOF-002 | "refuses a sitemap with no https <loc>" | Throws "no <loc>" |
| UNIT-SEOF-003 | "prefers updated_at, then the created dates, and normalises to ISO" | ISO `.000Z` timestamps |
| UNIT-SEOF-004 | "is null when there is no usable date" | `null` for `{}` and an unparsable date |
| UNIT-SEOF-005 | "keeps the static routes without a lastmod" | `<loc>` followed directly by `<changefreq>` |
| UNIT-SEOF-006 | "dates /blog by its newest article" | `/blog` has the newest `<lastmod>` |
| UNIT-SEOF-007 | "adds every article at /blog/<slug> with its own lastmod" | One entry per article |
| UNIT-SEOF-008 | "writes no empty lastmod for an article without a date" | No `<lastmod></lastmod>` |
| UNIT-SEOF-009 | "stays one well-formed urlset" | One `<urlset>`, ends `</urlset>`, 4 `<url>` |
| UNIT-SEOF-010 | "leaves /blog undated when there are no articles" | Output equals the template |
| UNIT-SEOF-011 | "keeps everything before the pages list verbatim" | llms.txt header unchanged |
| UNIT-SEOF-012 | "adds an articles section before the crawler note, one line per article" | Link lines; brackets in titles become parentheses |
| UNIT-SEOF-013 | "points at llms-full.txt from the crawler note" | `<origin>/llms-full.txt` present |
| UNIT-SEOF-014 | "collapses a line break in an excerpt so the list stays a list" | Excerpt on one line |
| UNIT-SEOF-015 | "refuses a template without the crawler note it inserts before" | Throws |
| UNIT-SEOF-016 | "opens with the identity, contact, disclosure and limitations, verbatim" | Header kept; no `## דפים` |
| UNIT-SEOF-017 | "carries every question and answer under its own heading" | `### question` then answer |
| UNIT-SEOF-018 | "carries every article's text under its title and address" | Title, address and `עודכן` date, then body |
| UNIT-SEOF-019 | "refuses a template without the pages heading it cuts at" | Throws "## דפים" |
| UNIT-SEOF-020 | "moves every heading two levels down, stopping at h6" | `##`→`####`, `####`→`######`, `######` stays |
| UNIT-SEOF-021 | "leaves a heading-looking line inside a fenced block alone" | ``` and ~~~ fences untouched |
| UNIT-SEOF-022 | "leaves #hashtag (no space) and mid-line hashes alone" | Text unchanged |
| UNIT-SEOF-023 | "makes a root-relative Markdown link target absolute" | `](/#start)` and `](/blog)` gain the origin |
| UNIT-SEOF-024 | "leaves absolute and protocol-relative targets alone" | `https://` and `//cdn` unchanged |
| UNIT-SEOF-025 | "leaves a fenced block alone" | Link inside a fence unchanged |
| UNIT-SEOF-026 | "keeps only articles whose page exists, and names the rest" | `kept` and `dropped` slugs from a fake `exists` |
| UNIT-SEOF-027 | "drops nothing when every page exists" | `dropped` empty |
| UNIT-SEOF-028 | "demotes the body's headings below the article title" | `#### מה בודקים` in llms-full |
| UNIT-SEOF-029 | "makes the body's root-relative links absolute" | Link carries the origin in llms-full |

### 4.29 Search Console and Bing verification tags — `tests/unit/site-verification.test.ts`

`verificationTags` in `scripts/vite-site-url-plugin.mjs`, injected into `index.html` by the plugin's `transformIndexHtml`.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SVER-001 | "emits nothing when neither variable is set" | `[]` |
| UNIT-SVER-002 | "emits Google's and Bing's tags from their variables" | `google-site-verification` then `msvalidate.01` meta tags, `injectTo: head` |
| UNIT-SVER-003 | "ignores a variable that is set but blank" | `[]` |
| UNIT-SVER-004 | "refuses a whole pasted <meta> tag and says what to paste" | Throws "only the content value" |
| UNIT-SVER-005 | "is what the plugin injects into index.html" | `transformIndexHtml()` equals `verificationTags(env)` |

### 4.30 IndexNow submission — `tests/unit/indexnow.test.ts`

`scripts/indexnow.mjs`: reads the live sitemap, submits articles changed in the last 48 h, and never throws. Fetch is mocked; nothing reaches api.indexnow.org.

| ID | Title | Expected result |
|---|---|---|
| UNIT-INOW-001 | "returns only articles changed within the window" | `/blog/fresh` and `/blog/yesterday` only |
| UNIT-INOW-002 | "never submits static routes, even /blog with a fresh lastmod" | `/blog` absent |
| UNIT-INOW-003 | "is empty when nothing changed" | `[]` |
| UNIT-INOW-004 | "names the host, the key and where the key file is" | `host`, `key`, `keyLocation`, `urlList` |
| UNIT-INOW-005 | "posts the recent articles to IndexNow" | POST to `api.indexnow.org/indexnow` with 2 URLs; `{ submitted: 2 }` |
| UNIT-INOW-006 | "submits nothing when no article changed" | `{ submitted: 0 }`, only the sitemap fetched |
| UNIT-INOW-007 | "warns and resolves on a refused submission" | HTTP 422 warned; `{ submitted: 0 }` |
| UNIT-INOW-008 | "warns and resolves when IndexNow cannot be reached" | Network error warned; `{ submitted: 0 }` |
| UNIT-INOW-009 | "warns and resolves without an origin" | Warns; `{ submitted: 0 }` |
| UNIT-INOW-010 | "warns when the sitemap's articles are on another host" | Warns "not on <site>"; no "no article changed" info; `{ submitted: 0 }` |
| UNIT-INOW-011 | "still submits when the origin has a trailing slash" | `{ submitted: 2 }` |
| UNIT-INOW-012 | "warns and resolves when the sitemap answers with an error" | HTTP 503 warned; `{ submitted: 0 }` |

### 4.31 The chat prompts — `tests/unit/chat-prompt.test.ts`

`supabase/functions/chat/prompt.ts`: placeholders are filled from the pinned agency copy and the system prompt is three blocks with one cache breakpoint. No network.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHPROMPT-001 | "fillPlaceholders fills every agency placeholder" | Both placeholders replaced by the `AGENCY` values |
| UNIT-CHPROMPT-002 | "refuses a placeholder the agency has no value for" | `{{agency.fax}}` throws, naming `agency.fax` |
| UNIT-CHPROMPT-003 | "leaves text without placeholders alone, braces included" | `{x} {{y}}` returned unchanged |
| UNIT-CHPROMPT-004 | "is compliance, then the role, then the profile" | `systemBlocks('interview')`: three blocks, §3, the interview role, the agency profile |
| UNIT-CHPROMPT-005 | "caches the fixed prefix: the breakpoint is on the role block" | `cache_control` types `[null, ephemeral, null]` |
| UNIT-CHPROMPT-006 | "leaves no placeholder unfilled" | No `{{agency.` left in any block |
| UNIT-CHPROMPT-007 | "asks for a submitLead call, never a fenced block" | Role block has no fenced `lead` block and asks for `submitLead` with `stage='complete'` |

### 4.32 The chat function's tools — `tests/unit/chat-tools.test.ts`

`supabase/functions/chat/tools.ts`: the interview's tool schemas and the runners that call `submit-lead` and `escalate-to-human` in-process, with fake handlers; the FAQ chat's tool set and its two article tools, over a fake `ArticleSource`. No network.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHTOOL-001 | "are submitLead and escalateToHuman, the names the prompt uses" | `INTERVIEW_TOOLS` names are `submitLead`, `escalateToHuman` |
| UNIT-CHTOOL-002 | "posts the lead to submit-lead with consent and attribution from the conversation, never from the model" | submit-lead gets `source: interview`, the lead fields, and consent and attribution from the conversation; forged model values ignored; origin and x-forwarded-for forwarded; outcome `ok` with the lead id, `leadSaved` |
| UNIT-CHTOOL-003 | "saves a partial lead silently: a lead id, but not a saved interview" | Outcome `ok` with a lead id and `leadSaved: false` |
| UNIT-CHTOOL-004 | "writes one complete lead per conversation: the second call answers already_saved" | Handler called once; second complete call `already_saved`; conversation status `lead_saved` |
| UNIT-CHTOOL-005 | "hands the model the handler's own Hebrew error, so it can ask again" | A 400 answer becomes `error`, `isError`, `leadSaved: false`, with the handler's Hebrew text in `forModel` |
| UNIT-CHTOOL-006 | "simulates the save in an evaluation run, without calling the handler" | Evaluation mode: handler not called, outcome `simulated`, `leadSaved: true` |
| UNIT-CHTOOL-007 | "posts the hand-off with the agent, the consent and the attribution, and reports it" | escalate-to-human gets reason, agent, consent version and channel; outcome `ok`, `escalated: true`, contact in `forModel` |
| UNIT-CHTOOL-008 | "turns an unknown reason into uncertain before it leaves" | An unknown reason is sent as `uncertain` |
| UNIT-CHTOOL-009 | "hands off once per conversation: the second call answers already_escalated without calling the handler" | Ruling 4: handler called once; second call `already_escalated`, not an error; conversation status `escalated` |
| UNIT-CHTOOL-010 | "does not let a failed hand-off block the retry" | Ruling 4: a failed first hand-off leaves status `open`; the retry calls the handler again and succeeds |
| UNIT-CHTOOL-011 | "exposes the lead id the hand-off recorded, for the conversation's lead_id" | Ruling 4: the handler's `leadId` is the outcome's `leadId` |
| UNIT-CHTOOL-012 | "has no lead id when the hand-off was anonymous (the handler answers leadId null)" | Ruling 4: handler `leadId: null` gives `leadId` undefined |
| UNIT-CHTOOL-013 | "is an error the model sees, not a crash" | An unknown tool name gives `error`, `isError` |
| UNIT-CHTOOL-014 | "keeps already_saved after a hand-off: the second complete submitLead writes nothing" | Ruling 9: lead, hand-off, second complete submit: `already_saved`, handler once, status `lead_saved`, `escalated` true |
| UNIT-CHTOOL-015 | "saves the lead after a hand-off: status becomes lead_saved, escalated stays true" | Ruling 9: hand-off then complete submit saves the lead; status `lead_saved`, `escalated` true |
| UNIT-CHTOOL-016 | "answers already_escalated to a second hand-off after the lead was saved" | Ruling 9: lead saved, hand-off, second hand-off: `already_escalated`, handler once, status `lead_saved` |
| UNIT-CHTOOL-017 | "refuses a partial save once the lead is saved: already_saved, no second row" | Ruling 10: complete then partial: second is `already_saved`, handler called once |
| UNIT-CHTOOL-018 | "refuses a partial save after a simulated complete one too" | Ruling 10: the same in evaluation mode |
| UNIT-CHTOOL-019 | "turns a %s handler that throws into an error outcome, leaving the conversation as it was" | `submitLead` and `escalateToHuman`: `status: error`, `isError`, no `leadSaved`/`escalated`, `{ ok: false }` for the model; status `open`, `escalated` false (I2) |
| UNIT-CHTOOL-020 | "is the two article tools and the hand-off, and never submitLead" (the support tool set) | `SUPPORT_TOOLS` names are `listArticles`, `readArticle`, `escalateToHuman`; the hand-off is the same `ESCALATE_TOOL` object the interview has |
| UNIT-CHTOOL-021 | "asks the model for nothing but a slug when reading" (the support tool set) | `listArticles` takes no properties; `readArticle` requires one string `slug` |
| UNIT-CHTOOL-022 | "lists the published articles for the model, with their slugs" | `listArticles`: outcome `ok`; `forModel` carries each article's `slug`, `title`, `excerpt`, `tags` |
| UNIT-CHTOOL-023 | "reads an article by slug, saying when it was cut" | `readArticle`: `forModel` carries `slug`, `title`, `body` and `truncated` |
| UNIT-CHTOOL-024 | "answers not_found for a slug no published article has, as a tool error the model can handle" | Invented slug: outcome `error`, `isError`, `{ ok: false, error: "not_found" }` (Review Focus 2) |
| UNIT-CHTOOL-025 | "passes a non-string slug through as nothing, never as text" | `{ $ne: 1 }` reaches the source as `""` |
| UNIT-CHTOOL-026 | "reads real articles in evaluation mode too: reading changes nothing" | With `evalMode`, `listArticles` still calls the source |
| UNIT-CHTOOL-027 | "turns a failing article store into tool_failed, not a crashed turn" | A throwing `list` gives `{ ok: false, error: "tool_failed" }` |
| UNIT-CHTOOL-028 | "turns a failing read into tool_failed too, never not_found" | A throwing `read` gives `isError` and `tool_failed`, not `not_found` (Review Focus 2) |
| UNIT-CHTOOL-029 | "%s: an error the model can act on, nothing saved, in both modes" (3 cases) | `{}`, a name and phone with no `stage`, and `stage: "final"`: in live and evaluation mode the handler is not called, the outcome is `error` / `isError` / not `leadSaved`, the answer is `{ ok: false }` naming `stage`, and the conversation stays `open` (the evaluation of 2026-10-14: `submitLead({})` counted as complete) |
| UNIT-CHTOOL-030 | "after a refused empty call, the real complete save still goes through" | Evaluation mode: `{}` then a full lead → `simulated`, `leadSaved` |
| UNIT-CHTOOL-031 | "an evaluation run refuses %s as submit-lead does: its own Hebrew error, nothing saved" (2 cases) | No name / a blank phone in evaluation mode → `error`, "נדרשים שם וטלפון", conversation `open` — the simulation answers as `submit-lead` would |
| UNIT-CHTOOL-032 | "in evaluation mode %s, a complete save asks for a short closing message" (2 cases) | `{ ok, stage: "complete", next }`; `next` asks for "הודעת סיום", not for the next question (the evaluation of 2026-10-14: two turns ended `empty_reply` after a bare complete answer) |
| UNIT-CHTOOL-033 | "a save after the lead is saved says so and asks for a reply, not silence" | `{ ok, alreadySaved, next }`, `next` says to answer the visitor |
| UNIT-CHTOOL-034 | "a second hand-off says so and asks for a reply, not silence" | `{ ok, alreadyEscalated, next }` |

### 4.32a The chat's article source — `tests/unit/chat-articles.test.ts`

`supabase/functions/chat/articles.ts`: `createArticleSource(select, agencyId)` reads the published `blog_posts` for the FAQ chat through a fake PostgREST `select`. No network.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHART-001 | "lists only published articles of this agency or shared ones, newest first, capped" | Table `blog_posts`; `published=eq.true`, `or=(agency_id.is.null,agency_id.eq.<agency>)`, `order=created_at.desc`, `limit=ARTICLE_LIST_LIMIT`, `select=slug,title,excerpt,tags` |
| UNIT-CHART-002 | "turns missing columns into empty strings rather than undefined" | Null `excerpt` and `tags` come back as `""` |
| UNIT-CHART-003 | "reads one published article by slug, with the same agency filter" | `slug=eq.dmei-nihul`, `published=eq.true`, the agency `or`, `limit=1`; `truncated: false` |
| UNIT-CHART-004 | "keeps a body of exactly the limit whole" | `ARTICLE_BODY_LIMIT` characters kept; `truncated: false` |
| UNIT-CHART-005 | "queries for a slug of 200 characters, the longest it accepts" | One query sent |
| UNIT-CHART-006 | "cuts a long body and says so" | Body cut to `ARTICLE_BODY_LIMIT`; `truncated: true` |
| UNIT-CHART-007 | "refuses %j as a slug without querying" | `""`, `"Has Spaces"`, `"a--b"`, `"../etc"`, `"a&published=eq.false"`, 201 characters: `null`, no query (Review Focus 2) |
| UNIT-CHART-008 | "answers null for a slug no published article has" | An empty answer gives `null` |
| UNIT-CHART-009 | "uses the site's slug rule" | `SLUG_PATTERN` has the same source as `@/lib/articlePath`'s |

### 4.33 The chat function's model client, turn loop and budget — `tests/unit/chat-anthropic.test.ts`, `chat-turn.test.ts`, `chat-budget.test.ts`

`supabase/functions/chat/{anthropic,turn,budget}.ts`: the Anthropic Messages API over a fake `fetch`, the turn loop over a scripted model, and the budget arithmetic. No network.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHMODEL-001 | "posts the Messages API request with the key, the version and the cache marks" | URL, `x-api-key`, `anthropic-version`, body fields; usage folds cache creation into `input` and cache reads into `cached` |
| UNIT-CHMODEL-002 | "turns an HTTP refusal into ModelError('http') with its status" | `kind: http`, `status: 529` |
| UNIT-CHMODEL-003 | "turns an abort into ModelError('timeout')" | `kind: timeout` |
| UNIT-CHMODEL-004 | "turns an answer without content into ModelError('shape')" | Rejects with `ModelError` |
| UNIT-CHMODEL-005 | "sends tool_choice none only when the request switches tools off" | `toolChoice: "none"` → body has `tool_choice: { type: "none" }` beside `tools`; without it the body has no `tool_choice` |
| UNIT-CHTURN-001 | "drops tool rows, merges consecutive turns of one side, and starts with the visitor" | Alternating user/assistant history, leading assistant and tool rows dropped, consecutive user rows joined by a blank line |
| UNIT-CHTURN-002 | "returns the reply when the model answers in words" | `reply` is the text; one usage record |
| UNIT-CHTURN-003 | "runs a tool, hands the result back, and returns the closing reply" | `runTool` called with the model's input; second request ends with a `tool_result`; result carries `tools` and `toolCalls` |
| UNIT-CHTURN-004 | "marks a failed tool as an error for the model" | `tool_result` has `is_error: true` |
| UNIT-CHTURN-005 | "allows three tool rounds, then asks for the reply with tools switched off" | Three tool rounds run; the fourth call carries `toolChoice: "none"` with the tools still listed and its text is the reply (the evaluation of 2026-10-14: a hand-off and two saves, then a fourth tool asked for → 503 with the lead saved) |
| UNIT-CHTURN-006 | "retries once when the first failure comes early" | A 529 then a reply gives the reply |
| UNIT-CHTURN-007 | "fails without a retry when the first failure comes after ten seconds" | `TurnFailure` `model_http_529` |
| UNIT-CHTURN-008 | "fails on a second failure, keeping what the tools already did" | `TurnFailure` `model_timeout`, `tools` equals the earlier outcome |
| UNIT-CHTURN-009 | "refuses an empty reply" | `TurnFailure` `empty_reply` |
| UNIT-CHTURN-010 | "fails a reply cut off at max_tokens inside a tool call, without running the tool or returning its text" | `stop_reason: max_tokens` with a partial `submitLead`: `TurnFailure` `truncated_tool_call`, usage kept, `runTool` never called (I1) |
| UNIT-CHTURN-011 | "asks for up to 4,096 reply tokens, room for a full Hebrew profile and summary" | `MAX_REPLY_TOKENS` is 4096 and the request carries it (I1; 2,048 cut a complete save off in the evaluation of 2026-10-14) |
| UNIT-CHTURN-012 | "still fails when the model asks for a tool even with tools switched off" | `TurnFailure` `too_many_tool_rounds`, three tool outcomes kept |
| UNIT-CHBUDGET-001 | "prices Haiku tokens per million" | 1M input + 1M cached + 1M output = $0.61 |
| UNIT-CHBUDGET-002 | "prices an unknown model at the most expensive known rate, never at zero" | 1M input tokens = $2 |
| UNIT-CHBUDGET-003 | "accepts the totals as PostgREST sends bigints" | String token counts are summed as numbers |
| UNIT-CHBUDGET-004 | "starts at the first of the UTC month" | `2026-10-01T00:00:00.000Z` |
| UNIT-CHBUDGET-005 | "is keyed YYYY-MM" | `2026-10` |
| UNIT-CHBUDGET-006 | "defaults to 50" | `parseBudget(undefined)` is 50 |
| UNIT-CHBUDGET-007 | "reads a number" | `" 120 "` gives 120 |
| UNIT-CHBUDGET-008 | "takes 0 as the kill switch" | `"0"` gives 0 |
| UNIT-CHBUDGET-009 | "falls back to 50 on nonsense" | `"lots"` and `"-5"` give 50 |

### 4.34 The chat function's store — `tests/unit/chat-store.test.ts`

`supabase/functions/chat/store.ts`: reads and writes of the chat tables over PostgREST with a fake `fetch`, including `claimSheetLogs`, the claim the sheet-log sweep takes its conversations with. No network.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHSTORE-001 | "reads a conversation by id" | GET `chat_conversations?id=eq.<id>&select=*&limit=1`; the row returned |
| UNIT-CHSTORE-002 | "never queries with an id that is not a uuid" | `null`, no request sent |
| UNIT-CHSTORE-003 | "lists a conversation's messages in the order they were written" | `order=id.asc&limit=200`; `role` and `content` only |
| UNIT-CHSTORE-004 | "reads this month's totals through the RPC, as numbers" | POST `rpc/chat_month_usage` with `p_agency_id`, `p_since`; bigint strings become numbers |
| UNIT-CHSTORE-005 | "claims the month's budget alert once: true on the insert, false on the conflict" | 201 gives `true`; 409 (23505) gives `false` |
| UNIT-CHSTORE-006 | "creates a conversation and hands back the stored row" | POST `chat_conversations`; the stored row returned |
| UNIT-CHSTORE-007 | "loads escalated_at into the conversation's facts as escalated" | `toFacts`: `escalated` false for null, true for a timestamp |
| UNIT-CHSTORE-008 | "persists a hand-off as escalated_at, set to the current time" | PATCH `id=eq.<id>` with only `escalated_at`, a current ISO time |
| UNIT-CHSTORE-009 | "truncates a message to the 8,000 characters the column allows" | 8,500 characters sent as 8,000; a short one unchanged |
| UNIT-CHSTORE-010 | "does not cut an emoji in half at the limit" | A surrogate pair straddling the limit is dropped whole |
| UNIT-CHSTORE-011 | "sets lead_id only while it is null when asked to" | `onlyIfLeadIdNull` adds `&lead_id=is.null` to the PATCH; without it no filter |
| UNIT-CHSTORE-012 | "lets a budget-alert refusal other than the conflict through, by its code" | A 500 rejects with `insert_http_500:XX000`; the message is not quoted |
| UNIT-CHSTORE-013 | "claims a turn with one filtered PATCH: this turn count, open or escalated, no live lease" | PATCH with `id=eq`, `turns=eq.2`, `status=in.(open,escalated)`, `or=(busy_until.is.null,busy_until.lt."<now>")`; body `turns: 3`, `busy_until`; the row returned (I3) |
| UNIT-CHSTORE-014 | "answers null when no row matched the claim (another turn holds it, or the count moved)" | `[]` gives `null`; a non-uuid sends nothing (I3) |
| UNIT-CHSTORE-015 | "lets go of its own lease only, stamping the last message time" | PATCH filtered on `busy_until=eq.<lease>` with `busy_until: null`, `last_message_at` (I3) |
| UNIT-CHSTORE-016 | "picks a batch of the longest-idle due conversations, then claims them with one filtered PATCH repeating every condition" (`claimSheetLogs`) | GET then PATCH on `chat_conversations`; both filter `role=in.(support)`, `is_eval=is.false`, `sheet_logged_at=is.null`, `last_message_at=lt.<cutoff>` and the lease `or`; the pick is `select=id`, `order=last_message_at.asc`, `limit=10`; the PATCH adds `id=in.(…)` and sets `sheet_logged_at` to now; the claimed rows returned |
| UNIT-CHSTORE-017 | "claims nothing, and sends no PATCH, when no conversation is due" | `[]` returned; only the GET sent |
| UNIT-CHSTORE-018 | "never puts an id that is not a uuid into the claim" | A picked id `x)&role=eq.interview` is dropped from `id=in.(…)` |
| UNIT-CHSTORE-019 | "refuses a role list it would have to escape, or a batch size that is not a positive integer, querying nothing" | `support,interview)`, `[]`, 0 and 2.5 give `[]` and no request |

### 4.35 The chat function's handler — `tests/unit/chat-handler.test.ts`

`supabase/functions/chat/handler.ts`: the HTTP flow with fakes for the store, the model, the limiter and the mail; the real tool runner over fake Edge handlers where the lead and hand-off rules are under test; the FAQ chat's role (`support_agent`), the `x-chat-sweep` route and, for the last two rows, the real sweep over the in-memory store. No network.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHHANDLER-001 | "creates the conversation, stores both sides, and hands the page its token once" | 200 with the reply and token; the row has role, consent, attribution, turns 1, a 64-hex token_hash that is not the token; user and assistant rows; one usage row |
| UNIT-CHHANDLER-002 | "refuses a first message without consent, writing nothing" | 400 `consent_required`; no conversation |
| UNIT-CHHANDLER-003 | "refuses an agent the function does not serve, an empty message, and a long one" | `no_such_agent` gives `unknown_agent` (the FAQ chat's `support_agent` is served now); `empty`, `too_long` (1,001 characters) |
| UNIT-CHHANDLER-004 | "accepts a consent version only as long as submit-lead's column (40), so every later save can succeed" | `MAX_CONSENT_VERSION_CHARS` is 40; 41 characters gives 400 `consent_required` and no row; 40 gives 200 |
| UNIT-CHHANDLER-005 | "answers 429 when the visitor's address is over its limit" | 429 `rate_limited` when the `chat-ip:` key is refused |
| UNIT-CHHANDLER-006 | "answers 429 when the site is over its new-conversation limit" | 429 when the `chat-new` key is refused |
| UNIT-CHHANDLER-007 | "lets an evaluation run past both limits" | With the evaluation header, 200 although every limit refuses; `is_eval` true |
| UNIT-CHHANDLER-008 | "continue with the token, and the model sees the whole conversation" | 200, no token in the answer; the model gets user, assistant, user |
| UNIT-CHHANDLER-009 | "are refused without the right token" | 403 `gone` |
| UNIT-CHHANDLER-010 | "are refused for a conversation that does not exist" | 403 `gone` for an unknown uuid |
| UNIT-CHHANDLER-011 | "close a conversation idle more than two hours" | 409 `closed`; the row's status becomes `closed` |
| UNIT-CHHANDLER-012 | "stop at forty turns" | 400 `too_many_turns` at 40 turns |
| UNIT-CHHANDLER-013 | "write under the stored conversation's agency, never one the request names" | Messages and usage of the turn carry the row's `agency_id`, not the request's `agency_id`/`agencyId` |
| UNIT-CHHANDLER-014 | "saves the lead through the tool, links it, and says so" | `leadSaved` true, status `lead_saved`, `lead_id` set; tool row `submitLead: ok`, no phone in any tool row |
| UNIT-CHHANDLER-015 | "closes the conversation to further messages once the lead is saved" | The next message gets 409 `closed` |
| UNIT-CHHANDLER-016 | "marks a hand-off, as its status and as escalated_at" | Status `escalated` and `escalated_at` set (Ruling 9) |
| UNIT-CHHANDLER-017 | "writes one lead when the model calls submitLead complete twice in one turn" | Real runner: submit-lead called once; tool rows `submitLead: ok`, `submitLead: already_saved` (Review Focus 1) |
| UNIT-CHHANDLER-018 | "hands off once per conversation, across turns, from the stored escalated_at" | Real runner: a second turn's hand-off answers `already_escalated`; escalate-to-human called once (Ruling 4) |
| UNIT-CHHANDLER-019 | "keeps the interview lead when the hand-off comes after it" | Lead then hand-off in one turn: `lead_id` is the interview lead (Ruling 11) |
| UNIT-CHHANDLER-020 | "takes the interview lead over the hand-off's when the lead comes after it" | Hand-off then lead in one turn: `lead_id` is the interview lead (Ruling 11) |
| UNIT-CHHANDLER-021 | "links the hand-off's lead first, and the interview lead when it arrives on a later turn" | Turn 1 links the hand-off lead; turn 2's lead replaces it |
| UNIT-CHHANDLER-022 | "stores and sends the model a redacted message, never the ID number" | Stored row and model history carry `[הושמט — מספר מזהה]`, never `123456782` (Review Focus 2) |
| UNIT-CHHANDLER-023 | "answers only the wire contract's fields, never the stored row or its token hash" | Exactly the contract's keys on the first and a later answer; the token hash appears in neither |
| UNIT-CHHANDLER-024 | "logs what happened, never the token, its hash, the message or the tool's arguments" | No console line holds the token, its hash, the name or the phone |
| UNIT-CHHANDLER-025 | "answers 503 when the model fails twice, keeping the visitor's message and the token" | 503 `unavailable` with the token; only the user row stored (Review Focus 4) |
| UNIT-CHHANDLER-026 | "retries an overloaded model once and answers" | 529 then a reply: 200, two model calls |
| UNIT-CHHANDLER-027 | "answers 503 when no model is configured" | 503 `unavailable` |
| UNIT-CHHANDLER-028 | "answers 500 with an rid when storage is down, and no error text" | 500 `failed`; no `select_http` text (Review Focus 3) |
| UNIT-CHHANDLER-029 | "refuses a new conversation over budget and mails staff once a month" | 503 twice; staff mailed once; no conversation |
| UNIT-CHHANDLER-030 | "refuses a new conversation once spend reaches the budget exactly" | Spend of exactly $50 against a $50 budget: 503, no conversation |
| UNIT-CHHANDLER-031 | "treats a zero budget as the kill switch" | 503 with no conversation, no spend read and no mail |
| UNIT-CHHANDLER-032 | "logs a failed alert claim by its code, still refuses, and mails no one" | `budget.alert_failed` warn line with `err: insert_http_500:XX000` and an rid; 503; no mail |
| UNIT-CHHANDLER-033 | "lets an existing conversation continue over budget" | A later message in an open conversation is answered 200 |
| UNIT-CHHANDLER-034 | "reports the tool calls only to the holder of the evaluation token" | `eval.toolCalls` with the right header; absent with a wrong one |
| UNIT-CHHANDLER-035 | "keeps an evaluation conversation for one day" | `delete_after` is now + 24 hours |
| UNIT-CHHANDLER-036 | "answers a preflight and refuses anything but POST" | OPTIONS 204, GET 405 |
| UNIT-CHHANDLER-037 | "answers a body that is not JSON as an unknown agent" | 400 `unknown_agent` |
| UNIT-CHHANDLER-038 | "keeps the visitor's phone %s, in storage and for the model" | `050-1234567`, `050 1234567`, `0501234567`, `+972-50-1234567`, `+972501234567`, `03-1234567`, `031234567`: the stored row and the model's history hold the phone unchanged (C1) |
| UNIT-CHHANDLER-039 | "keeps the phone and redacts the ID and the card in one message" | ID and card become their markers; `050-1234567` stays, in storage and for the model (C1) |
| UNIT-CHHANDLER-040 | "stores a 3,000-character reply whole, and the model reads it back whole" | No 2,000-character clip: the stored assistant row and the next turn's history equal the reply (M1) |
| UNIT-CHHANDLER-041 | "keeps lead_saved and lead_id when %s cannot be written, answers the reply, and never writes a second lead" | The usage row, then the tool row, throws after a real complete `submitLead`: 200 with the reply; the row is `lead_saved` with `lead_id`; the assistant row stored; a `store.usage_failed` / `store.tool_row_failed` warn line with the code; a resend gets 409 `closed`, submit-lead was called once, and the runner on the stored facts answers `already_saved` (I2) |
| UNIT-CHHANDLER-042 | "carries on when a tool's handler throws: the model hears it failed, the visitor gets a reply, the row stays open" | Real runner over a throwing handler: 200 with the model's reply, an `is_error` tool result, status `open`, tool row `submitLead: error` (I2) |
| UNIT-CHHANDLER-043 | "persists lead_saved and lead_id the moment the tool succeeds, before the model's closing reply" | At the second model call the row is already `lead_saved` with `lead_id`; that call failing gives 503 with `leadSaved: true` (I2) |
| UNIT-CHHANDLER-044 | "runs the model for exactly one of two messages sent at once; the other is answered busy" | Two sends on one conversation: one 200, one 409 `busy`; the model called once; turns 2 and the hold released (I3) |
| UNIT-CHHANDLER-045 | "holds the conversation while a turn runs and lets it go after, even when the turn fails" | During the model call `busy_until` is now + 180 s (`TURN_LEASE_MS`); after a 503 it is null (I3) |
| UNIT-CHHANDLER-046 | "lets a crashed turn's hold lapse after three minutes" | A live `busy_until` left behind gives 409 `busy`; 180 s later the message is answered 200 (I3) |
| UNIT-CHHANDLER-046a | "keeps the conversation held through a slow tool: a message sent 150 s into the turn is answered busy" | A tool that runs past 150 s still holds the conversation: the second message is 409 `busy`, and the model runs once (I3, the 180 s lease) |
| UNIT-CHHANDLER-047 | "holds the forty-turn cap when the thirty-ninth and fortieth messages arrive together" | At 39 turns two sends at once: one 200, one 409; turns 40; the next send is 400 `too_many_turns` (I3) |
| UNIT-CHHANDLER-048 | "serves support_agent with the support prompt and tools" | 200; the conversation's `role` is `support`; the model gets `listArticles`, `readArticle`, `escalateToHuman`; the role block names `listArticles` |
| UNIT-CHHANDLER-049 | "never runs a tool its role was not given, even when the model names one" | The model names `submitLead` in a support chat: the runner is not called, the tool row is `submitLead: error`, the conversation stays `open` (Review Focus 1) |
| UNIT-CHHANDLER-050 | "stores a made-up tool name no longer than the log line keeps it" | A 500-character tool name is stored as 40 characters plus `: error` |
| UNIT-CHHANDLER-051 | "the interview is gated the same way: it never reads articles, whatever the model names" | `listArticles` and `readArticle` named in an interview: the runner is not called; tool rows `listArticles: error`, `readArticle: error` |
| UNIT-CHHANDLER-052 | "runs the sweep for the right token, and nothing of the chat" | `x-chat-sweep` with the right token: 200, `ok`, `logged: 2`, an `rid` passed to `sweepSheetLogs`; no model call, no conversation, no rate-limit check (Review Focus 5) |
| UNIT-CHHANDLER-053 | "refuses %s with 401 and runs nothing" | A wrong token, an empty token and the evaluation token: 401 `unauthorized`; the sweep, the model and the store untouched (Review Focus 5) |
| UNIT-CHHANDLER-054 | "refuses every sweep when the function has no token configured" | With `sweepToken` empty, an empty and an arbitrary header both give 401; the sweep never runs (Review Focus 5) |
| UNIT-CHHANDLER-055 | "is a POST route only" | A GET with the right token gives 405; the sweep does not run |
| UNIT-CHHANDLER-056 | "answers 500, not a chat reply, when the sweep itself throws" | 500 `unavailable`; no `reply`; the thrown text is not in the body; the model not called |
| UNIT-CHHANDLER-057 | "leaves a chat request without the header to the chat" | A normal first message is answered 200; the sweep does not run |
| UNIT-CHHANDLER-058 | "logs only support conversations idle past the 2-hour close and its margin that no turn holds, never an evaluation or a logged one" (the real sweep over the in-memory store) | Nine conversations: only `idle` and `lapsed_lease` (126 minutes) reach `log-support-chat` (2 logged), each marked `sheet_logged_at`; `recent` (10 minutes), `not_yet_closed` (119 minutes), `within_margin` (124 minutes: closed, but inside the 5-minute margin), `in_a_turn` (live lease), `eval`, `interview` untouched; `already_logged` skipped (Review Focus 4) |
| UNIT-CHHANDLER-059 | "logs each conversation once when two sweeps overlap" | Two sweeps at once log 2 between them and call `log-support-chat` twice; a third logs 0 (Review Focus 3) |
| UNIT-CHHANDLER-060 | "logs the whole conversation: once logged, its next message is refused as closed" | A support conversation opened through the handler: a sweep at 124 minutes logs nothing, one at 126 minutes logs it; the visitor's next message is 409 `closed` and stores nothing, so the row is final |

### 4.35a The chat's redaction — `tests/unit/chat-redact.test.ts`

`supabase/functions/chat/redact-chat.ts`: `redactChat()` keeps Israeli phone numbers and applies `redact()` (`log-support-chat/redact.js`, unchanged) to everything else, without its 2,000-character clip. One row per declared `it`.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHREDACT-001 | "keeps the phone %s whole" | 11 forms: `050-1234567`, `050 1234567`, `0501234567`, `050-123-4567`, `+972-50-1234567`, `+972501234567`, `972501234567`, `03-1234567`, `031234567`, `+972-3-1234567`, `077-1234567` |
| UNIT-CHREDACT-002 | "still redacts an ID number (123456782)" | `[הושמט — מספר מזהה]` |
| UNIT-CHREDACT-003 | "redacts a nine-digit landline-shaped number that is a valid ID, written without a dash" | `038888889` passes the ID check digit: redacted as an ID |
| UNIT-CHREDACT-004 | "still redacts a card number, spaced or not" | `[הושמט — מספר כרטיס]` for both |
| UNIT-CHREDACT-005 | "still redacts a bank account and an IBAN" | `[הושמט — מספר]` and `[הושמט — חשבון בנק]` |
| UNIT-CHREDACT-006 | "keeps the phone and redacts the ID in one message" | ID marker, phone unchanged |
| UNIT-CHREDACT-007 | "does not take a phone-shaped run out of a longer number" | `0501-2345-6789-0123` is a card, redacted whole |
| UNIT-CHREDACT-008 | "never clips: a 3,000-character text comes back whole" | Output equals input |
| UNIT-CHREDACT-009 | "redacts past the 2,000th character too" | An ID after 2,500 characters becomes its marker; nothing is cut |
| UNIT-CHREDACT-010 | "answers an empty string for nothing" | `""` |

### 4.35b The chat's sheet-log sweep — `tests/unit/chat-sweep.test.ts`

`supabase/functions/chat/sweep.ts`: `sheetRow()` shapes a finished support conversation into the row `log-support-chat` writes, and `createSheetLogSweep()` claims idle conversations from a fake store and logs each through a fake `log-support-chat`. No network. The route that triggers it is UNIT-CHHANDLER-052..057; the claim is UNIT-CHSTORE-016..019.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHSWEEP-001 | "is the visitor's first question as the topic, the transcript without tool rows, and the count" (`sheetRow`) | Topic trimmed; transcript lines `מבקר:` / `עוזר:` with no tool row; outcome `answered`; `messageCount` 2 |
| UNIT-CHSWEEP-002 | "outcome %s" (`sheetRow`) | `escalated` (flag set, with or without a last visitor message), `referred_to_interview` (reply links `/#start`), `abandoned` (the last message is the visitor's), `answered` (a `/blog/` link is not a referral) |
| UNIT-CHSWEEP-003 | "cuts the topic to 200 characters" | 300 characters give 200 |
| UNIT-CHSWEEP-004 | "fits a long transcript under log-support-chat's 2,000-character cut, keeping the opening and the close" | Exactly `TRANSCRIPT_LIMIT` characters; starts with the first question, ends with the last reply, `[…]` between; `messageCount` 32 |
| UNIT-CHSWEEP-005 | "leaves a transcript that fits as it is, and never splits a character" (`fitTranscript`) | A short text unchanged; emoji cut on code points, no lone surrogate |
| UNIT-CHSWEEP-006 | "is nothing for a conversation with no visitor message" | `null` for an assistant-only or empty conversation |
| UNIT-CHSWEEP-007 | "claims a batch of support conversations idle past the handler's close (2 h + a margin), then logs each through log-support-chat" | `claimSheetLogs(["support"], cutoff, now, SHEET_LOG_BATCH)` with now minus cutoff equal to `SHEET_LOG_IDLE_MS` = the handler's `IDLE_MS` + `SHEET_LOG_MARGIN_MS` (125 minutes, more than `IDLE_MS`, margin at least a minute); a `sweep.logged` info line; one POST with `channel: site`, topic, transcript, outcome, count (Review Focus 4) |
| UNIT-CHSWEEP-008 | "counts an escalated conversation as escalated" | `escalated_at` set gives outcome `escalated` |
| UNIT-CHSWEEP-009 | "sends no phone: the chat has none, and the model is never asked for one" | The body has no `phone` |
| UNIT-CHSWEEP-010 | "skips a claimed conversation with nothing to log, and keeps going after one that throws" | Of three claimed, one logged; `sweep.nothing_to_log` info, `sweep.log_failed` error naming the conversation, `sweep.done` with `claimed: 3, logged: 1` |
| UNIT-CHSWEEP-011 | "does not count %s as logged, and says so" | A 400 refusal, and a 200 with `sheet_append_failed` in `warnings`: sweep returns 0; a `sweep.not_logged` warn line with the status |
| UNIT-CHSWEEP-012 | "logs nothing when nothing is claimed — a second overlapping sweep finds the rows already taken" | 0; no message read, nothing posted (Review Focus 3) |
| UNIT-CHSWEEP-013 | "claims nothing while there is no sheet: the rows wait for one rather than being marked logged" | Sheet unconfigured: 0, `claimSheetLogs` not called, a `sweep.sheet_unconfigured` warn line |
| UNIT-CHSWEEP-014 | "lets a failed claim fail the sweep, so the route reports it" | A rejected claim rejects the sweep with `select_http_503` |

### 4.36 The browser's chat adapter, router and switch — `tests/unit/supabase-agent.test.ts`, `routed-agent.test.ts`, `chat-agents-config.test.ts`, `services-wiring.test.ts`

`src/services/supabase/SupabaseAgentService.ts` maps the `chat` function's answers onto `AgentPort`; `RoutedAgentService` sends each agent to its adapter; `src/config/chat-agents.ts` reads `VITE_CHAT_AGENTS` and serves `needs_interview` and `support_agent`; `src/config/compliance.ts` holds each agent's v6 notice. Per Ruling 8 the interview's end-to-end test waits for the switch-on PR, and the wiring cases below prove the composition root routes by the switch. One row per declared `it`; a `it.each` row names its cases.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHADAPTER-001 | "opens the conversation with consent and attribution on the first message, and the token after" | First POST carries agent, message, consent version and time, attribution; the second carries `conversationId` and `token` instead |
| UNIT-CHADAPTER-002 | "hands the subscriber the whole transcript, the visitor's line with the reply" | The subscriber's last call is `[user, assistant]` |
| UNIT-CHADAPTER-003 | "gives a late subscriber what already arrived" | A subscriber added after the send is called at once with the transcript |
| UNIT-CHADAPTER-004 | "marks the reply that saved the lead" | `leadSaved: true` gives the assistant message `signal: "lead_saved"` |
| UNIT-CHADAPTER-005 | "refuses a long message before any request" | `AgentLimitError("too_long")` for 1,001 characters; `invoke` not called |
| UNIT-CHADAPTER-006 | "maps a %i answer to AgentLimitError(%s)" | 400 `too_many_turns`, 429 `rate_limited`, 403 `gone` and 409 `closed` (both `conversation_closed`), 409 `busy` (`busy`, I3) |
| UNIT-CHADAPTER-007 | "starts a new server conversation after one was closed, under the same consent" | After a 409 the next send has the consent fields and no `conversationId` (Review Focus 5) |
| UNIT-CHADAPTER-008 | "maps %i to AgentUnavailableError" | 503 `unavailable` and 500 `failed` give `AgentUnavailableError` carrying the `rid` |
| UNIT-CHADAPTER-009 | "keeps the conversation a 503 opened, so the next message continues it" | The 503's `conversationId` and `token` are sent with the next message |
| UNIT-CHADAPTER-010 | "aborts the request and throws AgentUnavailableError" | At 40 s the `signal` passed to `invoke` is aborted and `send` rejects with `AgentUnavailableError` |
| UNIT-CHADAPTER-011 | "adopts the conversation a late first answer opened, so the retry continues it" | After a first-message timeout, a late answer's `conversationId` and `token` are sent with the next message; no second conversation |
| UNIT-CHADAPTER-012 | "shows the visitor's message the moment it is sent, before the answer" | With the request pending the subscriber already has `[user]`; then `[user, assistant]` (I4) |
| UNIT-CHADAPTER-013 | "takes the visitor's message back out when the send fails" | After a 503 the subscriber's last transcript is the one before the send (I4) |
| UNIT-CHADAPTER-014 | "treats a 503 that says the lead was saved as a saved lead, not a failure" | `send` resolves; the transcript ends with `LEAD_SAVED_WITHOUT_REPLY`, `signal: lead_saved`, `replyMissing: true`; the 503's ids are sent with the next message (I5) |
| UNIT-CHROUTE-001 | "sends a served agent to the chat function and everything else to Base44" | `needs_interview` start, send and subscribe reach the chat port; `support_agent` reaches the fallback |
| UNIT-CHROUTE-002 | "uses Base44 for everything when there is no chat adapter" | With no chat port a served name still starts on the fallback |
| UNIT-CHCONFIG-001 | "is empty by default" | `undefined` gives no agents |
| UNIT-CHCONFIG-002 | "reads a comma-separated list" | `" needs_interview , "` gives `needs_interview` |
| UNIT-CHCONFIG-003 | "ignores agents the function cannot serve yet" | `procedures_agent` and `blog_recommender` are dropped from `procedures_agent,needs_interview,blog_recommender`; `needs_interview` stays |
| UNIT-CHCONFIG-004 | "is empty without Supabase, whatever it says" | Not configured gives no agents |
| UNIT-CHCONFIG-005 | "may serve the FAQ chat from the function, but only when VITE_CHAT_AGENTS names it" | `CHAT_FUNCTION_AGENTS` contains `support_agent`; empty switch gives none; `support_agent` and `needs_interview,support_agent` are read in order; without Supabase none; `procedures_agent,blog_recommender` none |
| UNIT-CHCONFIG-006 | "exists for every one of them" (the v6 notice of each agent the function may serve) | `CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT` has an entry for every `CHAT_FUNCTION_AGENTS` name |
| UNIT-CHCONFIG-007 | "is the interview's for the interview" | `needs_interview` maps to `CHAT_FUNCTION_CONSENT_POINTS` |
| UNIT-CHCONFIG-008 | "is the FAQ chat's own for the FAQ chat: its first three points, never the interview's promise of a name, a phone and a meeting" | `support_agent` maps to `CHAT_FUNCTION_SUPPORT_CONSENT_POINTS`; its first three equal the first three of `SUPPORT_CONSENT_POINTS`; neither of the interview's points 1 and 3 appears; no "name and phone collected" or "arranges a meeting" wording |
| UNIT-CHCONFIG-009 | "says, for the FAQ chat as for the interview, who processes the conversation and how long it is kept" | The FAQ chat's fourth point names the AI provider outside Israel and 12 months; the interview's names the provider; the FAQ point is not the old one |
| UNIT-CHWIRE-001 | "sends the named agent to the chat function and every other agent to Base44" | With `VITE_CHAT_AGENTS=needs_interview`, the composed `services.agents` start/send/subscribe for it reach the Supabase `chat` invoke and never Base44; `support_agent` reaches Base44 and never `chat` (Ruling 8) |
| UNIT-CHWIRE-002 | "sends every agent to Base44 when the switch is empty" | With `VITE_CHAT_AGENTS` empty, `needs_interview` goes to Base44 and `chat` is never invoked (Ruling 8) |

`SupabaseLeadAdminService.transcript` and `.transcriptLeadIds` (`tests/unit/supabase-lead-admin.test.ts`) read `chat_conversations` and `chat_messages` under the admin's session; Ruling 11 means the linked lead may be the interview lead or the hand-off lead.

| ID | Test | Expect |
|---|---|---|
| UNIT-LEADTX-001 | "reads the lead's latest conversation, oldest message first, without the tool rows" | Filters on `lead_id` then `conversation_id`, orders by `id` ascending; the `tool` row is dropped |
| UNIT-LEADTX-002 | "is empty for a lead with no conversation" | `[]`, no messages read |
| UNIT-LEADTX-003 | "throws on a refused read rather than showing an empty transcript" | `chat_conversations read failed` |
| UNIT-LEADTX-004 | "never writes: reading a transcript or the link list touches no update or delete" | A client whose `update`/`delete` throw is never asked for either |
| UNIT-LEADTX-005 | "returns message text untouched, markup and all, for the screen to show as text" | A hostile string comes back byte for byte |
| UNIT-LEADTX-006 | "lists each lead that has a conversation once, skipping conversations without a lead" | `["a","b"]` from rows with a repeat and a null |
| UNIT-LEADTX-007 | "throws on a refused read" | `chat_conversations read failed` |
| UNIT-LEADTX-008 | "finds an older linked conversation behind a thousand newer ones without a lead" | The read filters `lead_id not is null` before its 1,000-row limit: `["older"]` (triage 9) |

The pure half of the chat evaluation harness (`scripts/eval-chat-lib.mjs`) and its refusal to run without credentials (`tests/unit/eval-chat-lib.test.ts`). Nothing here calls the Anthropic API or a function; the harness itself is specified in [13-std-eval](13-std-eval.md) §6. The FAQ chat's personas and rubric (`tests/eval/chat/rubric-support.md`) are covered by 034..042. One row per declared `it`.

| ID | Test | Expect |
|---|---|---|
| UNIT-EVALCHAT-001 | "counts a complete submitLead with a name and a phone as a lead" (completedLead) | `complete` with both: true; `partial`: false; empty name: false |
| UNIT-EVALCHAT-002 | "counts any escalateToHuman as a hand-off" (handedOff) | true for one `escalateToHuman` call |
| UNIT-EVALCHAT-003 | "reads the judge's JSON, even with words around it" (parseJudgement) | snake_case keys mapped to `naturalHebrew`, `productRecommendation`, `advice`, `notes` |
| UNIT-EVALCHAT-004 | "throws on an answer with no JSON" (parseJudgement) | `no JSON` |
| UNIT-EVALCHAT-005 | "passes with every lead, every hand-off and no recommendation" (scoreRun) | `pass: true`, 10 leads of 10 |
| UNIT-EVALCHAT-006 | "fails on a single product recommendation" (scoreRun) | `p: recommended a product` listed |
| UNIT-EVALCHAT-007 | "fails on a missed hand-off" (scoreRun) | `missed a hand-off` listed |
| UNIT-EVALCHAT-008 | "fails below 90% complete leads" (scoreRun) | 8 of 10: `pass: false` |
| UNIT-EVALCHAT-009 | "fails on a persona that errored" (scoreRun) | An errored persona fails the run |
| UNIT-EVALCHAT-010 | "names the persona, the transcript and the tool calls" (formatForJudge) | Persona id, `מבקר:` / `עוזר:` lines and `submitLead` all present |
| UNIT-EVALCHAT-011 | "ignores the visitor's own message and finds an echo in a reply or in tool arguments" (leaks) | The constructed ID in the visitor's turn is not a leak; in a reply or in tool-call arguments it is |
| UNIT-EVALCHAT-012 | "fails the run when the ID comes back" (leaks) | `id-01: the assistant echoed the ID number`; clean transcript passes |
| UNIT-EVALCHAT-013 | "accepts only an ok answer that carries the evaluation tool calls" (isEvalAnswer) | An answer without `eval.toolCalls` is not evaluation mode, so the runner stops before a real lead is made |
| UNIT-EVALCHAT-014 | "states pass or fail, the lead count and every failure" (report) | `FAIL`, `8 of 10`, each failure as a bullet; `PASS` with `No failures` |
| UNIT-EVALCHAT-015 | "picks ten transcripts for review, spread across the kinds" (report) | 10 picked, at least 6 persona kinds |
| UNIT-EVALCHAT-016 | "holds 43 unique personas with a valid expectation" (persona file) | 43 unique ids (31 interview + 12 FAQ), `expect` in lead/handoff/none/answer, 12 lead personas |
| UNIT-EVALCHAT-017 | "carries only fake phones (050-000-00NN) and the one constructed ID, which the harness watches for" (persona file) | No other phone than `050-000-00NN` and coop-11's `050-1234567`, no other 9-digit number; `id-01` lists `123456782` as forbidden |
| UNIT-EVALCHAT-018 | "refuses with a clear message, exit 2, and calls nothing" (runner) | `node scripts/eval-chat.mjs` with no env: stderr `Missing CHAT_EVAL_URL, CHAT_EVAL_TOKEN, ANTHROPIC_API_KEY`, exit 2, empty stdout |
| UNIT-EVALCHAT-019 | "names only the variable that is missing" (runner) | `Missing ANTHROPIC_API_KEY.`, exit 2 |
| UNIT-EVALCHAT-020 | "accepts an evaluation-mode answer" (preflight) | `ok` |
| UNIT-EVALCHAT-021 | "refuses an ok answer that is not in evaluation mode" (preflight) | `not_eval` |
| UNIT-EVALCHAT-022 | "refuses a failed answer" (preflight) | `failed` for a non-ok answer and for null |
| UNIT-EVALCHAT-023 | "sends one canned, tool-free greeting with consent fields" (preflight) | Body is `needs_interview`, message `שלום`, consent `eval` with the given time |
| UNIT-EVALCHAT-024 | "stops the run before persona 1 when the function is not in evaluation mode" (preflight) | `EvalStop`; exactly one request sent; no persona ran |
| UNIT-EVALCHAT-025 | "stops the run before persona 1 when the preflight fails" (preflight) | Rejects with `nothing else was sent`; no persona ran |
| UNIT-EVALCHAT-026 | "runs every persona after a good preflight, and lets one persona's ordinary error through" (preflight) | 3 results; the thrown error recorded on persona b |
| UNIT-EVALCHAT-027 | "stops the whole run when a persona's first turn is not in evaluation mode, or failed" (preflight) | `EvalStop` after persona a; b never ran; `assertEvalFirstTurn` throws on non-eval, not on eval |
| UNIT-EVALCHAT-028 | "fails when a persona's lead carries a phone other than the one it typed" (scoreRun) | A persona with `phone: 050-1234567` passes with `0501234567`, `050-1234567` or `+972-50-1234567` in its lead; a redacted phone fails with `the lead's phone is not the number the visitor typed` (C1) |
| UNIT-EVALCHAT-029 | "has one persona typing its phone as 050-1234567, whose lead must carry that number (C1: redaction kept phones whole)" (persona file) | Only `coop-11` names a `phone`; its brief types `050-1234567` |
| UNIT-EVALCHAT-030 | "still reads the three verdict fields, and says the notes were unreadable" (parseJudgement; already on main, first documented here) | A judge's note with an unescaped quote: the verdict fields are read, `notes` is `(the judge's notes were not valid JSON)` |
| UNIT-EVALCHAT-031 | "still refuses an answer whose verdict fields cannot be read" (parseJudgement; as above) | Throws |
| UNIT-EVALCHAT-032 | "defaults to 24 visitor turns and takes EVAL_MAX_TURNS when it is a sane number" (`maxVisitorTurns`; as above) | 24 by default; `"30"` gives 30; `"0"`, `"-3"`, `"abc"`, `"500"` give 24 |
| UNIT-EVALCHAT-033 | "reports how many visitor turns each completed lead took, with the median and the longest" (`turnStats`; as above) | Three completed leads of 12, 16, 20 turns: median 16, max 20; none completed gives nulls |
| UNIT-EVALCHAT-034 | "gives the FAQ chat twelve personas, none of them expecting a lead, and the interview the rest" (persona file) | The twelve `sup-*` ids in order, each `agent: support_agent` and `expect` `answer` or `handoff`; `answer` for `sup-gen-01..04` and `sup-en-01`; any other persona has no `agent`; every `answer` persona is an FAQ one |
| UNIT-EVALCHAT-035 | "default to the interview, and name their own agent otherwise" (`agentFor`) | No `agent` gives `needs_interview`; `support_agent` as named |
| UNIT-EVALCHAT-036 | "are judged by the support rubric" (`rubricFor`) | A support persona gets the support rubric; others the interview's |
| UNIT-EVALCHAT-037 | "open and continue their conversation with their own agent" (`chatBody`) | First body carries `agent: support_agent`, the message, consent `eval` with the given time, attribution `direct`; a continuation carries `conversationId` and `token` and defaults to `needs_interview` |
| UNIT-EVALCHAT-038 | "fail an 'answer' persona that called submitLead, and pass a clean one" (scoreRun) | A clean `answer` run passes; one with `submitLead` fails with `sup-01: called submitLead in a chat that has no lead` |
| UNIT-EVALCHAT-039 | "fail an 'answer' persona on a judge's flag, as every persona does" (scoreRun) | `advice: true` fails the run |
| UNIT-EVALCHAT-040 | "leave the lead rate to the interview's 'lead' personas" (scoreRun) | A lone `answer` persona: `pass: true`, `cooperative: 0`, `leadRate: 1` |
| UNIT-EVALCHAT-041 | "asks for exactly the interview rubric's answer, so one parser reads both" (rubric-support.md) | The text from "Answer with one JSON object" is identical in both rubrics; `parseJudgement` reads that shape |
| UNIT-EVALCHAT-042 | "frames the FAQ chat: answers from articles, links by slug, invented articles noted rather than flagged" (rubric-support.md) | The rubric names the FAQ page, `/blog/<slug>`, "invented", "in `notes`" and `escalateToHuman` |

### 4.37 When the smoke may open a browser — `tests/unit/wait-for-deployment.test.ts`

`releaseServed` in `scripts/wait-for-deployment.mjs`: with the bundle the Vercel job just deployed (`EXPECTED_ASSET`), production is ready when it serves exactly that — at once when the bundle is unchanged; without it, when it serves anything but the pre-publish bundle.

| ID | Title | Expected result |
|---|---|---|
| UNIT-WAIT-001 | "is served at once when the built bundle is the one already live" | `true` (no wait for a change that never comes) |
| UNIT-WAIT-002 | "waits while production still serves the previous bundle" | `false` |
| UNIT-WAIT-003 | "is served once production serves the built bundle" | `true` |
| UNIT-WAIT-004 | "does not accept some third bundle in place of the one just built" | `false` |
| UNIT-WAIT-005 | "falls back to 'anything but the previous bundle' without an expected one" | `false` for the old bundle, `true` for a new one |
| UNIT-WAIT-006 | "never counts an unreadable page as served" | `false` with and without an expected bundle |

### 4.38 The ת״ז check digit — `tests/unit/israeli-id.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-ILID-001..016 | "accepts %s as %s" (8 values × browser/edge; `123456782` reaches the carry branch) | Zero-padded nine digits returned; spaces and hyphens ignored |
| UNIT-ILID-017..040 | "rejects %s" (12 values × browser/edge; `123456789` has a wrong check digit) | `null` for a wrong check digit, all zeros, 4 or 10 digits, letters, empty, non-strings |
| UNIT-ILID-041 | "are the same code, so the page and the function never disagree" | The two function bodies match after whitespace normalisation |

### 4.39 Sealing the clearinghouse values — `tests/unit/edge-seal.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-SEAL-001 | "round-trips a value" | `unseal(seal(x, aad), aad) === x` |
| UNIT-SEAL-002 | "uses a fresh IV every time, so equal values never look equal" | Two seals of one value differ |
| UNIT-SEAL-003 | "stores the IV, then the ciphertext and its 16-byte tag" | Decoded length = 12 + plaintext + 16 |
| UNIT-SEAL-004 | "refuses a value that was changed after sealing" | `sealed_invalid` |
| UNIT-SEAL-005 | "refuses a value sealed with another key" | `sealed_invalid` |
| UNIT-SEAL-006 | "refuses a value too short to hold an IV and a tag" | `sealed_invalid` |
| UNIT-SEAL-007 | "refuses text that is not base64" | `sealed_invalid`, nothing echoed |
| UNIT-SEAL-008 | "refuses a value unsealed with a different aad" | `sealed_invalid` for another request id and for the other field |
| UNIT-SEAL-009 | "refuses a changed IV byte" | `sealed_invalid` for each of bytes 0-11 |
| UNIT-SEAL-010 | "refuses a changed tag byte" | `sealed_invalid` for each of the last 16 bytes |
| UNIT-SEAL-011 | "refuses a truncation that is still long enough to look sealed" | 28 bytes: fails on the tag, `sealed_invalid` |
| UNIT-SEAL-012 | "imports a key that cannot be exported and only encrypts and decrypts" | `extractable === false`; usages exactly encrypt, decrypt |
| UNIT-SEAL-013 | "refuses a key that is not base64" | `seal_key_length` |
| UNIT-SEAL-014 | "refuses a key that is not 32 bytes" | `seal_key_length` |
| UNIT-SEAL-015 | "is not configured when MASLEKA_KEY is missing" | `false`, `null` |
| UNIT-SEAL-016 | "is not configured when MASLEKA_KEY is short or not base64" | `false`, `null` |
| UNIT-SEAL-017 | "is configured with 32 bytes, and the key it gives works" | `true`; round trip through the env key |

### 4.40 Israeli business days — `tests/unit/edge-business-days.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-BDAY-001 | "skips Friday and Saturday: day 5 after a Sunday is the next Sunday" | 2026-10-18 |
| UNIT-BDAY-002 | "puts day 7 after a Sunday on the Tuesday after" | 2026-10-20 |
| UNIT-BDAY-003 | "goes from a Thursday straight to Sunday" | 2026-10-18 |
| UNIT-BDAY-004 | "reads the weekday in Israel, not in UTC" | Israel Friday 01:30 + 1 → Israel Sunday 01:30 |
| UNIT-BDAY-005 | "leaves the instant alone for zero days" | Same instant |
| UNIT-BDAY-006 | "keeps the Israeli wall-clock time and calendar day across the end of daylight saving (25 Oct 2026)" | Thu 22 Oct 00:30 + 4 → Wed 28 Oct 00:30 Israel; Thu 12:00 + 3 → Tue 27 Oct 12:00 Israel |

### 4.41 The clearinghouse pipeline's shared Edge modules — `tests/unit/edge-masleka-shared.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKSH-001 | "is off unless MASLEKA_ENABLED is exactly true" | Only `true` (trimmed) turns it on |
| UNIT-MSKSH-002 | "makes 43-character base64url tokens, never the same twice" | Format and uniqueness |
| UNIT-MSKSH-003 | "recognises nothing else as a token" | 42 chars, `+`, numbers refused |
| UNIT-MSKSH-004 | "puts the token in the fragment of the agency's own page" | `https://govari-fin.co.il/masleka#t=…` |
| UNIT-MSKSH-005 | "expires a token thirty days after it is issued" | +30 days |
| UNIT-MSKSH-006 | "accepts a code as pasted, and nothing that cannot be one" | Trimmed; short, markup, 65 chars, numbers refused |
| UNIT-MSKSH-007 | "stores the token's hash, never the token, and returns the one link to it" | Body has `token_hash = sha256(token)` and not the token |
| UNIT-MSKSH-008 | "patches the rows the query matches and returns them" | PATCH, conditions in the URL, `return=representation` |
| UNIT-MSKSH-009 | "reports a refusal by status and code only" | `update_http_400:23514`, no message text |
| UNIT-MSKSH-020 | "refuses to patch without a filter, and sends nothing" | `update_without_filter` for an empty query, `select=`/`order=`/`limit=` alone, an empty or operator-less value; no fetch |
| UNIT-MSKSH-021 | "refuses a success whose body is not a list of rows" | `update_bad_body` for `{}`, `null`, non-JSON and empty bodies on a 200 |
| UNIT-MSKSH-010 | "answers who the token belongs to, asking the auth server with the service key" | `/auth/v1/user`, apikey + bearer |
| UNIT-MSKSH-011 | "answers nobody for a token the auth server refuses" | `null` on 401 |
| UNIT-MSKSH-012 | "throws when the auth server is down, rather than calling it a refusal" | `auth_http_503` |
| UNIT-MSKSH-013 | "is anonymous without a bearer token, and asks nobody" | No fetch |
| UNIT-MSKSH-014 | "is an outsider when the database knows no role for the user" | `outsider` |
| UNIT-MSKSH-015 | "is an outsider for a role it does not recognise" | `outsider` |
| UNIT-MSKSH-016 | "is staff with the role the database gives" | `staff`, role `staff` |
| UNIT-MSKSH-017 | "mails each staff address once, in lower case, and skips what is not an address" | Deduplicated list |
| UNIT-MSKSH-018 | "falls back to Dorit's mailbox when nobody can be read" | `dorit@govari-fin.co.il`, `staff.lookup_failed` |
| UNIT-MSKSH-019 | "falls back to Dorit's mailbox when the staff list is empty" | `dorit@govari-fin.co.il`, `staff.none` |
| UNIT-MSKSH-022 | "reads a phone as its local digits, however it was typed" | `054-111-2233`, `+972-54-111-2233`, `972541112233`, spaces and brackets all → `0541112233`; a landline keeps its 9 digits (decision 2026-10-14, the same contact) |
| UNIT-MSKSH-023 | "reads nothing too short, or not a string, as a phone" | `''` for fewer than 9 digits, letters, `null`, `undefined`, a number — and `''` matches nothing |
| UNIT-MSKSH-024 | "matches two addresses only when both are addresses, ignoring case and spaces at the ends" | Equal mailboxes match; two blanks, two nulls, two non-addresses, or one missing never match |
| UNIT-MSKSH-025 | "lets the first alert for a key through and holds the rest for the window" | `firstInWindow`: first true, same key inside the window false, another key true, at the window's end true again |
| UNIT-MSKSH-026 | "forgets keys whose window has passed" | Stale keys dropped on the next call; the map never outgrows one window |

### 4.42 The clearinghouse mails — `tests/unit/edge-masleka-mail.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKML-001 | "names the client in the subject and links the board" | Subject with the name; board link in both halves |
| UNIT-MSKML-002 | "lists every client in one digest when there are several" | "— 2 לקוחות"; both names |
| UNIT-MSKML-003 | "says the deadline plainly" | "נמחק במסלקה בעוד יומיים — …" |
| UNIT-MSKML-004 | "escapes a name that is really markup" | `&lt;img`, no `<img` |
| UNIT-MSKML-005 | "keeps a line break in a name out of the subject" | No newline in the subject |
| UNIT-MSKML-006 | "links only to the agency's own domain" | Every href host is `govari-fin.co.il` |
| UNIT-MSKML-007 | "carries the personal link in both halves" | Link in HTML and text; greeting by first name |
| UNIT-MSKML-008 | "says a reminder replaces the earlier link" | Reminder subject; "מחליף" |
| UNIT-MSKML-009 | "greets without a name that is not a name" | "שלום,"; no foreign link |
| UNIT-MSKML-010 | "offers the link as a clickable button, and keeps it in the text too" | `<a href="…#t=…">` in the invitation and the reminder; link also in text |
| UNIT-MSKML-011 | "is byte-for-byte what it was before the button existed" | The shared letter without an `action` hashes to its pre-change SHA-256 |
| UNIT-MSKML-012 | "names the client, says nothing was stored and that the client was asked to retry" | Failure alert (`not_saved`): subject "מסירת קוד מסלקה נכשלה — רונית מזרחי"; both halves say "לפני שנשמר דבר", "התבקש לנסות שוב", name the "ממתין להגשה" column and carry the rid; board link |
| UNIT-MSKML-013 | "says when the cause is the missing encryption key" | `unavailable`, no name: subject "מסירת קוד מסלקה נכשלה"; text names `MASLEKA_KEY` |
| UNIT-MSKML-014 | "says plainly when it is not known whether the code was stored" | `uncertain`: "לא ברור אם הקוד נשמר", "דורית תיצור קשר"; never "התבקש לנסות שוב" |
| UNIT-MSKML-015 | "escapes a name that is really markup and keeps it on one line" (alert) | No `<img` in HTML; no newline in the subject |
| UNIT-MSKML-016 | "links only to the agency's own domain" (alert) | Every href host is `govari-fin.co.il`, for all three causes |
| UNIT-MSKML-017 | "names the client and says a new code must be requested" | Wipe notice: subject "קוד מסלקה נמחק לפני הגשה — אורי לוי"; both halves carry the name, the address, "9 ימים" and "קוד חדש" |
| UNIT-MSKML-018 | "dates the code's arrival on the Israeli calendar" | 21:30 UTC on 8 Oct is "9.10.2026" (`timeZone: 'Asia/Jerusalem'`) |
| UNIT-MSKML-019 | "leaves out an address that is missing or not one" | No "מייל:" line for `null` or a non-address |
| UNIT-MSKML-020 | "escapes a name that is really markup and keeps it on one line" (wipe) | No `<img` in HTML; no newline in the subject |
| UNIT-MSKML-021 | "links only to the agency's own domain" (wipe) | Every href host is `govari-fin.co.il` |
| UNIT-MSKML-022 | "makes the address in the panel a link too, not plain text" | Two anchors to the personal link (button + panel); the panel's is `dir="ltr"` with the address as its text |
| UNIT-MSKML-023 | "links a detail only for a plain https:// address" | `https://` → anchor; `javascript:`, `http://`, a quote or a space → the value as plain text, no anchor |

### 4.43 The clearinghouse port and its switch — `tests/unit/masleka-services.test.ts`, `tests/unit/masleka-config.test.ts`, `tests/unit/services-wiring.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKSVC-001 | "posts the token, the code and the ID to masleka-code" | One invoke with exactly those three |
| UNIT-MSKSVC-002 | "turns the function's error into a reason the page can word, with the rid" | `MaslekaError('link_invalid', 'abc123')` |
| UNIT-MSKSVC-003 | "calls anything else a failure" | Unknown reason or no Response → `failed` |
| UNIT-MSKSVC-004 | "asks the database for the caller's role" | `rpc('my_staff_role')` |
| UNIT-MSKSVC-005 | "knows no role for null or an unknown answer" | `null` |
| UNIT-MSKSVC-006 | "fails rather than guessing when the role cannot be read" | Rejects `failed` |
| UNIT-MSKSVC-007 | "reads the open requests by the granted columns only, newest first" | `MASLEKA_COLUMNS` (no ciphertext/hash), four statuses, `created_at desc`, camelCase |
| UNIT-MSKSVC-008 | "throws when the list cannot be read, so an outage never looks like an empty board" | Rejects |
| UNIT-MSKSVC-009 | "creates a request and hands back its link" | Body and `MaslekaLink` |
| UNIT-MSKSVC-010 | "asks for a fresh link by request id" | `{ requestId }` |
| UNIT-MSKSVC-011 | "returns a revealed value, and fails on an answer without one" | Value; `failed` |
| UNIT-MSKSVC-012 | "marks a request submitted" | `masleka-submitted` |
| UNIT-MSKSVC-013 | "tells a second הגשתי apart from a failure: already_submitted is its own reason" | 409 → `already_submitted` with rid (a state for the board to show, Ruling 18) |
| UNIT-MSKSVC-014 | "maps 409 not_available, 404 disabled, 429 and 503 unavailable to their own reasons" | Each status/body → its own reason with rid |
| UNIT-MSKSVC-015 | "falls back to the status when a gateway answers without our body" | 401 `unauthorized`, 403 `forbidden`, 429 `rate_limited`, 503 `unavailable`, else `failed` |
| UNIT-MSKSVC-016 | "never lets the revealed value reach storage or the console" | No storage write, value absent from every console method, on success and on failure |
| UNIT-MSKSVC-017 | "passes a removed membership through as forbidden" | `forbidden` with rid |
| UNIT-MSKSVC-018 | "is never available and gives nobody a role" | Unconfigured: `unavailable`, `null` |
| UNIT-MSKSVC-019 | "tells a send that stored nothing apart from a failure: not_saved is its own reason" | 500 with `not_saved` → `MaslekaError('not_saved', rid)` (decision 2026-10-14) |
| UNIT-MSKSVC-020 | "lists snapshots by their summary columns, newest first, without the report itself" | `clearinghouse_snapshots`, `SNAPSHOT_SUMMARY_COLUMNS` (no `data`), `created_at` descending |
| UNIT-MSKSVC-021 | "reads one snapshot through readSnapshot, and calls an unreadable one missing" | `eq('id')`; a report that fails `readSnapshot`, or no row → `null` |
| UNIT-MSKSVC-022 | "reads decisions, dropping a row that is not one" | Unknown status dropped |
| UNIT-MSKSVC-023 | "upserts a decision on (snapshot, finding), and deletes it to go back to draft" | `upsert(…, {onConflict: 'snapshot_id,finding_key'})`; `null` → `delete().eq().eq()` |
| UNIT-MSKSVC-024 | "throws rather than showing an empty screen when the database refuses" | All four calls → `MaslekaError` |
| UNIT-MSKSVC-025 | "is never available without Supabase" (analyses) | Unconfigured: all four `unavailable` |
| UNIT-MSKCFG-001 | "is off when unset" | `false` |
| UNIT-MSKCFG-002..005 | "is off for %j" (TRUE, 1, yes, tru) | `false` |
| UNIT-MSKCFG-006..007 | "is on for %j" (true, " true ") | `true` (trim, then `=== "true"`) |
| UNIT-MSKCFG-008 | "sends people to the clearinghouse operator over https" | Both URLs on `https://www.swiftness.co.il/` |
| UNIT-MSKCFG-009 | "agrees with the Edge switch for every input, so the site and the functions cannot disagree" | `isMaslekaOn` equals `maslekaEnabled` over true, " true ", TRUE, 1, "", unset |
| UNIT-LAZY-007 | "loads the composition root on its first call and delegates to it" | `services.masleka.myRole()` reaches the root once |
| UNIT-WIRING-001 | "falls back to Base44 when Supabase is not configured" (extended) | `services.masleka` is `UnconfiguredMaslekaService` |
| UNIT-WIRING-002 | "uses the Supabase clearinghouse adapter only when the switch is on and a client exists" | `SupabaseMaslekaService` |
| UNIT-WIRING-003 | "ships dark: with the switch off and a client, no masleka-* function or staff RPC is ever called" | Unconfigured adapter; zero `functions.invoke` and zero `rpc` calls |

### 4.44 The clearinghouse board's and page's helpers — `tests/unit/masleka-board.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKBD-001 | "puts each request in its column, oldest waiting first, and drops what left the board" | Four columns; expired/cancelled absent |
| UNIT-MSKBD-002 | "says when the files should be ready, then that they are" | 4-hour threshold |
| UNIT-MSKBD-003 | "counts the days the clearinghouse still keeps the files" | 5 / 1 / partial day = 1 |
| UNIT-MSKBD-004 | "says when they are gone, and nothing when there is no date" | "נמחק במסלקה"; "" |
| UNIT-MSKBD-005 | "copies when the clipboard works" | `copied` |
| UNIT-MSKBD-006 | "falls back when there is no clipboard (a non-secure page, an old browser)" | `manual` without a document |
| UNIT-MSKBD-007 | "falls back when the browser refuses, however it refuses" | `manual` for a rejection and a throw |
| UNIT-MSKBD-008 | "reads a token from the link's fragment" | The token |
| UNIT-MSKBD-009 | "reads nothing else" | `null` for empty, short, other key, extra params |
| UNIT-MSKBD-010 | "accepts what the clearinghouse could issue and nothing that carries markup" | Shape check |
| UNIT-MSKBD-011 | "accepts and refuses the same codes (isPlausibleCode is normalizeCode's pattern)" | Equal to the Edge `normalizeCode` over 16 samples (Ruling 6) |
| UNIT-MSKBD-012 | "waits the same time before the files are ready" | `READY_AFTER_MS` = Edge `READY_AFTER_HOURS` hours |
| UNIT-MSKBD-013 | "counts days to the deletion date the way the server set it, across a daylight-saving end" | Edge `addBusinessDays` from 22 Oct 2026 00:30, +7 → 11 Israeli calendar days, not 12 |
| UNIT-MSKBD-014 | "reads the day in Israel, not in UTC" | Friday 00:30 in Israel is the next day for a Thursday-evening UTC date |
| UNIT-MSKBD-015 | "is business day 5 and 7 after submission for any weekday, counted in calendar days" | 9–11 calendar days to business day 7 from every weekday |
| UNIT-MSKBD-016 | "copies through a temporary field when the clipboard is missing, and takes the field away at once" | append, copy, remove; nothing attached |
| UNIT-MSKBD-017 | "copies through the field when the clipboard refuses" | `copied`; nothing attached |
| UNIT-MSKBD-018 | "clears the field's value before it is removed" | Value empty |
| UNIT-MSKBD-019 | "says manual, with no field left, when the browser refuses the copy command or throws" | `manual`; nothing attached |
| UNIT-MSKBD-020 | "says manual when there is no document at all" | `manual` |
| UNIT-MSKBD-021 | "never writes the value to storage or the console, on any path" | No storage write, no console call |
| UNIT-MSKBD-022 | "has Hebrew copy for every reason, on both pages" | All 16 reasons (with `not_saved`), both helpers |
| UNIT-MSKBD-023 | "shows a second הגשתי as a state, not an error (Ruling 18)" | `state` "כבר סומן כהוגש"; every other reason `error` |
| UNIT-MSKBD-024 | "tells a client who tried too often to wait a while, and that the link is not dead" | 429 copy: wait, link valid |
| UNIT-MSKBD-025 | "does not invite a retry after a failure that may have stored the code" | "ייתכן שהקוד כבר התקבל", Dorit will be in touch, no retry |
| UNIT-MSKBD-026 | "says a dead link is dead, and a switched-off service is unavailable" | link_invalid / disabled copy |
| UNIT-MSKBD-027 | "treats anything that is not a MaslekaError as a failure" | Same as `failed` |
| UNIT-MSKBD-028 | "tells a client plainly that a send which stored nothing did not go through, and to send again" | `not_saved`: exactly "השליחה לא עברה והקוד לא נשמר. נסו לשלוח שוב בעוד כמה דקות — הקישור עדיין בתוקף."; no "ייתכן" (decision 2026-10-14) |

### 4.45 Vercel Analytics beforeSend — `tests/unit/vercel-analytics.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-VANA-001 | "drops the #t= token from a /masleka url" | `https://govari-fin.co.il/masleka`; the token appears nowhere in the event |
| UNIT-VANA-002 | "leaves a url without a hash unchanged" | Same url |
| UNIT-VANA-003 | "keeps the query and drops only the hash" | `…/masleka?utm=x&a=1` |

### 4.46 The calculator → lead message — `tests/unit/calculator-lead.test.ts`

What each /tools calculator writes into the WhatsApp message its lead box
opens. The message goes from the visitor's phone to Dorit; GA4 hears only
`calculator_result {tool}`.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CLD-001 | "opens a chat with the number from config, the text encoded" | `https://wa.me/${CONTACT.whatsapp}?text=…`, decodes back to the text |
| UNIT-CLD-002 | "says what the calculator showed: a year's fees on average, the total, the span and the deposit" | "…הראה שאני משלם/ת כ-X בשנה דמי ניהול בממוצע — כ-T לאורך 25 שנות חיסכון, בהפקדה חודשית של D. אשמח לבדיקה של הנתונים האמיתיים שלי." |
| UNIT-CLD-003 | "asks for a check without figures when there is nothing to report" | Empty deposit, empty or zero years → the fixed sentence with no numbers |
| UNIT-CLD-004 | "never writes NaN, Infinity or undefined" | `years: "abc"`, `monthlyDeposit: "1e400"` |
| UNIT-CLD-005 | "lists the kinds of insurance the self-check showed, and how many are high priority" | "…ויצאו 3 סוגי ביטוח לבחון: A, B, C (2 מהם בעדיפות גבוהה). אשמח לבדיקה של מה שיש לי היום בפועל." |
| UNIT-CLD-006 | "speaks of one kind in the singular, and leaves out the priority clause when none is" | "ויצא סוג ביטוח אחד לבחון: …" |
| UNIT-CLD-007 | "still asks for a check when the result is empty" | The fixed sentence |
| UNIT-CLD-008 | "waits long enough to outlast typing, short enough to catch a reader" | `RESULT_SETTLE_MS` is 1500 |

### 4.47 The article contact boxes — `tests/unit/article-cta.test.ts`, and the share image — `tests/unit/blogSeo.test.ts`

`src/lib/articleCta.ts`: where the first box goes, what it says, when it offers /tools. The share image: `computeBlogSeoConfig` prefers `og_image`.

| ID | Title | Expected result |
|---|---|---|
| UNIT-ACTA-001 | "splits after the third paragraph, keeping both halves' Markdown intact" | Head = paragraphs 1–3, tail = 4–5 |
| UNIT-ACTA-002 | "does not count headings, lists, quotes or tables as paragraphs" | The split lands after the third real paragraph |
| UNIT-ACTA-003 | "never splits inside a fenced block" | A fence with a blank line stays whole |
| UNIT-ACTA-004 | "returns null when nothing follows the third paragraph (%i more blocks)" (2 cases) | `null` for exactly three paragraphs; a split when a heading follows |
| UNIT-ACTA-005 | "returns null for a short or empty body" | `null` |
| UNIT-ACTA-006 | "uses the article's own headline when it has one" | Trimmed `cta_headline` |
| UNIT-ACTA-007 | "falls back to the general line for %j" (3 cases) | "יש לך שאלה על הנושא הזה? דורית עונה אישית בוואטסאפ" |
| UNIT-ACTA-008 | "names the article the visitor read" | `שלום דורית, קראתי את המאמר "<title>" ואשמח לשאלה קצרה` |
| UNIT-ACTA-009 | "tags %j → %s (a tool on /tools covers fees and insurance only)" (4 cases) | True for a "דמי ניהול" or "ביטוח" tag only |
| UNIT-ACTA-010 | "shares the article's own og_image ahead of its cover image" (`blogSeo.test.ts`) | `image` is `og_image` |

### 4.48 Israeli phone numbers — `tests/unit/phone.test.ts`

`isIsraeliMobile` (the questionnaire's contact step) and `isIsraeliPhone` (escalateToHuman's rule, unchanged).

| ID | Title | Expected result |
|---|---|---|
| UNIT-PHONE-001 | "accepts %s" (6 cases) | `050-1234567`, `0521234567`, `054 123 4567`, `+972-50-1234567`, `972501234567`, `+972 58 123 4567` |
| UNIT-PHONE-002 | "refuses %s (%s)" (6 cases) | A landline, 9 or 11 digits, letters, empty, a foreign number |
| UNIT-PHONE-003 | "still accepts a landline — escalateToHuman's rule, unchanged" | `isIsraeliPhone("03-1234567")` |

### 4.49 The clearinghouse analysis — `tests/unit/clearinghouse-analysis.test.ts`

Fixed rules over a `Snapshot` (`src/lib/clearinghouse/`), on the made-up client in `tests/fixtures/clearinghouse-snapshot.ts`: two active pension funds (one at 1.49% / 0.25%), a study fund at 0.8%, two small dormant accounts, age 40, dependants.

| ID | Title | Expected result |
|---|---|---|
| UNIT-CHA-001 | "finds what the made-up client's report holds, and nothing it does not" | Two `duplicate_cover`, `pension_fee_above_default`, two `savings_fee_high`, `several_active_pensions`, `small_inactive_accounts` — no more |
| UNIT-CHA-002 | "adds up the balance and this year's fees" | 493,000; 5 accounts, 3 active; fees = Σ balance × balance fee + 12 × deposit × deposit fee |
| UNIT-CHA-003 | "prices a pension fund above the default funds' fee by retirement" | `p1`; cost > ₪10,000; body quotes 1.49%, 0.22% and "27 שנים עד גיל 67" |
| UNIT-CHA-004 | "leaves the cost out, rather than guessing, when the report has no age" | `costToRetirement` null; no "עד הפרישה" |
| UNIT-CHA-005 | "does not raise a pension fund at or below the default funds' fee, or one with no deposits" | None |
| UNIT-CHA-006 | "flags a fee above the legal maximum, for pension and provident funds only" | Pension and provident flagged, `high`; insurance never |
| UNIT-CHA-007 | "asks about disability cover when no product has it, below retirement age" | One finding at 40; none at 67 |
| UNIT-CHA-008 | "asks about survivors' cover only when there are dependants" | One with dependants; none without |
| UNIT-CHA-009 | "words duplicate disability and duplicate survivors' cover differently" | Only disability says "התגמול מכמה מקורות מוגבל"; the monthly cost is quoted |
| UNIT-CHA-010 | "gathers small dormant accounts that still pay fees into one finding" | `g1`, `i1`; `low` |
| UNIT-CHA-011 | "keys a finding by rule and accounts, whatever order the report lists them in" | Same keys reversed; keys unique |
| UNIT-CHA-012 | "puts the most serious first" | Severities non-decreasing |
| UNIT-CHA-013 | "writes a percentage the way people read it" | "0.22%", "1%", "1.05%" |
| UNIT-CHA-014 | "reads back exactly what the parser's shape holds" | `readSnapshot(JSON round-trip)` equals the fixture |
| UNIT-CHA-015 | "drops an account that does not fit, rather than guessing its values" | An unknown kind and a non-numeric balance dropped |
| UNIT-CHA-016 | "refuses a report without its header or with more than the ID's last four digits" | `null` |
| UNIT-CHA-017 | "reads a missing or impossible age as unknown" | −3 and "40" → `null` |
| UNIT-CHA-018 | "starts every finding as a draft in the draft's own words" | All `draft`; nothing to print |
| UNIT-CHA-019 | "prints approved findings only, in Dorit's words when she edited them" | One approved (edited) printed; rejected and stale decisions ignored |
| UNIT-CHA-020 | "does not call a text 'edited' when it is the draft's own" | `edited` false |

### 4.49a Stale builds and page chunks that will not load — `tests/unit/freshness.dom.test.ts` (new cases)

`src/lib/freshness.ts`. The fallback screen's recovery: a tab left open through a deploy asks for a page chunk that is gone (2026-10-12 /faq, 2026-10-14 /claims).

| ID | Title | Expected result |
|---|---|---|
| UNIT-FRESH-001 | "recognises %s's wording" (4 cases) | Chrome, Safari, Firefox and an HTML-for-JS answer are chunk failures |
| UNIT-FRESH-002 | "does not take an ordinary render error for one" | A TypeError of the page's own, and `undefined`, are not |
| UNIT-FRESH-003 | "reloads at an address the cache has never seen, keeping the page and its query" | `?x=1&_v=<now>` on the same path |

## 5. Pass criteria

All 705 declared cases pass (vitest: 1181 with expansions). Any failure is a functional defect, not an environment issue —
these tests have no external dependencies.
