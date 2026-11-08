# Manual Test Plan — Admin Area

The manual checks for the admin screens under `/admin/*`, done in a browser by
someone signed in as staff. It goes deeper than the admin rows of the general
manual plan (`15-manual-test-plan.md`, sections 3.2 and 3.4). It uses the same
environments, test data and priorities.

Case IDs are `ADM-<AREA>-<NNN>`. The **Kind** column says whether a case only
reads (**R**) or writes data (**W**). The last section is the log of each run.

---

## 1. Scope and safety

**In scope:** the sidebar and top bar, and these screens:
- פניות ופגישות (`/admin/leads`): its פניות, פגישות and מעקב לידים tabs, the lead drawer and "פנייה חדשה"
- קמפיינים (`/admin/campaigns`)
- בלוג (`/admin/blog`)
- משתמשים (`/admin/users`)
- פרטי הסוכנות (`/admin/agency`)

**Out of scope:**
- בקשות מסלקה (`/admin/masleka/*`): it's off in production (`VITE_MASLEKA_ENABLED`). Only the check that it stays hidden is in scope.
- סוכנויות בהקמה (`/admin/agencies/*`): it's off (`VITE_AGENCY_ONBOARDING`).
- The operator's own home in `/account`.

**Safety rules.** The admin works on the **live database**. Every screen, local or deployed, reads and writes the agency's real leads, meetings, articles and users.

- **R cases** can run on production with a real staff account. Look, filter, search and open things, but don't save.
- **W cases** run only on test records whose name starts with "בדיקה". Use phone `050-1234567` and mail `test@example.com`. Create the records for the run and delete them at the end.
- Never change, assign or delete a real client's lead.
- Never edit a published article.
- Never change פרטי הסוכנות: the public site shows them.
- Never send an invite to a real address.
- A CSV export holds real clients' personal details. Delete the file after checking it.

## 2. Roles

| Role | Sees |
|---|---|
| User | פניות (only leads assigned to them), קמפיינים, בלוג (drafts, no publishing), משתמשים |
| Admin | + every lead, assign, delete, the "לא שויכו" queue, publishing articles, inviting users |
| Owner | + פרטי הסוכנות and the "מעקב לידים" tab |

The run log records which role was used. A case that needs a role the tester
doesn't have is logged as **Not run (role)**.

---

## 3. Functional cases

### 3.1 Access and routing

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-ACC-001 | Signed out, open each admin route | Redirect to `/login?returnTo=<the route>`; after signing in, back on that route | R | P1 |
| ADM-ACC-002 | Every admin route, page source and response headers | `noindex` in the meta and in `X-Robots-Tag` | R | P1 |
| ADM-ACC-003 | `/admin/masleka`, `/admin/masleka/guide`, `/admin/agencies` with the switches off | Not offered in the sidebar; the route shows nothing of the screen | R | P1 |
| ADM-ACC-004 | A route the role doesn't reach (`/admin/agency` as a User or Admin, `?tab=tracking` below Owner) | Refused or falls back to "פניות"; no Owner data visible | R | P1 |
| ADM-ACC-005 | Refresh on each admin route, and Back/Forward across three of them | The same screen and tab come back; no flash of the public site | R | P2 |
| ADM-ACC-006 | Someone in two agencies switches agency | `?agency=` follows; lists, counters and links show the chosen agency only | R | P1 |

### 3.2 Sidebar and top bar

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-NAV-001 | The sidebar for the role | The groups "טיפול שוטף" and "תוכן והגדרות", with only the rows that role reaches (section 2) | R | P1 |
| ADM-NAV-002 | Open each row in turn | The current row is marked (a bar on the start edge, and "נוכחי" or a dot); `aria-current="page"` on it only | R | P1 |
| ADM-NAV-003 | Counters on "פניות ופגישות" | The number matches the "לא שויכו" filter (Admin and above) or the User's own new leads; the label is read out after the number | R | P1 |
| ADM-NAV-004 | Header of the sidebar | The monogram and "ממשק ניהול · <agency name>" | R | P3 |
| ADM-NAV-005 | Day/night switch, then a reload | The theme changes everywhere and is still set after the reload; no white flash | R | P2 |
| ADM-NAV-006 | Phone width: the admin menu | It opens and closes, has the same rows as the sidebar, and closes after a row is chosen | R | P1 |
| ADM-NAV-007 | Log out from the sidebar | Lands on `/`; Back doesn't reopen an admin screen with data | R | P1 |

### 3.3 פניות (`/admin/leads`, the leads tab)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-LED-001 | Load the tab | The summary cards (סה״כ פניות, דורשות טיפול, בתהליך, נסגרו), the filter pills, "N פניות להצגה" and the table, with no console errors | R | P1 |
| ADM-LED-002 | Each filter pill: הכל, השבוע, ללא פעילות, דורשות טיפול, הועברו לטיפול, ראיונות שלא הושלמו, לא שויכו, דרך הצוות, כפילות אפשרית | The rows match the pill, and the count on the pill equals "N פניות להצגה" | R | P1 |
| ADM-LED-003 | Each summary card | It filters to its set, and its number matches | R | P1 |
| ADM-LED-004 | Search by name and by phone, then clear it | Matching rows only; clearing brings everything back | R | P1 |
| ADM-LED-005 | Table at 1024, 1280 and 1440 px | Every column on screen with no sideways scroll; dates in Israel time; phones read left to right | R | P1 |
| ADM-LED-006 | Open a lead (the drawer) | Name, contact details, source, the message ("עוד"/"פחות" on long text), status and assignment; Escape closes it and focus returns to the row | R | P1 |
| ADM-LED-007 | "שיחה" on a lead that came from the chat or the interview | The transcript opens; "הסתרת השיחה" closes it; a lead with none says "אין תמליל שמור לפנייה הזו" | R | P2 |
| ADM-LED-008 | A document attached to a lead (claim report) | It opens in a new tab; if pop-ups are blocked, the message about the blocked window appears | R | P2 |
| ADM-LED-009 | "ייצוא מסונן" with a filter on, and "ייצוא הכל ל-CSV" | Hebrew is intact in Excel or Sheets; the filtered file has only the filtered rows; no cell starts with `=`, `+`, `-` or `@` as a formula | R | P2 |
| ADM-LED-010 | Change the status of a test lead | Saved; still there after a refresh; the cards and pills move by one | W | P1 |
| ADM-LED-011 | Assign a test lead to a member, then unassign it (Admin and above) | "לא שויכו" and the sidebar counter move by one each time | W | P1 |
| ADM-LED-012 | Delete a test lead (Admin and above) | A confirmation first, naming the meetings that go with it; the lead is gone from both tabs | W | P1 |
| ADM-LED-013 | A User's view | Only their leads; no assign column, no "מחיקה", no "לא שויכו" | R | P1 |
| ADM-LED-014 | A backend-set status (הועברה לטיפול אישי, ראיון שלא הושלם) | Shown with its label, and not offered as a choice in the status menu | R | P2 |

### 3.4 פנייה חדשה (adding a lead by hand)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-NEW-001 | Open "פנייה חדשה" and save it empty | It names the missing fields; nothing is saved | R | P1 |
| ADM-NEW-002 | A bad phone, and a bad mail | Refused with a clear message | R | P1 |
| ADM-NEW-003 | A phone already in the agency | "המספר כבר קיים בסוכנות" or "הפונה כבר רשום/ה", with "פתיחת הפנייה הקיימת"; a link that opens the existing lead | R (stop before saving) | P1 |
| ADM-NEW-004 | Save a test lead with "איך הגיע/ה" and "מי הפנה" | "הפנייה נשמרה"; it shows under "דרך הצוות" with "הובאה ע״י" filled in | W | P1 |
| ADM-NEW-005 | Save a test lead with "קבענו כבר פגישה" | The lead and its meeting both appear; the notice text is shown, along with a note that it isn't sent by mail, and "העתקת הנוסח" copies it | W | P2 |
| ADM-NEW-006 | Close the sheet with Escape halfway through | It closes, and focus returns to the button | R | P2 |

### 3.5 פגישות (the meetings tab and the lead's meetings)

Only when the build has `VITE_MEETINGS_STAFF=true`. Without it, there's no
פגישות tab, and every case here is **Not run (off)**.

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-MTG-001 | Load the tab | KPI cards (לידים פעילים, פגישות השבוע, משימות פתוחות) and the agenda | R | P1 |
| ADM-MTG-002 | Each view: היום, השבוע, קרובות, עברו, בוטלו, בקשות שינוי, בלי סיכום | The meetings fit the view; an empty view says "אין פגישות להצגה." | R | P1 |
| ADM-MTG-003 | The צוות filter ("כל הצוות", one member, "לא שויכו") | Only that member's meetings | R | P2 |
| ADM-MTG-004 | "פגישה חדשה" → choose a lead: search by name and by phone | Matching leads; nonsense input shows "לא נמצאה פנייה כזו." | R (stop before saving) | P2 |
| ADM-MTG-005 | Add a meeting to a test lead, move it, then cancel it | Each change shows in the agenda, in the KPI cards and on the lead's meetings | W | P1 |
| ADM-MTG-006 | A meeting late at night, or across the clock change | The same time shown everywhere (Israel time) | W | P1 |
| ADM-MTG-007 | Write a summary for a past test meeting | It moves out of "בלי סיכום"; "טרם פורסם ללקוח" until it's published | W | P2 |

### 3.6 מעקב לידים (the tracking tab, Owner only)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-TRK-001 | Open the tab | The table of events sent to Google Analytics, and the line saying no name, phone, mail or message is sent | R | P2 |
| ADM-TRK-002 | "סמנו כגלישה פנימית", then "ביטול הסימון" | The state line follows ("מסומן כגלישה פנימית" / "נספר כמבקר רגיל"); this browser only | R (browser only) | P3 |

### 3.7 קמפיינים (`/admin/campaigns`)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-CMP-001 | Load the screen | The list, or "אין עדיין קמפיינים."; "קמפיין חדש" only for Admin and above | R | P2 |
| ADM-CMP-002 | "העתקת הקישור" and "העתקת ההודעה" | "הועתק"; the clipboard holds the link or the message as previewed under "כך תיראה ההודעה" | R | P2 |
| ADM-CMP-003 | Create a test campaign, edit it, move it to the archive, then bring it back | Each step is saved; an archived one shows "· בארכיון" | W | P2 |

### 3.8 בלוג (`/admin/blog`)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-BLG-001 | Load the screen | The counts (מאמרים מפורסמים, טיוטות, ממתינות לעריכה) and the list | R | P1 |
| ADM-BLG-002 | Search by title and by tag; filter by status and by topic | The list follows; the counts are right | R | P1 |
| ADM-BLG-003 | "צפייה במאמר באתר" on a published article | Opens the public article | R | P2 |
| ADM-BLG-004 | Open "עריכה" on a published article, then close it without saving | Nothing changes | R | P2 |
| ADM-BLG-005 | "מאמר חדש" as a test draft, with an image | Saved as a draft; it doesn't appear on the public `/blog` | W | P1 |
| ADM-BLG-006 | Publish the test draft, then "העברה לטיוטה" (Admin and above) | The public `/blog` shows it, then stops showing it; the address stays the same | W | P1 |
| ADM-BLG-007 | Delete the test article | "למחוק את המאמר?" first; it's gone from the list and from `/blog` | W | P1 |
| ADM-BLG-008 | A User: open a draft | "טיוטה — הפרסום אצל מנהלי הסוכנות"; no publish button | R | P2 |

### 3.9 משתמשים (`/admin/users`)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-USR-001 | Load the screen | The users with role and agency; "חברי הסוכנות" below | R | P1 |
| ADM-USR-002 | Search by name, by role, and by text that matches no one | Matching rows; "לא נמצאו משתמשים שמתאימים לחיפוש" when nothing matches | R | P2 |
| ADM-USR-003 | "הוספת משתמש": send with a bad email, and with no agency chosen | "יש להזין כתובת דוא״ל תקינה." and "יש לבחור ארגון."; nothing is sent | R | P1 |
| ADM-USR-004 | Roles on offer in the invite | Only roles the inviter may give; an Admin can't make an Owner | R | P1 |
| ADM-USR-005 | Invite a test address the team owns, then remove it | The invite arrives once; the member appears and is removed | W | P2 |
| ADM-USR-006 | A User's view | No "הוספת משתמש" | R | P2 |

### 3.10 פרטי הסוכנות (`/admin/agency`, Owner only)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ADM-AGY-001 | Load the screen | The fields match what the public site shows (name, licence holder, licence number, regulator, phones, mail, WhatsApp) | R | P1 |
| ADM-AGY-002 | Type a WhatsApp number with a `+` or spaces, then leave the field without saving | The hint "ספרות בלבד, עם 972" and a refusal; reload to discard | R | P2 |

---

## 4. Non-functional cases

| ID | Area | Check | Expected | Pri |
|---|---|---|---|---|
| ADM-RSP-001 | Responsive | Each screen at 375, 768, 1024 and 1440 px | No sideways page scroll; tables scroll inside their box on a phone; nothing is cut off | P1 |
| ADM-A11Y-001 | Accessibility | axe (WCAG 2.1 AA) on each screen, in day and night mode | No violations | P1 |
| ADM-A11Y-002 | Keyboard | Tab through each screen; arrow keys on the tab lists; Escape on drawers and dialogs | Every control is reachable with a visible outline; focus returns after closing | P1 |
| ADM-A11Y-003 | Screen reader | The tabs, counters and dialogs | Names and states are read out (selected tab, number + label, dialog title) | P2 |
| ADM-PRF-001 | Performance | Open each screen | Data within about 2 s; a loading state while it waits; no layout jump | P2 |
| ADM-ERR-001 | Errors | Go offline, then filter, open and save | A Hebrew error ("ניתן לנסות שוב" / "ניתן לרענן את הדף"); nothing half-saved | P2 |
| ADM-CON-001 | Console | Each screen | No errors and no failed requests | P2 |
| ADM-CMP-001 | Compatibility | The P1 R cases on Safari and iPhone | The same behaviour | P3 |

---

## 5. Which cases to run

- **Every admin change, read-only on production (about 30 minutes):** every P1 R case in sections 3 and 4.
- **A change in saving, permissions or the backend functions:** add the W cases for that screen, with test records.
- **Before a role is given to someone new:** ADM-ACC-004, ADM-LED-013, ADM-BLG-008, ADM-USR-006, signed in with that role.

---

## 6. Run log

<!-- One block per run: date, environment, browser, role, then one row per case. -->

### Run 1 — 2026-11-02, production (`govari-fin.co.il`), Chrome on macOS, read-only

Role: Owner of the agency "Trust", also listed as מפעיל הפלטפורמה. The account belongs to two agencies, and the admin opens on "Trust", which has no leads, meetings or agency details.

| ID | Result | Notes |
|---|---|---|
| ADM-ACC-001 | Pass (signed-out half) | All 9 admin routes redirect to `/login?returnTo=<the route>`. The return after signing in is not checked yet. |
| ADM-ACC-002 | Pass | `noindex` in both the meta tag and `X-Robots-Tag` on every admin route. |
| ADM-ACC-003 | **Fail** | "בקשות מסלקה" is in the sidebar. `/admin/masleka` and `/admin/masleka/guide` are live, with real clients' requests. `docs/COMPLIANCE.md:442` says it stays off until the compliance review. `/admin/agencies` shows 404 (pass). |
| ADM-ACC-004 | Not run (role) | Only an Owner account was available. |
| ADM-ACC-006 | **Fail** | The account is in two agencies ("Trust" and דורית גוב ארי), but there's no agency switcher, and `?agency=<id>` is ignored: the screen stays on "Trust". |
| ADM-NAV-001 | Pass | Both groups, with the Owner rows. |
| ADM-NAV-002 | Pass | בלוג, משתמשים, פרטי הסוכנות and פניות ופגישות each get `aria-current="page"` and "נוכחי" when open, and only that row. |
| ADM-NAV-003 | **Fail** | The sidebar shows "5 לא שויכו", but the "לא שויכו" pill and every card on `/admin/leads` show 0. The counter's request (`leads?assigned_user_id=is.null&status=not.eq.closed&merged_into=is.null`) has no agency filter; the screen shows "Trust" only. |
| ADM-NAV-004 | Pass | The monogram and "ממשק ניהול · Trust" (the agency in use). |
| ADM-LED-001 | Pass (empty) | Cards, pills, "0 פניות להצגה" and "אין פניות להצגה."; no console errors, every request 200. "Trust" has no leads. |
| ADM-LED-002…006 | Not run (no data) | The agency on screen has no leads. |
| ADM-LED-013 | Not run (role) | |
| ADM-BLG-001 | Pass | 30 articles: 29 published, 1 draft. |
| ADM-BLG-002 | Pass | "טיוטה (1)" shows the one draft. Searching "הייטק" finds 1 article. Nonsense text shows "אין מאמרים שתואמים את הסינון."; clearing it brings back all 30. |
| ADM-USR-001 | Pass | 8 users with role and agency, and "חברי הסוכנות — Trust" below. |
| ADM-AGY-001 | Not run (no data) | "לסוכנות הזו עדיין אין פרטים. מפעיל הפלטפורמה יוצר אותם.": "Trust" has no profile, so there's nothing to compare with the public site. |
| ADM-CON-001 | Pass so far | No console errors on leads, masleka, campaigns, blog, users or agency. |
| ADM-NAV-005 | Pass | Night mode is still set after a full load of another admin screen; switched back to day mode afterwards. |
| ADM-NAV-006 | **Fail** | At phone width (311 px view, the narrowest the window allows) there's no menu button. The whole sidebar is stacked above the page, and the page title starts about 554 px down. |
| ADM-NAV-007 | Not run | It signs you out; to be run together with the second half of ADM-ACC-001. |
| ADM-NEW-001…006 | Not run (agency) | By design there's no "פנייה חדשה" in "Trust": `src/config/staff-leads.ts:41` offers it in agency 1 only. |
| ADM-MTG-001 | Pass (empty) | KPI cards (לידים פעילים, פגישות השבוע, משימות פתוחות), the agenda and "פגישה חדשה". |
| ADM-MTG-002 | Pass (empty) | קרובות, עברו, בקשות שינוי, בלי סיכום and בוטלו each get selected and say "אין פגישות להצגה." |
| ADM-TRK-001 | Pass | The events table and the line saying no name, phone, mail, message or chat text is sent. |
| ADM-CMP-001 | Pass | "אין עדיין קמפיינים." with the "קמפיין חדש" form shown to an Owner. |
| ADM-CMP-002 | Not run (no data) | No campaigns. |
| ADM-USR-002 | Pass | "מפעיל" shows 2 of 8, "Trust" 3 of 8, and nonsense 0 of 8 with "לא נמצאו…"; clearing it brings back all 8. The search filters after a short delay. |
| ADM-USR-003 | Pass (half) | `not-an-email` shows "יש להזין כתובת דוא״ל תקינה." and nothing is sent. The missing-organisation message didn't appear alongside it. Not tested with a valid address, because that would send a real invite. |
| ADM-USR-004 | Pass (Owner) | An Owner is offered בעלים, מנהל/ת and משתמש/ת. Whether an Admin is limited isn't tested (role). |
| ADM-RSP-001 | **Fail** (campaigns) | At 311 px: leads, blog, users and agency have no sideways scroll, and the leads tabs scroll inside their box. On `/admin/campaigns` the new-campaign form and its preview stick out on the left (page 461 px wide in a 311 px view); probably the long campaign link in the preview not wrapping. Checked at 311 and about 470 px only, because the window wouldn't size to exactly 375 or 768. |
| ADM-A11Y-002 | Pass (leads) | Tab goes from the skip link through the sidebar, theme, tabs, cards and pills, each with a visible outline. Arrow keys move between the tabs and update `?tab=`. Escape closes "הוספת משתמש", and focus returns to its button. |
| ADM-A11Y-001 | Not run | Running axe means injecting a script into the production page; left to the automated a11y suite. |
