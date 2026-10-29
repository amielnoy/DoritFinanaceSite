# STD-06 — UI End-to-End Tests

**Suite:** `ui` · **Runner:** `npm run test:e2e:ui` (Playwright)
**Location:** `e2e/ui/` · **Cases:** 87 in `e2e/ui`, of 199 across the whole e2e suite. CI runs `web-chromium` on a pull request, and `web-chromium` + `android-chrome` (two shards each) on `main`, nightly and on a manual run; `web-webkit` and `ios-safari` remain in `playwright.config` for a local run

---

## 1. Purpose

Exercise the journeys a visitor actually takes on the production build: land on
the page, read the sections, model their pension fees, submit one of the three
lead forms, read the blog, and navigate around — including when the backend is
broken.

## 2. Environment

The production bundle served by `vite preview`, built by `npm run build:e2e` with
production's configuration (`e2e/build-env.ts`: every port on Supabase, as the
composition root wires it, all four agents on the `chat` function; `VITE_MEETINGS_STAFF` on;
`VITE_MASLEKA_ENABLED` stays off for §3.10) and Supabase at
`https://supabase.e2e.invalid`, a host that never resolves. `e2e/fixtures/app.ts`
answers that host — PostgREST reads over seeded tables in Supabase row shape
(`e2e/fixtures/data.ts`), the Edge Functions per function, storage and auth — and
aborts the third-party beacons. A request it does not model, and any `/api` call
but the site's own Vercel functions and the Base44 SDK's telemetry, fails the
test at teardown. Locale `he-IL`, timezone `Asia/Jerusalem`.

Until 2026-10-18 the bundle was built with no Supabase, so every adapter fell
back to Base44 and the fixture stubbed Base44's `/api`; the cases below were
re-pointed at the Supabase path that day, case for case.

## 3. Test cases

### 3.1 Landing page — `home.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-HOM-001 | "boots past the auth/bootstrap spinner and renders the page shell" | `#top` and `main` visible; no spinner; no console errors; no `/auth/v1/` request (it read "public-settings requested" until 2026-10-18; Base44's bootstrap is gone) |
| E2E-HOM-002 | "has the RTL Hebrew document contract search engines rely on" | `lang=he`, `dir=rtl`, title present, and the description is the home route's own (applied by `useSeo`, not the static one from `index.html`) |
| E2E-HOM-003 | "renders every top-level section of the landing page" | All 7 section ids present (the default fixture carries testimonials, so `testimonials` is among them) (`top`, `about`, `services`, `start`, `quick-contact`, `testimonials`, `common-questions`); `proof` left with the Short home page, 2026-10-19 |
| E2E-HOM-004 | "exposes exactly one h1 and a sane heading order" | One `h1`; no heading level skipped by more than one |
| E2E-HOM-005 | "renders the reviews pulled from the backend" | `GET /rest/v1/testimonials` made; the seeded testimonial's name visible |
| E2E-HOM-008 | "leaves the testimonials section out when there are none" | Empty `testimonials` table → no `#testimonials`, no "לקוחות מספרים" heading, no `a[href$="#testimonials"]`; `#common-questions` still present |
| E2E-HOM-006 | "survives a backend that is completely down" | Every `/rest/v1/` read and every `/functions/v1/` call 500 → page still renders, `h1` visible, no `pageerror` |
| E2E-HOM-007 | "wires the primary CTAs to real targets" | Visible `#consultation` CTA; visible `tel:+972508311776` link |

### 3.2 Routing — `navigation.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-NAV-001..007 | "`<route>` renders without a client-side error" for `/`, `/blog`, `/claims`, `/faq`, `/privacy`, `/accessibility`, `/login` | Non-empty root, a visible heading, expected copy, zero console errors |
| E2E-NAV-008 | "an unknown path lands on the app's not-found page, not a blank screen" | Root non-empty |
| E2E-NAV-009 | "deep links are served by the SPA fallback with a 200" | `/blog` → 200 HTML |
| E2E-NAV-010 | "in-page anchors move the viewport to the right section" | `#services` in viewport after clicking the visible anchor |
| E2E-NAV-011 | "the main menu reaches a home section from another route" | From `/blog`, the header's `שירותים` lands on `/#services` with the section in view |
| E2E-NAV-012 | "the footer reaches a home section from another route" | From `/blog`, the footer's `אודות` lands on `/#about` with the section in view |
| E2E-NAV-013 | "no link anywhere points at a section the page does not have" | On every public route, every `a[href^="#"]` resolves to an element on that route — the skip link's `#main` included, which is why every page's `<main>` is `id="main"` (`tests/contract/main-landmark.contract.test.ts`) |
| E2E-NAV-014 | "every internal link lands on a real route, not the not-found page" | Every internal `href` collected from the home page renders a `#main` and no `data-testid="not-found"`. It looked for a heading named "404", which stopped existing with the English template (D-04); a test id does not change with the wording |
| E2E-NAV-015 | "every link in the footer menu goes where its label says" | All seven footer nav links, clicked from `/blog`, reach their documented URL (the `#start` link reads "לשיחה קצרה") |
| E2E-NAV-016 | "navigating between routes scrolls back to the top" | `scrollY < 50` after a route change (verifies `ScrollToTop`) |
| E2E-NAV-017 | "browser back returns to the previous route" | Back from `/blog` lands on `/` with `#top` visible |
| E2E-NAV-018 | "admin routes bounce an anonymous visitor to login" | `/admin/leads` → `/login` |

**Why five of these are about links.** Dead navigation has shipped more than
once, and it is the failure mode least likely to be noticed: every section this
site links to with a `#hash` lives on the home page, while the header and footer
render on all seven routes. A bare `#about` on `/blog` sets the URL to
`/blog#about`, matches no element, and does nothing — no error, no console
warning, no visible change. It was fixed in the header and left in the footer,
which carries the larger menu.

E2E-NAV-011/012 pin the two menus by behaviour. E2E-NAV-013/014 are the general
forms — an anchor naming a section that is not on the page, and a link naming a
route that is not registered — so the next one is caught without anybody having
to think of it. All four were confirmed to fail against the unfixed code before
being committed.

### 3.3 Pension fee calculator — `calculator.spec.ts`

| ID | Title | Steps | Expected result |
|---|---|---|---|
| E2E-CAL-001 | "shows the default scenario with a plausible result set" | scroll to `#fee-calculator` | ₪600,000 contributions, ₪12,000 deposit fees, balance > contributions, annual fees > 0 |
| E2E-CAL-002 | "recomputes live when the saver changes an input" | set deposit to 4000 | Contributions become ₪1,200,000; balance grows |
| E2E-CAL-003 | "higher management fees shrink the projected balance" | annual fee → 1.5% | Balance strictly lower |
| E2E-CAL-004 | "never renders NaN or ₪NaN when fields are cleared" | clear all five inputs | No `NaN`/`Infinity` on screen; no console errors |
| E2E-CAL-005 | "shrugs off absurd input instead of hanging the tab" | 120 years at 99%; then ₪1,000,000 a month and 100% fees, leaving each field | No `NaN`; inputs still editable; on leaving, each field shows its ceiling — ₪50,000, 15%, 3%, 50 years, 15% (D-15) |
| E2E-CAL-006 | "its CTA points at the contact form" | — | `a[href="/#start"]` visible |
| E2E-CAL-007 | "the fee calculator offers Dorit's check on WhatsApp, its result written in, and counts it once" | open /tools; wait 2 s; type into the deposit, then 3000; press the box's button (navigation prevented) | Box heading, "not advice" line and the calculator's disclaimer visible; `wa.me/972508311776?text=` with "לאורך 25 שנות חיסכון"; no `calculator_result` for the defaults; exactly one `{tool: fee_calculator}` after typing, no digit in any queued parameter; the message now says 3,000; `click_whatsapp` with `location: calculator` |
| E2E-CAL-008 | "the insurance self-check ends with the same box, its result in the message, counted once" | answer the four questions | No box before; then the box, a message listing "…סוגי ביטוח לבחון: …ביטוח חיים…"; both disclaimers visible; `calculator_result` tools are exactly `[insurance_assessment]` |

E2E-CAL-009 (`@mobile-only`, phone projects) is in [STD-07](07-std-mobile.md).

### 3.4 Lead form — `forms.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-FRM-001 | "names what's missing instead of silently disabling submit" | Submit stays enabled; each send names what is missing — both fields, the phone, then a phone Dorit could not call back (`abc`, D-01); the alert clears once both are valid |
| E2E-FRM-002 | "submits, confirms, and sends the payload the backend expects" | Confirmation shown; the `POST /functions/v1/submit-lead` body carries the name and phone and `source: quick` |
| E2E-FRM-003 | "shows a recoverable error and a direct mail fallback when sending fails" | `submit-lead` 500 → error message; input preserved; button re-enabled |
| E2E-FRM-004 | "still records the lead when only the optional secondary copy fails" | Exactly one `POST /functions/v1/submit-lead` |

**Why this section shrank.** `E2E-FRM-005..011` covered a detailed contact form
and a three-step consultation builder. Both were deleted from the site: the
home page offered five separate ways to send the same name and phone number,
and those were two of them. The interview agent in `#start` does that work now,
with the short form beside it for anyone who would rather not chat — so the
cases went with the components, not with a decision to stop testing them. The
`detailed` and `consultation` values still exist in `src/services/ports.ts`
because the backend still accepts leads recorded under them.

### 3.5 Claim submission — `claim.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-CLM-001 | "every control on the form has an accessible name" | Every input, select and file control is reachable by name |
| E2E-CLM-002 | "refuses to submit without a name and phone" | Submit disabled; no `/functions/v1/submit-claim` request |
| E2E-CLM-003 | "reports an event and confirms to the visitor" | `POST /functions/v1/submit-claim` carrying what was typed; confirmation shown |
| E2E-CLM-004 | "keeps the report on screen and offers a fallback when the backend fails" | `submit-claim` 500 → typed report preserved; direct contact offered |
| E2E-CLM-005 | "does not file two reports on a double click" | Exactly one `submit-claim` call |
| E2E-CLM-006 | "keeps documents in the browser until the report is sent, and turns away the wrong ones" | An `.exe` is named and left out, a PDF is listed, no upload until send; then one upload to `/storage/v1/object/claim-documents/` and `documents` of one, the object's path (`storage:claim-documents/…receipt.pdf`), never a link (D-02) |

### 3.6 Blog — `blog.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-BLG-001 | "lists only published posts" | Draft title absent |
| E2E-BLG-002 | "filters server-side on the published flag" | `GET /rest/v1/blog_posts` carries `published=eq.true` and `order=created_at.desc` (it read `q = {"published":true}`, Base44's filter, until 2026-10-18) |
| E2E-BLG-003 | "opens a post and renders its markdown body" | Heading, `##` subheading and list items rendered |
| E2E-BLG-004 | "shows a friendly not-found for a missing post" | "המאמר לא נמצא" plus a back link; no `pageerror` |
| E2E-BLG-005 | "share buttons point at real share endpoints" | ≥1 wa.me/facebook/linkedin/x link |
| E2E-BLG-006 | "degrades gracefully when the blog backend errors" | `blog_posts` read 500 → root non-empty; no `pageerror`; a `role="alert"` "לא הצלחנו לטעון את המאמרים" with "לנסות שוב", and no "עדיין אין מאמרים" (D-09) |
| E2E-BLG-007 | "the first article is on the first screen and a half" (375×812) | First `article-card` (the featured one, seeded) starts < 1,250px from the top; it was ~2,300px before the redesign |
| E2E-BLG-008 | "the prerendered list does not jump when the app takes over" (Chromium projects; layout-shift entries are Chromium's alone) | Cumulative layout shift, observed from the first paint to a second after the cards appear, is < 0.1. It was 0.444 on production and 0.18 here before the fix (D-06) |

### 3.7 Desktop chrome — `mobile.spec.ts` (desktop projects only)

| ID | Title | Expected result |
|---|---|---|
| E2E-DSK-001 | "shows the floating WhatsApp/phone dock and hides the mobile bar" | Dock visible; sticky bar hidden. The dock holds a third button since A-64, support — see §3.9 |
| E2E-DSK-002 | "shows the full desktop nav rather than a burger" | Burger hidden; "שירותים" link visible |
| E2E-DSK-004 | "keeps its portrait, its open services, its standing form, its testimonials grid and its open footer menu" (`/`) | The hero plate >300px tall, no hero "חיוג", "לצפייה בשירותים" visible; no `aria-expanded` in `#services` and every description visible; `#qc-name`, "עדיף לי בוואטסאפ" and "לשיחה עם העוזר" visible, the "השארת פרטים" chip hidden; a chosen life stage waits for "המשך"; 2 testimonials, no "ההמלצה…" buttons and no scrolling region in `#testimonials`; "לכל השאלות" visible in `#common-questions`, no `<details>` in the footer; the footer's quote and "התכנון שלי — השקט שלך" visible — the desktop half of E2E-MOB-021–034 |
| E2E-DSK-003 | "keeps its sidebar, its contact box and its one-open-at-a-time questions" (`/faq`) | "ניווט לפי נושא" and the "לא מצאתם תשובה?" box with "יצירת קשר" → `/#start` visible; opening a second question closes the first; the CTA band shows the phone number, not the phone-only "טלפון" label — the desktop half of E2E-MOB-015–020 |

### 3.8 Agent chat — regulatory shell — `agent-compliance.spec.ts`

The chat widgets are driven by prompts, and a prompt is a request to a model.
These ten cases cover only what the shell enforces regardless of what the
model does — the part that is a gate rather than an instruction. Every chat here
is served by the `chat` Edge Function (one POST to `/functions/v1/chat` per
message), and the hand-off goes to `/functions/v1/escalate-to-human` — as in
production since 2026-10-14; until 2026-10-18 the e2e build ran them on Base44.

| ID | Title | Expected result |
|---|---|---|
| E2E-AGT-001 | "a visitor cannot type before accepting the consent notice" | Message box disabled with the "יש לאשר את ההסכמה" placeholder; **zero** requests to `/functions/v1/chat`; accepting the notice enables the box |
| E2E-AGT-002 | "the notice discloses the bot, the licence and the data collected" | "עוזר אוטומטי", `L-00107009`, the marketing-not-advice line, the ban on typing an ID number, and a link to `/privacy` all visible |
| E2E-AGT-003 | "the fence is published beside the interview agent" | The tagline and the כללי הגדר block (what it does / does not do / when it hands over) visible in `#interview` |
| E2E-AGT-004 | "a standing disclaimer sits under every message box" | The "אינו ייעוץ, שיווק פנסיוני או המלצה אישית" line visible in all three sections |
| E2E-AGT-005 | "the route to a person works without the model, and before consent" | Handoff button present on first frame; pressing it POSTs the name and phone to `/functions/v1/escalate-to-human`; phone and WhatsApp links render even though the visitor never consented and no conversation exists |
| E2E-AGT-006 | "a visitor cannot type before accepting the notice" (support) | The support chat on `/faq` gates the same way: box disabled, **zero** requests to `/functions/v1/chat`, accepting unlocks it. On the phone projects E2E-AGT-006–008 first open the chat from the card ("שאלו את העוזר"), where it is a full-screen layer — see E2E-MOB-011–014 |
| E2E-AGT-007 | "the notice describes this chat and not the interview" | The support notice states the conversation itself is kept and why; the interview's "נאספים שם וטלפון בלבד" is **absent**; the licence and affiliation still present |
| E2E-AGT-008 | "the route to a person is here too" | The handoff button on `/faq` POSTs to `/functions/v1/escalate-to-human` |
| E2E-AGT-009 | "a refused conversation gives the visitor their message back" | The first message reaches `/functions/v1/chat` (agent `needs_interview`, the text typed) and is answered 401 `Invalid API key`, as the gateway answers a key it does not accept. The chat says so with `HUMAN_HANDOFF.failure` and the direct phone link — on the chat function an unavailable agent hands over the channels (AgentChat's `showChannelsOnly`), where Base44's path said "לא הצלחתי לשלוח את ההודעה כרגע" (the check until 2026-10-18) — and the typed text is still in the box |
| E2E-AGT-010 | "the direct channels appear even when the escalation itself fails" | With `/functions/v1/escalate-to-human` stubbed 500, the phone and WhatsApp links still render |
| E2E-AGT-011 | "a visitor who will not leave a number still gets hers, and nobody is paged" | "רק הפרטים של דורית" shows the phone link; zero `escalate-to-human` calls |
| E2E-AGT-012 | "sending with no number asks for one instead of paging her empty-handed" | A name and no phone → an alert asking for "מספר טלפון"; zero `escalate-to-human` calls (A-55) |

E2E-AGT-009 and E2E-AGT-010 are the first cases anywhere to exercise a failing
chat call. The `catch` in `AgentChat.send()` had never once executed under
test — which is how a total backend outage came to be reported in the same words
as a bad moment on the train (A-42), and how a failed send came to erase what
the visitor had written: their own message reaches the transcript only by way of
the server echoing it back, so on failure it was nowhere at all.

E2E-AGT-006 and E2E-AGT-007 exist because the failure they catch is
invisible. A chat that kept
its transcript while showing the interview's notice would look entirely correct
— it is a real consent notice, precisely describing a different chat — and
consent to processing that does not happen is not consent to the processing that
does.

### 3.8a Support chat entry points — `support-entry.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-SUP-001 | "the header menu lists שאלות ותשובות and it opens the page" | From `/blog`, the item reaches `/faq` (the drawer on a phone) |
| E2E-SUP-002 | "the support button lands on the chat, not the top of the page" | Dock (desktop) or sticky bar (phone) → `/faq#support-chat`, the chat's heading in view |
| E2E-SUP-003 | "pressed again on /faq, it still brings the chat back into view" | Desktop: scrolled away, the dock button scrolls back |
| E2E-SUP-004 | "the desktop dock's support button is click_chat from floating_dock" | Desktop only: queued `click_chat` is exactly `[{location: floating_dock}]` |
| E2E-SUP-005 | "on a phone: the sticky bar, the header menu and the card's button each report where they were" | Phone only: `click_chat` from `mobile_sticky_bar`, then `header_menu`, then `{location: support-chat, method: ai_support}` with the layer open — three in all |

### 3.9 Personal area — `account.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-ACC-001 | "bounces an anonymous visitor to login, remembering /account as the return target" | `/account` without a session ends on `/login?returnTo=/account` |

The signed-in path is covered by the component cases CMP-ACC-*: the e2e fixture
answers `/auth/v1/user` with 401 unconditionally and has no session path (no
`/auth/v1/token`). Giving it one is a separate change.

### 3.10 Clearinghouse, dark — `masleka.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-MSK-001 | "the client page says the service is unavailable, offers no form, and is not indexed" | Opening `/masleka#t=<43 characters>` shows the heading "השירות אינו זמין כרגע" and no `form`; the URL ends exactly `/masleka` (no fragment, so the token is out of the address bar); `meta[name=robots]` contains `noindex`; no `/functions/v1/` request is made |
| E2E-MSK-002 | "the staff board does not exist in a dark build" | `/admin/masleka` renders the not-found page (`data-testid="not-found"`) |

The enabled flow is covered in-process (CMP-MSK-*, the `INT-MSK*` cases); an
e2e of one request end to end needs the switch on in a test build and belongs
to PR B. Run once with `VITE_MASLEKA_ENABLED=true` the two cases above must
fail (the page asks for the link; the board exists) — that is how they are
known to bite.

### 3.11 Agency content — `agency-content.spec.ts`

The e2e build has `VITE_AGENCY_CONTENT=true` (CTR-E2E-002). Each case renders a page twice: from agency 1's rows as the seed writes them (`e2e/fixtures/agency1-seed.ts`), and with `public_agency_sites` refused (503), which falls back to the bundled constants. Both full-page screenshots must be byte-identical and `body` HTML equal (R9). Reduced motion; skipped against a deployment, whose stubs are unreachable.

| ID | Title | Expected result |
|---|---|---|
| E2E-AGC-001 | "/ from the seeded rows matches the bundled fallback" | Same PNG and `body` HTML; `public_agent_cards` was requested |
| E2E-AGC-002 | "/perspective from the seeded rows matches the bundled fallback" | As above |
| E2E-AGC-003 | "/privacy from the seeded rows matches the bundled fallback" | As above |
| E2E-AGC-004 | "/poa.html is the same page whatever the database answers" | A static file (R4): identical |
| E2E-AGC-005 | "a value changed in the database reaches the page" | The footer shows `050-000-0000` when the site row says so; without this the gate could pass on a page that never shows a database value |

Runs on `web-chromium` and `android-chrome`. Before the user turns the flag on, this spec is run on a preview built with it.

## 4. Pass criteria

Every case passes on every project CI runs (`web-chromium`, `android-chrome`)
and locally on all four. `E2E-DSK-*` runs only on the desktop projects; the mobile block is in [STD-07](07-std-mobile.md).
