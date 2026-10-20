# Staff-created leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any agency member can open a lead by hand ("פנייה חדשה"), recorded with who brought it, how it came, and how the person was told about their data — behind `VITE_STAFF_LEADS` (off).

**Architecture:** One additive migration adds the columns, a guard trigger and the `create_staff_lead` RPC (security definer; the database decides who may write what). A new Edge Function `create-lead` validates, rate-limits, calls the RPC under the caller's session, then does the side effects (sheet row, assignment mail, ops notice, privacy-notice mail). The leads screen gains a side-sheet form and list changes, all behind the flag; `LeadAdminPort` gains `createLead` and `clearDuplicate` (Supabase adapter only).

**Tech Stack:** Postgres/Supabase migrations, Deno Edge Functions (`supabase/functions/*/handler.ts`), React + TanStack Query, Vitest (unit/component/contract/integration), psql check files.

**Spec:** `docs/superpowers/specs/2026-10-20-staff-lead-design.md` — decisions D1–D8 accepted as proposed (2026-10-20). This plan covers rollout steps 1 and 3 only. Out: applying the migration to production, the compliance adviser's approval of `staff-intake-v1`, the privacy-policy line, turning the flag on.

## Global Constraints

- Migration file: `supabase/migrations/20261105000000_staff_leads.sql` (prod history ends at `20261104000000`). Additive only.
- New `source` value `'staff'`; `intake` ∈ `phone, in_person, referral, event, existing_client, other`; `notice_method` ∈ `verbal, email, whatsapp`; starting status ∈ `new, contacted, client` (default `contacted`); `referrer_note` ≤ 120 chars.
- `consent_version = 'staff-intake-v1'`, `consent_at = now()` — set by the RPC, never by the caller.
- `channel = 'referral'` for intake `referral`/`existing_client`, else `'direct'`.
- Direct `insert` on `leads` stays revoked for `anon`/`authenticated`.
- Staff text goes to `leads.notes`, **never** `summary` or `message` (the client sees `summary`).
- Rate limit: 60 creates per member per hour (`withinLimit`, key `staff-lead:<userId>`).
- Every function answer carries `rid`; no error text leaked; Israel time (`Asia/Jerusalem`) for anything shown or written to the sheet.
- Labels: `SOURCE_LABEL.staff = "דרך הצוות"` (Leads), `SOURCE_LABELS.staff = "פנייה דרך הצוות"` (Account). Intake chips: שיחת טלפון · פגישה · הפניה · אירוע · לקוח/ה קיים/ת · אחר. Status: חדשה / נוצר קשר / לקוח/ה. Notice: בעל פה / במייל / בוואטסאפ.
- Flag: `VITE_STAFF_LEADS`, read like `src/config/meetings.ts` (`=== "true"`).
- `supabase/tests/*_check.sql` run against a local `supabase start` (Docker). Docker is down on this machine: write the check file; run it only if Docker is started, otherwise say so in the PR.

## Review Focus

- **The same phone in two shapes** (`050-123 4567` vs `+972501234567`) must be one duplicate, landlines too (`03-1234567` vs `+972-3-1234567`). Match on the national number: `regexp_replace(regexp_replace(phone, '\D', '', 'g'), '^(972|0)', '')` — test in Task 2.
- **A User probing for other Users' clients**: a hidden duplicate's answer must carry no id, name or assignee of the other lead — test in Tasks 2 and 4.
- **An Admin assigning to someone outside the agency, or a User passing `p_assignee`**: refused / ignored — test in Task 2.
- **Privacy mail fails or no email was given with method `email`**: the lead still exists, the answer says `noticeSent: false`, and the form tells the member — tests in Tasks 4 and 6. Method `email` without an email is refused by the function (400) and disabled in the form.
- **A direct `update` from the browser** to `brought_by`, `source`, `intake`, consent fields, `notice_method`, or setting `possible_duplicate` to true — refused by the trigger, Admin+ included — test in Task 1. (Rulings 2026-10-20: `duplicate_of uuid` became `possible_duplicate boolean`; the duplicate key is the national number, not the last 9 digits.)

---

### Task 1: Schema — columns, constraints, guard trigger, retention

**Files:**
- Create: `supabase/migrations/20261105000000_staff_leads.sql`
- Create: `tests/contract/staff-leads-schema.contract.test.ts`
- Create: `supabase/tests/staff_leads_check.sql` (schema blocks; Task 2 appends RPC blocks)

**Interfaces:**
- Produces: columns `leads.brought_by uuid`, `intake text`, `referrer_note text`, `notice_method text`, `duplicate_of uuid`; constraint `leads_staff_fields`; index `leads_agency_brought_by`; trigger function `public.leads_guard_staff_fields()` + trigger `leads_guard_staff_fields` (before update on `leads`).

- [ ] **Step 1: Write the failing contract test** (style of `tests/contract/agency-roles-schema.contract.test.ts`: read the migration as source, strip `--` lines). Assertions:
  - `leads_source_check` lists exactly `'consultation','detailed','quick','claim','escalation','interview','staff'`.
  - The five columns exist with the spec's checks (`intake in (...)` six values, `notice_method in (...)` three, `char_length(referrer_note) <= 120`, `duplicate_of references public.leads(id) on delete set null`, `brought_by references auth.users(id) on delete set null`).
  - `leads_staff_fields` requires `brought_by`, `intake`, `notice_method`, `consent_version`, `consent_at` when `source = 'staff'`.
  - `leads_guard_staff_fields` exists, is **not** `security definer`, and names `brought_by`, `source`, `intake`, `consent_version`, `consent_at`, `notice_method`, `duplicate_of`.
  - `anonymize_stale_leads` in this migration sets `referrer_note = null`.
  - No `grant insert` on `public.leads` to `authenticated` or `anon` anywhere in this migration.
- [ ] **Step 2: Run** `npx vitest run tests/contract/staff-leads-schema.contract.test.ts` — Expected: FAIL (file missing).
- [ ] **Step 3: Write the migration's first half.** The spec's "Migration (additive)" block verbatim, then:
  - `leads_guard_staff_fields()` — `language plpgsql`, `set search_path = ''`, runs as the caller like `leads_guard_assignment` (`v_person := current_user in ('authenticated','anon')`). When `v_person and not public.is_admin()`: raise `'staff_fields_fixed'` (errcode `42501`) if any of `brought_by, source, intake, consent_version, consent_at, notice_method` is distinct from old; for `duplicate_of`, allow only a change to `null`, and only if `public.has_role(old.agency_id,'admin')`, else raise `'forbidden'`.
  - `create or replace function public.anonymize_stale_leads(p_now timestamptz default now())`: copy the current body from `20261103000000_client_meetings.sql` unchanged except that the anonymising update also sets `referrer_note = null`; repeat its revoke/grant lines.
- [ ] **Step 4: Write the schema blocks of `supabase/tests/staff_leads_check.sql`** in the style of `client_meetings_check.sql` (begin … rollback, every block raises on a wrong answer): a `staff` row without notice fields is rejected by `leads_staff_fields`; as an `authenticated` Admin of the agency (`set local role authenticated; set local request.jwt.claims …` as in that file), updating `brought_by`/`source`/`notice_method` raises; clearing `duplicate_of` succeeds for the Admin and raises for a User; setting `duplicate_of` to another id raises for the Admin.
- [ ] **Step 5: Run** the contract test — Expected: PASS. If Docker is up: `supabase start` then `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/staff_leads_check.sql` — Expected: no error, `ROLLBACK`.
- [ ] **Step 6: Commit** `git add supabase/migrations/20261105000000_staff_leads.sql supabase/tests/staff_leads_check.sql tests/contract/staff-leads-schema.contract.test.ts && git commit -m "Staff leads: columns, guard trigger, retention"`

### Task 2: The `create_staff_lead` RPC

**Files:**
- Modify: `supabase/migrations/20261105000000_staff_leads.sql` (append)
- Modify: `tests/contract/staff-leads-schema.contract.test.ts`, `supabase/tests/staff_leads_check.sql`

**Interfaces:**
- Consumes: Task 1's columns; existing `public.has_role(uuid,text)`, `public.is_admin()`, `public.can_see_lead(uuid)`, `public.lead_assignee_ok(uuid,uuid)`.
- Produces: `public.create_staff_lead(p_agency_id uuid, p_name text, p_phone text, p_email text, p_topic text, p_notes text, p_intake text, p_referrer text, p_status text, p_notice text, p_assignee uuid, p_duplicate_ok boolean) returns table (lead_id uuid, duplicate text)`; `duplicate` ∈ `null | 'visible' | 'hidden'`. Errors raised (errcode `42501` / `22023`): `forbidden`, `bad_status`, `bad_intake`, `bad_notice`, `field_too_long`, `assignee_not_member`.

- [ ] **Step 1: Extend the contract test**: the function is `security definer` with `set search_path = ''`; `revoke execute … from public, anon, authenticated` then `grant execute … to authenticated`; its body never reads `source`, `brought_by`, `consent_*` or `agency_id` of the row from arguments other than `p_agency_id` (assert the insert names `'staff'`, `auth.uid()`, `'staff-intake-v1'`, `now()`); refuses `escalated` and `partial` (assert the status list is exactly `('new','contacted','client')`).
- [ ] **Step 2: Run** it — Expected: FAIL.
- [ ] **Step 3: Implement** the function in the order the spec's "The RPC" gives (steps 1–5). Pinned details:
  - Lengths: `p_name` ≤ 200, `p_email` ≤ 200, `p_topic` ≤ 200, `p_notes` ≤ 4000, `p_referrer` ≤ 120 (if `LEAD_FIELD_LIMITS` in `supabase/functions/submit-lead/lead.js` differs for name/email/topic, use its values).
  - Assignee: a caller who is not `has_role(p_agency_id,'admin')` and not `is_admin()` → `auth.uid()`; otherwise `p_assignee`, which if not null must pass `lead_assignee_ok(p_agency_id, p_assignee)`.
  - Duplicate key: `right(regexp_replace(phone, '\D', '', 'g'), 9)` equal to the same of `p_phone`, same `agency_id`, `anonymized_at is null`, newest first, limit 1.
  - Visible (`can_see_lead(id)`) and not `p_duplicate_ok` → `return query select id, 'visible'` and stop. Not visible → insert with `duplicate_of = that id`, return `(new id, 'hidden')`.
  - Insert sets `assigned_at = now()`, `assigned_by = auth.uid()` when an assignee is set; `channel` per Global Constraints; `status = p_status`; `notes = p_notes`; `summary` and `message` left null.
- [ ] **Step 4: Append RPC blocks to the check file**: User creates → assigned to self, `brought_by` self, `source 'staff'`, `p_assignee` ignored; Admin assigns to a member; Admin assigning to a member of another agency → `assignee_not_member`; non-member, suspended-agency member, other agency → `forbidden`; `p_status 'escalated'` → `bad_status`; `insert into public.leads` as `authenticated` still raises; visible duplicate (`050-1234567` existing, `+972501234567` passed) → no new row, returns the id with `'visible'`; same as a User who cannot see it → new row with `duplicate_of` set, returns the **new** id with `'hidden'`.
- [ ] **Step 5: Run** contract test (PASS) and, if Docker is up, the check file (clean `ROLLBACK`).
- [ ] **Step 6: Commit** `"Staff leads: create_staff_lead RPC"`

### Task 3: The notice text and the flag (one text, two copies)

**Files:**
- Create: `supabase/functions/create-lead/notice.ts`
- Create: `src/config/staff-leads.ts`
- Create: `tests/contract/staff-intake-notice.contract.test.ts`

**Interfaces:**
- Produces (server): `STAFF_INTAKE_VERSION = 'staff-intake-v1'`; `STAFF_INTAKE_NOTICE: string` (Hebrew plain text); `noticeMail(): { subject: string; html: string; text: string }` (html via `buildClientHtml` from `_shared/html.ts`, as `invite-user` does).
- Produces (client): `STAFF_LEADS: boolean` (from `VITE_STAFF_LEADS`), `isStaffLeadsOn(v: string | undefined): boolean`, `STAFF_INTAKE_NOTICE: string`, `INTAKE_LABELS: Record<Intake, string>`, `NOTICE_LABELS: Record<NoticeMethod, string>`, `STAFF_STATUS_LABELS`, types `Intake`, `NoticeMethod`.

- [ ] **Step 1: Write the failing contract test**: the two `STAFF_INTAKE_NOTICE` strings are byte-identical (read both files as source, extract the template literal); the text mentions `דורית גוב ארי`, the purpose, retention ("24 חודשים"), the right to see/correct/delete, and `https://govari-fin.co.il/privacy`; `isStaffLeadsOn("true") === true`, `isStaffLeadsOn(undefined) === false`, `isStaffLeadsOn(" true ") === true`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Write both files.** The notice is a **draft for the compliance adviser** — say so in a comment above it. Content (Hebrew, ≤ 8 short lines): who (סוכנות דורית גוב ארי, licence L-00107009), what is kept (name, phone, email, topic, notes from the conversation), why (to get back to you and give the service asked for), for how long (24 months from the last contact; clients for as long as they are clients), who sees it (the agency's team only), your rights (to see, correct and ask to delete — `dorit@govari-fin.co.il`), and the policy link.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `"Staff leads: intake notice draft and VITE_STAFF_LEADS"`

### Task 4: `create-lead` Edge Function

**Files:**
- Create: `supabase/functions/create-lead/handler.ts`, `supabase/functions/create-lead/index.ts` (same two lines as `invite-user/index.ts`)
- Modify: `supabase/config.toml` (add `[functions.create-lead]\nverify_jwt = false` with a one-line comment, next to `invite-user`)
- Create: `tests/integration/create-lead.integration.test.ts`, `tests/contract/create-lead.contract.test.ts`

**Interfaces:**
- Consumes: Task 2's RPC; Task 3's `noticeMail`, `STAFF_INTAKE_VERSION`; `_shared/staff.ts` `requireAgencyRole`, `_shared/phone.ts` `contactPhone`, `_shared/masleka.ts` `normalizePhone`, `_shared/guard.ts` `isEmail`, `oversizedField`, `withinLimit`, `submit-lead/lead.js` `redact`, `SHEET_TAB`, `SHEET_COLUMNS`, `_shared/sheets.ts` `appendSheetRow`, `assign-lead/handler.ts` `assignmentMail`, `_shared/ops-notice.ts` `opsNotice`, `ADMIN_LEADS_URL`, `_shared/mail.ts` `sendMail`, `_shared/rest.ts` `callRpc`, `selectRows`, `refusalReason`.
- Produces: `POST /functions/v1/create-lead` with body `{ agencyId, name, phone, email?, topic?, notes?, intake, referrer?, status, notice, assignee?, duplicateOk? }`. Answers: `200 { leadId, duplicate: null | 'hidden', noticeSent: boolean | null, rid, warnings? }`; `409 { duplicate: 'visible', leadId, rid }`; `400 { error, rid }` (bad phone, missing name, bad email, field too long, `notice = 'email'` without email, bad intake/status/notice); `401/403` from the gate; `429` rate limit.

- [ ] **Step 1: Write the failing integration test** with `invokeEdge` from `tests/helpers/edge-function.ts` and a fake Supabase in the style of `invite-user.integration.test.ts` (sessions → users, roles per agency, an `rpc/create_staff_lead` route that records `{ token, body }` and returns a configurable row, `rpc/allow_submission` for the limiter, `profiles`/`memberships` reads, the mailer and Sheets endpoints recorded). Cases:
  - invalid phone `"123"` → 400, no RPC call.
  - `notice: "email"` without `email` → 400.
  - a non-member → 403, no RPC call.
  - the RPC is called **with the caller's token**, with `p_phone` normalised, `p_notes` and `p_topic` passed through `redact` (an Israeli ID `123456782` in notes is not in the RPC body).
  - RPC returns `visible` → 409 `{ duplicate: 'visible', leadId }`, no sheet row, no mail.
  - RPC returns `hidden` → 200 `{ duplicate: 'hidden' }`; the ops notice says `כפילות אפשרית`; the body contains no id other than the new lead's.
  - limiter refuses → 429.
  - `notice: "email"` and the mailer fails → 200, `noticeSent: false`, the lead id present.
  - Admin assigns to another member → that member gets `assignmentMail(leadId)`; a User → no assignment mail.
  - the ops notice (to the agency's admins and owners, read via `memberships` then `profiles`) contains the topic and `ADMIN_LEADS_URL`, and **not** the name, phone or email.
  - the sheet row has `source` = `staff` and an Israel-time timestamp.
- [ ] **Step 2: Run** `npx vitest run tests/integration/create-lead.integration.test.ts` — FAIL.
- [ ] **Step 3: Implement `handler(req: Request): Promise<Response>`** following `invite-user/handler.ts`'s skeleton (CORS, `rid`, `json()` helper, `log` by ids only). Order: method → `requireAgencyRole(req, agencyId, 'user', rid, log)` → validate → `withinLimit(log, rid, \`staff-lead:${gate.userId}\`, 3600, 60)` → `callRpc('create_staff_lead', {...}, gate.token)` (map `refusalReason` → 400/403) → side effects, each in its own try/catch that adds to `warnings`: sheet row (`appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, [...])`, `eventTypeFor` not used — event type `'פנייה ידנית'`), assignment mail when `assignee` is set and differs from the caller, ops notice `"{member email} הוסיף/ה פנייה"` (or `"כפילות אפשרית"` on hidden) to admins/owners, privacy mail when `notice === 'email'`.
- [ ] **Step 4: Write the contract test** (like `tests/contract/invite-user.contract.test.ts`): `config.toml` has the entry; the handler calls `requireAgencyRole(` with `'user'`; calls `callRpc('create_staff_lead'` with the session token as third argument; never calls `insertRow('leads'`; never writes `summary`.
- [ ] **Step 5: Run** both — PASS. **Step 6: Commit** `"Staff leads: create-lead function"`

### Task 5: Port, adapter, permission, labels

**Files:**
- Modify: `src/services/ports.ts` (`LeadSource` + `'staff'`; `LeadRecord` + `broughtBy?: string | null; intake?: Intake | null; referrerNote?: string | null; noticeMethod?: NoticeMethod | null; possibleDuplicate?: boolean`; `LeadAdminPort` + two methods)
- Modify: `src/services/supabase/SupabaseLeadAdminService.ts` (the list reads `brought_by,intake,referrer_note,notice_method,possible_duplicate` **only when `STAFF_LEADS` is on** — ruling: a merge before the production migration must not break the list; the two methods)
- Modify: `src/services/base44/Base44LeadAdminService.ts` (both throw a `STAFF_LEADS_SUPABASE_ONLY` error, as the meetings methods do)
- Modify: `src/config/permissions.ts` (`"leads.create": "user"`), `tests/contract/permissions.contract.test.ts`
- Modify: `src/pages/Leads.tsx` (`SOURCE_LABEL.staff`), `src/pages/Account.tsx` (`SOURCE_LABELS.staff`)
- Test: `tests/unit/supabase-lead-admin.test.ts` (or the existing adapter test file; find it with `grep -rl SupabaseLeadAdminService tests/unit`)

**Interfaces:**
- Produces: `interface NewStaffLead { agencyId: string; name: string; phone: string; email?: string; topic?: string; notes?: string; intake: Intake; referrer?: string; status: "new" | "contacted" | "client"; notice: NoticeMethod; assignee?: string | null; duplicateOk?: boolean }`; `createLead(input: NewStaffLead): Promise<{ leadId: string; duplicate: "visible" | "hidden" | null; noticeSent: boolean | null }>` (a 409 from the function resolves to `{ leadId, duplicate: "visible", noticeSent: null }`, not a throw); `clearDuplicate(leadId: string): Promise<void>` (update `possible_duplicate = false`, applied-or-throw like `setStatus`).

- [ ] **Step 1: Failing tests**: `createLead` invokes `create-lead` with the body above and the bearer token; maps a 409 to `duplicate: "visible"`; rethrows other errors; `clearDuplicate` updates `possible_duplicate` to false and throws when no row came back; `list()` maps `brought_by` → `broughtBy`, `possible_duplicate` → `possibleDuplicate` etc. when the flag is on, and selects exactly today's columns when it is off; permissions contract: `leads.create` is `"user"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** (If `call()` in the adapter cannot surface a 409's body, read it from `error.context` as `functions-js` exposes it; test both shapes.) **Step 4: Run** typecheck + the tests — PASS. **Step 5: Commit** `"Staff leads: port, adapter, permission, labels"`

### Task 6: The "פנייה חדשה" side sheet

**Files:**
- Create: `src/components/dorit/admin/NewLeadSheet.tsx`
- Create: `tests/component/new-lead-sheet.test.tsx`

**Interfaces:**
- Consumes: `SideDrawer` (`src/components/dorit/admin/SideDrawer.tsx`) for the sheet; Task 3's labels and notice; Task 5's `createLead`; `MEETING_TOPICS` from `src/config/needs-wizard.ts` plus `"אחר"`; `contactPhone`-equivalent client check (reuse the site form's phone check — find it with `grep -rn "contactPhone\|isPhone" src/lib src/components/dorit/forms`); `addMeeting(NewLeadMeeting)` for the optional first meeting.
- Produces: `export default function NewLeadSheet(props: { open: boolean; onClose(): void; agencyId: string; canAssign: boolean; assignees: { id: string; label: string }[]; onCreated(leadId: string): void; onOpenExisting(leadId: string): void })`.

- [ ] **Step 1: Failing component tests** (React Testing Library, services mock as in `tests/component/leads-meetings-screen.test.tsx`):
  - "שמירה" is disabled until name, a valid phone, an intake chip and the notice checkbox + method are set.
  - With `canAssign = false` there is no assignee field; with `true` the dropdown defaults to "אני".
  - Choosing הפניה shows "מי הפנה" (maxLength 120).
  - "במייל" is disabled without an email; "בוואטסאפ" shows the notice text and a copy button (`navigator.clipboard.writeText` called with `STAFF_INTAKE_NOTICE`).
  - Submit calls `createLead` with `status: "contacted"` by default and notes in `notes`.
  - `duplicate: "visible"` → shows "פתיחת הפנייה הקיימת" (calls `onOpenExisting(id)`) and "פנייה חדשה לאותו אדם" (resubmits with `duplicateOk: true`).
  - `duplicate: "hidden"` → the confirmation includes "המספר כבר קיים בסוכנות — מנהל/ת יבדוק/תבדוק".
  - `noticeSent: false` → a message telling the member to send the notice another way.
  - The "קבענו כבר פגישה" toggle shows date, time, mode, place; on success `addMeeting` is called with the new lead id and `kind: "first"`; a failed meeting does not hide the created lead (toast says the meeting was not saved).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — fields in the spec's order (Frontend → The form), full-screen below `md`. **Step 4: Run** — PASS. **Step 5: Commit** `"Staff leads: the new-lead sheet"`

### Task 7: The leads screen — button, column, filters, strip, CSV, drawer line

**Files:**
- Modify: `src/pages/Leads.tsx`
- Modify: `src/components/dorit/admin/LeadDrawer.tsx` (the header line)
- Create: `src/lib/staff-leads.ts` (pure helpers) + `tests/unit/staff-leads.test.ts`
- Modify: `tests/component/leads-meetings-screen.test.tsx` (or a new `tests/component/leads-staff.test.tsx`)

**Interfaces:**
- Consumes: Tasks 3, 5, 6.
- Produces: `broughtThisMonth(leads: LeadRecord[], now: Date): Map<string, number>` (Israel-time month of `createdAt`, keyed by `broughtBy`, nulls skipped); `staffLeadLine(lead: LeadRecord, memberLabel: (id: string | null) => string): string | null` → `"נוספה ידנית ע״י {member} · {intake label} · יידוע: {notice label}"`, null for non-staff leads; a missing member renders `"חבר/ה שכבר לא בסוכנות"`.

- [ ] **Step 1: Failing unit tests** for both helpers, including a lead created `2026-10-31T22:30:00Z` counting in **November** (Israel time) and a lead whose `broughtBy` is null.
- [ ] **Step 2: Failing screen tests**, with `STAFF_LEADS` mocked on and off:
  - Off: no "פנייה חדשה" button, no column, no chips, no strip (the page renders exactly as today).
  - On, as a User: the button; a staff lead's source cell shows "דרך הצוות" with its intake label as a tag; the chip "דרך הצוות" filters to `source === "staff"`; no "הובאה ע״י" column, no "כפילות אפשרית" chip, no strip.
  - On, as an Admin: the column, the "כפילות אפשרית" chip (filters to `possibleDuplicate`) with "לא כפילות" calling `clearDuplicate`, and on such a lead a pointer to the agency's other leads with the same national phone number (digits, leading `972`/`0` stripped) — the database stores no link to the other lead, the "הובאו החודש" strip.
  - CSV export includes `brought_by` (member label), `intake`, `referrer_note` columns.
  - The drawer shows `staffLeadLine` under its header for a staff lead.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement**; after a create: toast, refetch the list, open the new lead's drawer. **Step 5: Run** — PASS.
- [ ] **Step 6: Full local CI** (the project rule): `npm run lint`, `npm run typecheck`, `npm run build:prerender`, `npx vitest run` (all five suites, with `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY=`), `CI=1 npx playwright test --project='*'`. Expected: all green.
- [ ] **Step 7: Commit** `"Staff leads: the leads screen, behind VITE_STAFF_LEADS"`; push; open the PR, listing: migration not applied to production; `staff-intake-v1` awaits the compliance adviser; the SQL check file's run status.
