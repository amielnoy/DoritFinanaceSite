# STD-06 — UI End-to-End Tests

**Suite:** `ui` · **Runner:** `npm run test:e2e:ui` (Playwright)
**Location:** `e2e/ui/` · **Cases:** 41 desktop-relevant, run on all four platforms

---

## 1. Purpose

Exercise the journeys a visitor actually takes on the production build: land on
the page, read the sections, model their pension fees, submit one of the three
lead forms, read the blog, and navigate around — including when the backend is
broken.

## 2. Environment

The production bundle served by `vite preview`; the Base44 API and all
third-party beacons intercepted by `e2e/fixtures/app.ts`. Locale `he-IL`,
timezone `Asia/Jerusalem`.

## 3. Test cases

### 3.1 Landing page — `home.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-HOM-001 | "boots past the auth/bootstrap spinner and renders the page shell" | `#top` and `main` visible; no spinner; no console errors; public-settings requested |
| E2E-HOM-002 | "has the RTL Hebrew document contract search engines rely on" | `lang=he`, `dir=rtl`, title present, and the description is the home route's own (applied by `useSeo`, not the static one from `index.html`) |
| E2E-HOM-003 | "renders every top-level section of the landing page" | All 12 section ids present (`top`, `about`, `perspective`, `services`, `fee-calculator`, `quick-contact`, `proof`, `testimonials`, `faq`, `consultation`, `detailed-contact`, `common-questions`) |
| E2E-HOM-004 | "exposes exactly one h1 and a sane heading order" | One `h1`; no heading level skipped by more than one |
| E2E-HOM-005 | "renders the reviews pulled from the backend" | Stubbed testimonial name visible |
| E2E-HOM-006 | "survives a backend that is completely down" | All entity calls 500 → page still renders, `h1` visible, no `pageerror` |
| E2E-HOM-007 | "wires the primary CTAs to real targets" | Visible `#consultation` CTA; visible `tel:+972508311776` link |

### 3.2 Routing — `navigation.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-NAV-001..006 | "`<route>` renders without a client-side error" for `/`, `/blog`, `/claims`, `/privacy`, `/accessibility`, `/login` | Non-empty root, a visible heading, expected copy, zero console errors |
| E2E-NAV-007 | "an unknown path lands on the app's not-found page, not a blank screen" | Root non-empty |
| E2E-NAV-008 | "deep links are served by the SPA fallback with a 200" | `/blog` → 200 HTML |
| E2E-NAV-009 | "in-page anchors move the viewport to the right section" | `#services` in viewport after clicking the visible anchor |
| E2E-NAV-010 | "navigating between routes scrolls back to the top" | `scrollY < 50` after a route change (verifies `ScrollToTop`) |
| E2E-NAV-011 | "browser back returns to the previous route" | Back from `/blog` lands on `/` with `#top` visible |
| E2E-NAV-012 | "admin routes bounce an anonymous visitor to login" | `/admin/leads` → `/login` |

### 3.3 Pension fee calculator — `calculator.spec.ts`

| ID | Title | Steps | Expected result |
|---|---|---|---|
| E2E-CAL-001 | "shows the default scenario with a plausible result set" | scroll to `#fee-calculator` | ₪600,000 contributions, ₪12,000 deposit fees, balance > contributions, annual fees > 0 |
| E2E-CAL-002 | "recomputes live when the saver changes an input" | set deposit to 4000 | Contributions become ₪1,200,000; balance grows |
| E2E-CAL-003 | "higher management fees shrink the projected balance" | annual fee → 1.5% | Balance strictly lower |
| E2E-CAL-004 | "never renders NaN or ₪NaN when fields are cleared" | clear all five inputs | No `NaN`/`Infinity` on screen; no console errors |
| E2E-CAL-005 | "shrugs off absurd input instead of hanging the tab" | 120 years at 99% | No `NaN`; inputs still editable |
| E2E-CAL-006 | "its CTA points at the contact form" | — | `a[href="#quick-contact"]` visible |

### 3.4 Lead forms — `forms.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-FRM-001 | "keeps submit disabled until name and phone are filled" | Enabled only after both |
| E2E-FRM-002 | "submits, confirms, and sends the payload the backend expects" | Confirmation shown; `SendEmail` carries the name and phone; `Lead.create` gets `source: quick`, `status: new` |
| E2E-FRM-003 | "shows a recoverable error and a direct mail fallback when sending fails" | Error message; input preserved; button re-enabled |
| E2E-FRM-004 | "still records the lead when only the optional secondary copy fails" | Exactly one `POST /entities/Lead` |
| E2E-FRM-005 | "gates submission on service, message and the consent checkbox" | Submit stays disabled until all three are supplied |
| E2E-FRM-006 | "marks the chosen service as pressed for assistive tech" | `aria-pressed` flips false → true |
| E2E-FRM-007 | "sends a detailed lead with topic and timing" | `source: detailed`, `topic`, `timing` present |
| E2E-FRM-008 | "walks the three steps and books a consultation end to end" | Thank-you shown; `Lead.create` with `source: consultation`; function invoked with the six documented keys |
| E2E-FRM-009 | "lets the visitor step back without losing their answers" | "Continue" still enabled after going back |
| E2E-FRM-010 | "still confirms to the visitor when calendar booking fails" | Function 502 → visitor still sees the thank-you; the lead is still recorded |
| E2E-FRM-011 | "refuses to submit the wizard without a phone number" | Submit disabled; zero lead requests |

### 3.5 Blog — `blog.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-BLG-001 | "lists only published posts" | Draft title absent |
| E2E-BLG-002 | "filters server-side on the published flag" | Request carries `q = {"published":true}` |
| E2E-BLG-003 | "opens a post and renders its markdown body" | Heading, `##` subheading and list items rendered |
| E2E-BLG-004 | "shows a friendly not-found for a missing post" | "המאמר לא נמצא" plus a back link; no `pageerror` |
| E2E-BLG-005 | "share buttons point at real share endpoints" | ≥1 wa.me/facebook/linkedin/x link |
| E2E-BLG-006 | "degrades gracefully when the blog backend errors" | Root non-empty; no `pageerror` |

### 3.6 Desktop chrome — `mobile.spec.ts` (desktop projects only)

| ID | Title | Expected result |
|---|---|---|
| E2E-DSK-001 | "shows the floating WhatsApp/phone dock and hides the mobile bar" | Dock visible; sticky bar hidden |
| E2E-DSK-002 | "shows the full desktop nav rather than a burger" | Burger hidden; "שירותים" link visible |

## 4. Pass criteria

Every case passes on all four platforms. `E2E-DSK-*` runs only on the two
desktop projects; the mobile block is in [STD-07](07-std-mobile.md).
