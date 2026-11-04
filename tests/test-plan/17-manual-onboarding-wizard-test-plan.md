# Manual Test Plan — New-Agency Onboarding Wizard

The manual checks for the new-agency wizard
(`docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md`): the
operator opens a draft agency, the owner (or the operator on the owner's
behalf) fills steps 1–7, and the operator reviews and activates it. Done in a
browser, with the database checked after each write. It uses the conventions of
`16-manual-admin-test-plan.md`.

Case IDs are `ONB-<AREA>-<NNN>`. The **Kind** column says whether a case only
reads (**R**) or writes data (**W**). **Pri**: P1 blocks onboarding an agency,
P2 makes it harder or wrong, P3 is polish. The last sections are the defects
found and the log of each run.

---

## 1. Scope, environment and safety

**In scope:** `/admin/agencies` (list), `/admin/agencies/new` (step 0),
`/admin/onboarding/:agencyId` (steps 1–7), `/admin/agencies/:id/review`
(operator review, return, activate), the sign-in redirect for a draft owner,
and the public footer links an agency gives in step 3.

**Out of scope:** the invitation mail itself (the Resend mailer is not reachable
locally; only the screen's handling of a failed send is checked), the
regulator's register, and Rollout 5 (an outside agency's public site).

**Environment: local only.** The wizard is off in production
(`VITE_AGENCY_ONBOARDING`), and its writes create agencies, so every case runs
against a local Supabase:

| Piece | Value |
|---|---|
| Supabase | `npx supabase@2 start` (all migrations applied, `20261115000000_agency_links.sql` included) |
| Site | `VITE_SUPABASE_URL=<local API> VITE_SUPABASE_PUBLISHABLE_KEY=<local key> VITE_AGENCY_ONBOARDING=true VITE_AGENCY_CONTENT=true npm run dev` |
| Database checks | `psql` in the `supabase_db_<project>` container |

**Test data.** Accounts `owner@local.test` (Owner of the draft "סוכנות הדגמה")
and `operator@local.test` (`profiles.role = 'admin'`), and any agency the run
opens, named "בדיקה …". Never run these cases against the hosted project.

## 2. Roles

| Role | Reaches |
|---|---|
| Platform operator (`profiles.role = 'admin'`) | Step 0, steps 1–7 on the owner's behalf, the review screen, return, activate |
| Owner of the draft agency | Steps 1–7 and "שליחה לאישור" for their own agency only |
| Signed-in non-owner / signed out | Nothing of the wizard |

---

## 3. Functional cases

### 3.1 Access and routing

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-ACC-001 | Signed out, open `/admin/onboarding/<id>` | Redirect to sign-in; after signing in as the owner, back in the wizard | R | P1 |
| ONB-ACC-002 | Owner of a single draft agency signs in from `/login` | Lands in that agency's wizard | R | P1 |
| ONB-ACC-003 | A signed-in user who is not the owner opens the wizard URL | Sent to `/`; no agency data shown | R | P1 |
| ONB-ACC-004 | Owner opens `/admin/agencies/new` and `/admin/agencies/<id>/review` | Refused; no operator controls shown | R | P1 |
| ONB-ACC-005 | Operator opens the wizard of any draft agency | The wizard opens for that agency | R | P1 |
| ONB-ACC-006 | The wizard page's chrome | A page for setting up the agency, with a way out (back to the site or admin) and sign-out; no console errors | R | P2 |

### 3.2 Moving between steps

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-NAV-001 | The step bar | Steps 1–7, the current one marked (`aria-current="step"`), a check on each step whose required fields are filled | R | P2 |
| ONB-NAV-002 | "המשך" on an empty step 1 | Moves to step 2; nothing required blocks moving on (the checklist on step 7 asks for it) | W | P1 |
| ONB-NAV-003 | "הקודם" and the step bar, both directions | Every step is reachable from every step | W | P1 |
| ONB-NAV-004 | An invalid value in a field (e.g. a bad e-mail), then "הקודם" or another step in the bar | The owner can still move between steps; the invalid value is not saved, and the reason is shown | W | P1 |
| ONB-NAV-005 | Leave the wizard on step N, reload | Opens again on step N (`onboarding.last_step`) | W | P2 |
| ONB-NAV-006 | Steps that write the licensee (2, 4, 6) before step 1's name is filled | A clear message pointing to step 1; the owner can still go there | W | P1 |
| ONB-NAV-007 | A filled wizard: "המשך" from step 1 to 7, then "הקודם" back to 1 | Every field shows the same value both ways; no error | R | P1 |
| ONB-NAV-008 | Type in a field and press "המשך" or "הקודם" at once, without leaving the field | The new value is saved (check after a reload) | R | P1 |
| ONB-NAV-009 | The browser's Back and Forward inside the wizard | Back and Forward go between steps (`?step=` in the address); Back from the first step opened leaves the wizard | R | P2 |
| ONB-NAV-010 | Type in a field, then the browser's Back (to a step or out of the wizard) | The value is saved; the review screen and the wizard reopened show it | R | P1 |
| ONB-NAV-011 | Step 5: a testimonial or case typed and not added, then "המשך", a step chip or the browser's Back | The wizard stays and asks: "להישאר כאן" keeps the text, "להמשיך בלי להוסיף" moves on | R | P2 |

### 3.3 Step 1 · בעל/ת הרישיון

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-LIC-001 | Fill full name, gender, title (list and free text), display name; leave each field | Each field saves on leaving it; a reload shows the values; one `agents` row exists | W | P1 |
| ONB-LIC-002 | Gender "זכר" | The page addresses the owner in the masculine ("אתה בשלב…") | W | P3 |
| ONB-LIC-003 | Upload a JPG portrait | Preview shows it; three WebP files in `agent-photos/<agency>/<agent>/`; `photo_path` set | W | P2 |
| ONB-LIC-004 | Replace, then remove the portrait | New files replace the old; "remove" returns to the monogram and clears `photo_path` | W | P2 |
| ONB-LIC-005 | Portrait before the name is saved | A clear message rather than a silent failure | W | P2 |
| ONB-LIC-006 | The live preview panel | Name, title, portrait or monogram update as typed | R | P3 |

### 3.4 Step 2 · רישוי וגילוי נאות

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-LCN-001 | Licence number `L-0012345`, then `12345` | The first saves; the second shows "מספר רישיון נראה כמו L-0012345." | W | P1 |
| ONB-LCN-002 | Licence types (several), regulator | Saved and shown after a reload | W | P1 |
| ONB-LCN-003 | "זיקה לגופים מוסדיים" yes → the bodies list appears and is required; no → hidden and not required | As stated; the checklist follows | W | P1 |
| ONB-LCN-004 | The licence-entity line | Pre-filled "<name> — <title>" from step 1; editable; not overwritten after the owner edits it | W | P2 |
| ONB-LCN-005 | The disclosure preview | The exact sentences, gendered, with the number and the affiliation choice | R | P2 |

### 3.5 Step 3 · פרטי קשר

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-CON-001 | Mobile `052-1234567` | Saved as `+972521234567`, `052-123-4567`, `972521234567` | W | P1 |
| ONB-CON-002 | A landline or short number | "נדרש מספר נייד ישראלי…" ; not saved | W | P1 |
| ONB-CON-003 | E-mail, then leave it | Saved; "כתובות להתראות" pre-filled with it when empty | W | P1 |
| ONB-CON-004 | WhatsApp opening message | Pre-filled with the first name; editable; saved | W | P2 |
| ONB-CON-005 | Notification addresses, one per line, one bad | The bad one named; the good list saves | W | P1 |
| ONB-CON-006 | Website, WhatsApp group, Facebook group: valid links | Saved; shown after a reload | W | P1 |
| ONB-CON-007 | Each link wrong (`http://`, `wa.me`, another host) | A Hebrew reason under the field, readable left-to-right; not saved | W | P2 |
| ONB-CON-008 | Clear a saved link | Saved as empty (null); no database error | W | P1 |

### 3.6 Step 4 · אודות

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-ABT-001 | "משפט שיווקי קצר" and "רקע מקצועי" | Saved; counters show length against the recommendation | W | P1 |
| ONB-ABT-002 | Optional texts, signature | Saved; signature defaults to the first name | W | P2 |
| ONB-ABT-003 | Up to three stats; try a fourth | Three at most; each `{num, label}` saved | W | P2 |
| ONB-ABT-004 | The preview's headline | Shows the typed pitch; with none, a placeholder that names the field as the form does | R | P3 |

### 3.7 Step 5 · המלצות ותיקי הצלחה

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-TST-001 | Google and Midrag links (https) | Saved; a non-https link refused | W | P2 |
| ONB-TST-002 | Add a testimonial without the consent box | Refused with a reason | W | P1 |
| ONB-TST-003 | Add a testimonial with consent; edit; delete | Each saved; `consent_confirmed_at` stamped | W | P1 |
| ONB-TST-004 | Add, edit and delete a success case | Saved; the anonymisation warning shown | W | P2 |
| ONB-TST-005 | Testimonials before step 1's name is saved | A clear message pointing to step 1 | W | P2 |

### 3.8 Step 6 · פגישות

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-MTG-001 | Booking link https; meeting length | Saved | W | P2 |
| ONB-MTG-002 | Booking link `http://…`, then cleared | Refused with a reason; cleared saves as null | W | P2 |

### 3.9 Step 7 · סקירה ושליחה

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-REV-001 | With fields missing | "עוד N פרטים…", grouped by step, each group linking to its step | R | P1 |
| ONB-REV-002 | "שליחה לאישור" with fields missing | Refused; the server's missing list replaces the local one | W | P1 |
| ONB-REV-003 | Everything filled, "שליחה לאישור" | Status `pending_review`; the page says it was sent | W | P1 |
| ONB-REV-004 | Edit a field while pending review | Allowed; the banner says the reviewer sees the latest version | W | P2 |
| ONB-REV-005 | The full preview | Renders the agency's draft home-page blocks | R | P3 |

### 3.10 Operator: open, review, return, activate

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-OPR-001 | `/admin/agencies` | Lists draft and pending agencies with status and a way in | R | P1 |
| ONB-OPR-002 | `/admin/agencies/new`: name + owner e-mail, submit | A draft agency is created; the invite failure (no mailer locally) is shown with "שליחת ההזמנה שוב" | W | P1 |
| ONB-OPR-003 | Step 0 with a bad e-mail or no name | Submit stays unavailable / refused with a reason | W | P2 |
| ONB-OPR-004 | "מילוי האשף בשם הבעלים" | Opens the wizard of the new agency | W | P1 |
| ONB-OPR-005 | Review: return with a note | Status back to `draft`; the owner's wizard shows the note | W | P1 |
| ONB-OPR-006 | Review: activate with a gate open | Refused, naming the gate | W | P1 |
| ONB-OPR-007 | Review: pass the three gates, set the domain, activate | Status `active` | W | P1 |
| ONB-OPR-008 | Owner edits after activation | Still allowed; the public view shows the new values | W | P2 |

### 3.11 Permissions (database)

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-PRM-001 | As the owner, write an operator-only column (`domain`) through the API | Refused, `operator_only` | W | P1 |
| ONB-PRM-002 | As a non-member, read or write the draft's profile through the API | No rows; write changes nothing | W | P1 |

### 3.12 Phone width and accessibility

| ID | Check | Expected | Kind | Pri |
|---|---|---|---|---|
| ONB-MOB-001 | Every step at 390 px | No sideways scroll; step bar wraps; buttons ≥ 44 px | R | P2 |
| ONB-A11-001 | Keyboard only through a step | Every control reachable; focus visible; errors announced (`role="alert"`) | R | P2 |

---

## 4. Defects found

| ID | Case | What happens | Pri | Status |
|---|---|---|---|---|
| ONB-D-01 | ONB-NAV-006, ONB-NAV-003 | Before step 1's full name is saved, steps 2, 4, 5 and 6 can't be left in any direction: "המשך", "הקודם" and every step button answer "כדי לשמור, יש להשלים קודם את השם המלא בשלב 1." and stay put. A reload reopens the same step (`last_step`), so the owner is stuck for good. Cause: the agent defaults (`licence_regulator`, `bio`, `stats`, `review_links`, `meeting_minutes` in `AGENT_DEFAULTS`, `src/lib/onboarding-draft.ts`) make `stepPatches` write the licensee on every move, and `saveNow` refuses that without a name. Reproduced for the owner and for the operator, on two agencies. | P1 | Fixed — the licensee row waits for the name and is then created with everything typed for it in any step; until then every move works and a notice says so (CMP-ONB-101, 102) |
| ONB-D-02 | ONB-NAV-004 | One invalid field in the open step blocks every move, back to an earlier step included ("יש שדות שצריך לתקן לפני השמירה."). The value should simply not be saved. | P2 | Fixed — a bad value is left out of the save, the move goes on, and a notice names it (phone case) |
| ONB-D-03 | ONB-ACC-006 | The owner's wizard page has no header, no way back to the site or the admin, and no sign-out (the operator sees it inside the admin layout). | P2 | Fixed — the owner gets a bar with "לאתר" and "יציאה" (`OnboardingRoute`) |
| ONB-D-04 | ONB-LCN-003 | "הגופים המוסדיים *" is shown, and marked required, before the affiliation question is answered and after "לא". | P2 | Fixed — shown only after "כן"; "לא" clears it (CMP-ONB-103) |
| ONB-D-05 | ONB-ABT-003 | Typing into stats row 2 while row 1 is empty splits the text across rows ("לקוחות" → "ל" in row 1, "קוחות" in row 2): `write()` drops empty rows on every keystroke. | P2 | Fixed — the rows keep their places (CMP-ONB-104) |
| ONB-D-06 | ONB-TST-003 | A saved testimonial can't be edited, only reordered or deleted. | P2 | Fixed — testimonials and cases open for editing (CMP-ONB-105) |
| ONB-D-07 | ONB-REV-001 | The checklist lists raw keys `agency_profiles.phone_display` and `agency_profiles.whatsapp` beside "טלפון נייד". | P3 | Fixed (CMP-ONB-106) |
| ONB-D-08 | ONB-OPR-001…007 | The review screen prints raw values: `m` for gender, `life_agent` for licence types. A testimonial's source shows as `google`. | P3 | Fixed — words everywhere; the portrait shows as a picture and the phone as typed (CMP-ONB-105, 108) |
| ONB-D-09 | ONB-ABT-004, ONB-CON-007 | The preview's placeholder still says "משפט הפתיחה שלך יופיע כאן" after the field became "משפט שיווקי קצר". The link hints and errors render `https://…` reversed inside the Hebrew line. | P3 | Fixed — new placeholder; Latin runs isolated left-to-right (CMP-ONB-111) |
| ONB-D-10 | ONB-TST-003 | Deleting a testimonial or a case happens at once, with no confirmation or undo. | P3 | Fixed — "למחוק? כן, למחוק / ביטול" (CMP-ONB-105) |
| ONB-D-11 | ONB-OPR-005, ONB-OPR-007 | Saving the operator fields (domain) shows no confirmation. After a returned agency is resubmitted, the old return note stays on screen beside "נשלח לאישור" until a reload. | P3 | Fixed — "נשמר ✓" beside each save; the banner follows the send at once (CMP-ONB-107, 108) |
| ONB-D-12 | ONB-LCN-005 | The bot disclosure uses "השם שמוצג באתר", which defaults to the agency's name, giving "לא סוכנות הדגמה עצמו". | P3 | Fixed — the bot line uses the licensee's name and first name, as Dorit's does; "ולא בעל רישיון" (the bot) in both genders |
| ONB-D-13 | ONB-LCN-003, ONB-CON-005 (run 2) | In "הגופים המוסדיים" and "כתובות להתראות" a new line vanished as it was typed: "מגדל" ↵ "הראל" became "מגדלהראל". | P2 | Fixed — the box keeps what is typed (CMP-ONB-109) |
| ONB-D-14 | ONB-NAV-001 (run 2) | A new step opened scrolled to where the last one was, often at its bottom. | P3 | Fixed — a step opens at its top |
| ONB-D-15 | ONB-REV-001 (run 2) | A required value typed but not acceptable (licence "12345") ticked its step ✓, though it was never saved. | P2 | Fixed (CMP-ONB-110) |
| ONB-D-16 | ONB-MTG-001 (run 2) | The first fix for ONB-D-09 isolated each English word, so "Google appointment schedule, Calendly" read backwards. | P3 | Fixed — one isolate per English phrase, full stop outside (CMP-ONB-111) |
| ONB-D-17 | ONB-LCN-005 (run 2) | With no name yet the bot line read "לא [השם עצמה". | P3 | Fixed — a placeholder is kept whole |
| ONB-D-18 | ONB-REV-002 (run 2) | The review step showed the same preview twice, large and in the side column. | P3 | Fixed — no side copy on the review step |
| ONB-D-19 | ONB-OPR-007 (run 2) | Right after "הפעלה" the screen still said "אפשר להפעיל או להחזיר רק סוכנות שנשלחה לאישור". | P3 | Fixed — "הסוכנות פעילה." |
| ONB-D-20 | ONB-NAV-011 (run 3) | A testimonial typed and not added was dropped without a word on "המשך" or a step chip. | P2 | Fixed — the wizard asks first (CMP-ONB-114) |
| ONB-D-21 | ONB-NAV-009 (run 3) | The browser's Back left the wizard from any step: the step was not in the address. | P2 | Fixed — `?step=`, one history entry per move (CMP-ONB-112, 113) |
| ONB-D-22 | ONB-NAV-010 (run 3) | A value typed and not left was lost on the browser's Back, a link out, or closing the tab. | P1 | Fixed — the open step is saved on every way out, and when the tab is hidden (CMP-ONB-113) |
| ONB-D-23 | ONB-NAV-010 (run 3) | After a save, the review screen and the wizard reopened showed the cached record from before it — and the wizard would have edited from it. | P1 | Fixed — each save marks the record stale; the wizard waits for a fresh read |

## 5. Run log

| Date | Build | Tester | Environment | Result |
|---|---|---|---|---|
| 2026-11-03 | `feature/agency-onboarding` (uncommitted, on `8810509`) | Claude, in Chrome | Local Supabase (CLI 2.122.1), dev server with both switches on | 59 cases: **49 pass, 9 fail, 1 not run** (ONB-TST-005). Fails: ONB-ACC-006, ONB-NAV-003, ONB-NAV-004, ONB-NAV-006, ONB-LCN-003, ONB-ABT-003, ONB-ABT-004, ONB-TST-003, ONB-REV-001. Twelve defects, one P1 (ONB-D-01). ONB-MOB-001 ran at 500 px, Chrome's narrowest window. ONB-ACC-002 was observed at the start of the session. |
| 2026-11-03 (run 2) | `feature/agency-onboarding` (uncommitted, on `8810509`), after the fixes | Claude, in Chrome | Local Supabase, dev server with both switches on; a fresh draft "סוכנות בדיקת אשף" owned by `wizard@local.test` | Every field of steps 1–7 typed bad then good and checked in the database; the owner bar and sign-out; send, return with a note, resend, the three gates, activation, and the public view's links. ONB-D-01…12 retested: all fixed. Seven more found (ONB-D-13…19) and fixed in the same run. Not repeated this run: ONB-MOB-001, ONB-A11-001, ONB-PRM-*. The details typed before the name exist are kept in the page only — a reload before the name is saved loses them (the notice says to fill the name first). |
| 2026-11-03 (run 3) | as run 2, plus the navigation fixes | Claude, in Chrome | Local Supabase; the filled agency "סוכנות בדיקת אשף", as the operator | Back and forward on a filled wizard (ONB-NAV-007…011): 1→7 with "המשך" and 6→1 with "הקודם", all 29 field values equal both ways; quick edits saved on "המשך" and "הקודם"; the browser's Back and Forward. Four defects found (ONB-D-20…23) and fixed; all five cases pass after the fixes. |
