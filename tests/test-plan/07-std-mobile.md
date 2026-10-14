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
| E2E-MOB-001 | "renders the sticky call/consult bar instead of the desktop dock" | Load `/` | Sticky bar shows `tel:+972508311776` and `/#quick-contact`; desktop WhatsApp dock hidden |
| E2E-MOB-001b | "the sticky bar's השאירו פרטים reaches the form from another route" | Load `/blog`, tap it | URL `/#quick-contact`, the form in view — a bare `#…` did nothing off home |
| E2E-MOB-002 | "the sticky bar stays pinned while scrolling" | Scroll to `#testimonials` | Call link still in viewport |
| E2E-MOB-003 | "opens and closes the burger menu and navigates from it" | Tap burger → tap "בלוג" | Drawer opens with a close button; navigation lands on `/blog` |
| E2E-MOB-004 | "the burger menu closes on Escape and on backdrop tap" | Tap burger, press Escape | Close button gone |
| E2E-MOB-005 | "no page scrolls horizontally on a phone viewport" | Load `/`, `/blog`, `/claims`, `/privacy`, `/accessibility`, `/faq` | `scrollWidth − clientWidth ≤ 1px` on every page |
| E2E-MOB-006 | "primary tap targets meet the 44px minimum" | Load `/` | Sticky call, sticky consult and the burger each ≥44px on the long edge and ≥36px on the short edge (WCAG 2.5.5 / iOS HIG) |
| E2E-MOB-007 | "the phone keyboard gets the right input types" | Scroll to `#quick-contact` | Phone field `type=tel`, email field `type=email` |
| E2E-MOB-008 | "a visitor can submit the quick contact form by touch" | Tap and fill, tap submit | Confirmation shown; `Lead.create` with `source: quick` |
| E2E-MOB-009 | "the calculator is usable on a narrow screen" | Scroll to `#fee-calculator`, set deposit | Field visible and editable; no `NaN` |
| E2E-MOB-009a | "the hero caption and phrase list stay aligned, even with enlarged text" | Load `/`; repeat at body zoom 1 and 1.3 (a phone's large-text setting) | `L-00107009` on one line; the six phrases are a list of 6 items, each with its own diamond, starting at exactly two right edges (two aligned columns) |
| E2E-MOB-009b | "every sticky-bar label fits on one line, even with enlarged text" | Load `/`, wait for `document.fonts.ready`; repeat at body zoom 1 and 1.3 | The bar has 3 links; each label's text occupies exactly one line (distinct line tops of its text nodes = 1). Measured in the real, self-hosted fonts (A-74) |
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
| E2E-MOB-020 | "עדיין מתלבטים? has its three buttons on one row, and each still reports to GA4" | Scroll to the CTA band; tap all three (navigation prevented) | "קביעת פגישה", "טלפון" and "WhatsApp" share one row inside the screen, each ≥44×44px, hrefs `/#start`, `tel:+972508311776`, `wa.me/972508311776`; `cta_click`, `click_phone` and `click_whatsapp` queued for GA4 with `location: faq` |

The sticky bar has a third cell since A-64, "תמיכה", which goes to the support
chat on `/faq`. It is exercised on the phone projects by `E2E-SUP-002` in
[STD-06 §3.9](06-std-ui-e2e.md), and the consultation keeps the widest column
(`1fr 1.5fr 1fr`).

### 2.1 The desktop half of the same switch

`mobile.spec.ts` also holds a `Desktop-only chrome` block, tagged
`@desktop-only` and filtered out of the two mobile projects the same way, so
each project collects only its own half: 22 cases on a phone, 3 on a desktop. A responsive swap
has two halves and only one of them is ever asserted by accident: hiding the
desktop dock on a phone while also hiding it on a desktop passes E2E-MOB-001
and ships a home page with no call-to-action above the fold. Those two cases
are specified as `E2E-DSK-001/002` in
[STD-06 §3.7](06-std-ui-e2e.md), with the rest of the desktop suite.

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
