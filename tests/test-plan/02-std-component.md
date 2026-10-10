# STD-02 — Component Tests

**Suite:** `component` · **Runner:** `npm run test:component` (Vitest + React Testing Library)
**Location:** `tests/component/sanity.test.tsx` · **Cases:** 24 · **Environment:** jsdom

---

## 1. Purpose

Sanity-check every first-party component that carries behaviour: that it
renders, exposes the accessible names screen readers and the e2e suite depend
on, and calls the Base44 client with the payload the backend contract expects.

## 2. Test items

`Stars`, `MobileStickyBar`, `FloatingActions`, `PensionFeeCalculator`,
`QuickContact`, `ClaimForm`, `FAQ`, `ShareButtons`, `ReviewsWidget`, `Testimonials` — all in
`src/components/dorit/`.

## 3. Approach

| Concern | Handling |
|---|---|
| Base44 SDK | `vi.mock("@/api/base44Client")` → `tests/component/base44-mock.ts`; assertions are on the recorded calls |
| `framer-motion` | Replaced with a pass-through proxy; jsdom has no layout engine for its animations |
| Router | Components using `<Link>` are wrapped in `MemoryRouter` |
| Queries | Role and label based (`getByRole`, `getByLabelText`) — the same accessibility surface the e2e suite asserts on |
| Cleanup | `tests/setup/testing-library.ts` runs `cleanup()` after each case |

## 4. Test cases

### 4.1 `<Stars />`

| ID | Title | Expected result |
|---|---|---|
| CMP-STR-001 | "exposes the rating as an image with an accessible name" | `role="img"` named `דירוג 4 מתוך 5` |
| CMP-STR-002 | "rounds a fractional rating" | `4.6` → `דירוג 5 מתוך 5` |
| CMP-STR-003 | "renders five stars regardless of the value" | Exactly 5 `<svg>` |
| CMP-STR-004 | "treats a missing value as zero rather than NaN" | Named `דירוג 0 מתוך 5` |

### 4.2 `<MobileStickyBar />` / `<FloatingActions />`

| ID | Title | Expected result |
|---|---|---|
| CMP-BAR-001 | "offers a dial link and the short contact form" | `tel:+972508311776` and `/#quick-contact` — a home-page anchor from every route, never a bare `#…` |
| CMP-FLA-001 | "links to WhatsApp with a prefilled Hebrew message and a safe rel" | `wa.me/<number>`, `target=_blank`, `rel` contains `noopener`, message decodes to Hebrew |
| CMP-FLA-002 | "links to the phone number in E.164 form" | `href === tel:${CONTACT.phoneE164}` |
| CMP-BAR-002 | "offers a way to the support chat" | "תמיכה" → `/faq#support-chat` |
| CMP-FLA-003 | "links to the support chat" | "תמיכה — …" → `/faq#support-chat` |

Both components now hold a router link, so every case renders them inside
`MemoryRouter`, as the app does. Rendered bare, all three earlier cases threw
before asserting anything.

### 4.3 `<PensionFeeCalculator />`

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-PFC-001 | "renders the default scenario" | render | Deposit `2000`, years `25`, totals visible |
| CMP-PFC-002 | "recomputes the totals when an input changes" | clear + type `4000` | First result card changes |
| CMP-PFC-003 | "never shows NaN when every field is cleared" | clear all 5 inputs | Rendered text contains no `NaN` |
| CMP-PFC-004 | "labels every input for assistive tech" | render | Every `spinbutton` has an accessible name |

### 4.4 `<QuickContact />` — the primary lead form

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-QCF-001 | "disables submit until name and phone are present" | type name, then phone | Submit enabled only after both |
| CMP-QCF-002 | "hands the lead to the submitLead backend function" | fill + submit | `functions.invoke("submitLead", {name, phone, email, source:"quick"})`; `SendEmail` and `Lead.create` are **not** called — the mail and the write moved into the function |
| CMP-QCF-003 | "confirms to the visitor and clears the form after a successful send" | submit, then "send another" | Confirmation shown; fields reset |
| CMP-QCF-004 | "keeps the visitor's input and offers a fallback when sending fails" | `SendEmail` rejects | Error message shown; typed name still present |
| CMP-QCF-005 | "does not submit twice on a double click" | double-click submit | The function is invoked exactly once |

### 4.5 `<ClaimForm />` — the claim report

Two of these three are regressions with a fixed shape: a handler referencing a
setter that does not exist throws a `ReferenceError` out of an event, which
React does not surface anywhere a visitor can see. The form simply stops.

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-CLM-001 | "hands the report to the submitClaim backend function with uploaded document urls" | fill, attach a file, submit | `functions.invoke("submitClaim", {name, phone, documents:[url]})` |
| CMP-CLM-002 | "reports a failed upload instead of crashing, and keeps the form usable" | `UploadFile` rejects | Upload error shown; submit still enabled |
| CMP-CLM-003 | "offers a blank form again after a successful report" | submit, then "send another" | Fields cleared; submit disabled again |

### 4.6 `<FAQ />`, `<ShareButtons />`, `<ReviewsWidget />`

| ID | Title | Expected result |
|---|---|---|
| CMP-FAQ-001 | "renders questions as buttons and reveals the answer on click" | Content grows after clicking the first question |
| CMP-SHR-001 | "renders share targets that all use https and a safe rel" | Every `target=_blank` href is `https:` or `mailto:`; `rel` contains `noopener` |
| CMP-RVW-001 | "asks the backend for testimonials on mount" | `Testimonial.list("-created_date", 50)` |
| CMP-RVW-002 | "renders without crashing when the backend returns nothing" | No throw on an empty list |
| CMP-RVW-003 | "survives a backend error without throwing" | No throw when `list` rejects |

### 4.7 `<Account />` — the personal area

| ID | Title | Expected result |
|---|---|---|
| CMP-ACC-001 | "shows who is signed in" | Name and email of the signed-in user appear |
| CMP-ACC-002 | "says so when there are no enquiries, and why some may be missing" | One "עוד אין כאן פניות" and the note on mail-less or other-address enquiries |
| CMP-ACC-003 | "shows a meeting with its status" | "ביומן" for an entry in the calendar, "ממתינה לאישור דורית" for one not yet |
| CMP-ACC-004 | "shows the interview's answers with the mail's labels" | Profile labels and values rendered as text |
| CMP-ACC-005 | "marks a partial interview as not finished" | "לא הושלם" shown |
| CMP-ACC-006 | "renders an old enquiry with no stored answers" | The summary-not-saved note instead of an empty block |
| CMP-ACC-007 | "explains an unverified address instead of an empty list" | The unverified-address explanation, no lists |
| CMP-ACC-008 | "shows the rid when loading fails, and keeps the rest of the page" | The rid is shown; the signed-in details remain |
| CMP-ACC-009 | "sends a visitor whose session ended back to sign in" | The login screen is rendered; the page is gone |
| CMP-ACC-010 | "renders an enquiry with no stored date without printing an invalid date" | `createdAt: ""` prints no "Invalid Date" |
| CMP-ACC-011 | "gives an interview-only visitor an empty meetings line, not a second empty-page notice" | "אין כאן פגישות" shown; "עוד אין כאן פניות" absent |
| CMP-ACC-012 | "gives a meeting-only visitor an empty interviews line" | "אין כאן סיכומי היכרות" shown |
| CMP-ACC-013 | "links to the privacy rights" | Link to `/privacy` for access, correction or deletion |
| CMP-ACC-014 | "renders a repeated answer label twice without a React key warning" | Both values shown; no duplicate-key console error |
| CMP-ACC-015 | "says the time is not set when a meeting has neither a date nor a timing" | "המועד טרם נקבע" shown |
| CMP-ACC-016 | "offers a retry after a failed load, and shows the enquiries when it succeeds" | A failed load is retried once by the page, so it fails twice before "ניסיון נוסף" appears; the button then refetches and the third load's meeting appears |
| CMP-ACC-017 | "orders meetings: upcoming soonest first, then past most recent first, then undated" | With a fixed `now`, the titles read upcoming (soonest first), past (most recent first), then the one with no date |
| CMP-ACC-018 | "lists enquiries that are neither interviews nor meetings, with a source label" | Section "פניות נוספות"; labels "טופס יצירת קשר", "פנייה מפורטת", "בקשת פגישה", "דיווח על תביעה", "בקשה לשיחה עם דורית", and "פנייה" for an unknown source, each with its date |
| CMP-ACC-019 | "hides the other-enquiries section when there is nothing for it" | No "פניות נוספות" heading when every enquiry is an interview or meeting |
| CMP-ACC-020 | "does not show the previous user's rows after the session changes without a reload" | After the signed-in user changes, the loader runs again and the first user's meeting is gone |
| CMP-ACC-021 | "does not retry a signed-out load" | A `signed_out` rejection calls the loader exactly once and lands on the login screen |
| CMP-ACC-022 | "announces loading as a status" | The loading line has `role="status"` |
| CMP-ACC-023 | "signs out and goes to sign in again, to switch to another Google account" | "יציאה והתחברות עם חשבון אחר" calls `logout(true, <origin>/login?returnTo=/account)` |

### 4.8 `<FloatingHeader />` — account and admin links

| ID | Title | Expected result |
|---|---|---|
| CMP-HDR-001 | "shows no personal-area link to a signed-out visitor" | No "האזור שלי" link |
| CMP-HDR-002 | "links a signed-in visitor to /account, with no admin links" | "האזור שלי" points to `/account`; no "ניהול פניות" or "ניהול בלוג" |
| CMP-HDR-003 | "gives an admin both admin pages" | "ניהול פניות" points to `/admin/leads` and "ניהול בלוג" to `/admin/blog` |
| CMP-HDR-004 | "offers no sign-out to a signed-out visitor" | No "יציאה" button |
| CMP-HDR-005 | "signs a visitor out and sends them home" | "יציאה" calls `logout(true, <origin>/)` |

### 4.9 `<LeadTrackingPanel />` — `tests/component/lead-tracking-panel.test.tsx`

The admins' view of GA4 lead tracking, at the top of `/admin/leads`.

| ID | Title | Expected result |
|---|---|---|
| CMP-GA4-001 | "lists every event the site sends" | Every `LEAD_EVENTS` name shown |
| CMP-GA4-002 | "says when the tag is blocked in this browser" | "כנראה חוסם פרסומות" |
| CMP-GA4-003 | "says when the tag is running" | "אירועים נשלחים" |
| CMP-GA4-004 | "marks this browser as internal, and unmarks it" | Label and storage flip both ways |
| CMP-GA4-005 | "links to the GA4 reports in a new tab" | `analytics.google.com`, `rel` contains `noopener` |

`sanity.test.tsx` also pins the rule that a lead counts only once saved:
CMP-QCF-006 "reports a lead to GA4 after a successful send, and not after a failed one".

### 4.10 `<ErrorBoundary />` — `tests/component/error-boundary.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-ERB-001 | "renders children normally when nothing throws" | Child visible, no `role="alert"` |
| CMP-ERB-002 | "shows the fallback with all three contact links when a child throws, and logs without personal data" | `role="alert"` message; `tel:`, `wa.me` and `mailto:` links from `CONTACT`; `console.error` called |
| CMP-ERB-003 | "isolates the failure: sibling trees still render" | Sibling text present; section wording ("החלק הזה") |
| CMP-ERB-004 | "uses page wording for the app-level boundary" | `scope="page"` message says "הדף" |
| CMP-ERB-005 | "recovers when its resetKey changes, so leaving a broken page is not a dead end" | After `resetKey` changes (the app passes the path), the fallback is gone and the new children render |

### 4.11 `<Testimonials />` — `tests/component/testimonials.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-TST-001 | "renders nothing while loading and nothing when there are no testimonials" | No `#testimonials`, no "לקוחות מספרים" heading, no placeholder text |
| CMP-TST-002 | "renders the section and its heading when there are testimonials" | `section#testimonials`, the heading and the quote are present |
| CMP-TST-003 | "keeps the section for an admin when empty, so the first one can be added" | The "הוספת המלצה" button is present |
| CMP-TST-004 | "shows a signed-in visitor who is not an admin no add or delete controls" | Since the personal area, ordinary visitors sign in: the quote shows, no "הוספת המלצה" and no delete button |
| CMP-TST-005 | "hides the empty section from a signed-in visitor who is not an admin" | No `#testimonials` |

### 4.12 `<Blog />` — the blog index — `tests/component/blog-page.test.tsx`

`AgentChat` is stubbed; the date is fixed with `vi.setSystemTime`, so the
featured row's deadline does not decide the outcome of an unrelated run.

| ID | Title | Expected result |
|---|---|---|
| CMP-BLOG-001 | "shows a count per topic and starts on הכל" | Five buttons with counts; הכל is `aria-pressed` |
| CMP-BLOG-002 | "narrows the grid to the chosen topic and marks only that button pressed" | Only that topic's cards; H2 reads the topic and its count |
| CMP-BLOG-003 | "combines with the search box" | Topic and search apply together |
| CMP-BLOG-004 | "shows the first nine, then the rest on request" | 9 cards, then 12 after "הצגת כל המאמרים" |
| CMP-BLOG-005 | "hides cards past the sixth on a phone only, with the count a phone sees" | Cards 7–9 carry `max-md:hidden`; button names both counts |
| CMP-BLOG-006 | "shows the featured article and the three quickest to act on under הכל" | Badge, title, and the three shortest action times in order |
| CMP-BLOG-007 | "stays under מיסוי ועצמאים and goes away under any other topic" | Row present under tax, absent under insurance and pension |
| CMP-BLOG-008 | "is gone once its deadline has passed" | No row on 2 Jan 2027 |
| CMP-BLOG-009 | "is gone when the featured article is not published" | No row |
| CMP-BLOG-010 | "render no image at all when the article has none" | No `<img>` in the card |
| CMP-BLOG-011 | "render the article's own image when it has one" | One `<img>` |
| CMP-BLOG-012 | "show the action time when there is one, and the reading time always" | "ביצוע: …" only with `action_time`; "קריאה: כ־N דק׳" always |
| CMP-BLOG-013 | "opens the reading-recommender chat with what the visitor typed" | A dialog with the embedded chat, its input pre-filled |
| CMP-BLOG-014 | "gives the page back to assistive tech once the dialog closes" | The grid heading is hidden while the modal is open and back after closing |
| CMP-BLOG-015 | "carries the one-line disclosure and the privacy link" | The line and a link to `/privacy` |
| CMP-BLOG-016 | "offers WhatsApp with the blog's own opening line, and the phone" | `wa.me/<CONTACT.whatsapp>` with "שלום דורית, הגעתי מהבלוג"; `tel:<CONTACT.phoneE164>`; `blog_cta` |

### 4.13 Reading-recommender filter — `tests/component/blog-recommendation-filter.test.tsx`

A recommendation narrows the grid to the posts the chat named. The chat is
opened from the recommender box and closed before the grid is read, as a
visitor would.

| ID | Title | Expected result |
|---|---|---|
| CMP-REC-001 | "shows every post when no recommendation has arrived yet" | All posts; no "חזרה לכל המאמרים" |
| CMP-REC-002 | "hides every post the chat did not recommend" | Only the recommended card; H2 "מאמרים שהומלצו בצ'אט · מאמר אחד" |
| CMP-REC-003 | "orders the posts the way the chat ranked them" | The chat's order |
| CMP-REC-004 | "brings every post back from the show-all button" | "חזרה לכל המאמרים" restores the grid |
| CMP-REC-005 | "keeps every post when none of the recommended ids exists, rather than an empty page" | Nothing filtered |
| CMP-REC-006 | "drops the recommendation filter once the visitor searches" | The search result, not the recommendation |
| CMP-REC-007 | "clears an earlier search so the recommendation is not narrowed to nothing" | Search box emptied |
| CMP-REC-008 | "scrolls the recommendation into view" | `scrollIntoView` called |

### 4.14 Reading-recommender chat — `tests/component/blog-recommendation-chat.test.tsx`

The real `AgentChat` with the recommender's descriptor; the agent service is faked.

| ID | Title | Expected result |
|---|---|---|
| CMP-RCH-001 | "calls onAssistantMessage with the raw content, block included" | The `recommended` block reaches the page |
| CMP-RCH-002 | "never shows the recommended block to the visitor" | No fence, no ids in the transcript |
| CMP-RCH-003 | "does not re-report the same trailing assistant message once a later user message arrives" | No second call for the same content |
| CMP-RCH-004 | "shows the approved one line and the licence, not the interview's notice" | The approved sentence and `L-00107009`; exactly two points; no "נאספים שם וטלפון בלבד" |
| CMP-RCH-005 | "still gates the first message on the checkbox" | Start and send disabled before consent; the pre-filled text waits in the input |

## 5. Pass criteria

All 76 cases pass. A `submitLead` or `submitClaim` payload assertion failing
here is a contract break — cross-check [STD-03](03-std-contract.md) before
changing the test.
