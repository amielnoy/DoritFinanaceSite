# Staff-added clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any agency member can add someone who is already a client ("הוספה" → לקוח/ה), or turn a matching old lead into a client, recorded as *opened as a client* with since-when, the product lines, and how they were informed — behind `VITE_STAFF_CLIENTS` (off).

**Architecture:** One additive migration adds three `leads` columns and two constraints, extends the staff-field guard and the retention job, replaces `create_staff_lead` with a 15-argument version (three trailing defaulted args), and adds `convert_lead_to_client` (security invoker). `create-lead` gains `kind: 'client'`; a new `invite-client` function mails the personal-area link. The existing new-lead sheet gains a client mode, a conversion path and a next-steps card; the leads screen, drawer, strip and CSV learn the new fields. Supabase adapter only.

**Tech Stack:** Postgres/Supabase migrations, Deno Edge Functions (`supabase/functions/*/handler.ts`), React + TanStack Query, Vitest (unit/component/contract/integration), psql check files.

**Spec:** `docs/superpowers/specs/2026-10-22-staff-client-design.md` — C1–C8 accepted as proposed (2026-10-22, under the standing "take the recommended option" rule). Open choices settled as the spec proposes: no label in `/account`; the invite is recorded in the event sheet, no `invited_at` column. This plan covers rollout steps 1 and 3. Out: applying the migration to production, the adviser's approval of `staff-client-v1`, the privacy-policy line, turning either flag on.

## Global Constraints

- Migration file: **`supabase/migrations/20261113000000_staff_clients.sql`** (`20261106000000` and `20261108000000` are taken — agency onboarding and lead duplicates; prod history ends `20261112000000`, re-checked 2026-10-26). The guard's body is still `20261105000000`'s; `anonymize_stale_leads`'s current body is `20261108000000_lead_duplicates.sql`'s (merged groups kept together) — build on that one, and use the client test (`status = 'client' or opened_as = 'client' or client_since is not null`) in its merged-group clauses too. `create_staff_lead` is still `20261105000000`'s; the pipeline (`20261109000000`) widened `leads_status_check` but not the RPC. Additive only.
- `opened_as` ∈ `lead, client`, default `'lead'`, never changed by a person after insert (guard). `client_since` = first of a month, `≥ 1990-01-01`, `≤` this month in `Asia/Jerusalem`. `products` ⊆ `pension, provident, life, health, savings, planning, claims, other`, non-empty for a client.
- `notice_method` gains `'agreement'`, allowed only when `opened_as = 'client'`.
- `consent_version`: `'staff-client-v1'` for a client opened by hand, `'staff-intake-v1'` otherwise — set by the RPC, never by the caller. Conversion keeps the original consent and `opened_as = 'lead'`.
- Product labels (client and server, one list): pension פנסיה · provident גמל והשתלמות · life ביטוח חיים ומשכנתא · health בריאות וסיעוד · savings חיסכון והשקעות · planning תכנון פיננסי · claims ליווי תביעות · other אחר. `NOTICE_LABELS.agreement = "בהסכם ההתקשרות"`.
- Flags: client `VITE_STAFF_CLIENTS` (`src/config/staff-clients.ts`, `=== "true"` after trim, like `isStaffLeadsOn`); server `STAFF_CLIENTS` (same rule). Client mode needs `STAFF_LEADS` **and** `STAFF_CLIENTS`. Agency 1 only, as staff leads.
- With `VITE_STAFF_CLIENTS` off, the leads screen and the adapter's `select` are exactly as today (a merge before the prod migration must not break the list).
- Every function answer carries `rid`; logs by ids only; no name, phone or email in ops notices; Israel time for anything shown or written to the sheet.
- No amounts, policy numbers, balances, ID or medical details anywhere; `scrub`/`fit` still run on free text.
- SQL check files: Docker is down here — run them on the pgserver stand-in (memory: `sql-standin-without-docker`) if available this session, else say so in the PR.
- Before pushing: `npm run lint`, `npm run typecheck`, `npm run build:prerender`, `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vitest run` (all five suites), `CI=1 npx playwright test --project='*'`.

## Review Focus

- **Converting a lead the caller cannot update** (a User and someone else's lead, found through a hidden match or a stale id): an RLS-filtered update changes 0 rows — the function must raise `not_found`, not return quietly — test in Task 2.
- **`client_since` this month at the month boundary**: on 2026-10-31 23:30 UTC it is already November in Israel, so `2026-11-01` must be accepted and `2026-12-01` refused; the form's year/month selects must offer November then — tests in Tasks 2 and 6.
- **An old 12-argument call** (a cached browser bundle, the integration fake) must keep working: named args with the three new ones absent → exactly today's lead — test in Task 2 (direct named call without the new args) and Task 4 (body without `kind` sends no `p_as_client`).
- **The client flag off server-side while the browser has it on** → `400`, nothing written, and the sheet says so in Hebrew rather than spinning — tests in Tasks 4 and 6.
- **A former client (`status` later set to `closed`)** must not be anonymised after 24 months if `opened_as = 'client'` or `client_since` is set, and its contact row must survive too — test in Task 1.

---

### Task 1: Schema — columns, constraints, guard, retention

**Files:**
- Create: `supabase/migrations/20261113000000_staff_clients.sql`
- Create: `tests/contract/staff-clients-schema.contract.test.ts`
- Create: `supabase/tests/staff_clients_check.sql` (schema blocks; Task 2 appends)

**Interfaces:**
- Produces: `leads.opened_as text not null default 'lead'`, `leads.client_since date`, `leads.products text[]`; constraints `leads_notice_method_check` (four values), `leads_opened_as_client`, `leads_agreement_notice`; `leads_guard_staff_fields()` now also fixes `opened_as`; `anonymize_stale_leads` skips client-opened rows.

- [ ] **Step 1: Failing contract test** (style of `tests/contract/staff-leads-schema.contract.test.ts`, source with `--` lines stripped): the three columns with the spec's checks (eight product values, `date '1990-01-01'`, `date_trunc('month', client_since)`); `notice_method in ('verbal','email','whatsapp','agreement')`; `leads_opened_as_client` names `source = 'staff'`, `client_since is not null`, `cardinality(products) >= 1`, `consent_version = 'staff-client-v1'`; `leads_agreement_notice`; the guard is `create or replace`, not `security definer`, and names `opened_as` beside the six existing fields; `anonymize_stale_leads` here has `opened_as = 'lead'` and `client_since is null` in the stale rows **and** in the contacts `not exists`, and still sets `referrer_note = null`; no `grant insert` on `public.leads`.
- [ ] **Step 2: Run** `npx vitest run tests/contract/staff-clients-schema.contract.test.ts` — FAIL.
- [ ] **Step 3: Write the migration's first half**: the spec's "Migration (additive)" block verbatim; `create or replace function public.leads_guard_staff_fields()` — the body of `20261105000000_staff_leads.sql` with `or new.opened_as is distinct from old.opened_as` added to the fixed list; `create or replace function public.anonymize_stale_leads(...)` — that file's body, with the contacts clause becoming `(k.status = 'client' or k.opened_as = 'client' or k.client_since is not null or greatest(...) >= cutoff)` and the stale rows gaining `and l.opened_as = 'lead' and l.client_since is null`. Repeat both revoke lines. A header comment says the exclusion holds until the adviser gives the engagement retention period.
- [ ] **Step 4: Schema blocks in `staff_clients_check.sql`** (style of `staff_leads_check.sql`, `begin … rollback`, each block raises on a wrong answer): a client-opened row without `products` fails `leads_opened_as_client`; `client_since = '2019-03-15'` fails; `notice_method = 'agreement'` on an `opened_as = 'lead'` row fails; an authenticated Admin updating `opened_as` raises `staff_fields_fixed`; an Admin updating `client_since`/`products` on a lead they may update succeeds; `anonymize_stale_leads(now() + interval '30 months')` leaves a `closed` row with `client_since` set (and its contact) intact and still anonymises a plain stale lead.
- [ ] **Step 5: Run** the contract test (PASS) and the check file if a Postgres is available (clean `ROLLBACK`).
- [ ] **Step 6: Commit** `"Staff clients: columns, constraints, guard, retention"`

### Task 2: `create_staff_lead` replaced, and `convert_lead_to_client`

**Files:**
- Modify: `supabase/migrations/20261113000000_staff_clients.sql` (append), `tests/contract/staff-clients-schema.contract.test.ts`, `supabase/tests/staff_clients_check.sql`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `public.create_staff_lead(<the 12 existing args>, p_as_client boolean default false, p_client_since date default null, p_products text[] default null) returns table (lead_id uuid, duplicate text)`; `public.convert_lead_to_client(p_lead_id uuid, p_client_since date, p_products text[]) returns uuid` (the converted lead's id; a lead merged into another converts its main lead — decided 2026-10-26), security **invoker**. New refusals: `bad_since`, `bad_products` (errcode `22023`), `not_found` (`P0002`).

- [ ] **Step 1: Extend the contract test**: `drop function public.create_staff_lead(uuid, text, text, text, text, text, text, text, text, text, uuid, boolean)` precedes the create; the new signature has the three defaulted args last; insert names `case when p_as_client then 'client' else 'lead' end` and both consent versions; revoke/grant lines name the 15-arg signature; `convert_lead_to_client` is not `security definer`, sets `search_path = ''`, never writes `opened_as`, `consent_*` or `source`, and is granted to `authenticated` only.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Copy the 20261105 body; change only the spec's three steps. One shared month/list check used by both functions: write `public.client_fields_ok(p_since date, p_products text[]) returns text` (null when fine, else `'bad_since'`/`'bad_products'`), `stable` (it reads the clock), `set search_path = ''`; "this month" is `date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date`. In `create_staff_lead`: when `p_as_client`, status is `'client'` whatever `p_status` says (validate `p_status` only when not a client), `p_notice` may be `agreement`; when not, `agreement` → `bad_notice`, a non-null `p_client_since`/`p_products` → `field_invalid`. `convert_lead_to_client`: check fields, then `update public.leads set status = 'client', client_since = …, products = … where id = p_lead_id returning id`; nothing returned → raise `not_found`. Revoke both from `public, anon, authenticated`, grant to `authenticated`; revoke `client_fields_ok` from all three.
- [ ] **Step 4: RPC blocks in the check file**: a User adds a client with `p_status 'new'` → `status 'client'`, `opened_as 'client'`, `consent_version 'staff-client-v1'`, assigned to self; future month, mid-month date, `'1989-12-01'`, `'{}'`, `'{pension,crypto}'` → refused; `agreement` without `p_as_client` → `bad_notice`; `p_products` without `p_as_client` → `field_invalid`; a named call with only the 12 old args → a lead exactly as before (`opened_as 'lead'`, `staff-intake-v1`); the month boundary — assert `client_fields_ok(date_trunc('month', now() at time zone 'Asia/Jerusalem')::date, '{pension}')` is null and next month's is `'bad_since'`; conversion by the assignee and by an Admin → `status 'client'`, fields set, `opened_as` still `'lead'`, consent unchanged; conversion by a User on another member's lead → raises `not_found`, row unchanged.
- [ ] **Step 5: Run** contract test (PASS); check file if Postgres available.
- [ ] **Step 6: Commit** `"Staff clients: create_staff_lead learns clients; convert_lead_to_client"`

### Task 3: The client notice, product list and flags (one text, two copies)

**Files:**
- Modify: `supabase/functions/create-lead/notice.ts`, `src/config/staff-leads.ts` (`NOTICE_LABELS.agreement`), `src/lib/staff-lead-types.ts` (`NoticeMethod` + `"agreement"`; new `Product`)
- Create: `src/config/staff-clients.ts`, `supabase/functions/_shared/staff-clients.ts`
- Modify: `tests/contract/staff-intake-notice.contract.test.ts`

**Interfaces:**
- Produces (server, `notice.ts`): `STAFF_CLIENT_VERSION = 'staff-client-v1'`, `STAFF_CLIENT_NOTICE: string`, `noticeMail(kind: 'lead' | 'client' = 'lead')`. (`_shared/staff-clients.ts`): `PRODUCTS: readonly Product[]`, `PRODUCT_LABELS: Record<Product, string>`, `staffClientsEnabled(): boolean` (env `STAFF_CLIENTS`).
- Produces (client, `staff-clients.ts`): `isStaffClientsOn(v)`, `STAFF_CLIENTS: boolean`, `PRODUCT_LABELS`, `PRODUCTS`, `STAFF_CLIENT_NOTICE`, `CLIENT_NOTICE_METHODS: NoticeMethod[] = ["agreement","verbal","email","whatsapp"]`.

- [ ] **Step 1: Extend the contract test**: the two `STAFF_CLIENT_NOTICE` copies are byte-identical; it names סוכנות דורית גוב ארי, "הסכם ההתקשרות", retention "כנדרש על-פי דין", the rights and `/privacy`, and does **not** contain "24 חודשים"; the two `PRODUCT_LABELS` objects are identical and their keys equal the migration's product list (read it from `20261113000000_staff_clients.sql`); `isStaffClientsOn` trims; `noticeMail('client').text` contains the client text and `noticeMail()` is unchanged.
- [ ] **Step 2: Run** — FAIL. **Step 3: Write.** Draft-for-adviser comment above the text, as the intake one. Content (≤ 6 lines): the agency keeps the details given under the engagement agreement (name, phone, email, the services handled, notes); to give the service agreed; kept as the law and the Capital Market Authority's rules require; seen by the agency's team only; the rights line and the policy link — the same two closing lines as the intake text. **Step 4: Run** — PASS. **Step 5: Commit** `"Staff clients: client notice draft, product list, flags"`

### Task 4: `create-lead` learns `kind: 'client'`

**Files:**
- Modify: `supabase/functions/create-lead/handler.ts`, `tests/integration/create-lead.integration.test.ts`, `tests/contract/create-lead.contract.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3; `maslekaEnabled()` from `_shared/masleka.ts`.
- Produces: body adds `kind?: 'lead' | 'client'`, `clientSince?: 'YYYY-MM'`, `products?: Product[]`. `200` adds, for a client, `next: { invite: boolean, masleka: boolean }` (`invite` = an email was given; `masleka` = `maslekaEnabled()` — every role holds `masleka.create`). New 400s: `kind: 'client'` with `STAFF_CLIENTS` off; bad `clientSince`; empty/unknown `products`; `notice: 'agreement'` on a lead. RPC refusals `bad_since`/`bad_products` get Hebrew messages.

- [ ] **Step 1: Failing integration cases**: `kind:'client'` with the env off → 400, no RPC call; on → the RPC body has `p_as_client: true`, `p_client_since: '2019-03-01'` from `'2019-03'`, `p_products`; a body without `kind` sends **no** `p_as_client`/`p_client_since`/`p_products` keys; `agreement` on a lead → 400; `clientSince: '2019-13'` → 400; `products: []` → 400; `notice:'email'` client → the mail's text is `STAFF_CLIENT_NOTICE`; `agreement` → no client mail, `noticeSent: null`; the ops title is `"{member} הוסיף/ה לקוח/ה"` with a `תחומים` row of Hebrew labels and no name/phone/email; the sheet row's summary cell starts `לקוח/ה · ` and the row still has `SHEET_COLUMNS.length` cells; `next` is `{ invite: true, masleka: false }` with an email and the masleka env off; a visible duplicate is still 409.
- [ ] **Step 2: Run** `npx vitest run tests/integration/create-lead.integration.test.ts` — FAIL.
- [ ] **Step 3: Implement** in the existing order. `clientSince` must match `/^\d{4}-(0[1-9]|1[0-2])$/` → `${v}-01`; leave the future/1990 check to the RPC. Status for a client is sent as `'client'`. Which sheet cell is "summary": find it by name in `SHEET_COLUMNS`, not by index. Contract test: the handler checks `staffClientsEnabled()` before any `callRpc`.
- [ ] **Step 4: Run** both — PASS. **Step 5: Commit** `"Staff clients: create-lead kind client"`

### Task 5: `invite-client` — the personal-area invitation

**Files:**
- Create: `supabase/functions/invite-client/handler.ts`, `supabase/functions/invite-client/index.ts` (as `create-lead/index.ts`)
- Modify: `supabase/config.toml` (`[functions.invite-client]`, `verify_jwt = false`, beside `create-lead`)
- Create: `tests/integration/invite-client.integration.test.ts`, `tests/contract/invite-client.contract.test.ts`

**Interfaces:**
- Produces: `POST /functions/v1/invite-client` `{ agencyId, leadId }` → `200 { sent: true, rid }`; `400` bad ids / no email on the lead / not a client; `403` gate or agency ≠ `AGENCY_1` or `STAFF_CLIENTS` off; `404` the caller cannot see the lead; `409 { error, rid }` already invited (limiter `client-invite:<leadId>`, 2 per 365 days — decided 2026-10-26: the limiter counts before the mail goes, so 1 would lock a lead out for a year after one mailer failure); `502` mail failed.

- [ ] **Step 1: Failing tests** (fake Supabase as in `create-lead.integration.test.ts`): the lead is read **with the caller's token** (`leads?id=eq.…&select=id,name,email,status,agency_id`), so an RLS-empty answer → 404 and no mail; a lead with `status ≠ 'client'` → 400; no email → 400; third call → 409; the mail goes to the lead's email with a link to `https://govari-fin.co.il/login?returnTo=/account` (the app's parameter; the spec's `?next=` is not read), first name only in the greeting; a sheet row with event type `client_invite` and the lead id; no Auth admin call anywhere (contract: the handler never calls `/auth/v1/admin` or `inviteUserByEmail`).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** on `create-lead/handler.ts`'s skeleton (CORS, `rid`, `json()`, `requireAgencyRole(req, agencyId, 'user', rid, log)`); mail built with `buildClientHtml`. **Step 4: Run** — PASS. **Step 5: Commit** `"Staff clients: invite-client function"`

### Task 6: Port, adapter, permission

**Files:**
- Modify: `src/services/ports.ts`, `src/services/supabase/SupabaseLeadAdminService.ts`, `src/services/base44/Base44LeadAdminService.ts`, `src/config/permissions.ts`, `tests/contract/permissions.contract.test.ts`
- Test: the existing adapter test (`grep -rl SupabaseLeadAdminService tests/unit`)

**Interfaces:**
- Produces: `LeadRecord` + `openedAs?: "lead" | "client"; clientSince?: string | null /* "YYYY-MM" */; products?: Product[] | null`. `NewStaffLead` + `kind?: "lead" | "client"; clientSince?: string; products?: Product[]`. `CreatedLead` + `next?: { invite: boolean; masleka: boolean }`. `LeadAdminPort` + `convertToClient(leadId: string, since: string /* YYYY-MM */, products: Product[]): Promise<void>` (rpc `convert_lead_to_client`, maps `YYYY-MM` → `YYYY-MM-01`) and `inviteClient(agencyId: string, leadId: string): Promise<void>` (via `call("invite-client", …)`). Permission `"clients.create": "user"`. Base44: both throw `STAFF_LEADS_SUPABASE_ONLY`.

- [ ] **Step 1: Failing tests**: `list()` adds `opened_as,client_since,products` to the select only when the adapter's `staffClients` constructor flag is on (a fifth constructor arg defaulting to `STAFF_CLIENTS`), maps `client_since '2019-03-01'` → `"2019-03"`, and selects exactly today's columns when off; `createLead` forwards `kind/clientSince/products` and `next`; `convertToClient` calls the RPC (widen `SupabaseLeadTableClient` in `SupabaseTableClient.ts` with `rpc` if it lacks it) with `p_client_since: "2019-03-01"` and rethrows its error; `inviteClient` posts `{ agencyId, leadId }`; permissions contract: `clients.create` is `"user"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** typecheck + tests — PASS. **Step 5: Commit** `"Staff clients: port, adapter, permission"`

### Task 7: The sheet — client mode, conversion, next steps

**Files:**
- Modify: `src/components/dorit/admin/NewLeadSheet.tsx`, `src/components/dorit/admin/NewLeadSheetHost.tsx`
- Create: `src/components/dorit/admin/ClientFields.tsx` (since selects + product chips; reused by the drawer in Task 8), `src/components/dorit/admin/ClientNextSteps.tsx`
- Create: `tests/component/new-client-sheet.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 6; `MEETINGS_STAFF`.
- Produces: `ClientFields(props: { since: string; products: Product[]; onChange(v: { since: string; products: Product[] }): void; now?: Date })` — month/year selects from 1990-01 to this Israel month; `ClientNextSteps(props: { name: string; leadId: string; agencyId: string; next: { invite: boolean; masleka: boolean }; onClose(): void; onOpenLead(id: string): void })` — the masleka button links to `/admin/masleka?lead=<id>`, the meeting button calls `onOpenLead` (the drawer holds meetings). `NewLeadSheet` gains `canAddClient: boolean`; the mode is remembered in `localStorage` key `staff-sheet-mode` (try/catch).

- [ ] **Step 1: Failing component tests**: without `canAddClient` no switch (sheet as today); the switch remembers "לקוח/ה" across mounts; client mode hides מצב and נושא and shows לקוח/ה מאז and תחומים; "שמירת לקוח/ה" disabled until ≥1 product, a since month and the notice box + method; "בהסכם ההתקשרות" is first and preselected; with `now = 2026-10-31T22:30:00Z` the latest month offered is 11/2026; submit sends `kind:"client"`, `clientSince`, `products`; a 400 shows the server's Hebrew text; `duplicate:"visible"` shows "הפיכת הפנייה הקיימת ללקוח/ה" (calls `convertToClient` with the form's since/products, then `onOpenExisting`) and "לקוח/ה חדש/ה בכל זאת" (resubmits with `duplicateOk`); success shows "✓ {name} נוספ/ה כלקוח/ה" with the invite button only when `next.invite`, masleka only when `next.masleka`, meeting only when `MEETINGS_STAFF`; the invite button calls `inviteClient` once and then shows "ההזמנה נשלחה" (a 409 shows "כבר נשלחה הזמנה"); on a 390px viewport class the sheet is full-screen and chips have `min-h-11`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Use the spec's sketch for order and copy. **Step 4: Run** — PASS. **Step 5: Commit** `"Staff clients: client mode in the add sheet"`

### Task 8: Leads screen, drawer, strip, CSV, masleka preselect

**Files:**
- Modify: `src/pages/Leads.tsx`, `src/components/dorit/admin/LeadDrawer.tsx`, `src/components/dorit/admin/StaffLeadsStrip.tsx`, `src/lib/staff-leads.ts`, `src/pages/MaslekaBoard.tsx`
- Test: `tests/unit/staff-leads.test.ts`, `tests/component/leads-staff.test.tsx`, the MaslekaBoard component test (`grep -rl MaslekaBoard tests/component`)
- Modify: `tests/test-plan/01-std-unit.md`, `02-std-component.md`, `03-std-contract.md`, `12-std-integration.md`, `09-traceability-matrix.md`

**Interfaces:**
- Consumes: Tasks 3, 6, 7.
- Produces: `broughtThisMonth` returns `Map<string, { leads: number; clients: number }>` (clients = `openedAs === "client"`); `staffLeadLine` for a client-opened row → `"נפתח/ה כלקוח/ה ע״י {member} · לקוח/ה מאז MM/YYYY · {products}"`; `productsLabel(p: Product[] | null | undefined): string` (Hebrew, `", "`-joined).

- [ ] **Step 1: Failing unit tests**: the new `broughtThisMonth` shape incl. the Israel-month case; `staffLeadLine` for a client and for a lead (unchanged text); `productsLabel([])` is `""`.
- [ ] **Step 2: Failing screen tests**, `STAFF_CLIENTS` mocked on and off: off → the page and CSV exactly as today; on → the button reads "הוספה"; client rows show product tags; Admin+ chip "נפתחו כלקוחות" filters to `openedAs === "client"`; the strip shows `פניות · לקוחות` per member; CSV adds `נפתח/ה כ`, `לקוח/ה מאז` (`MM/YYYY`), `תחומים` (`;`-joined); the drawer of any `status === "client"` row shows `ClientFields` and saving calls `convertToClient`; MaslekaBoard with `?lead=<id>` opens the new-request form with that lead chosen.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS; update the STDs and traceability rows for every suite touched.
- [ ] **Step 6: Full local CI** (Global Constraints). Expected: all green.
- [ ] **Step 7: Commit** `"Staff clients: leads screen, drawer, strip, CSV, behind VITE_STAFF_CLIENTS"`; push; open the PR stating: migration `20261113000000` not applied to production (do not merge before it is); `STAFF_CLIENTS` env and `invite-client` deploy needed; `staff-client-v1` awaits the adviser; the check file's run status; the e2e line of the spec is covered by component tests (no admin e2e exists — CI has no Supabase session).
