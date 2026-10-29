# Manual Test Plan

The manual checks for govari-fin.co.il and its admin area: what a person does in a
browser that the automated suites (01–14) do not, or cannot, do. It follows a
generic web-application checklist, cut down to what this site has — a public
Hebrew site that takes enquiries, a personal area for clients, and an admin area
for the agency's Owner, Admins and Users.

Do not run every case on every release. Pick by risk (section 6): the smoke set
after every deploy, the area a change touched, and the retest of any defect it
claims to fix.

Case IDs are `MAN-<AREA>-<NNN>`. The last section is the log of each run.

---

## 1. Environments and safety rules

| Env | What it is | What may be done there |
|---|---|---|
| **PROD** | https://govari-fin.co.il | **Read only.** Browse, click links, check layout, headers, SEO and accessibility. Never submit a form, send a chat message, report a claim or sign in as staff: every write is a real lead, a real mail to Dorit and a row in her sheet. |
| **LOCAL** | `npm run build:e2e`, then `npx vite preview --host 127.0.0.1 --port 4173`, driven through `e2e/fixtures/app.ts` | Everything a visitor does. Supabase is a fake answered in the browser; nothing leaves the machine. |
| **PREVIEW** | The Vercel preview of a PR, signed in with a staff test account | Admin and personal-area flows on real screens. Use test leads only (name starts with "בדיקה"), and delete them afterwards. |
| **DESIGN** | A local render of a screen with sample data | Layout, theme, contrast and keyboard checks of a screen whose data needs a sign-in. |

Test data: names start with "בדיקה", phones are `050-1234567`, mail is
`test@example.com`. Never use a real person's details.

## 2. Roles

| Role | Where | How to get it |
|---|---|---|
| Visitor | public pages | anonymous |
| Client | `/account` | signed in, no membership |
| User | `/admin/leads` (own leads only), blog, users | agency membership `user` |
| Admin | + assign, delete, the unassigned queue | membership `admin` |
| Owner | + `/admin/agency`, the "מעקב לידים" tab | membership `owner` |
| Operator | `/account` admin home, every agency | `profiles.role = 'admin'` |

---

## 3. Functional cases

### 3.1 Authentication (`/login`)

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-AUT-001 | Open `/login` | "ברוכים השבים", Google button, email and password, "כניסה"; `noindex` | PROD | P1 |
| MAN-AUT-002 | Wrong password, then a malformed email | A clear Hebrew error; no hint whether the address exists | PREVIEW | P1 |
| MAN-AUT-003 | Sign in, sign out from the admin sidebar | Lands on `/`; Back does not reopen the admin screen | PREVIEW | P1 |
| MAN-AUT-004 | Open `/admin/leads` signed out | Redirect to `/login?returnTo=/admin/leads`; after sign-in, back on the leads | PROD + PREVIEW | P1 |
| MAN-AUT-005 | Leave a signed-in tab idle past the session, then act | Asked to sign in again, nothing half-saved | PREVIEW | P2 |
| MAN-AUT-006 | Forgot password | The reset mail arrives and the link works once | PREVIEW | P2 |

### 3.2 Authorization and permissions

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-PRM-001 | A User opens `/admin/leads` | Only leads assigned to them; no assign column, no delete, no "לא שויכו" | PREVIEW | P1 |
| MAN-PRM-002 | An Admin | All leads, assign and delete, the unassigned queue; no "פרטי הסוכנות" | PREVIEW | P1 |
| MAN-PRM-003 | An Owner | Everything above plus "פרטי הסוכנות" and the "מעקב לידים" tab | PREVIEW | P1 |
| MAN-PRM-004 | A User types `/admin/agency` or `?tab=tracking` | Refused or falls back to "פניות"; nothing of the Owner's shows | PREVIEW | P1 |
| MAN-PRM-005 | Someone in two agencies switches agency | Lists, counts and links follow `?agency=`; no row of the other agency | PREVIEW | P1 |
| MAN-PRM-006 | A client opens `/account` | Only their own enquiries, meetings and documents | PREVIEW | P1 |

### 3.3 Forms and validation

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-FRM-001 | Quick contact (`#quick-contact`), name of spaces only | "נא למלא שם מלא."; nothing sent | LOCAL | P1 |
| MAN-FRM-002 | Phones: `+972 50-123-4567`, `050 123 4567`, `03-1234567` / `1234`, `abcdefghij`, `0501234567890` | First three accepted; the rest refused with "מספר הטלפון לא נראה תקין" | LOCAL | P1 |
| MAN-FRM-003 | Email `abc@` with a valid name and phone | Refused before sending | LOCAL | P2 |
| MAN-FRM-004 | Markup, quotes and emoji in name and message | Sent as plain text; nothing rendered as HTML, no script runs | LOCAL | P1 |
| MAN-FRM-005 | A 6,000-character message | A stated limit, or accepted and stored whole | LOCAL | P3 |
| MAN-FRM-006 | Double-click "שליחת הודעה" | One request, one lead | LOCAL | P1 |
| MAN-FRM-007 | A slow backend (3 s) | Button disabled with a spinner until the answer | LOCAL | P2 |
| MAN-FRM-008 | Keyboard only: type, Tab, Enter | Enter sends the form, or shows what is missing | LOCAL | P2 |
| MAN-FRM-009 | Claim report (`/claims`): required fields, a wrong file type, a file over the limit, then a valid one | Clear refusals; documents stay in the browser until the report is sent | LOCAL | P1 |
| MAN-FRM-010 | Pension check (`/pension-check`) and the interview in `#start` | Every question reachable; the close lands as one lead | LOCAL | P1 |
| MAN-FRM-011 | "פנייה חדשה" in the admin (Owner) | Required fields, a repeated phone flagged as "כפילות אפשרית" | PREVIEW | P2 |

### 3.4 Data management in the admin (`/admin/leads`)

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-DAT-001 | Change a test lead's status | Saved; survives a refresh; the counts and tiles update | PREVIEW | P1 |
| MAN-DAT-002 | Assign and unassign a lead | The assignee sees it; "לא שויכו" moves by one | PREVIEW | P1 |
| MAN-DAT-003 | Delete a test lead with a meeting | The confirmation names the meetings; both tabs lose it | PREVIEW | P1 |
| MAN-DAT-004 | Each filter pill and summary tile | The table and "N פניות להצגה" match the pill's count | PREVIEW / DESIGN | P1 |
| MAN-DAT-005 | Add, move and cancel a meeting from the lead drawer | The agenda, the KPI cards and the client's `/account` agree | PREVIEW | P1 |
| MAN-DAT-006 | Blog admin: draft, publish, unpublish an article | The public `/blog` follows; the slug stays the same | PREVIEW | P2 |

### 3.5 Business rules

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-BIZ-001 | Fee calculator on `/tools` with 0, empty, very large and negative values | No NaN, no freeze; a larger fee lowers the balance | LOCAL / PROD | P2 |
| MAN-BIZ-002 | Year-end page `/atzmaim-31-12` in December and in January | The dates and the deadline are right for the tax year | PROD | P2 |
| MAN-BIZ-003 | Meeting times around midnight and the clock change | Israel time everywhere: page, mail and calendar | PREVIEW | P1 |
| MAN-BIZ-004 | A backend-written status (escalated, partial) | Shown with its label, not offered as a choice | PREVIEW | P2 |

### 3.6 Navigation and routing

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-NAV-001 | Every header, footer and sticky-bar link | Lands on a real page or section; no 404 | PROD | P1 |
| MAN-NAV-002 | An unknown path | Status 404, the Hebrew not-found page, `noindex` | PROD | P1 |
| MAN-NAV-003 | Refresh on a nested route (`/blog/<slug>`, `/admin/masleka/guide`) | The same page, not the home page | PROD / PREVIEW | P2 |
| MAN-NAV-004 | Back and forward across three routes | The right page, scrolled to the top | PROD | P2 |
| MAN-NAV-005 | The admin breadcrumb and sidebar | The current page marked in both | DESIGN / PREVIEW | P2 |

### 3.7 Downloads, notifications, integrations

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-INT-001 | "ייצוא מסונן" and "ייצוא הכל ל-CSV" | Opens in Excel with Hebrew intact; the filtered file has only the filtered rows | PREVIEW | P2 |
| MAN-INT-002 | A test lead on PREVIEW | Dorit's mail, the sheet row and the visitor's confirmation all arrive once | PREVIEW | P1 |
| MAN-INT-003 | WhatsApp, phone and mail links | The right number and prefilled text | PROD | P1 |
| MAN-INT-004 | Google sign-in | Comes back signed in to the page asked for | PREVIEW | P1 |
| MAN-INT-005 | Insurer links on the home page | All answer | PROD | P3 |
| MAN-INT-006 | Clearinghouse link `/masleka` with no or a wrong token | "הקישור חסר או שגוי", `noindex` | PROD | P2 |

### 3.8 Errors, storage and language

| ID | Check | Expected | Env | Pri |
|---|---|---|---|---|
| MAN-ERR-001 | Send while offline or with the backend down | A Hebrew error with a way out (mail address); the fields keep their values | LOCAL | P1 |
| MAN-STO-001 | `/?internal=1`, then `/?internal=0` | `ga_internal_user` set, then cleared | LOCAL | P3 |
| MAN-STO-002 | Day/night switch in the header, the phone menu and the admin top bar, then reload | The choice is kept in this browser only; with none, the system setting decides; no white flash on load | LOCAL / PREVIEW | P2 |
| MAN-LOC-001 | Every page | `lang="he"`, `dir="rtl"`, numbers and phones left-to-right where they should be | PROD | P1 |
| MAN-LOC-002 | `/en`, `/fr` | Off unless `VITE_LOCALES` names them | PROD | P3 |

---

## 4. Non-functional cases

| ID | Area | Check | Expected | Env | Pri |
|---|---|---|---|---|---|
| MAN-PRF-001 | Performance | Load each public page, desktop and phone | Under 2 s on a normal connection; no layout jump | PROD | P2 |
| MAN-SEC-001 | Security | Response headers of `/` | HSTS, CSP, `nosniff`, `SAMEORIGIN`, a referrer policy, a permissions policy | PROD | P1 |
| MAN-SEC-002 | Security | Private routes (`/login`, `/account`, `/admin/*`, `/masleka`) | `X-Robots-Tag: noindex` and a meta `noindex` | PROD | P1 |
| MAN-SEC-003 | Security | An error answer | Shows a `rid`, never a stack or a message from inside | LOCAL | P1 |
| MAN-A11Y-001 | Accessibility | First Tab on any page | "דילוג לתוכן הראשי" with a visible outline | LOCAL | P1 |
| MAN-A11Y-002 | Accessibility | axe (WCAG 2.1 AA) on every public page, desktop and phone | No violation | PROD | P1 |
| MAN-A11Y-003 | Accessibility | Phone menu by keyboard | Opens with Enter, closes with Escape, focus returns | LOCAL | P2 |
| MAN-A11Y-004 | Accessibility | The admin screen in day and night mode | No contrast violation; tabs move with the arrow keys | DESIGN / PREVIEW | P1 |
| MAN-RSP-001 | Responsive | 320, 375, 640 (200% zoom), 768, 1024 px | No sideways scroll | LOCAL / PROD | P1 |
| MAN-CMP-001 | Compatibility | Smoke set on Chrome, Safari (macOS and iPhone), Android Chrome | The same behaviour | PROD | P2 |
| MAN-SEO-001 | SEO | Title, description, canonical, one `h1`, on each public page | Present and distinct | PROD | P2 |
| MAN-PRV-001 | Privacy | What leaves the browser before consent | GA4 only, with no personal data (`src/lib/analytics.ts`) | PROD | P2 |
| MAN-USE-001 | Usability | A first-time visitor finds how to reach Dorit within one screen | The CTA in the hero, the sticky bar on a phone | PROD | P2 |

---

## 5. Retests of defects found earlier

The manual test of 2026-10-14 found D-01 to D-18, fixed in #235, #242 and #252.
After any change near them, check again:

| Defect | Retest |
|---|---|
| D-01 | Quick contact and the claim report refuse a phone Dorit cannot call back (MAN-FRM-002) |
| D-02 | Claim documents stay in the browser until the report is sent (MAN-FRM-009) |
| D-03 | The procedures chat names רשות שוק ההון as גמל נט's publisher |
| D-04, D-08 | The 404 page is Hebrew, with a main landmark, an `h1` and a skip link (MAN-NAV-002) |
| D-05 | Unknown paths answer 404; private screens are `noindex` (MAN-NAV-002, MAN-SEC-002) |
| D-07 | The WhatsApp label in an article is ink, not gold (MAN-A11Y-002) |
| D-10 | Agent replies link articles by slug |
| D-17 | An unknown `utm_source` is recorded as `referral` |

## 6. Release checklists

**Smoke after every deploy (PROD, about 10 minutes):** MAN-AUT-001, MAN-AUT-004,
MAN-NAV-001, MAN-NAV-002, MAN-INT-003, MAN-SEC-001, MAN-SEC-002, MAN-LOC-001,
MAN-RSP-001 at 375 px.

**Change in the forms or the backend functions:** section 3.3, MAN-ERR-001,
MAN-SEC-003, MAN-INT-002.

**Change in the admin:** sections 3.2 and 3.4, MAN-NAV-005, MAN-STO-002,
MAN-A11Y-004, MAN-INT-001.

**Change in layout or styles:** MAN-RSP-001, MAN-A11Y-002, MAN-A11Y-004,
MAN-CMP-001.

---

## 7. Run log

### Run 2026-10-22

Branch `feat/inquiries-redesign` (the admin redesign). PROD read-only on Chromium
desktop (1440×900) and Pixel 7; LOCAL on web-chromium and android-chrome; DESIGN
for the admin screen. Not run: everything marked PREVIEW (needs a staff test
account), the chats (real model on PROD), MAN-CMP-001 on Safari and iPhone.

| Case | Result | Notes |
|---|---|---|
| MAN-AUT-001 | Pass | Google, email, password, "כניסה"; `noindex` header and meta |
| MAN-AUT-004 | Pass (PROD half) | `/account` and `/admin/leads` redirect to `/login?returnTo=…` |
| MAN-FRM-001 | Pass | "נא למלא שם מלא." |
| MAN-FRM-002 | Pass | `+972 50-123-4567`, `050 123 4567`, `03-1234567` accepted; `1234`, letters, 13 digits refused. `050-0000000` is accepted (see M-05) |
| MAN-FRM-003 | **Fail** | `abc@` is sent (M-03) |
| MAN-FRM-004 | Pass | Markup sent as text, nothing rendered, no dialog |
| MAN-FRM-005 | Observation | No limit; 6,000 characters sent (M-05) |
| MAN-FRM-006 | Pass | One request on a double-click |
| MAN-FRM-007 | Pass | Button disabled during a 3 s answer, then the confirmation |
| MAN-FRM-008 | **Fail** | Enter in a field does nothing (M-02) |
| MAN-ERR-001 | Pass | "לא הצלחנו לשלוח את ההודעה כרגע…" with the mail address; fields kept |
| MAN-STO-001 | Pass | Set by `?internal=1`, cleared by `?internal=0` |
| MAN-STO-002 | Pass | Night mode kept after a reload, `aria-pressed` right |
| MAN-INT-003, 005 | Pass | WhatsApp links and all eight insurer sites answer 200 |
| MAN-INT-006 | Pass | No token and a wrong token both show "הקישור חסר או שגוי"; `noindex` |
| MAN-NAV-001 | Pass | 30 internal pages crawled from `/`, none broken |
| MAN-NAV-002 | Pass | 404 status, Hebrew page, `noindex` |
| MAN-NAV-005 | Pass | Breadcrumb and sidebar mark "פניות ופגישות" |
| MAN-LOC-001 | Pass | `he` / `rtl` on all 15 routes |
| MAN-PRF-001 | Pass | 0.2–0.8 s to `load` on desktop and phone |
| MAN-SEC-001 | Pass | HSTS with preload, CSP, `nosniff`, `SAMEORIGIN`, referrer and permissions policies |
| MAN-SEC-002 | Pass | Private routes `noindex` in header and meta |
| MAN-SEO-001 | Pass | Every public page has a distinct title, a description, a canonical and one `h1` |
| MAN-A11Y-001 | Pass | Skip link first, solid outline |
| MAN-A11Y-002 | **Fail** | Phone home page: one contrast violation (M-01). Desktop: none |
| MAN-A11Y-003 | **Fail** | Enter opens the menu and Escape closes it, but the button does not say whether it is open (M-06) |
| MAN-A11Y-004 | Pass after fix | Found 4.1–4.3:1 text in the new admin design in both modes; tokens darkened on the branch, then no violation on the leads, meetings and empty views |
| MAN-RSP-001 | Pass | No sideways scroll at 320, 375, 640, 768 and 1024 px, public and admin |

#### Defects

| ID | Severity | Where | What | Suggested fix |
|---|---|---|---|---|
| M-01 | Medium | PROD, phone, every page | The WhatsApp cell of the sticky bar (`MobileStickyBar.tsx`) is white on `#25d466`: 1.96:1 for 13px text, AA needs 4.5:1. The floating WhatsApp button (`FloatingActions.jsx`) has the same white on green. | **Fixed on the branch:** ink on the green in both |
| M-02 | Medium | Quick contact | The fields are not in a `<form>`: Enter does not send, assistive technology gets no form, and the browser's own checks never run. | **Fixed on the branch:** a `<form>` with a submit button; Enter now sends or names what is missing |
| M-03 | Low | Quick contact, `submit-lead` | `abc@` is accepted. The lead is saved, the visitor's confirmation is skipped as `client_email_invalid`, and Dorit gets an address she cannot use. | **Fixed on the branch** with M-02: the browser's email check now runs and `abc@` is not sent |
| M-04 | Low | New admin design (branch only) | Text at 4.1–4.3:1 in day and night mode | **Fixed on the branch** before merge |
| M-05 | Info | Quick contact | No length limit on the message, and `050-0000000` passes as a phone | Decide whether either matters |
| M-06 | Low | PROD, phone header | The menu button ("תפריט", `FloatingHeader.tsx`) has no `aria-expanded` or `aria-controls`, so a screen reader does not hear that the menu opened | **Fixed on the branch:** `aria-expanded`, and `aria-controls` while open |
