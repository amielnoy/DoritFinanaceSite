# STD-07 — Mobile Web (iOS & Android)

**Suite:** `ui` (mobile block) · **Runners:** `npm run test:e2e:ios`, `npm run test:e2e:android`
**Location:** `e2e/ui/mobile.spec.ts` · **Cases:** 10 × 2 mobile platforms,
plus 2 desktop-only counterparts in the same file

---

## 1. Scope and a deliberate clarification

This repository contains **no native iOS or Android application** — it is a Vite
React SPA. "iOS" and "Android" here mean the **mobile web** experience, driven
through Playwright's device descriptors on the engine each platform actually
ships:

| Project | Engine | Device descriptor | Viewport | DPR | Touch |
|---|---|---|---|---|---|
| `ios-safari` | WebKit | iPhone 14 | 390 × 664 | 3 | yes |
| `android-chrome` | Chromium | Pixel 7 | 412 × 839 | 2.625 | yes |

WebKit is the engine behind Safari on iOS (and the only engine iOS permits), so
a WebKit run is a faithful check of iOS rendering and JS behaviour. It is **not**
a substitute for a real-device pass on installability, push, or Safari UI chrome
(address-bar resize, safe-area insets) — those need a device lab.

The block is tagged `@mobile-only`, and the two desktop projects carry
`grepInvert: /@mobile-only/` in `playwright.config.ts`, so it runs on exactly the
two mobile projects and the desktop ones never collect it. It used to be a
`test.skip(({ isMobile }) => !isMobile)` at the top of the describe. Playwright
runs that as a hook, allure-playwright reports every such skip as a failed hook,
and the Allure report carried 38 "Global Errors" reading "skip modifier failed:
Test is skipped: mobile projects only".

## 2. Test cases

| ID | Title | Steps | Expected result |
|---|---|---|---|
| E2E-MOB-001 | "renders one 64px sticky bar — לשיחה קצרה, WhatsApp, a call, support — instead of the desktop dock" | Load `/` | Exactly 4 links: "לשיחה קצרה" → `/#start`, WhatsApp → `wa.me/972508311776?text=…`, "חייגו" → `tel:+972508311776`, "תמיכה" → `/faq#support-chat`; the bar is 64px tall, the CTA the widest cell, all four centred in it and ≥44px tall; the desktop dock (`floating_dock`) hidden |
| E2E-MOB-001a | "each of the bar's three contact cells reports to GA4 from location mobile_sticky_bar" | Tap "לשיחה קצרה", WhatsApp and "חייגו" (navigation prevented) | `cta_click`, `click_whatsapp`, `click_phone` queued with `location: mobile_sticky_bar` |
| E2E-MOB-001b | "the sticky bar's לשיחה קצרה reaches the conversation from another route" | Load `/blog`, tap it | URL `/#start`, the section in view — a bare `#…` did nothing off home |
| E2E-MOB-001c | "a link to /#quick-contact opens the short form, which a phone otherwise keeps folded" | Load `/#quick-contact` | `#qc-name` visible; the "השארת פרטים" chip `aria-expanded=true` |
| E2E-MOB-001d | "nothing at the bottom of the page hides under the bar" | Load `/` and `/blog`, scroll to the end | The footer's last line ends at or above the bar's top (the page wrappers carry `pb-[calc(4rem+safe-area)]`) |
| E2E-MOB-002 | "the sticky bar stays pinned while scrolling" | Scroll to `#testimonials` | Call link still in viewport |
| E2E-MOB-003 | "opens and closes the burger menu and navigates from it" | Tap burger → tap "בלוג" | Drawer opens with a close button; navigation lands on `/blog` |
| E2E-MOB-004 | "the burger menu closes on Escape and on backdrop tap" | Tap burger, press Escape | Close button gone |
| E2E-MOB-005 | "no page scrolls horizontally on a phone viewport" | Load `/`, `/blog`, `/claims`, `/privacy`, `/accessibility`, `/faq` | `scrollWidth − clientWidth ≤ 1px` on every page |
| E2E-MOB-006 | "primary tap targets meet the 44px minimum" | Load `/` | The bar's four links, the burger, the hero's CTA / WhatsApp / "חיוג", the start chips (וואטסאפ, טלפון, השארת פרטים, צ'אט), a services accordion button, "עוד עליי", "לכל השאלות" and the footer's "ניווט באתר" each ≥44px on the long edge and ≥36px on the short edge (WCAG 2.5.5 / iOS HIG) |
| E2E-MOB-007 | "the phone keyboard gets the right input types" | Open the form from its "השארת פרטים" chip | Phone field `type=tel`, email field `type=email` |
| E2E-MOB-008 | "a visitor can submit the quick contact form by touch" | Tap "השארת פרטים", fill, tap submit | Form appears; confirmation shown; `submitLead` with `source: quick` |
| E2E-MOB-009 | "the calculator is usable on a narrow screen" | Scroll to `#fee-calculator`, set deposit | Field visible and editable; no `NaN` |
| E2E-MOB-009a | "the hero caption and phrase list stay aligned, even with enlarged text" | Load `/`; repeat at body zoom 1 and 1.3 (a phone's large-text setting) | `L-00107009` on one line; the six phrases are a list of 6 items, each with its own diamond, starting at exactly two right edges (two aligned columns) |
| E2E-MOB-009b | "every sticky-bar label fits on one line, even with enlarged text" | Load `/`, wait for `document.fonts.ready`; repeat at 390 and 360px wide, at body zoom 1 and 1.3 | The bar has 4 links; each label's text occupies exactly one line (distinct line tops of its text nodes = 1). Measured in the real, self-hosted fonts (A-74) |
| E2E-MOB-010 | "the viewport meta allows pinch-zoom" | Load `/` | `width=device-width` present; no `user-scalable=no` or `maximum-scale=1` |
| E2E-MOB-011 | "the page shows a short card, with the fence closed behind <details>" | Load `/faq`, scroll to `#support-chat` | Heading "לא מצאתם את התשובה?", one full-width "שאלו את העוזר" button (≥44px, `aria-expanded=false`), no message box; the section is under ¾ of a screen; the fence is in a closed `<details>` and reads word for word once opened |
| E2E-MOB-012 | "the chat opens full-screen, with room for its messages and one scroll" | Press "שאלו את העוזר", accept the notice, open the hand-off | A `dialog` named "העוזר של דורית" covering the viewport; `body` overflow hidden; the header is one row (title, "אוטומטי · לא דורית עצמה", hand-off, X — each ≥44px); the notice region >300px with checkbox and start button in view; after consent the messages area >50% of the viewport and the layer itself does not scroll; the message box in view at ≥16px; `chat_start` and `chat_handoff` (`method: ai_support`) queued for GA4 |
| E2E-MOB-013 | "Escape and the X close it, and focus goes back to the button" | Open, press Escape; open, press X | Layer gone, focus on "שאלו את העוזר", `aria-expanded=false`, page scroll unlocked |
| E2E-MOB-014 | "Tab stays inside the layer while it is open" | Open, press Tab/Shift+Tab 12 times | Focus never leaves the dialog and visits ≥3 controls (Safari's own Tab skips buttons, so the layer moves focus itself) |
| E2E-MOB-015 | "the heading is one short line, and the document title is the same as before" | Load `/faq` | The `<h1>` reads "שאלות ותשובות" on one line (<60px tall); the first question is on the first screen; `<title>` is still "שאלות ותשובות — פנסיה, גמל, ביטוח ומיסוי \| דורית גוב ארי" |
| E2E-MOB-016 | "the topics are a bar pinned under the header, scrolling sideways" | Load `/faq`; scroll 120px into the questions | The group "ניווט לפי נושא" holds ≥3 real `<button>`s, each ≥44px tall, on one line, `overflow-x: auto`, the first `aria-pressed=true`; scrolled, the bar's top is within 16px under the header's bottom |
| E2E-MOB-017 | "a topic chosen from the pinned bar starts at its heading, clear of the bar" | Scroll 150px into the questions, tap the second topic | It is `aria-pressed`; its `<h2>` lands below the bar's bottom edge and within 60px of it — not under the bar, not mid-list |
| E2E-MOB-018 | "the topics are reachable from the keyboard" | Focus the last topic, press Enter; on Chromium, Tab from the first | The last topic is focusable, scrolls fully inside the bar when focused, and Enter selects it; Tab moves from the first topic to the second (Chromium only: Safari's own Tab skips buttons) |
| E2E-MOB-019 | "opening a question leaves it where it was, and the one above stays open" | Open the first question; put the second 400px down the screen; open it | The second question's top moves ≤1px; both are `aria-expanded=true` (below md the accordion is `multiple`) |
| E2E-MOB-021 | "the hero: an 88px round portrait beside the licence line, a full-width CTA, WhatsApp and a call under it" | Load `/` at 390×844 | The plate is 88×88 with a radius, the licence line within its row, the `<h1>` below it; the CTA spans the column; WhatsApp and "חיוג" on one row under it, above the bar; `cta_click`, `click_whatsapp`, `click_phone` with `location: top`; the image fetched is the 480 file (`sizes` says 88px below md) |
| E2E-MOB-022 | "the carriers are one strip that scrolls sideways, and the keyboard reaches all of them" | Load `/` | 8 carrier links on one row, the strip `overflow-x: auto` and wider than the screen; the affiliation line under it visible; the last link, focused, is in view |
| E2E-MOB-023 | "about: one sentence, the three figures and the rest folded behind עוד עליי" | Scroll to `#about` | "ותיקה בתחומי הפיננסים…" visible; "שמי דורית גוב ארי…" hidden but present once; both pictures hidden; 30 / מאות / 1:1 visible; "עוד עליי" is a button with `aria-expanded="false"` — pressed, it shows the personal sentence in place and a "הסיפור המלא" link, pressed again it folds back; "הסיפור המלא" → `/perspective` |
| E2E-MOB-024 | "services: an accordion, the first open and the others closed, with the copy unchanged" | Load `/` | 5 `<h3><button aria-expanded>`; only the first open; closed descriptions hidden but in the document; opening the second keeps the first open and moves it 0px; it closes again |
| E2E-MOB-025 | "start: the form waits behind a chip row — וואטסאפ · טלפון · השארת פרטים · צ'אט" | Load `/` | `#quick-contact` and the old tiles hidden; the list "מעדיפים אחרת?" holds the four in order; "השארת פרטים" (`aria-controls=quick-contact`) opens the form right below and closes it; "צ'אט" (`aria-controls=interview-chat`) opens the interview chat; WhatsApp and phone queue `click_whatsapp` / `click_phone` with `location: start`, as the tiles did |
| E2E-MOB-026 | "the questionnaire: a tap on a single-choice answer moves on, and reports the step" | Tap answers on steps 1–3, pick on step 4, press "הקודם" | No "המשך" on single-choice steps, "דילוג על השאלה" instead; each tap moves on and the new heading has focus; `wizard_step` step_1..3 and one `wizard_start`; the track step keeps "המשך" and does not move on a pick; back keeps the answer and offers "המשך" |
| E2E-MOB-027 | "the questionnaire from the keyboard: arrows move between answers without leaving the step" | Space on a life stage; ArrowDown ×2 on the concerns; Enter | Space moves on; the arrows choose but stay on step 2; Enter moves on; `wizard_step` is step_1, step_2 only |
| E2E-MOB-028 | "common questions: the first four, and לכל השאלות to /faq" | Load `/` | 4 visible of 8 in the document; one opens; "לכל השאלות" → `/faq` |
| E2E-MOB-029 | "the footer: the menu folded into ניווט באתר, contact two to a row, the licence line in view" | Scroll to the footer | A closed `<details>` "ניווט באתר" whose links appear when opened; phone and WhatsApp on one row, ≥44px; the licence line and `L-00107009` visible |
| E2E-MOB-030 | "the home page stays under 7,000px — it was 10,260" | Load `/` at 390×844 | `scrollHeight` < 7000px (10,260 before stage 3) |
| E2E-MOB-020 | "עדיין מתלבטים? has its three buttons on one row, and each still reports to GA4" | Scroll to the CTA band; tap all three (navigation prevented) | "קביעת פגישה", "טלפון" and "WhatsApp" share one row inside the screen, each ≥44×44px, hrefs `/#start`, `tel:+972508311776`, `wa.me/972508311776`; `cta_click`, `click_phone` and `click_whatsapp` queued for GA4 with `location: faq` |

Stage 3 made the sticky bar 64px of four phone tabs — "לשיחה קצרה", WhatsApp,
a call and "תמיכה". Support keeps the cell it has had since A-64
(`E2E-SUP-002` still presses it on the phone projects), and the header menu
lists it as well, as "תמיכה — שאלה לעוזר" under שאלות ותשובות (CMP-HDR-009).
"השאירו פרטים" left the bar: the short form opens from the chip row under the
questionnaire, and `/#quick-contact` still opens it (E2E-MOB-001c).

### 2.1 The desktop half of the same switch

`mobile.spec.ts` also holds a `Desktop-only chrome` block, tagged
`@desktop-only` and filtered out of the two mobile projects the same way, so
each project collects only its own half: 36 cases on a phone, 4 on a desktop. A responsive swap
has two halves and only one of them is ever asserted by accident: hiding the
desktop dock on a phone while also hiding it on a desktop passes E2E-MOB-001
and ships a home page with no call-to-action above the fold. Those two cases
are specified as `E2E-DSK-001/002` in
[STD-06 §3.7](06-std-ui-e2e.md), with the rest of the desktop suite.

E2E-MOB-021–030 cover the home page below md (stage 3). At 390×844 it was
10,260px, 12.16 screens: a portrait taller than the screen under the hero, the
carriers in four rows, four paragraphs' worth of room for one about her, five
open service rows, the short form standing open under the questionnaire, eight
questions and a footer with a 280px photo and an open menu. Now: an 88px byline
over the headline, the CTA full width with WhatsApp and a call under it, one
sideways strip, one sentence and the figures (the rest folded behind
"עוד עליי"), an accordion, a chip row, four
questions with "לכל השאלות", and a footer whose menu folds ("ניווט באתר") and
whose photo is hidden below md — 6,590px, 7.81 screens (`playwright.measure.config.ts`).
The brief's 4.5 screens is not reached: `#proof` (898px) and `#testimonials`
(791px) were outside it and are unchanged. Folded content is hidden with CSS
or `hidden`, never left out, so the phone's document still carries what the
desktop's does (`mobile-parity.spec.ts`). From md up nothing changes —
`E2E-DSK-004` pins the desktop half, and the 1440 screenshots of `/` (top and
whole page) and `/faq` are byte-identical. The shared footer brings `/faq` from
3,148 to 2,522px (3.73 → 2.99 screens).

Prerendered pages are replaced, not hydrated: `#root` is full before any script
runs, so `gotoApp` returns before React has mounted, and a tap in between
reaches a node with no handler. The stage-3 cases (and `openQuickContact`, the
footer-menu and interview-chat helpers) wait for `waitForLive` — the selector's
node carrying React's fiber — before they press anything.

E2E-MOB-015–020 cover the rest of `/faq` below md. At 390×844 the page was
4.91 screens after E2E-MOB-011–014, and a screen and a half stood before the
first question: a kicker repeating the two-line heading, a 70px topics row the
visitor scrolled away from for good, and a contact box saying what the support
chat's card says right below it. Opening a question closed the one above it and
pulled the clicked question 168px up the screen. The heading is now one line
with a shorter intro (the `<title>` and description are unchanged), the topics
are a bar pinned under the header, the accordion opens without closing, the
contact box is hidden below md, and the CTA band's three buttons are one row:
3.73 screens, of which the site-wide footer is 1.72. From md up nothing
changes — `E2E-DSK-003` pins the desktop half, and the 1440 screenshots are
byte-identical.

E2E-MOB-011–014 replace, on a phone, the support chat that used to sit on
`/faq` in a fixed 560px box: at 390×844 its consent notice got 96px and its
conversation about 190px, between a header that wrapped one word per line and
the message box, and the box scrolled inside a page that scrolled too. The
desktop half is unchanged and still covered by E2E-AGT-006–008, which open the
layer first on the phone projects. `npx playwright test -c
playwright.measure.config.ts` prints the page and chat heights behind these
numbers; it is a measuring tape, not part of the suite.

## 3. Defect found by this suite

`E2E-MOB-006` failed on first run: the header's burger button was 38 × 38 px
(`p-2` around a 22 px icon), under the 44 px minimum. `FloatingHeader.tsx` now
uses `p-3` (46 px). See [10-known-issues](10-known-issues.md).

## 4. Not covered

Real-device gestures (pinch, long-press), iOS safe-area insets, address-bar
resize behaviour, PWA installability, push notifications, and native app
stores — none of which apply to this codebase today.

## 5. Pass criteria

All the mobile cases above pass on both `ios-safari` and `android-chrome`. The mobile
accessibility case (`A11Y-AXE-007`) in [STD-08](08-std-accessibility.md) also
runs only on these two projects.
