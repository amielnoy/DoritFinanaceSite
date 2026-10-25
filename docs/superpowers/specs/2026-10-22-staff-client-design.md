# Adding a client by hand: a client who never came in as a lead

**Date:** 2026-10-22 · **Status:** draft for review. Nothing here is built.
Extends `2026-10-20-staff-lead-design.md` (built in #282/#283, behind
`VITE_STAFF_LEADS`), `2026-10-15-agency-roles-design.md` and
`2026-10-17-client-meetings-design.md`.

## Why

The staff-lead form ("פנייה חדשה") lets a member open an *enquiry* by hand,
and it can start it as `status = 'client'`. That covers "someone called and
we're talking". It does not cover the other common case: a person who is
**already a client** and was never an enquiry in this system — signed in the
office, a family member added to an existing household, a policyholder Dorit
has served for years, someone a colleague handed over with their portfolio.

Recording that person through the lead form today goes wrong in four ways:

- **It reads as an enquiry.** The row looks like a lead that converted on the
  day it was typed in; "client since" is lost, so is what they hold with us.
- **The wrong notice.** `staff-intake-v1` tells the person an enquiry that did
  not mature is kept 24 months. A client signed an engagement agreement (and
  usually a power of attorney); they were informed there, and the retention
  that applies to them is the one for an engagement, not an enquiry.
- **The wrong duplicate answer.** A client is often a former lead. When the
  phone matches a lead the member can see, the right action is to make *that*
  lead a client, not "open it" or "add a second lead".
- **No next step.** What follows a new client is the personal area invite, a
  clearinghouse (מסלקה) request and a first service meeting — the form ends at
  "saved".

**Outcome:** any member can add a client directly, from the same place they add
an enquiry. The row is an ordinary `leads` row (so meetings, the
clearinghouse, `/account` and retention keep working unchanged), recorded as
*opened as a client*, with when the relationship began, the fields it covers,
and how the person was informed.

**Success looks like:**

- Dorit adds "רחל לוי, 052…, לקוחה מאז 2019, פנסיה + בריאות" in under a
  minute, then sends the personal-area invite from the confirmation.
- A User types a phone that belongs to their own old lead; the form offers
  **"הפיכת הפנייה הקיימת ללקוח/ה"** and fills the client fields on it — no
  second row.
- The Owner can tell new clients that came through the funnel from ones that
  were typed in, and the per-member strip counts them apart.
- A User still cannot assign, write `source`, consent fields, or `opened_as`
  directly, and cannot create in another agency.

## Scope

**In:** a "לקוח/ה" mode of the existing sheet; three columns (`opened_as`,
`client_since`, `products`); a client notice text and a fourth notice method;
the "make the existing lead a client" duplicate path; post-save next steps;
list/drawer/CSV/strip changes; tests.

**Out (later):** CSV import of Dorit's book (still needs its own privacy
answer — staff-lead §Scope); a `clients`/households table separate from
`leads`; policy-level records (policy numbers, premiums — the clearinghouse is
the source for those); annual-review reminders; anything from an ID number.

## Decisions (proposed — each needs Amiel's yes)

| # | Decision | Proposal | Why |
|---|---|---|---|
| C1 | Data model | **No new table.** A client is a `leads` row with `status = 'client'`, `source = 'staff'`, plus a fixed **`opened_as = 'client'`** | Everything hangs off `leads` (meetings, `masleka_requests`, claim documents, `enquiries_for`, retention, `can_see_lead`). A `clients` table means re-pointing all of it; worth doing only with households, and not now. |
| C2 | Write path | Extend **`create_staff_lead`** with three trailing, defaulted args; `create-lead` takes `kind: 'lead' \| 'client'` | One RPC holds the role, rate-limit, duplicate and redaction rules. A second RPC would copy them, and copies drift. Defaults keep today's callers byte-for-byte the same. |
| C3 | Who may add | **Every role**, same assignment rule as staff-lead D3 (User → self; Admin+ chooses) | Same as for leads; signing clients is the agent's job. |
| C4 | Client fields | **`client_since`** (month, ≥ 1990-01, ≤ this month; default this month) and **`products`** (a fixed list, ≥ 1). Both editable later by whoever may update the lead | They answer "how long" and "what do we do for them", which the Owner and the next meeting need. Fixed lists, never free text about money. |
| C5 | Notice | Text **`staff-client-v1`** (engagement wording, retention "as the law requires"); `notice_method` gains **`agreement`** ("נמסר בהסכם ההתקשרות"), allowed only when `opened_as = 'client'` | A client is informed through the engagement agreement; the record must say so and point at the right text. Open item for the compliance adviser below. |
| C6 | Visible duplicate | Primary action **"הפיכת הפנייה הקיימת ללקוח/ה"**: status → `client` and the client fields written on that lead; secondary "לקוח/ה חדש/ה בכל זאת" | A client is very often last year's lead. Keeping one row keeps the history (interview, meetings) together. |
| C7 | Funnel | `opened_as` is set at insert and **never changes** (guard trigger); a lead later marked client stays `opened_as = 'lead'` | So "how many leads became clients" stays honest when typed-in clients are added. |
| C8 | Flag | New **`VITE_STAFF_CLIENTS`**, off by default, agency 1 only (like staff leads) | Lets the lead form go on first, and the client mode wait for the notice wording. |

### `products` — the list

`pension` פנסיה · `provident` גמל והשתלמות · `life` ביטוח חיים ומשכנתא ·
`health` בריאות וסיעוד · `savings` חיסכון והשקעות · `planning` תכנון פיננסי ·
`claims` ליווי תביעות · `other` אחר

A product line is a service the agency gives, not a fact about the person's
health or finances: "בריאות וסיעוד" says the agency handles their health
policy, nothing about their health. No amounts, no policy numbers, no
balances — ever.

## Data

### Migration (additive) — `20261106000000_staff_clients.sql`

```sql
alter table public.leads
  add column opened_as    text not null default 'lead' check (opened_as in ('lead','client')),
  add column client_since date check (client_since >= date '1990-01-01'
                                      and client_since = date_trunc('month', client_since)),
  add column products     text[] check (products <@ array['pension','provident','life','health',
                                         'savings','planning','claims','other']::text[]);

alter table public.leads drop constraint leads_notice_method_check;
alter table public.leads add constraint leads_notice_method_check
  check (notice_method in ('verbal','email','whatsapp','agreement'));

-- A row opened as a client is a staff row with its client fields and the client notice.
alter table public.leads add constraint leads_opened_as_client check (
  opened_as = 'lead'
  or (source = 'staff' and client_since is not null
      and cardinality(products) >= 1 and consent_version = 'staff-client-v1')
) not valid;
alter table public.leads validate constraint leads_opened_as_client;

-- "agreement" only for someone who has one.
alter table public.leads add constraint leads_agreement_notice check (
  notice_method is distinct from 'agreement' or opened_as = 'client'
);
```

`leads_guard_staff_fields` adds `opened_as` to the fixed list. `client_since`
and `products` are **not** fixed: they follow `leads_update_*` like `notes`.

`client_since` is stored as the first of the month — the form asks month and
year, and nobody remembers the day a relationship started.

### The RPC — `create_staff_lead`, replaced

Drop and recreate with three trailing arguments (the grant lines name the new
signature; the contract test that lists RPC signatures changes with it):

```sql
  ...,
  p_duplicate_ok  boolean,
  p_as_client     boolean default false,
  p_client_since  date    default null,
  p_products      text[]  default null
) returns table (lead_id uuid, duplicate text)
```

Changes inside, against the steps already there:

- **2 (what may be said):** when `p_as_client`: `p_status` is ignored and set
  to `'client'`; `p_client_since` required, ≤ this month in Israel time, first
  of month; `p_products` non-empty and in the list; `p_notice` may be
  `agreement`. When not `p_as_client`: `agreement`, `p_client_since` and
  `p_products` are refused (`bad_notice` / `field_invalid`).
- **4 (duplicate):** unchanged search. A visible match without
  `p_duplicate_ok` still returns `(id, 'visible')` and writes nothing; the
  *conversion* is a separate call (below), so this function never updates a
  row it did not create.
- **5 (write):** `opened_as = case when p_as_client then 'client' else 'lead'
  end`, `consent_version` `'staff-client-v1'` or `'staff-intake-v1'`, plus the
  two client columns.

### Making an existing lead a client — `convert_lead_to_client`

```sql
create function public.convert_lead_to_client(
  p_lead_id uuid, p_client_since date, p_products text[]
) returns void   -- security invoker: the caller's own update rights decide
```

It is an ordinary update under the caller's session — `status = 'client'`,
`client_since`, `products` — so `leads_update_*` and `can_see_lead` decide
exactly as they do for a status change from the drawer, and it asks for the
row back (an RLS-filtered update returns nothing; nothing is an error —
`SupabaseLeadAdminService`'s rule). `opened_as` stays `'lead'` (C7), the
original consent stays (the person was informed when they enquired). A
function rather than three PATCHed fields only so the month and list checks
live in one place.

### What the client sees

Nothing new in `enquiries_for` (11 columns, pinned). `/account` shows the row
as it shows any staff row — "פנייה דרך הצוות". *Open choice:* a label
"לקוח/ה" there would need `opened_as` or `status` in `enquiries_for`;
proposed **not** now, since the personal area's value for a client is the
meetings and the clearinghouse, not the label.

## Server — `create-lead`

- Body gains `kind` (`'lead'` default) and, for `'client'`, `clientSince`
  (`YYYY-MM`) and `products`. Refused with `400 invalid` when the flag is off
  server-side (`STAFF_CLIENTS` env, as `create-lead` already checks agency 1).
- Calls `create_staff_lead` with `p_as_client = true`. Visible duplicate →
  `409 { duplicate: 'visible', leadId }` as today; the sheet then offers
  conversion, which calls `convert_lead_to_client` through the
  `SupabaseLeadAdminService` adapter, not this function.
- Notice mail (`notice_method = 'email'`): the **`staff-client-v1`** text.
  `agreement` and `verbal` send nothing.
- Sheet row: `source = staff`, and the summary cell starts "לקוח/ה ·" with the
  product labels; no new column (19 stays 19).
- Ops notice to Admins/Owners: "{member} הוסיף/ה לקוח/ה" with the products
  and the link — no name or phone, as for leads.
- Answer adds `next: { invite: boolean, masleka: boolean }` — whether the
  invite (needs an email) and a clearinghouse request (`VITE_MASLEKA_ENABLED`,
  `masleka.create` for the role) are available, so the sheet doesn't guess.
- `rid` in every answer, Israel time, no error text — as everywhere.

`notice.ts` gains `STAFF_CLIENT_NOTICE`; `src/config/staff-leads.ts` gets the
same string, and `staff-intake-notice.contract.test.ts` checks both pairs.

## Frontend

### Entry

The "פנייה חדשה" button becomes **"הוספה"** when `VITE_STAFF_CLIENTS` is on
(unchanged otherwise). The sheet opens with a two-way switch at the top:

```
┌──────────────────────────────────────────────┐
│  הוספה                                    ✕  │
│  ┌───────────────┬──────────────────┐        │
│  │   פנייה       │ ■ לקוח/ה          │        │  ← remembers the last choice
│  └───────────────┴──────────────────┘        │
│  שם *            [ רחל לוי               ]   │
│  טלפון *         [ 052-…                 ]   │
│  אימייל          [ rachel@…              ]   │
│                                              │
│  לקוח/ה מאז *    [ 03 ▾ ] [ 2019 ▾ ]         │
│  תחומים *  (פנסיה✓) (גמל והשתלמות) (חיים)    │
│            (בריאות וסיעוד✓) (חיסכון) …       │
│  איך הגיע/ה *  (שיחה)(פגישה)(הפניה)(לקוח קיים✓)…│
│  הערות פנימיות   [ לא מוצגות ללקוח/ה     ]   │
│  שיוך            [ אני ▾ ]   ← Admin+ only   │
│                                              │
│  ▸ נוסח היידוע ללקוח/ה                       │
│  ☑ הלקוח/ה יודע/ת איך ישמשו הפרטים            │
│    (בהסכם ההתקשרות✓) (בעל פה) (במייל) (וואטסאפ)│
│                                              │
│            [  שמירת לקוח/ה  ]                │
└──────────────────────────────────────────────┘
```

Differences from the enquiry mode, and nothing else:

- **מצב** is hidden (always לקוח/ה); **נושא** is replaced by **תחומים**
  (multi-select chips, at least one).
- **לקוח/ה מאז**: month + year selects, default this month, no future.
- The notice box shows `STAFF_CLIENT_NOTICE`; "בהסכם ההתקשרות" is the first
  method and the default.
- "קבענו כבר פגישה" stays, as in the lead mode.
- Full screen on a phone; chips are 44px targets, as the lead sheet's are.

### Duplicate, client mode

```
  052-… כבר רשום/ה אצלך
  ┌──────────────────────────────────────────┐
  │ רחל לוי · נוצר קשר · 14.03.2025 · אצלך   │
  └──────────────────────────────────────────┘
  [ הפיכת הפנייה הקיימת ללקוח/ה ]   ← primary
    לקוח/ה חדש/ה בכל זאת            ← text button
```

The primary action writes `client_since` and `products` from the form onto
the existing lead and opens its drawer. A hidden match behaves as in lead
mode (created, flagged for an Admin, nothing said about whose it is).

### After saving — next steps

The confirmation replaces the toast with a short card:

```
  ✓ רחל לוי נוספה כלקוחה
  [ שליחת הזמנה לאזור האישי ]   — only with an email
  [ בקשת מסלקה ]                — when next.masleka
  [ קביעת פגישה ]               — when VITE_MEETINGS_STAFF
    סגירה
```

- **Invite:** a mail through dorit-mailer with a link to `/login?next=/account`
  — it creates **no** Auth account on their behalf; the person signs up with
  that email and `enquiries_for` finds the row once it is confirmed. Sent
  once per lead (`invited_at` would be the only extra column; proposed to
  record it in the event sheet instead and keep `leads` as is).
- **Clearinghouse / meeting:** open the existing flows with the new lead id.

### List, drawer, strip, CSV

- Drawer header: "נפתח/ה כלקוח/ה ע״י {member} · לקוח/ה מאז 03/2019 ·
  פנסיה, בריאות וסיעוד". On any `status = 'client'` row the drawer shows
  editable **לקוח/ה מאז** and **תחומים** (empty for older clients until
  someone fills them).
- List: products as small tags on client rows; filter chip **"נפתחו
  כלקוחות"** (Admin+), beside "דרך הצוות".
- `StaffLeadsStrip` ("הובאו החודש") shows per member **פניות · לקוחות**.
- CSV: `opened_as`, `client_since` (`MM/YYYY`), `products` (Hebrew labels,
  `;`-joined).
- `permissions.ts`: `clients.create` for user/admin/owner, held to the gate by
  the contract test; the switch is hidden without it.
- `LeadAdminPort`: `createLead` takes `kind` and the client fields;
  new `convertToClient(leadId, since, products)`. Supabase adapter only; the
  Base44 adapter answers `unsupported`.

## Retention and privacy

- `status = 'client'` rows are never anonymised — unchanged.
- **Gap to close (exists today, sharper with this):** a client later set to
  `closed` falls into the 24-month enquiry clock in `anonymize_stale_leads`,
  while `staff-client-v1` promises retention "as the law requires" for an
  engagement. Proposed: rows with `opened_as = 'client'` or a non-null
  `client_since` are excluded from the 24-month job until the adviser gives
  the engagement period; then a separate rule.
- **Open items for Dorit's compliance adviser:** the `staff-client-v1`
  wording; whether "informed in the engagement agreement" is enough evidence
  when the agreement predates the system; the retention period for a former
  client's record.
- The form never asks for ID, salary, balances, policy numbers or medical
  details; `redact()` still runs on the free text.
- Privacy policy: one line that a client's record may be opened by the
  agency's staff from the engagement, with the same uses.

## Tests

- `supabase/tests/staff_clients_check.sql`:
  - User adds a client → `status='client'`, `opened_as='client'`,
    `consent_version='staff-client-v1'`, self-assigned; `p_status` ignored.
  - Missing/future `client_since`, empty or unknown `products` → refused.
  - `agreement` refused when not `p_as_client`; client fields refused on a lead.
  - `opened_as` cannot be changed by anyone but the operator (guard).
  - `leads_opened_as_client` and `leads_agreement_notice` reject bad rows.
  - `convert_lead_to_client`: works for the assignee and Admin+, a User on a
    lead they can't see changes nothing and gets an error; `opened_as` stays
    `'lead'`.
  - Old 12-argument callers behave exactly as before.
  - Retention: a `closed` row with `client_since` is not anonymised.
- Contract: `enquiries_for` columns unchanged; both notice texts identical
  between `notice.ts` and `staff-leads.ts`; RPC signature list; permissions.
- Edge function: `kind: 'client'` with the flag off → 400; 409 visible
  duplicate; client notice mail text; ops notice without name/phone; `next`.
- Component: switch remembers mode; status hidden in client mode; save
  disabled until since + products + notice; conversion path; next-step card
  buttons by flags; User sees no assignee.
- e2e: add a client on a phone viewport, then the invite.
- STDs in `tests/test-plan/` for each suite touched.

## Rollout

1. Migration (columns, constraints, guard, replaced RPC, conversion function,
   retention exclusion) and `create-lead` `kind`, no UI. CI green.
2. `staff-client-v1` wording and the retention question to the adviser.
3. Sheet mode, conversion, next steps, list changes behind
   `VITE_STAFF_CLIENTS`; Dorit adds a handful of real clients for a week.
4. Privacy-policy line, then the flag on for agency 1.
