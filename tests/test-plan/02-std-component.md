# STD-02 — Component Tests

**Suite:** `component` · **Runner:** `npm run test:component` (Vitest + React Testing Library)
**Location:** `tests/component/` · **Cases:** 310 declared cases (IDs in section 4; a range such as `X-001..014` counts each ID); `npm run test:component` runs 340 including `it.each` / `describe.each` expansions · **Environment:** jsdom

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
| CMP-HDR-006 | "offers no clearinghouse board link, even to an admin, while the switch is off" | No "בקשות מסלקה" link with `VITE_MASLEKA_ENABLED` unset |
| CMP-HDR-009 | "lists the support chat as well as the sticky bar's תמיכה" (`describe` "phone menu") | Opening "תפריט" shows "תמיכה — שאלה לעוזר" → `/faq#support-chat`; pressing it closes the menu (`SupportLink` now runs the caller's `onClick` before its own scroll) |
| CMP-HDR-010 | "tags its support link header_menu, so click_chat says the menu sent the visitor" (`describe` "phone menu") | The drawer's "תמיכה — שאלה לעוזר" sits in `data-track-location="header_menu"` |

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

### 4.18 `<StaffRoute />` — the clearinghouse board's gate — `tests/component/staff-route.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-STF-001 | "sends a signed-out visitor to sign in" | `unauthenticatedElement`; no role lookup |
| CMP-STF-002 | "admits the platform admin without asking for a membership" | Outlet; no lookup |
| CMP-STF-003 | "admits a member of the agency" | Outlet |
| CMP-STF-004 | "turns away a signed-in user with no membership" | Redirect to `/` |
| CMP-STF-005 | "says so when the role cannot be read, rather than guessing either way" | Alert; no outlet |
| CMP-STF-006 | "waits while sign-in is still being checked" | Neither outlet nor redirect |
| CMP-STF-007 | "turns away a membership answer of %s, never rendering the outlet" (3 cases: empty string, `superuser`, `Staff`) | Redirect to `/`; no outlet |
| CMP-STF-008 | "alerts, never renders the outlet, when the membership answer is undefined" | Alert; no outlet |
| CMP-STF-009 | "turns away a signed-in user who has no id, without asking" | Redirect to `/`; no lookup |
| CMP-STF-010 | "does not take %s on the user for the platform admin" (3: `ADMIN`, no role, `owner`) | One lookup, then redirect to `/`; no outlet |
| CMP-STF-011 | "does not let one user's role reach the next user who signs in" | Second user never sees the outlet; two lookups |

### 4.19 `<MaslekaBoard />` — the staff board — `tests/component/masleka-board.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKB-001 | "lays the requests out by status, with the third column empty until PR B" | Each name in its region; empty-state text in "הושלם" |
| CMP-MSKB-002 | "says when the files should be ready, and how long the clearinghouse keeps them" | Readiness and deletion labels per card |
| CMP-MSKB-003 | "reports a list that failed to load" | Alert text |
| CMP-MSKB-004 | "copies the ID to the clipboard, revealing it only on the click" | No reveal before the click; `writeText('000000018')`; "הועתק ✓" |
| CMP-MSKB-005 | "falls back to a selected field when there is no clipboard" | Read-only field with the value; "העתק ידנית" |
| CMP-MSKB-006 | "falls back when the browser refuses the clipboard" | Read-only field with the value |
| CMP-MSKB-007 | "hides a manually-copied value when asked" | Value gone after "הסתר" |
| CMP-MSKB-008 | "clears a manually-copied value after a minute" | `REVEAL_MS` is 60 000; value still shown at 59 s, gone at 60 s |
| CMP-MSKB-009 | "clears a manually-copied value on the next click elsewhere, but not on a click in its field" | A click in the field keeps it; a click on the heading clears it |
| CMP-MSKB-010 | "shows one value at a time: revealing another client's clears the first" | The second client's field shown; the first client's gone |
| CMP-MSKB-011 | "drops a value that arrives after a newer reveal was asked for" | A slower answer for the first click never reaches the screen |
| CMP-MSKB-012 | "copies nothing when a value arrives after the board is gone" | Unmounted before the answer: `writeText` never called |
| CMP-MSKB-013 | "forgets a shown value once its row leaves the column, so it never comes back with the row" | Row moves to submitted and back on two refetches; value not shown again |
| CMP-MSKB-014 | "keeps the revealed value out of the query cache, storage, the console and the address" | Not in any query or mutation state, any storage write, any console call, `location.href` |
| CMP-MSKB-015 | "wipes on הגשתי only after asking first" | Declined confirm → nothing; accepted → `markSubmitted('r2')` and a refetch |
| CMP-MSKB-016 | "shows a second הגשתי as already submitted, not as an error, and refreshes the row" | `already_submitted` → `role="status"` "כבר סומן כהוגש", no alert; refetch (Ruling 18) |
| CMP-MSKB-017 | "tells a staff member whose access was removed" | Alert "ההרשאה שלך הוסרה" (`staffMessage`) |
| CMP-MSKB-018 | "words a failed list or a refused request in the staff vocabulary" | A forbidden list and an `invalid_email` create both say `staffMessage`'s text |
| CMP-MSKB-019 | "links to the clearinghouse portal in a new tab without a referrer" | `_blank`, `noopener noreferrer` |
| CMP-MSKB-020 | "creates a hand-made request and shows its link to copy" | `create` body; link shown; "נשלח במייל"; "פתיחת הקישור" opens it in a new tab, `noopener noreferrer` |
| CMP-MSKB-021 | "issues a fresh link for an invited client" | `relink('r1')`; new link shown, and "פתיחת הקישור" points at it |
| CMP-MSKB-022 | "drops a value still on its way when its row leaves the column" | The row leaves before the answer: never copied, never shown, no "הועתק ✓" when the row returns |
| CMP-MSKB-023 | "makes one הגשתי call for a double click that lands before the button is disabled" | Two clicks in one tick → one `markSubmitted`, one refetch |
| CMP-MSKB-024 | "clears an old failure when the next action starts" | A failed reveal's alert is gone once the next reveal succeeds |
| CMP-MSKB-025 | "takes a row's copied mark off at once when its הגשתי succeeds, even if the refetch fails" | "הועתק ✓" gone right after `markSubmitted('r2')`, with the refetch rejecting |
| CMP-MSKB-026 | "links a completed request to its analysis, and lists every stored report" | "לניתוח ולהמלצות" → `/admin/masleka/analysis/s7`; region "ניתוחים" lists a report with no request |
| CMP-MSKB-027 | "keeps the board working when the reports cannot be read" | A quiet "לא הצלחנו לטעון את הניתוחים."; the columns still work; no alert |
| CMP-MSKB-026 | "says a blank name is not valid, and sends nothing" | Whitespace-only name → alert "השם אינו תקין" (`staffMessage`); no `create` |
| CMP-MSKB-027 | "says so when the invitation e-mail was asked for but not sent" | `invited: false` with an address given → "המייל ללקוח לא נשלח"; not "נשלח במייל" |

### 4.20 `<FloatingHeader />` — the clearinghouse board link, switched on — `tests/component/floating-header-masleka.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKH-001 | "links the admin to the board without asking for a membership" | "בקשות מסלקה" → `/admin/masleka`; no `myRole` call |
| CMP-MSKH-002 | "links a member of the agency to the board" | `myRole` → `staff`: link shown |
| CMP-MSKH-003 | "offers no board link to a signed-in client with no membership, or when the role cannot be read" | `myRole` → `null`, then rejecting: no link |
| CMP-MSKH-004 | "asks nothing for a signed-out visitor" | No link; no `myRole` call |

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

`BlogPost` over the Base44 mock (as in §blog-post-redirect); `framer-motion` stubbed.

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

## 5. Pass criteria

All 278 declared cases pass (vitest: 308 with expansions). A `submitLead` or `submitClaim` payload assertion failing
here is a contract break — cross-check [STD-03](03-std-contract.md) before
changing the test.
