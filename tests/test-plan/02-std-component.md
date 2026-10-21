# STD-02 — Component Tests

**Suite:** `component` · **Runner:** `npm run test:component` (Vitest + React Testing Library)
**Location:** `tests/component/` · **Cases:** 572 declared cases (IDs in section 4; a range such as `X-001..014` counts each ID); `npm run test:component` runs 665 including `it.each` / `describe.each` expansions · **Environment:** jsdom

---

## 1. Purpose

Sanity-check every first-party component that carries behaviour: that it
renders, exposes the accessible names screen readers and the e2e suite depend
on, and asks the services (`@/services`) for what it needs with the domain
objects the ports take. What each adapter then sends over the wire is held by
the adapter unit tests and `tests/contract/frontend-payloads.contract.test.ts`,
not here.

## 2. Test items

`Stars`, `MobileStickyBar`, `FloatingActions`, `PensionFeeCalculator`,
`QuickContact`, `ClaimForm`, `FAQ`, `ShareButtons`, `ReviewsWidget`, `Testimonials` — all in
`src/components/dorit/`.

## 3. Approach

| Concern | Handling |
|---|---|
| Services | `vi.mock("@/services")` → `tests/component/services-mock.ts`: every port method a `vi.fn`, unscripted answering as a build without Supabase does (nobody signed in, the clearinghouse unavailable, the public writes succeed); `resetServicesMock()` drops a case's script. Assertions are on the recorded port calls. No test reaches a backend adapter, the Base44 SDK client or `@/lib/app-params`, so neither is mocked |
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
| CMP-BAR-001 | "offers a dial link and the conversation" | `tel:+972508311776` and "לשיחה קצרה" → `/#start` — a home-page anchor from every route, never a bare `#…`, and the shape the click listener reports as `cta_click` |
| CMP-FLA-001 | "links to WhatsApp with a prefilled Hebrew message and a safe rel" | `wa.me/<number>`, `target=_blank`, `rel` contains `noopener`, message decodes to Hebrew |
| CMP-FLA-002 | "links to the phone number in E.164 form" | `href === tel:${CONTACT.phoneE164}` |
| CMP-BAR-002 | "offers a way to the support chat" | "תמיכה" → `/faq#support-chat` (A-64) |
| CMP-BAR-003 | "holds those four and nothing else — the short form opens from #start's chip row" | Exactly 4 links; no "השאירו פרטים" (stage 3: the conversation, WhatsApp, a call and support) |
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

The lead box under both /tools calculators is §4.25.

### 4.4 `<QuickContact />` — the primary lead form

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-QCF-001 | "disables submit until name and phone are present" | type name, then phone | Submit enabled only after both |
| CMP-QCF-002 | "hands the lead to the lead port's submitLead" | fill + submit | `leads.submitLead` once with `{name, phone, email, source:"quick"}`; no other port is asked to save or send (`submitClaim`, `requestConsultationEvent`, `support.escalate`) — the mail and the write live in the backend function, which the adapter calls (`submitLead` / `submit-lead`, frontend-payloads contract) |
| CMP-QCF-003 | "confirms to the visitor and clears the form after a successful send" | submit, then "send another" | Confirmation shown; fields reset |
| CMP-QCF-004 | "keeps the visitor's input and offers a fallback when sending fails" | `submitLead` rejects | Error message shown; typed name still present |
| CMP-QCF-005 | "does not submit twice on a double click" | double-click submit | `submitLead` is called exactly once |
| CMP-QCF-006 | "refuses a phone Dorit could not call back, and says so" | name + phone `abc`, submit; then `+972 50 123 4567` | Alert "מספר הטלפון לא נראה תקין", phone `aria-invalid`, nothing sent; the +972 number is sent (D-01) |

### 4.5 `<ClaimForm />` — the claim report

Two of these three are regressions with a fixed shape: a handler referencing a
setter that does not exist throws a `ReferenceError` out of an event, which
React does not surface anywhere a visitor can see. The form simply stops.

| ID | Title | Steps | Expected result |
|---|---|---|---|
| CMP-CLM-001 | "hands the report to the lead port's submitClaim with uploaded document urls" | fill, attach a file, submit | The file goes to `claimDocuments.upload` on send, then `leads.submitClaim` once with `{name, phone, documents:[url]}` |
| CMP-CLM-002 | "reports a failed upload on send instead of crashing, sends nothing, and uploads once on the retry" | `claimDocuments.upload` rejects once, then send again | Upload error shown; `submitClaim` not called; submit still enabled; the retry uploads and sends |
| CMP-CLM-006 | "uploads nothing when a file is picked — only on send" | pick a file, remove it, send | No upload at any point; `documents: []` (D-02) |
| CMP-CLM-007 | "names a file it will not take, by its name and why, and keeps the rest" | pick an `.exe`, a 30 MB PDF and a PDF | Each refusal names its file and reason; only the good PDF is listed (D-02) |
| CMP-CLM-008 | "offers only the bucket's types in the file picker" | render | `accept` has `application/pdf` and `.heic`, no wildcard |
| CMP-CLM-009 | "does not upload a document twice when the send fails after the uploads" | `submitClaim` rejects once, send again | One upload in all; the retry sends the stored reference |
| CMP-CLM-003 | "offers a blank form again after a successful report" | submit, then "send another" | Fields cleared; submit disabled again |
| CMP-CLM-004 | "refuses a phone Dorit could not call back, and says so beside the field" | name + phone `123`, submit | Alert under the phone, which is `aria-invalid` and described by it; nothing sent; editing clears it (D-01) |
| CMP-CLM-005 | "marks the name and phone as required for assistive technology" | render | Both carry `aria-required="true"` (D-16) |

### 4.6 `<FAQ />`, `<ShareButtons />`, `<ReviewsWidget />`

| ID | Title | Expected result |
|---|---|---|
| CMP-FAQ-001 | "renders questions as buttons and reveals the answer on click" | Content grows after clicking the first question |
| CMP-SHR-001 | "renders share targets that all use https and a safe rel" | Every `target=_blank` href is `https:` or `mailto:`; `rel` contains `noopener` |
| CMP-RVW-001 | "asks the backend for testimonials on mount" | `content.listTestimonials(50)`; newest first is the port's promise, held by each adapter's own test (`supabase-content.test.ts`) |
| CMP-RVW-002 | "renders without crashing when the backend returns nothing" | No throw on an empty list |
| CMP-RVW-003 | "survives a backend error without throwing" | No throw when `listTestimonials` rejects |

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
| CMP-HDR-003 | "keeps the admin's pages out of the site's navigation, behind a ניהול menu" | A "ניהול" button with `aria-haspopup="menu"`; no "ניהול פניות", "ניהול בלוג", "ניהול משתמשים" or "האזור שלי" link, and no "יציאה" button in the row |
| CMP-HDR-011 | "offers a client no ניהול menu" | No "ניהול" button; the new-lead count is never read |
| CMP-HDR-004 | "offers no sign-out to a signed-out visitor" | No "יציאה" button |
| CMP-HDR-005 | "signs a visitor out and sends them home" | "יציאה" calls `logout(true, <origin>/)` |
| CMP-HDR-006 | "offers no clearinghouse board link, even to an admin, while the switch is off" | No "בקשות מסלקה" link with `VITE_MASLEKA_ENABLED` unset |
| CMP-HDR-012 | "gives the admin one row into the admin interface, with what is waiting" (`describe` "phone menu") | The drawer's "ממשק ניהול" → `/account`, named with "3 פריטים ממתינים"; no "ניהול פניות" |
| CMP-HDR-009 | "lists the support chat as well as the sticky bar's תמיכה" (`describe` "phone menu") | Opening "תפריט" shows "תמיכה — שאלה לעוזר" → `/faq#support-chat`; pressing it closes the menu (`SupportLink` now runs the caller's `onClick` before its own scroll) |
| CMP-HDR-010 | "tags its support link header_menu, so click_chat says the menu sent the visitor" (`describe` "phone menu") | The drawer's "תמיכה — שאלה לעוזר" sits in `data-track-location="header_menu"` |

### 4.9 `<LeadTrackingPanel />` — `tests/component/lead-tracking-panel.test.tsx`

The Owner's view of GA4 lead tracking: the leftmost tab of `/admin/leads` ("מעקב לידים",
`leads.tracking`), shown whole. Without `VITE_MEETINGS_STAFF` there are no tabs and it sits
folded above the leads; CMP-GA4-001 to 005 open it first.

| ID | Title | Expected result |
|---|---|---|
| CMP-GA4-006 | "starts folded, showing only its heading" | Toggle has `aria-expanded="false"`; no table, no reports link |
| CMP-GA4-007 | "opens on a click, and folds again on a second" | `aria-expanded` flips to `true` with the table shown, then back with it gone |
| CMP-GA4-008 | "shows whole, with no fold, in its own tab" | `collapsible={false}`: no toggle button; heading, table and reports link shown |
| CMP-GA4-001 | "lists every event the site sends" | Every `LEAD_EVENTS` name shown |
| CMP-GA4-002 | "says when the tag is blocked in this browser" | "כנראה חוסם פרסומות" |
| CMP-GA4-003 | "says when the tag is running" | "אירועים נשלחים" |
| CMP-GA4-004 | "marks this browser as internal, and unmarks it" | Label and storage flip both ways |
| CMP-GA4-005 | "links to the GA4 reports in a new tab" | `analytics.google.com`, `rel` contains `noopener` |

`sanity.test.tsx` also pins the rule that a lead counts only once saved:
CMP-QCF-006 "reports a lead to GA4 after a successful send, and not after a failed one".

### 4.9a `<LeadDetails />` — `tests/component/lead-details.test.tsx`

The "פרטים" cell on `/admin/leads`, and the details in the lead drawer. An interview's
"label: value" profile reads top to bottom: topic, urgency badge, time, then each answer's
label above its value. The table folds after three answers; the drawer shows them all.

| ID | Title | Expected result |
|---|---|---|
| CMP-LDT-001 | "splits an interview profile into rows, and lifts the urgency out" | Five labelled rows in order; `דחיפות` becomes the badge |
| CMP-LDT-002 | "keeps a free-text message as prose, even when it holds a colon" | No rows; the note unchanged |
| CMP-LDT-003 | "shows the topic, the time and the urgency, then three answers and 'עוד'" | First three answers shown, the rest hidden; "עוד 2 פרטים" with `aria-expanded="false"` |
| CMP-LDT-004 | "unfolds the rest in place, and folds it back" | The hidden answer appears, then "פחות" hides it again |
| CMP-LDT-005 | "shows everything, with no fold, in the drawer" | `compact={false}`: every answer, no button |
| CMP-LDT-006 | "shows a short quick-form message as it is, with no fold" | The message shown; no button |
| CMP-LDT-007 | "keeps a time range in reading order inside the Hebrew" | `12:00–15:00` sits in a `bdi[dir=ltr]` |
| CMP-LDT-008 | "shows a dash for a lead with no details" | "—" |
| CMP-LDT-009 | "turns a stored claim document into a button, not a link" | "מסמך 1" button; the storage ref not shown |

### 4.10 `<ErrorBoundary />` — `tests/component/error-boundary.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-ERB-001 | "renders children normally when nothing throws" | Child visible, no `role="alert"` |
| CMP-ERB-002 | "shows the fallback with all three contact links when a child throws, and logs without personal data" | `role="alert"` message; `tel:`, `wa.me` and `mailto:` links from `CONTACT`; `console.error` called |
| CMP-ERB-003 | "isolates the failure: sibling trees still render" | Sibling text present; section wording ("החלק הזה") |
| CMP-ERB-004 | "uses page wording for the app-level boundary" | `scope="page"` message says "הדף" |
| CMP-ERB-005 | "recovers when its resetKey changes, so leaving a broken page is not a dead end" | After `resetKey` changes (the app passes the path), the fallback is gone and the new children render |
| CMP-ERB-006 | "offers a fresh load, past the cache, in the fallback" | "לטעון את הדף מחדש" calls `reloadFresh` |
| CMP-ERB-007 | "asks whether the build was replaced when a page chunk failed to load, and only then" | A chunk error → `checkFreshness` once; an ordinary render error → not at all |

### 4.11 `<Testimonials />` — `tests/component/testimonials.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-TST-001 | "renders nothing while loading and nothing when there are no testimonials" | No `#testimonials`, no "לקוחות מספרים" heading, no placeholder text |
| CMP-TST-002 | "renders the section and its heading when there are testimonials" | `section#testimonials`, the heading and the quote are present |
| CMP-TST-003 | "keeps the section for an admin when empty, so the first one can be added" | The "הוספת המלצה" button is present |
| CMP-TST-004 | "shows a signed-in visitor who is not an admin no add or delete controls" | Since the personal area, ordinary visitors sign in: the quote shows, no "הוספת המלצה" and no delete button |
| CMP-TST-005 | "hides the empty section from a signed-in visitor who is not an admin" | No `#testimonials` |

The `describe` "<Testimonials /> on a phone" (stage 3b) stubs `matchMedia` to a
width, as §4.24 does; the cases above it run without one and are the desktop's
grid.

| ID | Title | Expected result |
|---|---|---|
| CMP-TST-006 | "shows two or more as a focusable strip, every card in it, with prev and next buttons" | At 390: a region "לקוחות מספרים — גלילה אופקית" with `tabindex=0` and `id=testimonials-strip`, both cards and quotes in it, the first named "המלצה 1 מתוך 2"; "ההמלצה הקודמת" and "ההמלצה הבאה" control the strip; the first `aria-disabled="true"`, the second `"false"` |
| CMP-TST-007 | "next scrolls the strip by one card; prev at the first card does nothing" | Prev: no `scrollTo`; next: one `scrollTo` |
| CMP-TST-008 | "shows a single testimonial as it is, with no strip and no buttons" | At 390 with one: the quote, no region, no button |
| CMP-TST-009 | "from md up, the grid: no strip and no buttons" | At 1440: no region, no button, the `.grid` |

### 4.25 `<ProofCarousel />` — the cases — `tests/component/proof-carousel.test.tsx`

Below md (stage 3b) each case's story is folded behind "פרטי המקרה"; from md up
nothing changes. `matchMedia` is stubbed as in §4.24.

| ID | Title | Expected result |
|---|---|---|
| CMP-PRF-001 | "on a phone, shows every story's first two lines until its own פרטי המקרה opens it" | 7 buttons, all `aria-expanded="false"`, each `aria-controls` its story; every story present, not hidden, clamped (`line-clamp-2`) — hidden, half of each card stood empty (user feedback, 2026-10-14) |
| CMP-PRF-002 | "on a phone, keeps the headline, the figure, its basis and the disclaimer on show" | The disclaimer, the first headline and "850 אלף ₪ שולמו" present; both "הערכה המבוססת על הנחות…" outside anything `hidden` |
| CMP-PRF-003 | "on a phone, פרטי המקרה unfolds its own story in place and folds it again" | First pressed: `aria-expanded="true"`, its story unclamped, the second untouched; pressed again: clamped |
| CMP-PRF-004 | "names the arrows by where they go in RTL: → back to the first case, ← on to the next" | "הבא" calls `scrollBy` with a negative `left`, "הקודם" with a positive one (A-80) |
| CMP-PRF-005 | "from md up, every story is open and there is no פרטי המקרה" | At 1440: no button, nothing `hidden`, the disclaimer present |

### 4.26 `<DetailedFAQ />` and `<Footer />` on a phone — `tests/component/home-phone-trims.test.tsx`

Below md (stage 3c) the common questions' intro is one sentence and their
closing "לשיחה קצרה עם דורית" is hidden, and the footer hides its quote band and
the name and slogan the header shows — all hidden, never removed. jsdom applies
no Tailwind, so "hidden below md" is the `max-md:hidden` class (or `hidden`) on
the element or an ancestor; E2E-MOB-033/034 check what a phone shows.
`matchMedia` is stubbed as in §4.24, the footer's `Image` with a plain `<img>`.

| ID | Title | Expected result |
|---|---|---|
| CMP-HTR-001 | "on a phone, the intro is its first sentence; the second is hidden, not dropped" | At 390 the paragraph's text is both sentences; the second is a `<span class="hidden">`; the first is not hidden |
| CMP-HTR-002 | "on a phone, the closing לשיחה קצרה עם דורית is hidden by CSS but still in the document, still a link to #start" | The link exists with `href="#start"` and `max-md:hidden`; "לכל השאלות" is not hidden |
| CMP-HTR-003 | "from md up, the intro is one text node and the closing link is there" | At 1440 the paragraph has exactly one child node holding both sentences (a run boundary would re-shape the desktop's glyphs); the link to `#start` present |
| CMP-HTR-004 | "hides the quote band and the name and slogan the header repeats, keeping them in the document" | At 390 "ביטחון אמיתי מתחיל…", "— דורית גוב ארי", "התכנון שלי — השקט שלך" and the footer's name are each under a `max-md:hidden` |
| CMP-HTR-005 | "keeps the licence line, the line saying what she does, contact and the legal links in view" | The licence line, `L-00107009`, "שיווק פנסיוני ותכנון פיננסי…", the phone, WhatsApp and email links, "מדיניות פרטיות", "הצהרת נגישות" and the copyright are under nothing hidden |

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
| CMP-BLOG-017 | "offers every keyword under הכל, a keyword on most articles last" | All tags present; פנסיה (7 of 12) is last |
| CMP-BLOG-018 | "offers only the chosen topic's keywords" | Under ביטוח: ביטוח · בריאות · משכנתא |
| CMP-BLOG-019 | "narrows within the topic, and says so in the heading" | One card; `aria-pressed`; H2 "ביטוח · משכנתא" |
| CMP-BLOG-020 | "clears on a second tap" | Topic's cards back; not pressed |
| CMP-BLOG-021 | "drops a keyword the new topic does not carry" | Switching topic clears it |
| CMP-BLOG-022 | "keeps a keyword the new topic still carries" | Still pressed after the switch |
| CMP-BLOG-023 | "hides the featured row while a keyword is chosen" | No featured row; only matching cards |
| CMP-BLOG-024 | "links each card and the blog's JSON-LD to the slug, or to the id where the store has none" | `/blog/maslul-hashkaa` and `/blog/pen-2` in the cards and in `Blog.blogPost[].url` |
| CMP-BLOG-025 | "keeps the filters and holds a screen's height for the grid, so the prerendered page does not jump" | With the read pending: the topic group and the search box are there, and the spinner's box is `min-h-screen` (D-06) |
| CMP-BLOG-026 | "says so and offers a retry, rather than saying there are no articles" | A failed read shows `role="alert"` "לא הצלחנו לטעון את המאמרים…", not "עדיין אין מאמרים"; "לנסות שוב" reads again and the cards appear (D-09) |
| CMP-BLOG-027 | "still says there are none when the read succeeds empty" | "עדיין אין מאמרים"; no topic group |

The suite's `loaded()` waits for the spinner to go, not for the topic group:
the group now renders while the read is pending (CMP-BLOG-025).

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
| CMP-REC-009 | "clears a chosen keyword when a recommendation arrives" | Recommended card only; keyword no longer pressed |
| CMP-REC-010 | "drops the recommendation filter once the visitor picks a keyword" | The keyword's cards, not the recommendation |
| CMP-REC-011 | "finds a post the chat function named by its slug, as one Base44 named by its id" | A block naming `livui-tviot` shows `post-c` alone |

### 4.14 Reading-recommender chat — `tests/component/blog-recommendation-chat.test.tsx`

The real `AgentChat` with the recommender's descriptor; the agent service is faked.

| ID | Title | Expected result |
|---|---|---|
| CMP-RCH-001 | "calls onAssistantMessage with the raw content, block included" | The `recommended` block reaches the page |
| CMP-RCH-002 | "never shows the recommended block to the visitor" | No fence, no ids in the transcript |
| CMP-RCH-003 | "does not re-report the same trailing assistant message once a later user message arrives" | No second call for the same content |
| CMP-RCH-004 | "shows the approved one line and the licence, not the interview's notice" | The approved sentence and `L-00107009`; exactly two points; no "נאספים שם וטלפון בלבד" |
| CMP-RCH-005 | "still gates the first message on the checkbox" | Start and send disabled before consent; the pre-filled text waits in the input |

### 4.15 `<BlogPost />` — old addresses — `tests/component/blog-post-redirect.test.tsx`

An address from before slugs (a Base44 id) shows the article, then replaces
itself with `/blog/<slug>`, keeping the query and hash the link carried. The
article is cached under the slug first, so the switch reads nothing again.

| ID | Title | Expected result |
|---|---|---|
| CMP-POST-001 | "takes its slug address, keeping the query and the hash" | `/blog/horadat-dmei-nihul?utm_source=whatsapp#mah-bodkim`; one read |
| CMP-POST-002 | "stays where it is when the address already is the slug" | Unchanged |
| CMP-POST-003 | "stays on the id where the store has no slug (a build reading Base44)" | Unchanged |

### 4.16 `<BlogAdmin />` — the article's address — `tests/component/blog-admin-slug.test.tsx`

The hooks are stubbed; contentAdmin repeats every refusal server-side (§4.24 of STD-12).

| ID | Title | Expected result |
|---|---|---|
| CMP-BADM-001 | "prefills an existing article's slug" | `horadat-dmei-nihul` |
| CMP-BADM-002 | "asks for one on a new article, and will not save without it" | `SLUG_PROBLEMS.missing`; save disabled |
| CMP-BADM-003 | "refuses %j" (3) | Format, Base44-id and taken messages; save disabled |
| CMP-BADM-004 | "warns before a published article's address changes" | `role="status"` naming `/blog/horadat-dmei-nihul` |
| CMP-BADM-005 | "does not warn for a draft, which nobody links to yet" | No status |
| CMP-BADM-006 | "sends the slug with the article" | `mutateAsync({ id, draft: { …, slug } })` |
| CMP-BADM-007 | "accepts a legacy fallback slug as it is" | `post-6ac8eb62b0a953274445869d` valid; save enabled |
| CMP-BADM-008 | "asks a legacy article with no slug for one, and saves once it has one" | `SLUG_PROBLEMS.missing`; save disabled until a valid slug is typed |
| CMP-BADM-009 | "shows the server's words when the address is taken (409), …" / "… invalid (400)" (2) | The 409 / 400 text in the alert; inputs and save still enabled |
| CMP-BADM-010 | "keeps the generic message for any other failure, never the raw server text" | `שמירת המאמר נכשלה. ניתן לנסות שוב.` for a 500 |
| CMP-BADM-011 | "says the public page goes at the next deploy after a published article is unpublished" | `role="status"` with "יוסר בעדכון הבא" and a pointer to the README; absent before the click |
| CMP-BADM-012 | "says nothing when a draft is published" | No note |
| CMP-BADM-013 | "says it after a published article is deleted, but not a draft" | Note only for the published one |
| CMP-CHATFN-001 | "shows the v6 notice" | The fourth v6 consent point is rendered for `needs_interview` when served by `chat` |
| CMP-CHATFN-002 | "sends the first message with the v6 stamp and shows the reply" | `consentVersion: 2026-10-agents-v6` in the function body; the reply appears |
| CMP-CHATFN-003 | "counts the lead the function saved, and never submits it from the page" | `interviewCompleted` once on `signal: lead_saved`; `submitInterview` not called |
| CMP-CHATFN-004 | "shows Dorit's channels and gives the text back when the function cannot answer" | A `tel:` link shown; the box holds the text again (`AgentUnavailableError`) |
| CMP-CHATFN-005 | "answers a rate limit with its own final wording and gives the text back" | `נשלחו הרבה הודעות בזמן קצר. אפשר לנסות שוב בעוד דקה.`; box refilled |
| CMP-CHATFN-006 | "answers a closed conversation with its own final wording" | `השיחה הזו הסתיימה. אפשר להתחיל שיחה חדשה.` |
| CMP-CHATFN-010 | "answers a message sent while the last one is still being answered, and gives the text back" | 409 `busy`: `הודעה קודמת עדיין בטיפול — רגע אחד.`; box refilled (I3) |
| CMP-CHATFN-011 | "shows the saved confirmation and Dorit's channels when the lead was saved but the reply failed (503 leadSaved)" | `LEAD_SAVED_WITHOUT_REPLY`, `HUMAN_HANDOFF.reachHer` and a `tel:` link; no failure copy; `interviewCompleted` once; box left empty (I5) |
| CMP-CHATFN-012 | "shows the visitor's message while the reply is on its way" | The sent text is on screen before the answer; then the reply (I4) |
| CMP-CHATFN-013 | "open their Base44 conversation with main's metadata only, no attribution keys (dark means byte-exact)" | A Base44 agent's `start` metadata has exactly `name`, `description`, `consent_version` (v5), `consent_at` (triage 7) |
| CMP-CHATFN-014 | "while the interview on the chat function sends its attribution" | The served interview's metadata adds `channel`, `campaign`, `landing_path` (triage 7) |
| CMP-CHATFN-007 | "keep the v5 notice, byte for byte" | A Base44 agent shows its v5 points and not the v6 fourth point |
| CMP-CHATFN-008 | "stays off for an agent on the chat function, even when the reply takes longer than 20 s" | No no-reply copy at 21 s; the slow reply shows at 25 s (Ruling 7) |
| CMP-CHATFN-009 | "still fires for a Base44 agent whose reply never comes" | No-reply copy after `NO_REPLY_TIMEOUT_MS` |
| CMP-CHATFN-015 | "says the message is still being answered, keeps it in the transcript, and does not hand it back" (a turn still running when the adapter stops waiting) | The send and every status request say busy: after 40 s + 60 s the panel shows "ההודעה התקבלה ועדיין בטיפול…", the visitor's line stays, and the input stays empty (review 2026-10-15, item 14) |
| CMP-CHATFN-016 | "aborts the chat function's request and leaves the new conversation clean and usable" (a reset while a message is on its way) | Reset mid-send: the request's signal is aborted; the old line, an apology and the old text are all absent; the next message goes out under a new conversation id and its reply shows (review 2026-10-15, item 13) |
| CMP-CHATFN-017 | "ignores what an earlier conversation's send ends with, even from an adapter that cannot abort" (a reset while a message is on its way) | A Base44 send that fails after the reset: the input stays empty and no apology appears (the panel's generation guard) |

The "שיחה" tab on `/admin/leads` (`tests/component/lead-transcript.test.tsx`, hooks stubbed). Read-only; visitor text is plain text.

| ID | Test | Expect |
|---|---|---|
| CMP-LEADTX-001 | "is offered for the lead with a conversation and for no other" | One "שיחה" button for two leads |
| CMP-LEADTX-002 | "is absent when no lead has a conversation" | No "שיחה" button; the page is as before |
| CMP-LEADTX-003 | "shows the visitor's markup as text, never as elements" | The hostile string is in `textContent`; no `img`, no `b` element |
| CMP-LEADTX-004 | "offers no control to write from the tab" | No textbox; only the hide button |

### 4.17 `<Masleka />` — the client's clearinghouse page — `tests/component/masleka-page.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSK-001 | "says the service is unavailable when the switch is off, and offers no form" | Heading; no form; nothing sent |
| CMP-MSK-002 | "takes the link's token out of the address bar" | Hash empty, path `/masleka` |
| CMP-MSK-003 | "does not take the token from a query string" | `?t=` ignored: "הקישור חסר או שגוי"; nothing sent |
| CMP-MSK-004 | "sends the code and the nine-digit ID with the link's token, then only thanks" | `submit(token, 'AB12-CD34', '000000018')`; thanks; values gone |
| CMP-MSK-005 | "writes neither value to storage or the console" | No `setItem`; no console call carries either value |
| CMP-MSK-006 | "refuses an ID that fails the check digit before sending" | Alert; not sent |
| CMP-MSK-007 | "refuses a code that cannot be one" | Alert; not sent |
| CMP-MSK-008 | "explains a link that is no longer valid, in clientMessage's words" | `clientMessage(link_invalid)` text |
| CMP-MSK-009 | "after too many tries says to wait, and that the link is not dead" | "נסו שוב בעוד זמן מה", "הקישור תקין" |
| CMP-MSK-010 | "after an unknown failure says the code may have arrived, with no invitation to retry" | "ייתכן שהקוד כבר התקבל", "דורית תיצור קשר"; no "נסו שוב" |
| CMP-MSK-011 | "treats a thrown non-MaslekaError the same way" | Same "ייתכן שהקוד כבר התקבל" |
| CMP-MSK-012 | "asks for the link when there is no token" | Heading; no form |
| CMP-MSK-013 | "links to the clearinghouse in a new tab without a referrer" | `_blank`, `noopener noreferrer` |
| CMP-MSK-014 | "links the privacy policy, since it collects an ID number" | `/privacy` |
| CMP-MSK-015 | "renders no screenshot slot when none is given, and the given one when it is" | 0 figures; then 1 |
| CMP-MSK-016 | "is marked noindex" | SeoRouteGuard writes `noindex` on `/masleka` |
| CMP-MSK-017 | "after a send that stored nothing says so plainly, and keeps both values for the retry" | `not_saved`: "השליחה לא עברה והקוד לא נשמר", "נסו לשלוח שוב", no "ייתכן"; a second click resends the same three values and thanks (decision 2026-10-14) |

### 4.18 `<AgencyRoute />` — an agency screen's gate — `tests/component/agency-route.test.tsx`

Replaces `<StaffRoute />` (agency roles). The role is asked of the database through `services.agency.myRole(agency)` for the current agency (`?agency=` when it is one of the person's, else their own, else agency 1).

| ID | Title | Expected result |
|---|---|---|
| CMP-AGR-001 | "sends a signed-out visitor to sign in, asking nothing" | `unauthenticatedElement`; no role lookup |
| CMP-AGR-002 | "admits the platform operator to every level, a member of no agency" | Outlet at `min="owner"` |
| CMP-AGR-003..007 | "a %s at a %s screen: %s" | user@user, admin@user, owner@admin admitted; user@admin, admin@owner sent to `/` |
| CMP-AGR-008 | "sends someone with no role in the agency home" | Redirect to `/` |
| CMP-AGR-009 | "says it could not check, rather than guessing, when the role cannot be read" | Alert; no outlet |
| CMP-AGR-010 | "asks about the agency in ?agency= when it is one of the person's" | `myRole(TRUST)`; Owner admitted |
| CMP-AGR-011 | "ignores an ?agency= that is not the person's, and asks about their own" | Last lookup for agency 1 |

### 4.19 `<MaslekaBoard />` — the staff board — `tests/component/masleka-board.test.tsx`

Since the redesign (2026-10-16) the board is one list of rows, each with one action (`actionFor`). Until the guided drawer (step 4), "להגשה" opens the copy controls under the row. Since step 4, "להגשה" opens the guided submit drawer: `card(name)` opens a client's (closing another's first), and `openWaiting()` waits for the list and opens רונית's. The phone layout (CMP-MSKB-054..057) is Tailwind's `max-sm:` variants, which jsdom does not apply, so those cases hold the markup. The rendering was checked in Chromium at 375px and 1280px: no horizontal page scroll at 375px, and both drawers full screen.

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKB-001 | "shows every request in one list: step, name, stage and the reason, with one action each" (the list) | רונית: `מוכן להגשה`, the code-received reason, `להגשה`; אורי: `קישור חדש` and the invited reason |
| CMP-MSKB-002 | "says when the files should be ready, and how long the clearinghouse keeps them" (the list) | יעל: `הוגש … · יהיה מוכן בעוד כ־3–4 שעות`, `אין צורך בפעולה`; דן: `מוכן להורדה · יום אחד…`, `דחוף`, `להורדה במסלקה` in a new tab with no referrer |
| CMP-MSKB-003 | "reports a list that failed to load" | Alert text |
| CMP-MSKB-004 | "copies the ID to the clipboard, revealing it only on the click" | No reveal before the click; `writeText('000000018')`; "הועתק ✓" |
| CMP-MSKB-005 | "falls back to a selected field when there is no clipboard" | Read-only field with the value; "העתק ידנית" |
| CMP-MSKB-006 | "falls back when the browser refuses the clipboard" | Read-only field with the value |
| CMP-MSKB-007 | "hides a manually-copied value when asked" | Value gone after "הסתר" |
| CMP-MSKB-008 | "clears a manually-copied value after a minute" | `REVEAL_MS` is 60 000; value still shown at 59 s, gone at 60 s |
| CMP-MSKB-009 | "clears a manually-copied value on the next click elsewhere, but not on a click in its field" | A click in the field keeps it; a click on the drawer's heading clears it |
| CMP-MSKB-010 | "shows one value at a time: revealing another client's clears the first" | Opening the second client's drawer closes the first's; its value is gone when the first is opened again |
| CMP-MSKB-011 | "drops a value that arrives after a newer reveal was asked for" | A slower answer for the first click never reaches the screen |
| CMP-MSKB-012 | "copies nothing when a value arrives after the board is gone" | Unmounted before the answer: `writeText` never called |
| CMP-MSKB-013 | "forgets a shown value once its row leaves the stage, so it never comes back with the row" | The row moves to submitted (no `להגשה`) and back: the value is gone |
| CMP-MSKB-014 | "keeps the revealed value out of the query cache, storage, the console and the address" | Not in any query or mutation state, any storage write, any console call, `location.href` |
| CMP-MSKB-015 | "asks inline before the wipe: 'עוד לא' sends nothing, 'כן, הגשתי' wipes and says what happens next" | `role="alert"` question with the name and the warning; עוד לא → nothing; כן, הגשתי → `markSubmitted('r2')`, "הוגש. מספר הזהות וקוד האימות נמחקו." and the 3–4 hours line; חזרה ללוח closes |
| CMP-MSKB-016 | "shows a second הגשתי as already submitted, not as an error, and refreshes the row" | `already_submitted` → status "כבר סומן כהוגש" in the drawer; the question closes, no alert; list refetched |
| CMP-MSKB-017 | "tells a staff member whose access was removed" | Alert "ההרשאה שלך הוסרה" (`staffMessage`) |
| CMP-MSKB-018 | "words a refused list in the staff vocabulary" (the list) | `forbidden` → "ההרשאה שלך הוסרה" |
| CMP-MSKB-019 | "links to the clearinghouse portal in a new tab without a referrer" | The drawer's step 1 link: `_blank`, `noopener noreferrer` |
| CMP-MSKB-020 | "sends by WhatsApp from the browser: a wa.me link with the link in the message, and the phone never sent" (the new-request drawer) | `create` without the phone (no digits of it in any call); "הקישור למשה כהן מוכן"; `https://wa.me/972501234567?text=…` with the link, in a new tab, no referrer; the link field, the gold "פעם אחת בלבד" box, and "לראות את הדף כמו שהלקוח יראה ↗" |
| CMP-MSKB-021 | "issues a fresh link for an invited client" | `relink('r1')`; new link shown, and "פתיחת הקישור" points at it |
| CMP-MSKB-022 | "drops a value still on its way when its row leaves the column" | The row leaves the stage before the answer: never copied, never shown |
| CMP-MSKB-023 | "makes one הגשתי call for a double click that lands before the button is disabled" | Two clicks on "כן, הגשתי" in one act → one `markSubmitted` |
| CMP-MSKB-024 | "clears an old failure when the next action starts" | A failed reveal's alert is gone once the next reveal succeeds |
| CMP-MSKB-025 | "takes a row's copied mark off at once when its הגשתי succeeds, even if the refetch fails" | The success view with no copied mark; the row, still listed after the failed refetch, opens clean |
| CMP-MSKB-026 | "links a completed request to its analysis, and lists every stored report" | Stage 4: the row's `לניתוח` → s7; "ניתוחים ללא בקשה:" names the lead-less report (s8) and not the request's own; no separate "ניתוחים" region |
| CMP-MSKB-027 | "keeps the board working when the reports cannot be read" | The guided submit still copies; stage 4 says "לא הצלחנו לטעון את הניתוחים."; no alert |
| CMP-MSKB-029 | "says a blank name is not valid, and sends nothing" (the new-request drawer) | Alert "השם אינו תקין" in the drawer; no `create` |
| CMP-MSKB-030 | "says so when the invitation e-mail was asked for but not sent" (the new-request drawer) | "המייל ללקוח לא נשלח"; the link still shown |
| CMP-MSKB-031 | "finds a client by name as you type, and says so when nothing is there" (the list) | `לוי`: both לוי rows only; no match: "אין כאן כלום כרגע. בקשות חדשות יופיעו כאן לבד." |
| CMP-MSKB-032 | "opens on 'לטיפול עכשיו': what needs action, urgent first, with each stage's count and hint" (the stage bar) | `aria-pressed` on now; counts 2 / 1 / 1 / 2 / 0 and the hints; rows דן (urgent) then רונית; יעל and אורי absent |
| CMP-MSKB-033 | "shows one stage when chosen, and keeps it in ?stage= so a refresh opens on it" (the stage bar) | `?stage=submitted` after the click; a fresh render at that address opens on it; back to now drops the parameter |
| CMP-MSKB-034 | "opens on 'now' for a stage it does not know" (the stage bar) | `?stage=everything` → now |
| CMP-MSKB-035 | "hides a revealed value when the stage changes under an open drawer (the browser's back and forward)" (the stage bar) | A clipboard copy's mark survives a click in the drawer and goes when `?stage=` changes |
| CMP-MSKB-036 | "names the board, says how many requests wait today, and links to how it works" (the header) | h1 מסלקה, eyebrow טיפול שוטף; "2 בקשות מחכות לך היום. שאר הבקשות מתקדמות לבד."; "איך זה עובד?" → `#masleka-how` |
| CMP-MSKB-037 | "words the count for none and for one" (the header) | `waitingLine` 0 / 1 / 7 |
| CMP-MSKB-038 | "keeps the new-request form off the page until '+ בקשה חדשה' opens its drawer" (the header) | No `שם הלקוח` on the page; present in the dialog |
| CMP-MSKB-039 | "is a modal dialog that the X and Esc close, giving the focus back to the button" (the header) | `aria-modal="true"`, focus inside; the X (`סגירה`) and Esc close it; focus back on "בקשה חדשה" |
| CMP-MSKB-040 | "opens from the row, named for the client, with when the code came and the ID's last digits" (the guided submit) | Dialog named רונית מזרחי, `aria-modal`, described by the code-received line; four steps |
| CMP-MSKB-041 | "walks the four steps: the current one marked, each ticked as it is done" (the guided submit) | `aria-current="step"` moves 1 → 2 → 3 → 4 as the portal is opened and the ID and code copied; "הועתק ✓ — הדביקו במסלקה"; a step stays ticked after its value goes |
| CMP-MSKB-042 | "hides a revealed value when the drawer closes, and opened again it starts clean" (the guided submit) | A clipboard copy's mark is gone on reopening; step 1 current again (fails without `hide()` on close) |
| CMP-MSKB-043 | "hides a value copied by hand when the drawer closes" (the guided submit) | The manual field is gone |
| CMP-MSKB-044 | "drops a value still on its way when the drawer closes: never copied, never shown" (the guided submit) | The answer lands after סגירה: no clipboard write, no mark (fails without `hide()` on close) |
| CMP-MSKB-045 | "keeps the inline question to the drawer: no browser confirm" (the guided submit) | `window.confirm` never called |
| CMP-MSKB-046 | "refuses a WhatsApp number that is not an Israeli mobile, beside the field, and sends nothing" (the new-request drawer) | `03-1234567`: the field's alert, `aria-invalid`; no `create` |
| CMP-MSKB-047 | "sends by mail through the invitation, and says when it went" (the new-request drawer) | `sendInvite: true` with the address; "הקישור נשלח במייל ללקוח"; no WhatsApp link |
| CMP-MSKB-048 | "words a refused address in the staff vocabulary, inside the drawer" (the new-request drawer) | `invalid_email` → "כתובת הדוא״ל אינה תקינה" as an alert in the drawer |
| CMP-MSKB-049 | "only shows the link when the staff member will copy it themselves" (the new-request drawer) | `sendInvite: false`, no address; the link; no WhatsApp link, no mail status |
| CMP-MSKB-050 | "offers the caller's open leads of the agency, fills what is empty, and sends the lead's id" (the new-request drawer) | Options: ללא שיוך and the open agency-1 lead only; choosing it fills the name and the mobile; `create` carries `leadId` |
| CMP-MSKB-051 | "reads the leads only once the drawer opens" (the new-request drawer) | No leads read until "+ בקשה חדשה" |
| CMP-MSKB-052 | "explains the four stages at the bottom, where 'איך זה עובד?' leads, with the advisor guide" (how a request moves) | Region `#masleka-how` "איך בקשה מתקדמת": ממתין ללקוח, מוכן להגשה, הוגש במסלקה, הושלם; the guide link; "קוד אימות", never "ייפוי" on the page |
| CMP-MSKB-053 | "lists no report line outside stage 4" (how a request moves) | No "ניתוחים ללא בקשה" on "now" |
| CMP-MSKB-054 | "makes '+ בקשה חדשה' a round 48px button named by its aria-label" (on a phone) | `aria-label="בקשה חדשה"`; `max-sm:h-12 max-sm:w-12 max-sm:rounded-full`; the visible label `max-sm:sr-only` |
| CMP-MSKB-055 | "makes the stage bar one sideways-scrolling row of chips" (on a phone) | `max-sm:overflow-x-auto`, no wrap; each chip `max-sm:shrink-0` |
| CMP-MSKB-056 | "gives each row's one action the full width" (on a phone) | The action's wrapper `max-sm:w-full max-sm:[&>*]:w-full` |
| CMP-MSKB-057 | "opens the drawers full screen" (on a phone) | The dialog `fixed inset-y-0 left-0 w-full sm:max-w-md` |
| CMP-MSKB-058 | "asks first, then sends the request back with a fresh link shown once — and stays open as the row moves to stage 1" (a code the clearinghouse refused) | The inline question (`role="alert"`); ביטול → nothing; כן, קישור חדש → `reissue('r2')`, "קישור חדש לרונית מזרחי מוכן.", the link once; the drawer stays after the refetch; חזרה ללוח closes |
| CMP-MSKB-059 | "drops a value still on its way when the request goes back to the client" (a code the clearinghouse refused) | No clipboard write, nothing shown (fails without `hide()` on reissue) |
| CMP-MSKB-060 | "makes one call for a double click" (a code the clearinghouse refused) | Two clicks in one act → one `reissue` |
| CMP-MSKB-061 | "says why when it is refused, closes its question, and keeps the guided submit" (a code the clearinghouse refused) | `unavailable` → "השירות אינו זמין כרגע"; the question closed; the copy buttons still there |

### 4.20 `<FloatingHeader />` — the admin menu with the clearinghouse switched on — `tests/component/floating-header-masleka.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKH-001 | "takes the admin to the admin interface without asking for a membership" | The drawer's "ממשק ניהול" → `/account`; no `myRole` call |
| CMP-MSKH-002 | "gives a member of the agency a ניהול menu that leads to the board" | `myRole` → `staff`: a "ניהול" button, and "ממשק ניהול" → `/admin/masleka`; `countNew` never called |
| CMP-MSKH-003 | "offers no ניהול menu to a signed-in client with no membership, or when the role cannot be read" | `myRole` → `null`, then rejecting: no button, no row |
| CMP-MSKH-004 | "asks nothing for a signed-out visitor" | No row; no `myRole` call |
| CMP-MSKH-005 | "counts new leads and the requests waiting to be submitted together" | 1 new lead + 2 `code_received` → "3 פריטים ממתינים" |

### 4.21 `<MaslekaGuide />` — registering as an advisor — `tests/component/masleka-guide.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKG-001 | "walks through registering, submitting and downloading, in order" | Four step headings in order |
| CMP-MSKG-002 | "names the licence the registration is made under" | `LICENCE.number` shown |
| CMP-MSKG-003 | "links to the clearinghouse in a new tab without a referrer, and back to the board" | `href` is `CLEARINGHOUSE_ADVISOR_URL`, `_blank` + `noopener noreferrer`; back link `/admin/masleka` |
| CMP-MSKG-004 | "shows no screenshot unless one is given" | 0 figures; then the given image |
| CMP-MSKG-005 | "is marked noindex" | `/admin/masleka/guide` through `SeoRouteGuard` sets `robots` to `noindex` |

### 4.22 `<AgentChat />` on a phone — the support chat's card and layer — `tests/component/agent-mobile-sheet.test.tsx`

`matchMedia` is stubbed to a width; with none at all (jsdom's default) the chat
renders as on a desktop, which is what every other component test relies on.

| ID | Title | Expected result |
|---|---|---|
| CMP-SHEET-001 | "shows the card, with the fence in a closed <details>, and no chat until asked" | At 390: heading, "שאלו את העוזר" with `aria-expanded=false`, no dialog; the `<details>` is closed and holds the tagline, the note and every guardrail line verbatim |
| CMP-SHEET-002 | "opens a modal dialog, locks the page's scroll, and shows the notice word for word" | `dialog` "העוזר של דורית", `aria-modal`, `body` overflow hidden, "אוטומטי · לא דורית עצמה", every `SUPPORT_CONSENT_POINTS` entry |
| CMP-SHEET-003 | "closes on Escape and on the X, and gives focus back to the button" | Both close it; focus on the opener; overflow restored |
| CMP-SHEET-004 | "fires chat_start and chat_handoff from inside the layer, and generate_lead only once it reaches Dorit" | `gtag` sees `chat_start` and `chat_handoff` (`ai_support`), and `generate_lead` only after `escalate` |
| CMP-SHEET-005 | "keeps the conversation, and the consent, across closing and reopening" | No checkbox on reopening; the typed draft still there |
| CMP-SHEET-006 | "gives every field in the layer at least 16px, so iOS does not zoom" | No text field in the layer is sized below 16px |
| CMP-SHEET-007 | "goes back in place when the viewport grows past md" | Dialog and card gone, the 560px panel back, overflow restored |
| CMP-SHEET-008 | "renders the embedded panel and no card, with no matchMedia at all" | Desktop as before |
| CMP-SHEET-009 | "renders the same at 1440px with matchMedia present" | Desktop as before |
| CMP-SHEET-010 | "leaves the home page's interview, which has no mobileSheet, as it was on a phone" | The interview keeps its 560px panel at 390 |
| CMP-SHEET-011 | "counts each opening of the layer as click_chat, from the chat's own section" | "שאלו את העוזר" → `click_chat {method: ai_support, location: support-chat}`; closed and reopened, two |

### 4.23 `<AgentChat />` — the FAQ chat on the chat function — `tests/component/chat-function-support.test.tsx`

`@/config/chat-agents` is mocked so `support_agent` is served by the chat function; `services.agents` is a real `SupabaseAgentService` over a fake `functions.invoke`; `framer-motion` is stubbed. No network.

| ID | Title | Expected result |
|---|---|---|
| CMP-CHSUP-001 | "shows the FAQ chat's own v6 notice, not the interview's" | Every `CHAT_FUNCTION_SUPPORT_CONSENT_POINTS` entry is on screen; the interview's fourth point, `CONSENT.points[2]` and the old support fourth point are not |
| CMP-CHSUP-002 | "sends the first message as support_agent with the v6 stamp, and shows the reply" | After consent, start and send: `invoke("chat", …)` with `agent: support_agent` and `consentVersion: CHAT_FUNCTION_CONSENT_VERSION`; the reply is shown |

### 4.23a `<AgentChat />` — the procedures chat on the chat function — `tests/component/chat-function-procedures.test.tsx`

As §4.23, with `procedures_agent` served by the function.

| ID | Title | Expected result |
|---|---|---|
| CMP-CHPROC-001 | "shows the procedures chat's own v6 notice, not the interview's" | Every `CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS` entry is on screen; not the interview's third point, not the Base44 notice's fourth |
| CMP-CHPROC-002 | "sends the first message as procedures_agent with the v6 stamp, and shows the reply" | `invoke("chat", …)` with `agent: procedures_agent` and `CHAT_FUNCTION_CONSENT_VERSION`; the reply on screen |

### 4.23b `<AgentChat />` — the blog recommender on the chat function — `tests/component/chat-function-blog.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-CHBLOG-001 | "shows the blog recommender's own v6 notice, not the interview's" | Every `CHAT_FUNCTION_BLOG_CONSENT_POINTS` entry; not the interview's third point |
| CMP-CHBLOG-002 | "sends the first message as blog_recommender with the v6 stamp, and hides the block it is handed" | `agent: blog_recommender`, v6; the reply shown without the block; `onAssistantMessage` gets the block |

### 4.24 `<NeedsWizard />` — three taps, the contact step, then three optional questions — `tests/component/needs-wizard.test.tsx`

The brief of 2026-10-14: the concern, life stage and urgency (each moves on 250 ms
after a tap, on every width), then a name and a mobile — the lead is saved
(`stage: "complete"`) and Dorit mailed; then, offered only when
`services.leads.updatesInterviews`, goal, the clearinghouse report (with the
pull offered only without one) and a time of day plus notes, saved as
`stage: "details"` into the same lead. No list of step names: a progress bar and
"שאלה N מתוך 3". `services` is mocked.

| ID | Title | Expected result |
|---|---|---|
| CMP-NWZ-001 | "opens on the concern with the short promise and a counter, and no list of steps" | "מה הכי מעסיק אותך כרגע?", "3 שאלות קצרות — פחות מדקה", "שאלה 1 מתוך 3"; no "שלבי השאלון" list |
| CMP-NWZ-002 | "each tap moves on by itself, and the contact step says it is nearly done" | Three taps → "איך דורית תחזור אליך?" focused, "כמעט סיימנו" |
| CMP-NWZ-003 | "saves the lead with the three answers, and reports it with its topic and urgency only" | `stage: "complete"`, profile concern/life_stage/urgency; `wizardCompleted(concern, urgency)`; "תודה רונית! דורית תחזור אליך בקרוב." |
| CMP-NWZ-004 | "reports each step by its number, and a skipped one as a skip" | `wizardSkipped(2)`; `wizardStep` 1, 3, 4 |
| CMP-NWZ-005 | "goes back with the answer kept" | "הקודם" → the concern checked, "המשך" offered |
| CMP-NWZ-006 | "an arrow key chooses without moving on; Enter then moves on" | ArrowDown → click → keyup: stays; Enter → next |
| CMP-NWZ-007 | "asks for a mobile the way a phone keyboard expects, and a name autofill knows" | `type/inputmode/autocomplete=tel`, placeholder `05X-XXXXXXX`; name `autocomplete=name` |
| CMP-NWZ-008 | "answers a wrong number under the field, reports which field, and saves nothing" | "מספר נייד צריך להתחיל ב-05 ולהכיל 10 ספרות" via `aria-describedby`; `formError("phone")`; nothing sent |
| CMP-NWZ-009 | "answers a missing name, and reports it" | "נא למלא שם."; `formError("name")` |
| CMP-NWZ-010 | "says when Dorit answers, under the button" | "דורית חוזרת תוך יום עסקים" |
| CMP-NWZ-011 | "offers WhatsApp instead, written from the three answers and tracked as wizard_step4" | `wa.me` link whose text names the concern, life stage and urgency; inside `data-track-location="wizard_step4"` |
| CMP-NWZ-012 | "are offered after the lead, and fill in the same lead" | "בטח" → `wizardFollowupStarted`; goal, report "לא" + opt-in "מעוניין/ת" + email, "ערב" + notes → `stage: "details"` with all of them, `timing: "ערב"`; `wizardFollowupCompleted(3)`; "מעולה, דורית תגיע מוכנה." |
| CMP-NWZ-013 | "offers the clearinghouse pull only to someone without a report" | "כן" → no opt-in; "לא יודע/ת מה זה" → "מעוניין/ת" offered |
| CMP-NWZ-014 | "'לא עכשיו' leaves the thanks without the offer" | The thanks stay; no "בטח" |
| CMP-NWZ-015 | "are not offered by a backend that cannot fill a lead in" | `updatesInterviews` false → no offer |
| CMP-NWZ-016 | "when their save fails, says the lead itself is already with Dorit" | "התשובות הנוספות לא נשמרו" |
| CMP-NWZ-017 | "a failed save shows Dorit's direct channels and keeps the answers for a retry" | Channels; retry keeps the name and saves |
| CMP-NWZ-018 | "the claim option escalates with claim_or_policy and never submits an interview" | `escalate` (`claim_or_policy`, `needs_wizard`); no `submitInterview`; `wizardClaimHandoff` once |
| CMP-NWZ-019 | "each tap question is a named radio group, though the heading is what shows" | Group "איפה את/ה בחיים כרגע?" (legend `sr-only`) with 6 radios |

### 4.25 The calculator → lead box — `tests/component/calculator-lead.test.tsx`

`<PensionFeeCalculator />` and `<InsuranceAssessment />` with `CalculatorLeadBox`.
The rule for `calculator_result`: the self-check sends one when its last answer
shows the result (and again only after "התחלה מחדש" and a new result); the fee
calculator, which recomputes on every keystroke, sends one when the visitor has
changed an input and then left the inputs alone for `RESULT_SETTLE_MS` (1.5 s),
once per distinct set of inputs per visit, and never for the untouched defaults
or while there are no deposits to compute from (`useCalculatorResultEvent`). Fake timers drive the 1.5 s.

| ID | Title | Expected result |
|---|---|---|
| CMP-CLD-001 | "shows the box under the result, tagged calculator, with the result in the WhatsApp message" | Heading "רוצים שדורית תבדוק את הנתונים האמיתיים שלכם?"; `data-track-location="calculator"`; `wa.me/${CONTACT.whatsapp}?text=` holding "…לאורך 25 שנות חיסכון"; new tab, `noopener` |
| CMP-CLD-002 | "keeps the calculator's disclaimer, and says the box is not advice" | "הערכה כללית בלבד — אינה מחליפה ייעוץ אישי." visible; the box says "הערכה כללית בלבד ואינה ייעוץ או המלצה" |
| CMP-CLD-003 | "has one WhatsApp button, the box's, and keeps the link to the conversation" | One `wa.me` link in the calculator; `/#start` still there |
| CMP-CLD-004 | "reports the box's button as click_whatsapp from location calculator" | `click_whatsapp {location: calculator}` |
| CMP-CLD-005 | "updates the message as the visitor changes an input" | Years → 10: "לאורך 10 שנות חיסכון" |
| CMP-CLD-006 | "sends no calculator_result for the defaults nobody touched" | None after 4.5 s |
| CMP-CLD-007 | "sends calculator_result once the inputs settle — not per keystroke — and with the tool's name only" | Four changes 200 ms apart: none; 1.5 s later exactly `{tool: fee_calculator}`; nothing more after |
| CMP-CLD-008 | "sends again for a new result, but not for one already counted" | 10 → 20 → 10 years: two events |
| CMP-CLD-009 | "sends nothing while there is no result to speak of" | Deposit cleared: none |
| CMP-CLD-010 | "never sends a figure to GA4" | No digit in any `gtag` parameter |
| CMP-CLD-011 | "shows no box before the result" | Self-check: no box, no event before the last answer |
| CMP-CLD-012 | "shows the box with the result in the message once the last answer is in" | Every recommended title and "ויצאו N סוגי ביטוח לבחון" in the message |
| CMP-CLD-013 | "keeps both disclaimers in view" | "ההערכה כאן היא כללית בלבד…" and "…אינו מהווה ייעוץ פיננסי או המלצה לרכישת…" |
| CMP-CLD-014 | "sends calculator_result once per completed assessment" | One `{tool: insurance_assessment}`; restart → still one; complete again → two |
| CMP-CLD-015 | "sends its call to the conversation to /#start, which works from /tools" | "לשיחה קצרה עם דורית" → `/#start` (was a bare `#start`, inert on /tools) |

### 4.27 The article contact boxes — `tests/component/article-contact-boxes.test.tsx`

`BlogPost` over `services.content.getArticle` mocked (as in §blog-post-redirect); `framer-motion` stubbed.

| ID | Title | Expected result |
|---|---|---|
| CMP-ACTA-001 | "puts one box after the third paragraph and one at the end, each tracked at its place" | `article_inline` between paragraphs 3 and 4, `article_end` after the body; each carries its `data-track-location` |
| CMP-ACTA-002 | "shows only the box at the end when nothing follows the third paragraph" | No `article_inline` |
| CMP-ACTA-003 | "pre-fills WhatsApp with the article's title" | `?text=` decodes to the title sentence; opens in a new tab |
| CMP-ACTA-004 | "uses the article's cta_headline, else the general line" | The article's headline |
| CMP-ACTA-005 | "falls back to the general headline" | `ARTICLE_CTA_FALLBACK` |
| CMP-ACTA-006 | "offers the clearinghouse check on a pension or fees article" | "נבדוק לך במסלקה" → `/pension-check` |
| CMP-ACTA-007 | "offers the year-end page to the self-employed" | "מה להפקיד עד 31.12" → `/atzmaim-31-12` |
| CMP-ACTA-008 | "offers nothing but WhatsApp on an article no offer covers" | One link in the box |

### 4.28 `<MaslekaAnalysis />` — Dorit's review of a client's report — `tests/component/masleka-analysis.test.tsx`

Over an in-memory port (decisions stored and read back) and the made-up client in `tests/fixtures/clearinghouse-snapshot.ts`.

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKA-001 | "shows the client, the totals, every finding as a draft, and the products" | Heading with the name; 493,000; one card per finding; "N ממתינות לבדיקה · 0 אושרו"; a row per account; the pension-marketing disclosure |
| CMP-MSKA-002 | "will not print before anything is approved" | "הדפסה" disabled |
| CMP-MSKA-003 | "approves a finding, then prints" | `decide(s1, key, {approved, null})`; "אושר"; `print()` |
| CMP-MSKA-004 | "approves in Dorit's own words, and stores them only when they differ from the draft" | Edited text stored and shown; "בנוסח של דורית" |
| CMP-MSKA-005 | "rejects a finding and can put it back to draft" | `rejected`, then `decide(…, null)`; "טיוטה" |
| CMP-MSKA-006 | "keeps drafts and rejected findings off the printout" | Approved card printable; rejected and draft cards `print:hidden` |
| CMP-MSKA-007 | "says so when a decision could not be saved" | Alert with the rid |
| CMP-MSKA-008 | "says plainly when the report is gone or cannot be read" | Alert "הדוח לא נמצא" |
| CMP-MSKA-009 | "changes an approved recommendation's priority, keeping its wording" | `decide(…, {approved, finalText: null, priority: important})` |
| CMP-MSKA-010 | "adds a recommendation of Dorit's own, approved, with its title and priority" | `decide('custom:…', {approved, finalText, title, priority})`; the card appears |
| CMP-MSKA-011 | "previews exactly what the client will see, with nothing sent" | The client's component in a region; answer buttons disabled; no publish |
| CMP-MSKA-012 | "publishes the approved recommendations to the client's address" | Disabled without an address; then `publish('s1', email, items)` |
| CMP-MSKA-013 | "asks before a republish replaces what the client sees" | Declined → no publish |
| CMP-MSKA-014 | "shows the client's answers, the new ones counted, and marks them read" | "1 חדשות", the note; `markAnswersSeen`; `unpublish` |
| CMP-MSKA-015 | "keeps a failed custom recommendation and retries the same item, clearing only after success" | Failure preserves title, body and priority; retry uses the same key; success clears the draft |
| CMP-MSKA-016 | "keeps a pending recommendation intact and prevents another submission" | Fields retain text and are disabled while saving; one write; clears after confirmation |
| CMP-MSKA-017 | "resets the recipient and preview when moving between cached client reports" | Cached route change resets to the new client's address and closes preview; publish uses the new id and address |

### 4.32 The growth brief: "בדיקת תיק פנסיוני", Cal.com and the WhatsApp channel — `tests/component/lead-growth.test.tsx`

`services.leads.submitInterview` mocked; `CAL_LINK` and `WHATSAPP_CHANNEL_URL` set per test.

| ID | Title | Expected result |
|---|---|---|
| CMP-GROW-001 | "sends the questionnaire's lead with the clearinghouse opt-in ticked, and counts it once saved" | `track: pension`, `profile: {clearinghouse: "מעוניין/ת"}`, `stage: complete`, the context in the summary; "במייל שלך מחכה קישור אישי"; `generate_lead {method: pension_check, location}` once |
| CMP-GROW-002 | "takes no email too, and says Dorit will send the link herself" | `email` undefined; the no-email thank-you |
| CMP-GROW-003 | "asks for a name, a mobile number and a real address before sending" | Three alerts in turn; nothing sent |
| CMP-GROW-004 | "says so, and counts nothing, when the save fails" | Alert; no `generate_lead` |
| CMP-GROW-005 | "/pension-check: one h1, three steps, the form and the disclosure, and no 'חינם'" | As titled |
| CMP-GROW-006 | "/atzmaim-31-12: the article's figures, a link to it, and the form with the campaign as its context" | 38,400; link to `/blog/sof-shana-atzmaim`; summary names the campaign; `location: year_end` |
| CMP-GROW-007 | "the hero leads with the check; the conversation is the second button, hidden on a phone" | `/pension-check`; `#start` with `max-md:hidden` |
| CMP-GROW-008 | "the fee calculator offers the check right after its result" | The calculator headline |
| CMP-GROW-009 | "the footer names the WhatsApp channel only once its address is set" | Absent unset; then the link, `noopener noreferrer`, and the reminder line |
| CMP-GROW-010 | "#start offers the 15-minute call first once Cal.com is set, the questionnaire second" | Absent unset; then "לבחירת מועד" → the Cal.com link, new tab; the questionnaire's lead-in |

### 4.29 `<SnapshotHome />` — the personal snapshot on the home page — `tests/component/snapshot-home.test.tsx`

Rendered on its own: on the home page it appears only with `VITE_SNAPSHOT_HOME=true`.

| ID | Title | Expected result |
|---|---|---|
| CMP-SNAP-001 | "leads with the headline as an h2 — the page keeps its one h1" | No h1; the headline is an h2; eyebrow "חדש באתר · תמונת מצב אישית" |
| CMP-SNAP-002 | "starts at the questionnaire, and explains first if asked" | Primary → `#start`; secondary → `#how-it-works`, which exists |
| CMP-SNAP-003 | "labels the preview's numbers as sample data" | Figure "תצוגה מקדימה — נתוני דוגמה" with the "נתוני דוגמה" tag |
| CMP-SNAP-004 | "walks through three steps, with no timing until Dorit confirms one" | 01–03 titles; no "ימי עסקים" |
| CMP-SNAP-005 | "names the four things the personal area shows" | The four tile titles, in order |
| CMP-SNAP-006 | "reaches Dorit directly from the dark band, by the numbers in the contact config" | `tel:` + `CONTACT.phoneE164`; `wa.me/` + `CONTACT.whatsapp`, `noopener noreferrer` |
| CMP-SNAP-007 | "lists four tools, the two new ones tagged חדש" | Four `/tools#…` links; "חדש" on the last two only |
| CMP-SNAP-008 | "makes no claim of a free check and counts no users or savings" | No "חינם"/"ללא עלות", no counters |

### 4.30 `<RetirementCalculator />` — /tools, מחשבון פרישה — `tests/component/retirement-calculator.test.tsx`

On /tools only with `VITE_SNAPSHOT_HOME=true`.

| ID | Title | Expected result |
|---|---|---|
| CMP-RET-001 | "pairs every slider with a number field, in the brief's ranges" | Six sliders with their min/max; a "— ערך" field each |
| CMP-RET-002 | "shows the monthly pension highlighted, the final balance and the fees" | The projection's figures; the pension card has the gold border; the chart's label names both ends |
| CMP-RET-003 | "answers 'ומה אם?' with ₪500 more a month and a 0.15% fee" | Both variations' pensions |
| CMP-RET-004 | "lets a two-digit age be typed, clamping only when the field is left" | "4" stays while typing; "45" moves the slider; "90" → 64 on blur |
| CMP-RET-005 | "says so when retirement is not after today" | Status "גיל הפרישה צריך להיות אחרי הגיל היום." |
| CMP-RET-006 | "keeps the disclaimer word for word, and sends the CTA to the questionnaire" | The brief's sentence; CTA → `/#start` |
| CMP-RET-007 | "sends no calculator_result for the untouched defaults" | None |
| CMP-RET-008 | "sends calculator_result once the inputs settle, with the tool's name and no figure" | `{tool: "retirement_projection"}` once |

### 4.31 `<HarHabituachCheck />` — /tools, בדיקת כפל ביטוחים — `tests/component/har-habituach-check.test.tsx`

`services.leads.submitLead` mocked; the file is the fixture written as an .xlsx. On /tools only with `VITE_SNAPSHOT_HOME=true`.

| ID | Title | Expected result |
|---|---|---|
| CMP-HB-001 | "shows the three steps, linking to Har HaBituach in a new tab, and the disclaimer" | `https://harb.cma.gov.il/`, `noopener noreferrer`; "לא נשלח לשום מקום"; the disclaimer |
| CMP-HB-002 | "reads the file into tiles and a list, a duplicate tagged, without sending anything" | Tiles 1 / 3; "כפל אפשרי" on the drugs group only; the note; `submitLead` not called |
| CMP-HB-003 | "counts the check for GA4 once, by the tool's name only" | `calculator_result {tool: coverage_check}` once |
| CMP-HB-004 | "refuses a file that is not an xlsx, and an xlsx that is not Har HaBituach's" | The two alerts |
| CMP-HB-005 | "sends Dorit only the summary, through the lead pipeline, and counts a lead once it is saved" | `source: quick`, topic "בדיקת כפל ביטוחים", the summary; no identifier; `generate_lead {method: coverage_check}` |
| CMP-HB-006 | "asks for a name and a mobile number before sending" | "נא למלא שם."; the mobile rule; nothing sent |

### 4.33 `<Account />` — the "תמונת מצב" tab — `tests/component/account-snapshot.test.tsx`

`snapshotEnabled` passed explicitly; the snapshot from the fixture, answers kept in memory.

| ID | Title | Expected result |
|---|---|---|
| CMP-ACCS-001 | "opens on תמונת מצב, with the dates, the four tiles, the products and the recommendations" | Tab selected; "נתוני המסלקה מתאריך … · נבדקו על ידי דורית ב־…"; four tiles (2 open); a row per account; "חשוב"; the disclosure |
| CMP-ACCS-002 | "answers 'כן, לטפל בזה' and says so" | `respond('i1', 'accepted')`; "ביקשת לטפל בזה" |
| CMP-ACCS-003 | "sends a question with its text" | `respond('i2', 'question', text)`; "שאלת את דורית" |
| CMP-ACCS-004 | "offers the clearinghouse check when nothing is published yet" | "עוד אין כאן תמונת מצב"; link to `/pension-check` |
| CMP-ACCS-005 | "keeps the enquiries in their own tab" | "הפניות שלי" panel with the enquiries |
| CMP-ACCS-006 | "is the page it was when the switch is off: no tabs, no snapshot" | No tablist; the enquiries as before |


### 4.34 English and French pages — `tests/component/i18n-pages.test.tsx`

The shell and `/pension-check` through `LocaleLayout`, as `App.jsx` routes `/en` and `/fr`; `ENABLED_LOCALES` mocked to he, en, fr; `submitInterview` mocked.

| ID | Title | Expected result |
|---|---|---|
| CMP-I18N-001 | "renders /en/pension-check in English, left to right" | `<html lang="en" dir="ltr">`; "Pension portfolio check"; the English disclosure |
| CMP-I18N-002 | "renders /fr/pension-check in French" | `lang="fr"`; "Bilan de votre épargne retraite" |
| CMP-I18N-003 | "keeps the Hebrew page Hebrew and right to left" | `dir="rtl"`; "בדיקת תיק פנסיוני" |
| CMP-I18N-004 | "keeps the visitor in their language: prefixed links, and no Hebrew-only pages in the menu" | `/en/tools`, `/en/#start`; no Blog or Perspective; "Privacy policy (in Hebrew)" → `/privacy` |
| CMP-I18N-005 | "offers the same page in the other languages" | עברית → `/pension-check`; Français → `/fr/pension-check`; English `aria-current` |
| CMP-I18N-006 | "asks in English, but sends Dorit the Hebrew summary, noting the language" | "Please enter your name."; the summary in Hebrew with "· מולא באנגלית" |

### 4.35 The home page in English and French — `tests/component/i18n-home.test.tsx`

`<Home />` through `LocaleLayout` at `/en`, `/fr` and `/`; `services` mocked (one Hebrew testimonial from `content.listTestimonials`; `leads.submitLead` recorded), a desktop `matchMedia`.

| ID | Title | Expected result |
|---|---|---|
| CMP-I18N-007 | "renders %s with no Hebrew but the testimonials and the switcher's עברית" (/en, /fr) | The h1 in the language; no Hebrew outside `lang="he"` in text, aria-label, alt, placeholder or title |
| CMP-I18N-008 | "leads with the short form: no questionnaire and no chat" | "Full name *"; no `#interview`; the hero's check → `/en/pension-check` |
| CMP-I18N-009 | "keeps the questionnaire and the FAQ block on the Hebrew page" | `#interview` and `#common-questions` present; no original-language note |
| CMP-I18N-010 | "sends the visitor's message as written, with a Hebrew note for Dorit" | "Please enter your name and phone."; `message` "About my pension\n(מולא באנגלית)" |
| CMP-I18N-011 | "shows the testimonials in their own Hebrew, marked so" | The card `lang="he" dir="rtl"`; the French note |
| CMP-I18N-012 | "turns the cases' arrows with the page: back is to the left in English, to the right in Hebrew" | **Retired 2026-10-19** — the Short home page has no `#proof` to render |
| CMP-I18N-013 | "keeps the Hebrew page's arrows as they were" | **Retired 2026-10-19** — the Short home page has no `#proof` to render |

### 4.36 /faq in English and French — `tests/component/i18n-faq.test.tsx`

`<FAQPage />` and `<Home />` through `LocaleLayout`; the support chat mocked as a marker.

| ID | Title | Expected result |
|---|---|---|
| CMP-I18N-014 | "renders %s with no Hebrew but the switcher's עברית" (/en/faq, /fr/faq) | The category heading and the first question in the language; no Hebrew outside `lang="he"` |
| CMP-I18N-015 | "opens an answer, and moves between topics" | "General" pressed; the first-meeting answer visible |
| CMP-I18N-016 | "declares its questions in English to search engines, and no Hebrew-only chat" | FAQPage JSON-LD: 24 English questions, no Hebrew; no chat; canonical `/en/faq` |
| CMP-I18N-017 | "keeps the Hebrew page Hebrew, its English subtitles and its JSON-LD" | "Income Tax · 6 שאלות"; the chat; the Hebrew first question |
| CMP-I18N-018 | "gives the English home page its common-questions link, to /en/faq" | "Common questions"; no buttons in the block; "All the questions" → `/en/faq` |

### 4.37 /claims and /atzmaim-31-12 in English and French — `tests/component/i18n-claims.test.tsx`

`<Claims />` and `<YearEndSelfEmployed />` through `LocaleLayout`; `submitClaim` mocked.

| ID | Title | Expected result |
|---|---|---|
| CMP-I18N-019 | "renders %s with no Hebrew but the switcher's עברית" (/en and /fr of both pages) | A heading in the language; no Hebrew outside `lang="he"` |
| CMP-I18N-020 | "offers the claim types in English, and sends Dorit the Hebrew type and a note" | `claimType` "אובדן כושר עבודה"; `description` "…\n(מולא באנגלית)" |
| CMP-I18N-021 | "sends a Hebrew report exactly as typed" | `description` keeps its trailing space |
| CMP-I18N-022 | "keeps the year-end figures exact, and marks the Hebrew-only guide" | 16.5%, ₪38,400, ₪13,203, ₪20,566; "(in Hebrew)" → `/blog/sof-shana-atzmaim`; the disclosure |


### 4.38 `<OrgBadge />`, `<OrgChip(s) />` and `<Avatar org>` — `tests/component/org-badge.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-ORG-001 | "on a %ipx avatar: a %ipx badge, code shown: %s" (64, 44, 40, 32, 24) | 26 / 20 / 20 / 12 / 12 px; the code from 40px up; "ארגון: …" as `aria-label` |
| CMP-ORG-002 | "writes the code at 9–10px on a 40–44px avatar's badge" | 9 ≤ font ≤ 10 |
| CMP-ORG-003 | "shows the organization's logo instead of its code when it has one" | An `<img>`; no code |
| CMP-ORG-004 | "sits at the inline-end bottom corner, with a white rim" | `inset-inline-end` and `bottom` −3px; 3px white border |
| CMP-ORG-005 | "opens its tooltip on keyboard focus, and on a tap" | `tabindex=0`; the tooltip after focus and after a touch tap |
| CMP-ORG-006 | "writes the name on the chip, in the ink on the tint, with the colour's square first" | Ink on tint; the square in the colour |
| CMP-ORG-007 | "shows two chips, then +N that lists the rest" | 2 chips; "ועוד 2 ארגונים" opens the other two |
| CMP-ORG-008 | "puts the badge on an avatar given an organization, sized to the avatar" | 26px with "אי" on a 64px avatar |
| CMP-ORG-009 | "leaves an avatar without an organization exactly as it was" | No badge; the original classes; no `style` |

### 4.40 `/admin/users` — `tests/component/admin-users.test.tsx`

`<AdminUsers />` with `services.usersAdmin.list` mocked.

| ID | Title | Expected result |
|---|---|---|
| CMP-AU-001 | "shows skeletons while loading, then the count and every user sorted by name" | 4 skeletons; "מציג 3 מתוך 3 משתמשים"; name `aria-sort=ascending` |
| CMP-AU-002 | "filters by organization with pressed buttons — ANY of them — and keeps it in the URL" | `aria-pressed`; ANY match; `?org=b,c` |
| CMP-AU-003 | "searches after a short pause, combined with the filter, and reads both back from the URL" | `?org=b` + "yossi" → 1; `?q=yossi` |
| CMP-AU-004 | "says when nothing matches, and clears the search and the filter" | The empty message; "ניקוי סינון" empties the URL and the field |
| CMP-AU-005 | "sorts by a column, marking it with aria-sort, and turns it around on a second click" | ascending, then descending; the others "none" |
| CMP-AU-006 | "shows the organization column in the table without avatar badges, and the badge on the cards" | No badge in the table; one per card (primary) |
| CMP-AU-007 | "turns the filter into a searchable multi-select above six organizations, with removable chips" | No pill group; search narrows; a chip removes its choice |
| CMP-AU-008 | "says so when there are no users at all, with nothing to clear" | "עדיין אין משתמשים"; no clear button |

### 4.39 /tools in English and French — `tests/component/i18n-tools.test.tsx`

`<Tools />` through `LocaleLayout`; the procedures chat mocked as a marker.

| ID | Title | Expected result |
|---|---|---|
| CMP-I18N-023 | "renders %s with no Hebrew but the switcher's עברית, and without the Hebrew-only chat" (/en, /fr) | The h1 in the language; no Hebrew outside `lang="he"`; no chat |
| CMP-I18N-024 | "runs the insurance self-check in English, and offers an English WhatsApp message" | "6 kinds of insurance relevant to you"; the WhatsApp text starts "Hello Dorit, I did the self-check" |
| CMP-I18N-025 | "shows the fee calculator's amounts in shekels the English way" | "₪600,000" |
| CMP-I18N-026 | "keeps the Hebrew page's chat, quiz and amounts" | The chat; the Hebrew heading; "‏600,000 ‏₪" |


### 4.41 The client status on `/admin/leads` — `tests/component/lead-client-status.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-LCS-001 | "offers לקוח/ה, labels a client lead with it, and filters by it" | The label; the filter shows only the client |
| CMP-LCS-002 | "marks a lead as a client" | `setStatus({ id, status: "client" })` |

### 4.42 `<AdminMenu />` — "ניהול" in the public header — `tests/component/admin-menu.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-AMENU-001 | "says it opens a menu, and whether it is open" | `aria-haspopup="menu"`; `aria-expanded` false, then true after Enter |
| CMP-AMENU-002 | "shows the initials, and the total waiting in the button's name" | "דג"; accessible name "ניהול 3 פריטים ממתינים" |
| CMP-AMENU-003 | "lists the admin's name and role, her items with their counters, and a way out" | Name and "מנהל/ת"; items ממשק ניהול → `/account`, פניות חדשות → `/admin/leads`, בקשות מסלקה → `/admin/masleka`, יציאה calls `onSignOut` |
| CMP-AMENU-004 | "gives agency staff the board alone" | "ממשק ניהול" → `/admin/masleka`; no "פניות חדשות" |
| CMP-AMENU-005 | "shows no counter at zero" | Accessible name exactly "ניהול"; items without a number |
| CMP-AMENU-006 | "closes on Escape and gives focus back to the button" | `aria-expanded` false; the button has focus |

### 4.43 `<AdminLayout />` — the admin sidebar — `tests/component/admin-layout.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-ALAY-001 | "groups the admin's pages by task, around the screen" | Groups "טיפול שוטף" (leads, masleka) and "תוכן והגדרות" (blog, users); ראשי → `/account`; צפייה באתר → `/` |
| CMP-ALAY-002 | "marks the current page, and only it" | `aria-current="page"` on פניות alone at `/admin/leads` |
| CMP-ALAY-003 | "keeps a page beneath the board under בקשות מסלקה" | `/admin/masleka/guide` marks בקשות מסלקה |
| CMP-ALAY-004 | "counts new leads and waiting requests, and shows no zero" | "פניות 4 חדשות"; בקשות מסלקה with no number |
| CMP-ALAY-005 | "gives agency staff the clearinghouse alone" | One link, `/admin/masleka`; `countNew` never called |
| CMP-ALAY-006 | "shows a client's personal area without the frame" | `/account` for a client: the page, no sidebar |
| CMP-ALAY-007 | "shows the admin's personal area as her main page, in the frame" | `/account` for the admin: the sidebar, ראשי current |
| CMP-ALAY-008 | "signs out and sends her home" | "יציאה" calls `logout(true, <origin>/)` |

### 4.44 "הוספת משתמש" — `tests/component/invite-user.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-INV-001 | "invites with the address, organization and role, says so, and reloads the list" | `invite({ email, orgId, role })`; status "ההזמנה נשלחה ל-…"; the users list read again |
| CMP-INV-002 | "says plainly when the membership was added but the mail did not go" | Status "נוסף לארגון, אבל המייל לא נשלח" |
| CMP-INV-003 | "shows the function's refusal in its own words" | Alert with the function's message |
| CMP-INV-004 | "asks for an address before sending anything" | Alert "יש להזין כתובת דוא״ל תקינה"; no call |

`tests/component/admin-users.test.tsx` adds CMP-AUSR "switches from cards to the table at 680px, as the design asks" (`min-[680px]:table` / `min-[680px]:hidden`).

### 4.45 `/login` — Google — `tests/component/login-google.test.tsx`

`vitest.config.ts` now resolves `.ts`/`.tsx` before `.jsx`, as `vite.config.js` does, so `@/pages/Login` is the site's page, not Base44's restored boilerplate.

| ID | Title | Expected result |
|---|---|---|
| CMP-LOGIN-001 | "tells the visitor when Google's sign-in could not start" | A rejecting `signInWithGoogle` shows "לא הצלחנו להתחיל את ההתחברות. נסו שוב." |
| CMP-LOGIN-002 | "says nothing while Google takes the visitor away" | No message; the call made |

### 4.46 The not-found page and the skip link — `tests/component/not-found.test.tsx`

Through `LocaleLayout`, as App.jsx routes them. Base44's template 404 said
"Page Not Found … Go Home" in English, outside the header and footer, with a
grey heading under the contrast floor and no `<main>`; no page had a skip link
(D-04, D-07, D-08, manual test 2026-10-14).

| ID | Title | Expected result |
|---|---|---|
| CMP-404-001 | "is in Hebrew, inside one <main>, with the h1 inside it" | One `<main>`; h1 "הדף שחיפשתם לא נמצא" inside it; no "Page Not Found" / "Go Home" |
| CMP-404-002 | "keeps the site's header and footer, so the way back is the usual one" | A `<header>` and a `<footer>` |
| CMP-404-003 | "links home and to the main pages" | "לעמוד הראשי" → `/`; the "דפים באתר" nav links `/tools`, `/claims`, `/blog`, `/faq` |
| CMP-404-004 | "uses no grey that fails contrast: the heading and text are ink" | h1 `text-foreground`; no `text-slate-*` in `<main>` |
| CMP-404-005 | "is noindex, and its canonical is the address asked for" | `robots` noindex; title "הדף לא נמצא \| דורית גוב ארי"; canonical path `/nope-xyz` |
| CMP-404-006 | "speaks English under /en, links stay in English, and the Hebrew-only blog is left out" | English h1; home → `/en`; links `/en/tools`, `/en/claims`, `/en/faq`; canonical `/en/nope` |
| CMP-SKIP-001 | "is the first focusable thing on the page" | The first focusable element reads "דילוג לתוכן הראשי" |
| CMP-SKIP-002 | "moves focus to the page's <main>" | After the click `document.activeElement` is the `<main>`, given `tabindex="-1"` |
| CMP-SKIP-003 | "is in the page's language" | "Aller au contenu principal" under `/fr` |
| CMP-SKIP-004 | "names a target that exists, so it works before the app runs" | `href="#main"`, and `#main` is the `<main>` |

## 5. Pass criteria

All 278 declared cases pass (vitest: 308 with expansions). A `submitLead` or `submitClaim` payload assertion failing
here is a contract break — cross-check [STD-03](03-std-contract.md) before
changing the test.

### 4.46 The screens by agency role — `tests/component/agency-roles-ui.test.tsx`

What a User, an Admin and an Owner are offered, with `src/hooks/useAgency` replaced by `tests/helpers/agency-role-mock.ts` (whose `can()` reads the real permissions table). The same mock gives full access in `lead-transcript`, `lead-client-status`, `blog-admin-slug`, `admin-users` and `invite-user`, so their existing cases test what they did.

| ID | Title | Expected result |
|---|---|---|
| CMP-ROLEUI-001 | "shows a User 'הפניות שלי', with no assignment, no delete and no tracking panel" | Heading הפניות שלי; no מחיקה, no assignee select, no לא שויכו chip, no tracking panel |
| CMP-ROLEUI-002 | "shows a backend-written status as it is, and not as a choice" | The select's value is `escalated`, its option disabled |
| CMP-ROLEUI-003 | "gives an Admin the queue: an assignee per lead, the unassigned chip, and delete" | ניהול פניות; delete on each; לא שויכו shows the open unassigned lead only (not a closed one); the assignee options are the agency's members; a choice calls assign with `{ id, userId }` |
| CMP-ROLEUI-004 | "offers everyone the escalated and partial chips" | Both chips, with counts |
| CMP-ROLEUI-005 | "shows only the current agency's leads" | Another agency's lead absent |
| CMP-ROLEUI-006 | "lets a User write drafts only: no publish toggle, no delete, no edit of a live article" | One עריכה (the draft's) |
| CMP-ROLEUI-007 | "gives an Admin publishing and deleting" | Toggle and delete on both articles |
| CMP-ROLEUI-008 | "shows a User the members, lets them leave, and offers no change to anyone else" | Three members; no הסרה or role select; עזיבת הסוכנות calls `leave(agency)` |
| CMP-ROLEUI-009 | "lets an Admin remove a User, saying how many leads go back to the queue, and never touch the Owner" | No הסרה on the Owner; no role select (User only); the confirm names 2 open leads; `remove(agency, user)` |
| CMP-ROLEUI-010 | "lets the Owner change roles and hand over ownership" | `setRole(agency, u2, 'admin')` — the value read at the change, not after React resets the controlled select; `transferOwnership(agency, u2)` |
| CMP-ROLEUI-011 | "lets the Owner edit and save every field" | `updateProfile(agency, { displayName, … })` |
| CMP-ROLEUI-012 | "shows anyone else the details read-only, with no save" | Inputs `readonly`; no שמירה |

Changed for agency roles:
- **`admin-layout.test.tsx`:**
  - The operator's sidebar adds פרטי הסוכנות, and counts the unassigned queue.
  - A User gets the agency's pages without פרטי הסוכנות, with their own new leads counted.
  - Someone in two agencies gets a switcher, and every link keeps `?agency=`; one agency shows no switcher.
- **`admin-menu.test.tsx`:**
  - The operator reads "מפעיל הפלטפורמה" and the unassigned queue.
  - A User gets הפניות שלי, with the leads as the way in.
  - An Admin gets the queue.
- **`floating-header(-masleka).test.tsx`:**
  - A member's ניהול leads to `/admin/leads`.
  - The operator's counter is the unassigned queue.
- **`invite-user.test.tsx`:**
  - An agency Admin is offered only their agencies and the User role.
  - A User gets no invite button.
  - The role offered by default is an Admin's (the operator may give it).

### 4.47 "דורשות טיפול" — `tests/component/leads-attention.test.tsx`

Review 2026-10-15, item 17. The `escalated` and `partial` chips and the disabled current-status option already came with the agency roles (CMP-ROLEUI-002 and 004). What remained: an escalated lead (a visitor who asked for Dorit herself) needs someone as much as a new one. The card counts both and its filter shows both, and so does the menu's counter for a User (UNIT-LEADTX-009).

| ID | Title | Expected result |
|---|---|---|
| CMP-ATTN-001 | "counts the new and the escalated leads together" | One new, one escalated, one contacted, one partial: the card reads 2 |
| CMP-ATTN-002 | "shows the new and the escalated leads when clicked, and no other" | After the click: the new and the escalated lead; not the contacted or the partial one |

### 4.48 The testimonials' writes — `tests/component/testimonials.test.tsx` (new cases)

Review 2026-10-15, item 18. Dorit's controls in the home page's testimonials say what failed, in a `role="alert"`, and ask before a delete, as the leads and blog screens do. The services' content-admin and upload methods are spied on, so these cases hold on either backend.

| ID | Title | Expected result |
|---|---|---|
| CMP-TESTIM-ADM-001 | "asks before deleting, and deletes nothing when the answer is no" (the admin's writes) | `confirm("למחוק את ההמלצה?")`; no → no delete; yes → `removeTestimonial("t1")` |
| CMP-TESTIM-ADM-002 | "says so in an alert when a delete fails" (the admin's writes) | `role="alert"`: "ההמלצה לא נמחקה…" |
| CMP-TESTIM-ADM-003 | "says so in an alert when the picture does not upload, and publishes nothing" (the admin's writes) | `role="alert"`: "התמונה לא הועלתה…"; `createTestimonial` not called |
| CMP-TESTIM-ADM-004 | "says so in an alert when the testimonial is not saved" (the admin's writes) | `role="alert"`: "ההמלצה לא נשמרה…" |

### 4.49 The claim form's documents — `tests/component/claim-form-files.test.tsx`

Review 2026-10-15, item 19. Already in place: `accept`, the 10 MB and type checks with Hebrew copy (`claimDocumentProblem`, UNIT section 4.63), and clearing the input after each pick. Added: drag-and-drop on the zone, the input `sr-only` instead of `hidden`, and `role="alert"` on the form's error. The phone stays on `isContactPhone`, the rule `submit-claim` applies: a landline is a number Dorit can call back about a claim, and mobile-only would refuse what the function accepts.

| ID | Title | Expected result |
|---|---|---|
| CMP-CLAIMDOC-001 | "takes dropped files through the same checks as picked ones" | A dropped PDF is listed; a dropped `.exe` is not, and the alert names it with the type message |
| CMP-CLAIMDOC-002 | "keeps the picker in the tab order: visually hidden, never display:none" | Class `sr-only`, not `hidden`; Tab reaches the input |
| CMP-CLAIMDOC-003 | "accepts only the bucket's types, and says a picked file's problem in an alert" | `accept` lists PDF and HEIC; a 10 MB + 1 byte JPG gives the size message in `role="alert"`; the input's value is cleared |

### 4.50 The home page's chat, loaded on demand — `tests/component/start-conversation-lazy-chat.test.tsx`

Review 2026-10-15, item 22. `StartConversation` imports `AgentChat` with `lazy()`, so the chat and react-markdown leave the home page's first bundle. Measured with `CI=1 vite build` on this branch: the entry chunk went from 473,997 B (140,328 gzip) to 337,775 B (100,007 gzip). Everything the home page loads up front (entry and modulepreloads) went from 935,093 B (288,942 gzip) to 798,907 B (248,641 gzip), about −14% gzipped. `AgentChat` is its own 21,245 B chunk (7,118 gzip).

| ID | Title | Expected result |
|---|---|---|
| CMP-LAZYCHAT-001 | "is not loaded with the section, and loads and shows once the visitor opens it" | The mocked module is not evaluated on render; after the צ'אט button, it is evaluated once and the chat shows |

### 4.51 Article links in a chat reply — `tests/component/chat-article-links.test.tsx`

D-10, manual test 2026-10-14. The support chat on the Base44 engine linked `/blog/6ac496b66444c62d843db5b9`. Base44's `BlogPost` has no slug, so its record id is all the agent can name, and the address worked only through the 301. `AgentChat` now reads the articles once a reply carries a `/blog/<24 hex>` link, and renders `articlePath(article)` for it. Supabase articles carry the Base44 id as `id` (`toPortRow`). The agents' own JSON block (`recommended`) keeps the ids, which the blog page reads.

| ID | Title | Expected result |
|---|---|---|
| CMP-CHATLINK-001 | "point at the article's slug, not the Base44 record id" | `/blog/6ac4…` renders as `/blog/horadat-dmei-nihul`; the articles are read once |
| CMP-CHATLINK-002 | "keep the old address for an article with no slug, or one the list does not have" | Both hrefs unchanged |
| CMP-CHATLINK-003 | "leave slug links and other links alone, and do not read the articles for them" | Hrefs unchanged; `listArticles` not called |
| CMP-CHATLINK-004 | "still links the old address when the articles cannot be read" | A failed read leaves `/blog/<id>`, which still reaches the article through the 301 |

### 4.52 The lead drawer and its meetings — `tests/component/lead-meetings.test.tsx`

docs/superpowers/specs/2026-10-17-client-meetings-design.md, rollout 2, behind `VITE_MEETINGS_STAFF`: the lead's name opens a drawer with "פרטים" and "פגישות · N" (the user's choice of 2026-10-17 — the table had no drawer). The meeting hooks are real; the service is the fake, so each button's payload is checked.

| ID | Title | Expected result |
|---|---|---|
| CMP-MTG-001 | "leaves the table as it was when the switch is off" | The name is text; no meetings read |
| CMP-MTG-002 | "opens on the lead's name, with its details and a meetings tab that counts them" | `פרטים` selected; `פגישות · 2`; read for that lead |
| CMP-MTG-003 | "publishes the client summary, with the time it was published" | `updateMeeting(m-1, { clientSummary: trimmed, summaryPublishedAt: ISO })` |
| CMP-MTG-004 | "does not offer to publish an empty summary" | Button disabled |
| CMP-MTG-005 | "unpublishes a published summary, and says when it was published" | `פורסם ללקוח · 23.9, 09:12`; `{ summaryPublishedAt: null }` |
| CMP-MTG-006 | "keeps Dorit's notes labelled as staff-only, apart from the client's summary" | Notes field labelled `— רק הצוות רואה`; summary empty |
| CMP-MTG-007 | "shows the client's open request and marks it handled" | Banner with kind and note; `handleMeetingRequest(r-1)`; the meeting untouched |
| CMP-MTG-008 | "adds a meeting in the lead's agency, on Israel's clock" | 2026-12-14 17:30 → `15:30Z`, the lead's agency |
| CMP-MTG-009 | "says why a meeting was not added, in the service's words" | The service's refusal as an alert |
| CMP-MTG-010 | "opens only the leads the table holds — their assigned ones — and reads only that lead's meetings" | A User: one lead; meetings read for it alone |
| CMP-MTG-011 | "is told when a write is refused, rather than shown it saved" | Alert `לא בוצעה` |

With the switch on, the page around the drawer is "פניות ופגישות" (§4.55); these cases open the drawer from the leads tab, which they reach unchanged.

### 4.53 "הפגישות שלי" in /account — `tests/component/account-meetings.test.tsx`

docs/superpowers/specs/2026-10-17-client-meetings-design.md, rollout 4, behind `VITE_MEETINGS_CLIENT` (the canvas "הפגישות שלי — לקוח": phone, desktop, the change-request sheet). Off until the privacy wording is approved.

| ID | Title | Expected result |
|---|---|---|
| CMP-CLMTG-001 | "is absent, and the page as it was, when the switch is off" | No tab |
| CMP-CLMTG-002 | "opens first, with the next meeting on its own card, on Israel's clock" | `10:00–10:45 · 45 דקות`, `ביומן של דורית`, "הוספה ליומן שלי" |
| CMP-CLMTG-003 | "shows a published summary under 'מה סיכמנו', and nothing for a meeting without one" | Summary shown; no empty box |
| CMP-CLMTG-004 | "keeps cancelled meetings collapsed, and the pension-marketing line under the summaries" | `פגישה אחת בוטלה`; `compliance.pensionMarketing` |
| CMP-CLMTG-005 | "shows an open request as waiting for Dorit, with no button to ask again" | Disabled `ביקשת מועד אחר — דורית תחזור אליך` |
| CMP-CLMTG-006 | "sends a change request from the sheet, and says the meeting stays until Dorit confirms" | `requestChange(m-next, cancel, trimmed note)`; the sheet closes |
| CMP-CLMTG-007 | "keeps the sheet open with the refusal in its own words" | Alert with the function's text |
| CMP-CLMTG-008 | "renders a summary as text, never as markup" | Literal `<b>…</b> **…**`; no `<b>` element |
| CMP-CLMTG-009 | "offers a booking when there is no meeting yet" | `עוד אין כאן פגישות`; link to `/#start` |

### 4.54 Glossary tooltips — `tests/component/glossary-term.test.tsx`

`Glossed` marks a text's glossary terms with `Term`: a dotted underline and a definition in a Radix popover, which opens on touch where a tooltip would not. The definition is rendered only while open, so the page's text — and what a crawler reads — does not change.

| ID | Title | Expected result |
|---|---|---|
| CMP-GLOSS-001 | "keeps the paragraph's text as written, and renders no definition until one is opened" | Same `textContent`; `data-term` buttons; no tooltip |
| CMP-GLOSS-002 | "opens on a tap, describes the term, and closes on a second tap" | `role=tooltip`, `dir=rtl`, `aria-describedby`; focus stays on the term |
| CMP-GLOSS-003 | "opens on Enter and closes on Escape" | Keyboard parity |
| CMP-GLOSS-004 | "opens when a mouse rests on the term, and closes when it leaves" | Closes after the 150 ms delay |
| CMP-GLOSS-005 | "does not open on a touch's pointer-enter, only on its tap" | No tooltip |
| CMP-GLOSS-006 | "speaks the page's language" | English definition, `dir=ltr` |
| CMP-GLOSS-007 | "renders an unknown id as plain text" | No button |

### 4.55 "פניות ופגישות" — `tests/component/leads-meetings-screen.test.tsx`

/admin/leads behind `VITE_MEETINGS_STAFF`: the leads and the agency's agenda as two tabs, the tab in the URL (`?tab=leads|meetings`, beside `?agency=`), the leads table's "הפגישה הבאה". The hooks are real; the port (`@/services`) is the fake, answering what a role's session would read. "Now" is Thursday 22.10.2026, 09:00 in Israel (`Date` faked alone).

| ID | Title | Expected result |
|---|---|---|
| CMP-AGENDA-001 | "is the leads screen as it was: no tabs, no next-meeting column, no meetings read" | Switch off: ניהול פניות; no tablist; no הפגישה הבאה; `agencyMeetings` not called |
| CMP-AGENDA-002 | "are a tablist of two, under the heading 'פניות ופגישות', with the leads first" | h1 פניות ופגישות; tabs `leads-tab-leads`, `leads-tab-meetings`; `aria-selected`; each `aria-controls` names a panel; roving `tabIndex` |
| CMP-AGENDA-003 | "count the leads and the meetings, the unassigned for Admin+" | `4`, `3 דורשות טיפול · 1 לא שויכו`; `2 השבוע`, `1 היום · 1 בקשות שינוי · 1 בלי סיכום` |
| CMP-AGENDA-004 | "switch on a click and keep the choice in the URL, beside ?agency=" | `tab=meetings`, then `tab=leads`; `agency` kept |
| CMP-AGENDA-005 | "open on the tab the URL names" | `?tab=meetings` → the agenda |
| CMP-AGENDA-006 | "move with the arrow keys — left to 'פגישות' in a right-to-left page — and Home and End" | ArrowLeft → פגישות, ArrowRight → פניות, End, Home; the focus follows |
| CMP-AGENDA-007 | "offers a %s what the leads screen offered it" (user, admin, owner) | Assignee select, delete, tracking panel and the לא שויכו chip for Admin+ only; status and export for all; a User's tab reads הפניות שלי, without the unassigned count |
| CMP-AGENDA-008 | "names each lead's next meeting on Israel's clock, and offers one where there is none" | `היום 10:00`, `מחר 17:30`, `רביעי 12:00` (winter time); a lead with only a past meeting: `+ קביעת פגישה` |
| CMP-AGENDA-009 | "goes to the meetings tab" | A next meeting → `tab=meetings` |
| CMP-AGENDA-010 | "'+ קביעת פגישה' opens the lead's drawer on its meetings, with the new-meeting form open" | Drawer tab פגישות selected; the form; that lead's meetings read |
| CMP-AGENDA-011 | "shows '—' rather than '+ קביעת פגישה' while the meetings cannot be read" | No offer to schedule on a failed read |
| CMP-AGENDA-012 | "groups by Israel's day across midnight and across the change from summer time" | היום (23:30), מחר (00:15), "יום ראשון, 25.10" holding 00:30 (+03) and 23:30 (+02) |
| CMP-AGENDA-013 | "shows a client's open request on top of its meeting, as plain text, and marks it handled" | Strip named by `MEETING_REQUEST_LABEL`; the note's `<b>` as text; `handleMeetingRequest(r-1)`; the agenda reads again; no meeting update |
| CMP-AGENDA-014 | "narrows to held meetings without a summary, from the chip and from the card" | בלי סיכום: one card, "כתיבת סיכום"; קרובות: the meeting ahead and the one waiting; the card does the same |
| CMP-AGENDA-015 | "opens the client's name in the lead's drawer, on its meetings, with that meeting expanded" | Drawer on פגישות; that meeting `aria-expanded=true` with its notes, the other closed |
| CMP-AGENDA-016 | "shows a name, topic and place as typed, never as markup" | No `img`, `i` or `a` in the card; the text as typed |
| CMP-AGENDA-017 | "lets Admin+ narrow to one member, and does not offer a User the select" | צוות select narrows to `u-2` and shows its address; a User: no select, both rows their session read |
| CMP-AGENDA-018 | "adds a meeting from 'פגישה חדשה': a lead picked by search, then the drawer's form" | Search narrows to one; `addMeeting({ leadId: l-3, agencyId, scheduledAt: 15:30Z })` |
| CMP-AGENDA-019 | "says when there is nothing to show, and when the meetings cannot be read" | אין פגישות להצגה.; alert לא הצלחנו לטעון את הפגישות |

### 4.56 Agency content on the page — `use-agency-content.test.tsx`, `agency-content-sections.test.tsx`, `agency-content-chrome.test.tsx`

`useAgencyContent` and the sections and chrome that read it, behind `VITE_AGENCY_CONTENT` (mocked in `@/config/agency-content`; the suite pins it off in `vitest.config.ts`). The port (`@/services`) is the fake. The byte-level proof that seeded and bundled render the same page is E2E-AGC-001..005.

| ID | Title | Expected result |
|---|---|---|
| CMP-AGC-001 | "flag off — the bundled constants, no request, and no QueryClientProvider needed" | Bundled content; the port not called |
| CMP-AGC-002 | "flag on, still loading — the bundled constants" | No blank, no spinner |
| CMP-AGC-003 | "flag on, the read fails — the bundled constants" | Bundled content |
| CMP-AGC-004 | "flag on, the read answers — the database's content" | The record's values |
| CMP-AGC-005 | "flag on, on localhost — asks for the host as the browser has it" | The port receives `localhost` |
| CMP-AGC-006 | "flag on, an English page — bundled English, and nothing is asked" | No request in a non-`he` locale |
| CMP-AGC-007a..e | The success cases | Off: bundled, nothing asked. On: agency 1's asked while the site loads, then the database's. Another agency still loading or failing: none, never Dorit's. Agency 1 failing: the bundled cases |
| CMP-AGC-008 | "flag off asks exactly today's question; on, it names the agency" | `listTestimonials` arguments |
| CMP-AGC-010 | "byline, licence, headline, monogram and contact are the record's" | Hero and About show the record |
| CMP-AGC-011 | "agency 1 without a photo keeps the bundled picture" | Bundled AVIF/WebP set |
| CMP-AGC-012 | "the paragraphs are the record's bio, and the stats follow its count" | Paragraphs and strip from the record |
| CMP-AGC-013 | "without family the first paragraph is the credentials alone" | No family clause |
| CMP-AGC-014 | "no stats, no strip; no signature, no signature line" | Elements absent |
| CMP-AGC-015 | "the Google link is the record's, and without a Midrag link there is none" | Links from `review_links` |
| CMP-AGC-016 | "the cases and the WhatsApp number are the agency's, and the basis shows under estimates only" | Cases, number, basis line |
| CMP-AGC-017, 017b | "the booking block links to the record's URL, the chips use its contact"; "another agency without a booking URL has no booking block" | Block follows `bookingUrl` |
| CMP-AGC-018 | "asks for the site agency's testimonials, and agency 1's Admin sees no add control there" | `agencyId` passed on; control gated |
| CMP-AGC-020 | "the footer shows the record's phone, email and licence" | Record values |
| CMP-AGC-021 | "the sticky bar and the header call the record's number" | `tel:` and `wa.me` from the record |
| CMP-AGC-022 | "the privacy policy mails the record's email" | `mailto:` from the record |

### 4.57 The portrait — `agent-portrait.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-POR-001 | "the bundled portrait is Dorit's AVIF + WebP picture" | `<picture>` with both sources |
| CMP-POR-002 | "an uploaded photo is one <img> with src, srcset and sizes" | Single `<img>` |
| CMP-POR-003 | "a monogram is a labelled box of initials, not an <img>" | Labelled, no `<img>` |
