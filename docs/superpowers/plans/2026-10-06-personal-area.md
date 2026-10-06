# Personal Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in visitor opens `/account` and sees their details, their meetings and the interview summaries they submitted — matched to them by verified email, and nothing of anyone else's.

**Architecture:** Supabase holds the data and one `security definer` function decides which columns a visitor may see. Two callers reach it: a Supabase session through `my_enquiries()`, and a Base44 session through a new `myAccount` Base44 function that calls the same SQL with the service key. The page reads through a new `AccountPort` with one adapter per sign-in, picked by `AUTH_PROVIDER` like `AuthPort`.

**Tech Stack:** Postgres/Supabase (SQL migration, RLS, PostgREST RPC), Base44 Deno functions, React 18 + React Router + TanStack Query, Vitest (unit, component, contract, integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-personal-area-design.md`

## Global Constraints

- Matching rule: an enquiry belongs to the user whose **verified** email equals the enquiry's email, compared as `lower(trim(email))`.
- Supabase: verified means `auth.users.email_confirmed_at is not null`. Base44: verified means `me.is_verified === true` (confirmed 2026-10-06 — `base44.auth.me()` returns `is_verified`; this resolves the spec's open item, so the bridge serves every verified Base44 account).
- A visitor may see only: `created_at`, `source`, `track`, `track_label`, `meeting_topic`, `timing`, `scheduled_at`, `summary`, `profile`, `completed`, `in_calendar`.
- Never returned to a visitor: `id`, `base44_id`, `name`, `phone`, `email`, `status`, `escalation_reason`, `handled_by_agent`, `consent_version`, `consent_at`, `notes`, `message`, `topic`, raw `calendar_status`.
- `leads` and `meetings` gain no policy for ordinary users; the functions are the only door.
- Read only. No write path from `/account`.
- A function answer carries `rid` and never an error message (AGENTS.md).
- Call Base44 functions through `invokeFunction` (`src/services/base44/invoke.ts`), never by casting `functions.invoke` (A-67).
- Visitor-facing copy is Hebrew; she is "דורית", the business is "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח".
- Update the relevant STD under `tests/test-plan/` with every test added (AGENTS.md).

## Review Focus

1. **An email that differs only in case or spaces** (`" Amiel@Gmail.com "` on the enquiry, `amiel@gmail.com` signed in) — must match. Pinned in Task 1 (SQL) and Task 3 (bridge).
2. **An enquiry with an empty or missing email** — must never match anyone, including a user whose address somehow resolves to `''`. Pinned in Task 1 (`enquiries_for('')` returns nothing).
3. **A partial interview** (the visitor gave a name and phone, then left) — shown as "לא הושלם", not hidden and not presented as a finished summary. Pinned in Task 1 (`completed`) and Task 5 (component).
4. **A Base44 account that is unverified or disabled** — gets 403 and no data, not an empty success. Pinned in Task 3.
5. **An old enquiry with no `profile`, or a `profile` that is not an array of pairs** — the page renders the rest of the enquiry and says the summary is not available, rather than crashing. Pinned in Task 4 (mapper) and Task 5 (component).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261006000000_personal_area.sql` | new columns; `my_email()`, `enquiries_for()`, `my_enquiries()`; grants |
| `supabase/tests/account_check.sql` | proves the functions against a local `supabase start` |
| `tests/contract/personal-area.contract.test.ts` | the migration's grants and column list, statically, in CI |
| `base44/functions/submitLead/entry.ts` | mirrors `summary`, `profile`, `track_label` |
| `base44/functions/myAccount/entry.ts` + `function.jsonc` | the Base44 bridge |
| `tests/helpers/base44-function.ts` | harness gains a signed-in user and RPC responses |
| `tests/integration/my-account.integration.test.ts` | the bridge |
| `src/services/ports.ts` | `Enquiry`, `AccountPort` |
| `src/services/account-mapping.ts` | one row → `Enquiry` mapper both adapters share |
| `src/services/supabase/SupabaseAccountService.ts` | `rpc("my_enquiries")` |
| `src/services/base44/Base44AccountService.ts` | `invokeFunction("myAccount")` |
| `src/services/index.ts` | `account` in `Services`, picked by `AUTH_PROVIDER` |
| `tests/unit/account-services.test.ts` | both adapters and the mapper |
| `src/pages/Account.tsx` | the page |
| `src/App.jsx` | the `/account` route |
| `src/components/dorit/layout/FloatingHeader.tsx` | "האזור שלי" link when signed in |
| `src/components/SeoRouteGuard.tsx` | `/account` is noindex |
| `tests/component/account-page.test.tsx` | the page's states |
| `e2e/ui/account.spec.ts` | signed out → `/login` |
| `src/pages/PrivacyPolicy.tsx`, `base44/agents/COMPLIANCE.md`, `tests/test-plan/*` | disclosure and docs |

---

### Task 1: The data layer — migration, SQL checks, static contract

**Files:**
- Create: `supabase/migrations/20261006000000_personal_area.sql`
- Create: `supabase/tests/account_check.sql`
- Create: `tests/contract/personal-area.contract.test.ts`
- Modify: `tests/test-plan/03-std-contract.md` (new section), `tests/test-plan/09-traceability-matrix.md` (new row F-29)

**Interfaces:**
- Produces: SQL functions `public.my_email() returns text`, `public.enquiries_for(p_email text) returns table(...)`, `public.my_enquiries() returns table(...)` with columns exactly `created_at timestamptz, source text, track text, track_label text, meeting_topic text, timing text, scheduled_at timestamptz, summary text, profile jsonb, completed boolean, in_calendar boolean`. RPC paths: `/rest/v1/rpc/enquiries_for` (body `{ "p_email": "..." }`), `/rest/v1/rpc/my_enquiries`.

- [ ] **Step 1: Write the failing contract test**

`tests/contract/personal-area.contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * What a visitor may see of their own enquiries, read from the migration.
 *
 * The SQL checks in supabase/tests/account_check.sql prove behaviour against
 * a real database, but CI does not run them. These pin the parts a careless
 * edit would break silently: who may call what, and which columns leave.
 */
const SQL = readFileSync(join(REPO_ROOT, "supabase/migrations/20261006000000_personal_area.sql"), "utf8");

const fnBody = (name: string) => {
  const m = SQL.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"));
  if (!m) throw new Error(`${name} is not defined in the migration`);
  return m[0];
};

const NEVER = [
  "base44_id", "name", "phone", "email", "status", "escalation_reason",
  "handled_by_agent", "consent_version", "consent_at", "notes", "message", "topic", "calendar_status",
];

describe("personal area — the migration", () => {
  it("adds the columns the page shows", () => {
    expect(SQL).toMatch(/add column summary\s+text/i);
    expect(SQL).toMatch(/add column profile\s+jsonb/i);
    expect(SQL).toMatch(/add column track_label\s+text/i);
  });

  it("only service_role may call enquiries_for", () => {
    expect(SQL).toMatch(/revoke all on function public\.enquiries_for\(text\) from public/i);
    expect(SQL).toMatch(/grant execute on function public\.enquiries_for\(text\) to service_role/i);
    expect(SQL).not.toMatch(/grant execute on function public\.enquiries_for\(text\) to (authenticated|anon)/i);
  });

  it("signed-in users may call my_enquiries, anonymous visitors may not", () => {
    expect(SQL).toMatch(/grant execute on function public\.my_enquiries\(\) to authenticated/i);
    expect(SQL).toMatch(/revoke all on function public\.my_enquiries\(\) from public/i);
    expect(SQL).not.toMatch(/my_enquiries\(\) to anon/i);
  });

  it("returns no column outside the visitor's list", () => {
    // The output columns, from `returns table (...)` — an expression may read
    // `status` to compute `completed`; what matters is that `status` never leaves.
    for (const name of ["enquiries_for", "my_enquiries"]) {
      const cols = (fnBody(name).match(/returns table \(([\s\S]*?)\)\s*language/i)?.[1] ?? "")
        .split(",")
        .map((c) => c.trim().split(/\s+/)[0]);
      expect(cols.length, `${name} declares no output columns`).toBe(11);
      for (const col of NEVER) expect(cols, `${name} returns ${col}`).not.toContain(col);
    }
  });

  it("matches only a verified address", () => {
    expect(fnBody("my_email")).toMatch(/email_confirmed_at is not null/i);
  });

  it("opens no table to ordinary users", () => {
    expect(SQL).not.toMatch(/create policy[\s\S]*?on public\.(leads|meetings)/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/contract/personal-area.contract.test.ts`
Expected: FAIL — `ENOENT … 20261006000000_personal_area.sql`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261006000000_personal_area.sql`:

```sql
-- A personal area for signed-in visitors.
--
-- An enquiry belongs to the user whose verified email equals the enquiry's
-- email. Nothing new is exposed by that: the confirmation mail already sent
-- these details to that address. See
-- docs/superpowers/specs/2026-10-06-personal-area-design.md.
--
-- The tables gain no policy. `enquiries_for` is the only door, and it names
-- every column that leaves — a column added to `leads` later is invisible to
-- a visitor until someone adds it here on purpose.

-- ── what the page shows that was stored nowhere ─────────────────────────────
alter table public.leads
  add column summary     text,
  add column profile     jsonb,   -- [[label, value], ...] as the summary mail shows them
  add column track_label text;

-- ── who is asking ───────────────────────────────────────────────────────────
-- Null for an unconfirmed address, so an unverified sign-up sees nothing.
create or replace function public.my_email() returns text
  language sql security definer stable set search_path = public as $$
  select nullif(lower(trim(email)), '') from auth.users
   where id = auth.uid() and email_confirmed_at is not null
$$;

-- ── what a visitor may see ──────────────────────────────────────────────────
create or replace function public.enquiries_for(p_email text)
returns table (
  created_at    timestamptz,
  source        text,
  track         text,
  track_label   text,
  meeting_topic text,
  timing        text,
  scheduled_at  timestamptz,
  summary       text,
  profile       jsonb,
  completed     boolean,
  in_calendar   boolean
)
  language sql security definer stable set search_path = public as $$
  select l.created_at, l.source, l.track, l.track_label, l.meeting_topic, l.timing,
         coalesce(m.scheduled_at, l.scheduled_at),
         l.summary, l.profile,
         l.status is distinct from 'partial',
         coalesce(m.calendar_status like 'אירוע נוצר%', false)
    from public.leads l
    left join public.meetings m on m.lead_base44_id = l.base44_id
   where nullif(lower(trim(p_email)), '') is not null
     and lower(trim(l.email)) = lower(trim(p_email))
   order by l.created_at desc
$$;

create or replace function public.my_enquiries()
returns table (
  created_at    timestamptz,
  source        text,
  track         text,
  track_label   text,
  meeting_topic text,
  timing        text,
  scheduled_at  timestamptz,
  summary       text,
  profile       jsonb,
  completed     boolean,
  in_calendar   boolean
)
  language sql security definer stable set search_path = public as $$
  select * from public.enquiries_for(public.my_email())
$$;

revoke all on function public.my_email()            from public;
revoke all on function public.enquiries_for(text)   from public;
revoke all on function public.my_enquiries()        from public;
grant execute on function public.my_email()          to authenticated;
grant execute on function public.enquiries_for(text) to service_role;
grant execute on function public.my_enquiries()      to authenticated;
```

- [ ] **Step 4: Run the contract test**

Run: `npx vitest run tests/contract/personal-area.contract.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Write the SQL checks**

`supabase/tests/account_check.sql` (same style as `rls_check.sql`: every block raises on a wrong answer):

```sql
\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000001','authenticated','authenticated','Ronit@Example.com', now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000002','authenticated','authenticated','other@example.com', now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000003','authenticated','authenticated','unconfirmed@example.com', null);

insert into public.leads (base44_id, name, phone, email, source, status, summary, profile, track, track_label) values
  ('L-1','רונית','050-1','  ronit@example.COM ','interview','new','סיכום','[["יעד עיקרי","פרישה"]]','pension','פנסיה, גמל והשתלמות'),
  ('L-2','רונית','050-1','ronit@example.com','interview','partial',null,null,'pension','פנסיה, גמל והשתלמות'),
  ('L-3','אחר','050-2','other@example.com','quick','new',null,null,null,null),
  ('L-4','בלי מייל','050-3','','quick','new',null,null,null,null),
  ('L-5','מבקר','050-4','unconfirmed@example.com','quick','new',null,null,null,null);
insert into public.meetings (lead_base44_id, scheduled_at, calendar_status) values
  ('L-1', '2026-10-11 07:00:00+00', 'אירוע נוצר ✓ (outlook, google) — 2026-10-11 10:00');

-- Case and spaces do not matter; another person's row never appears.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.my_enquiries()) <> 2 then raise exception 'ronit should see exactly her two enquiries'; end if;
  if exists (select 1 from public.my_enquiries() where summary is null and completed) then raise exception 'the partial interview must be marked incomplete'; end if;
  if not (select in_calendar from public.my_enquiries() where summary = 'סיכום') then raise exception 'a booked meeting should read as in the calendar'; end if;
end $$;

-- The tables stay closed to her: RLS lets an ordinary user read no lead rows.
do $$ begin
  if (select count(*) from public.leads) <> 0 then raise exception 'an ordinary user read lead rows directly'; end if;
  if (select count(*) from public.meetings) <> 0 then raise exception 'an ordinary user read meeting rows directly'; end if;
end $$;

-- She cannot call the service-role function with someone else's address.
do $$ begin
  begin
    perform * from public.enquiries_for('other@example.com');
    raise exception 'authenticated called enquiries_for';
  exception when insufficient_privilege then null;
  end;
end $$;

-- An unconfirmed address sees nothing.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.my_enquiries()) <> 0 then raise exception 'an unconfirmed address saw enquiries'; end if;
end $$;

-- An empty address matches nothing, not the enquiry without an email.
reset role;
do $$ begin
  if (select count(*) from public.enquiries_for('')) <> 0 then raise exception 'an empty address matched'; end if;
  if (select count(*) from public.enquiries_for('   ')) <> 0 then raise exception 'a blank address matched'; end if;
end $$;

rollback;
```

- [ ] **Step 6: Run the SQL checks locally**

Run: `supabase start && supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -f supabase/tests/account_check.sql`
Expected: exits 0 with no `ERROR`. (CI does not run this file; the contract test is the CI half.)

- [ ] **Step 7: Document and commit**

Add to `tests/test-plan/03-std-contract.md` §4.4 a `personal-area.contract.test.ts` entry with IDs `CTR-ACC-001..006` matching the six `it` titles; add row `F-29 | Signed-in visitor sees their own enquiries (/account)` to `09-traceability-matrix.md` with `CTR-ACC-001..006` in the Contract column.

```bash
git add supabase/migrations/20261006000000_personal_area.sql supabase/tests/account_check.sql tests/contract/personal-area.contract.test.ts tests/test-plan/03-std-contract.md tests/test-plan/09-traceability-matrix.md
git commit -m "Let a signed-in visitor read their own enquiries, and nothing else"
```

---

### Task 2: `submitLead` stores the summary and the answers

**Files:**
- Modify: `base44/functions/submitLead/entry.ts:1361-1379` (the `mirrorLeadToSupabase` row)
- Test: `tests/integration/submit-lead.integration.test.ts` (the "what it stores about the meeting" block)
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: `safeSummary` (line 1253), `safeProfile` (line 1264, `[label, value][]`, already through `redact()`), `trackLabel` (line 1265) — all in scope at the mirror call.
- Produces: `leads.summary`, `leads.profile`, `leads.track_label` populated for new enquiries.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("submitLead — what it stores about the meeting", ...)`:

```ts
  it("stores the summary and the answers, as the mail shows them", async () => {
    const r = await invokeFunction(
      "submitLead",
      { ...booked, summary: "לקוח שמעוניין לבדוק דמי ניהול", profile: { goal: "הורדת עלויות", life_stage: "נשוי +2" } },
      { env }
    );
    const [lead] = bodyOf(r, "leads");
    expect(lead.summary).toBe("לקוח שמעוניין לבדוק דמי ניהול");
    expect(lead.track_label).toBe("פנסיה, גמל והשתלמות");
    expect(lead.profile).toEqual(expect.arrayContaining([["יעד עיקרי", "הורדת עלויות"]]));
  });

  it("stores the answers only after redaction", async () => {
    const r = await invokeFunction(
      "submitLead",
      { ...booked, profile: { goal: "ת.ז. 123456782 — הורדת עלויות" } },
      { env }
    );
    const [lead] = bodyOf(r, "leads");
    expect(JSON.stringify(lead.profile)).not.toContain("123456782");
  });

  it("stores no profile for a form that is not an interview", async () => {
    const r = await invokeFunction("submitLead", { name: "דן", phone: "0501112233", source: "quick" }, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead.profile).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/integration/submit-lead.integration.test.ts -t "stores the summary|after redaction|not an interview"`
Expected: FAIL — `lead.summary` is `undefined`.

- [ ] **Step 3: Add the three fields to the mirrored row**

In `base44/functions/submitLead/entry.ts`, inside the object passed to `mirrorLeadToSupabase(rid, leadId, { ... })`, after `track: track || '',`:

```js
      // What the personal area shows. The redacted copies the mail already
      // carries — never the raw payload — so the stored version is never more
      // than what was mailed. `profile` keeps the mail's labels, so the page
      // needs no copy of the schema.
      summary: safeSummary || null,
      profile: safeProfile.length ? safeProfile : null,
      track_label: trackLabel || null,
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/integration/submit-lead.integration.test.ts`
Expected: PASS, including every existing case.

- [ ] **Step 5: Document and commit**

Add the three cases to `12-std-integration.md` in the submitLead section as `INT-LEAD-090..092`.

```bash
git add base44/functions/submitLead/entry.ts tests/integration/submit-lead.integration.test.ts tests/test-plan/12-std-integration.md
git commit -m "Store the interview's summary and answers where the personal area can read them"
```

---

### Task 3: The Base44 bridge — `myAccount`

**Files:**
- Create: `base44/functions/myAccount/entry.ts`, `base44/functions/myAccount/function.jsonc`
- Modify: `tests/helpers/base44-function.ts` (harness options `user`, `rpc`)
- Create: `tests/integration/my-account.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: RPC `POST {SUPABASE_URL}/rest/v1/rpc/enquiries_for` with `{ p_email }` (Task 1).
- Produces: `POST /functions/myAccount` → `200 { ok: true, rid, enquiries: Row[] }`, `401 { error, rid }` (not signed in), `403 { error, rid }` (unverified or disabled), `500 { error, rid }` (Supabase unconfigured or failed). `Row` has exactly the eleven columns of `enquiries_for`.

- [ ] **Step 1: Extend the harness**

In `tests/helpers/base44-function.ts`, add to `HarnessOptions`:

```ts
  /** The signed-in caller `base44.auth.me()` returns, or `null` for nobody. */
  user?: Record<string, unknown> | null;
  /** JSON returned by a Supabase RPC, keyed by function name. */
  rpc?: Record<string, unknown>;
```

In `invokeFunction`, add `auth` to `client`:

```ts
  const client = {
    entities,
    auth: {
      me: async () => {
        if (!options.user) throw Object.assign(new Error("not authenticated"), { status: 401 });
        return options.user;
      },
    },
    asServiceRole: {
      entities,
      integrations: { Core: { SendEmail: sendEmail } },
      connectors: { getConnection },
    },
  };
```

and in `fetchImpl`, before the generic success return:

```ts
    const rpc = String(url).match(/\/rest\/v1\/rpc\/(\w+)/);
    if (rpc && options.rpc && rpc[1] in options.rpc) {
      const status = options.fetchStatus ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => options.rpc![rpc[1]], text: async () => "" };
    }
```

- [ ] **Step 2: Write the failing integration tests**

`tests/integration/my-account.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * The personal area for a visitor signed in through Base44.
 *
 * The function identifies the caller, takes their verified address, and asks
 * Supabase for exactly what `enquiries_for` lets out. It never decides columns
 * itself — the SQL does — and never answers with an error message.
 */
const SUPABASE = "https://stub.supabase.co";
const env = { SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key" };
const verified = { id: "u1", email: " Ronit@Example.com ", is_verified: true, disabled: null };
const row = {
  created_at: "2026-10-06T07:55:18Z", source: "interview", track: "pension", track_label: "פנסיה, גמל והשתלמות",
  meeting_topic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduled_at: "2026-10-11T07:00:00Z",
  summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, in_calendar: true,
};

describe("myAccount — a Base44 user's own enquiries", () => {
  it("asks Supabase for the caller's verified address, normalised", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: verified, rpc: { enquiries_for: [row] } });
    expect(r.status).toBe(200);
    const [call] = r.callsTo("/rest/v1/rpc/enquiries_for");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ p_email: "ronit@example.com" });
    expect(call.headers.Authorization).toBe("Bearer test-only-service-key");
  });

  it("returns the rows and the rid", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: verified, rpc: { enquiries_for: [row] } });
    expect(r.json).toMatchObject({ ok: true, enquiries: [row] });
    expect(typeof r.json.rid).toBe("string");
  });

  it("refuses an anonymous caller", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: null });
    expect(r.status).toBe(401);
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("refuses an unverified address", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: { ...verified, is_verified: false } });
    expect(r.status).toBe(403);
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("refuses a disabled account", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: { ...verified, disabled: true } });
    expect(r.status).toBe(403);
  });

  it("answers with the rid and no error detail when Supabase fails", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: verified, rpc: { enquiries_for: [] }, fetchStatus: 500 });
    expect(r.status).toBe(500);
    expect(typeof r.json.rid).toBe("string");
    expect(JSON.stringify(r.json)).not.toMatch(/stub\.supabase|service-key|500/);
  });

  it("does not answer when Supabase is not configured", async () => {
    const r = await invokeFunction("myAccount", {}, { env: {}, user: verified });
    expect(r.status).toBe(500);
  });

  it("passes on no column outside the visitor's list, even if the SQL ever did", async () => {
    const leaky = { ...row, phone: "050-1", status: "new", escalation_reason: "x" };
    const r = await invokeFunction("myAccount", {}, { env, user: verified, rpc: { enquiries_for: [leaky] } });
    const [out] = r.json.enquiries as Record<string, unknown>[];
    expect(Object.keys(out).sort()).toEqual(Object.keys(row).sort());
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/integration/my-account.integration.test.ts`
Expected: FAIL — `ENOENT … base44/functions/myAccount/entry.ts`.

- [ ] **Step 4: Write the function**

`base44/functions/myAccount/function.jsonc`:

```jsonc
{
  "name": "myAccount",
  "entry": "entry.ts"
}
```

`base44/functions/myAccount/entry.ts`:

```ts
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'myAccount';

/**
 * שורת יומן מובנית. מה קרה, לא מי — אין כאן כתובת מייל, שם או טלפון.
 * משוכפלת בכל פונקציה בכוונה; אין מודול משותף ב-Base44.
 */
function log(level, event, fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const newRequestId = () => crypto.randomUUID().slice(0, 8);

/**
 * העמודות שמבקר רשאי לראות — אותה רשימה ש-enquiries_for בוחרת.
 * כפולה כאן בכוונה: אם ה-SQL ישתנה אי פעם, הפונקציה הזו עדיין לא תעביר עמודה
 * שלא הוחלט עליה.
 */
const VISIBLE = [
  'created_at', 'source', 'track', 'track_label', 'meeting_topic', 'timing',
  'scheduled_at', 'summary', 'profile', 'completed', 'in_calendar',
];
const pick = (row) => Object.fromEntries(VISIBLE.map((k) => [k, row?.[k] ?? null]));

/**
 * האזור האישי של משתמש שמחובר דרך Base44.
 *
 * מזהה את המשתמש, לוקח את כתובתו המאומתת, ומבקש מ-Supabase בדיוק את מה
 * ש-enquiries_for משחררת. ראו docs/superpowers/specs/2026-10-06-personal-area-design.md.
 */
export default async function(req) {
  const rid = newRequestId();
  const json = (body, status = 200) => Response.json({ ...body, rid }, { status });
  log('info', 'request.start', { rid });

  let me;
  try {
    const base44 = createClientFromRequest(req);
    me = await base44.auth.me();
  } catch {
    log('warn', 'auth.anonymous', { rid });
    return json({ error: 'נדרשת התחברות.' }, 401);
  }

  const email = String(me?.email ?? '').trim().toLowerCase();
  if (!email || me?.is_verified !== true || me?.disabled) {
    log('warn', 'auth.not_eligible', { rid, verified: me?.is_verified === true, disabled: Boolean(me?.disabled) });
    return json({ error: 'כתובת המייל בחשבון עדיין לא אומתה.' }, 403);
  }

  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) {
    log('error', 'supabase.unconfigured', { rid });
    return json({ error: 'האזור האישי אינו זמין כרגע.' }, 500);
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/enquiries_for`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_email: email }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const rows = await res.json();
    const enquiries = (Array.isArray(rows) ? rows : []).map(pick);
    log('info', 'request.end', { rid, count: enquiries.length });
    return json({ ok: true, enquiries });
  } catch (e) {
    log('error', 'supabase.failed', { rid, err: String(e?.message ?? e).slice(0, 200) });
    return json({ error: 'לא הצלחנו לטעון את הפרטים. אפשר לנסות שוב.' }, 500);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/integration/my-account.integration.test.ts && npx vitest run tests/contract tests/security`
Expected: PASS. If a contract test enumerates `base44/functions/*` (deploy list, logging rules, `rid` rule), it now includes `myAccount`; fix the function, not the test.

- [ ] **Step 6: Document and commit**

Add `INT-ACC-001..008` to `12-std-integration.md` (new section "myAccount"); add the IDs to F-29's Integration column.

```bash
git add base44/functions/myAccount tests/helpers/base44-function.ts tests/integration/my-account.integration.test.ts tests/test-plan/12-std-integration.md tests/test-plan/09-traceability-matrix.md
git commit -m "Give a Base44-signed-in visitor their own enquiries, through Supabase"
```

---

### Task 4: `AccountPort` and its two adapters

**Files:**
- Modify: `src/services/ports.ts` (add `Enquiry`, `AccountPort`)
- Create: `src/services/account-mapping.ts`
- Create: `src/services/supabase/SupabaseAccountService.ts`
- Create: `src/services/base44/Base44AccountService.ts`
- Modify: `src/services/index.ts` (`account` in `Services` and `services`)
- Create: `tests/unit/account-services.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: RPC `my_enquiries` (Task 1); function `myAccount` (Task 3); `invokeFunction` from `src/services/base44/invoke.ts`.
- Produces:

```ts
export interface Enquiry {
  createdAt: string;
  source: string;
  track?: string;
  trackLabel?: string;
  meetingTopic?: string;
  timing?: string;
  scheduledAt?: string;
  summary?: string;
  /** `[label, value]` pairs as the summary mail shows them; empty when none was stored. */
  profile: Array<[string, string]>;
  completed: boolean;
  inCalendar: boolean;
}

export interface AccountPort {
  /** The signed-in user's enquiries, newest first. Rejects with `AccountLoadError`. */
  myEnquiries(): Promise<Enquiry[]>;
}

export class AccountLoadError extends Error {
  constructor(readonly reason: "signed_out" | "unverified" | "failed", readonly rid?: string) {
    super(reason);
  }
}
```

`toEnquiry(row: Record<string, unknown>): Enquiry` from `src/services/account-mapping.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/account-services.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { toEnquiry } from "@/services/account-mapping";
import { SupabaseAccountService } from "@/services/supabase/SupabaseAccountService";
import { Base44AccountService } from "@/services/base44/Base44AccountService";
import { AccountLoadError } from "@/services/ports";

const row = {
  created_at: "2026-10-06T07:55:18Z", source: "interview", track: "pension", track_label: "פנסיה, גמל והשתלמות",
  meeting_topic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduled_at: "2026-10-11T07:00:00Z",
  summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, in_calendar: true,
};

describe("toEnquiry", () => {
  it("maps a row to the page's shape", () => {
    expect(toEnquiry(row)).toEqual({
      createdAt: "2026-10-06T07:55:18Z", source: "interview", track: "pension", trackLabel: "פנסיה, גמל והשתלמות",
      meetingTopic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduledAt: "2026-10-11T07:00:00Z",
      summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, inCalendar: true,
    });
  });

  it("survives an old enquiry with no profile", () => {
    expect(toEnquiry({ ...row, profile: null, summary: null }).profile).toEqual([]);
  });

  it("drops a profile that is not label/value pairs rather than crashing", () => {
    expect(toEnquiry({ ...row, profile: { goal: "x" } }).profile).toEqual([]);
    expect(toEnquiry({ ...row, profile: [["ok", "1"], ["bad"], [1, 2], "x"] }).profile).toEqual([["ok", "1"]]);
  });
});

describe("SupabaseAccountService", () => {
  it("reads my_enquiries over RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const out = await new SupabaseAccountService({ rpc }).myEnquiries();
    expect(rpc).toHaveBeenCalledWith("my_enquiries");
    expect(out[0].trackLabel).toBe("פנסיה, גמל והשתלמות");
  });

  it("turns an RPC error into AccountLoadError", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(new SupabaseAccountService({ rpc }).myEnquiries()).rejects.toBeInstanceOf(AccountLoadError);
  });
});

describe("Base44AccountService — fed the SDK's real response shape (A-67)", () => {
  const axios = (data: unknown, status = 200) => ({ data, status, statusText: "OK", headers: {}, config: {} });

  it("reads the body out of the axios wrapper", async () => {
    const invoke = vi.fn().mockResolvedValue(axios({ ok: true, rid: "r1", enquiries: [row] }));
    const out = await new Base44AccountService({ functions: { invoke } }).myEnquiries();
    expect(invoke).toHaveBeenCalledWith("myAccount", {});
    expect(out).toHaveLength(1);
  });

  it("names a 401 as signed out and a 403 as unverified, keeping the rid", async () => {
    const reject = (status: number) =>
      vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status, data: { rid: "r9" } }));
    await expect(new Base44AccountService({ functions: { invoke: reject(401) } }).myEnquiries())
      .rejects.toMatchObject({ reason: "signed_out", rid: "r9" });
    await expect(new Base44AccountService({ functions: { invoke: reject(403) } }).myEnquiries())
      .rejects.toMatchObject({ reason: "unverified", rid: "r9" });
    await expect(new Base44AccountService({ functions: { invoke: reject(500) } }).myEnquiries())
      .rejects.toMatchObject({ reason: "failed", rid: "r9" });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/account-services.test.ts`
Expected: FAIL — cannot resolve `@/services/account-mapping`.

- [ ] **Step 3: Add the types to `src/services/ports.ts`**

Append the `Enquiry`, `AccountPort` and `AccountLoadError` block from **Interfaces** above, verbatim.

- [ ] **Step 4: Write the mapper**

`src/services/account-mapping.ts`:

```ts
import type { Enquiry } from "./ports";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * One enquiry row, as `enquiries_for` returns it, in the page's shape.
 *
 * Shared by both adapters so the two sign-ins cannot disagree about what a
 * row means. `profile` is trusted only as an array of string pairs: anything
 * else — an old row, a hand-edited one — becomes "no answers stored" rather
 * than something the page tries to render.
 */
export function toEnquiry(row: Record<string, unknown>): Enquiry {
  const profile = Array.isArray(row.profile)
    ? (row.profile as unknown[]).filter(
        (p): p is [string, string] =>
          Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string"
      )
    : [];
  return {
    createdAt: String(row.created_at ?? ""),
    source: String(row.source ?? ""),
    track: str(row.track),
    trackLabel: str(row.track_label),
    meetingTopic: str(row.meeting_topic),
    timing: str(row.timing),
    scheduledAt: str(row.scheduled_at),
    summary: str(row.summary),
    profile,
    completed: row.completed !== false,
    inCalendar: row.in_calendar === true,
  };
}
```

- [ ] **Step 5: Write the adapters**

`src/services/supabase/SupabaseAccountService.ts`:

```ts
import { toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type Enquiry } from "../ports";

/** Just the call this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseRpcClient {
  rpc(fn: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** The personal area for a visitor signed in through Supabase. */
export class SupabaseAccountService implements AccountPort {
  constructor(private readonly client: SupabaseRpcClient) {}

  async myEnquiries(): Promise<Enquiry[]> {
    const { data, error } = await this.client.rpc("my_enquiries");
    if (error) throw new AccountLoadError("failed");
    return (Array.isArray(data) ? data : []).map((r) => toEnquiry(r as Record<string, unknown>));
  }
}
```

`src/services/base44/Base44AccountService.ts`:

```ts
import { toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type Enquiry } from "../ports";
import { invokeFunction, type FunctionInvoker } from "./invoke";

interface MyAccountBody {
  ok?: boolean;
  rid?: string;
  enquiries?: Record<string, unknown>[];
}

/** The personal area for a visitor signed in through Base44, via the `myAccount` function. */
export class Base44AccountService implements AccountPort {
  constructor(private readonly client: FunctionInvoker) {}

  async myEnquiries(): Promise<Enquiry[]> {
    let body: MyAccountBody | undefined;
    try {
      body = await invokeFunction<MyAccountBody>(this.client, "myAccount", {});
    } catch (e) {
      const err = e as { status?: number; data?: { rid?: string } };
      const reason = err.status === 401 ? "signed_out" : err.status === 403 ? "unverified" : "failed";
      throw new AccountLoadError(reason, err.data?.rid);
    }
    if (!body?.ok) throw new AccountLoadError("failed", body?.rid);
    return (body.enquiries ?? []).map(toEnquiry);
  }
}
```

- [ ] **Step 6: Wire the composition root**

In `src/services/index.ts`: import both adapters and the `AccountPort` type; add `account: AccountPort;` to `interface Services`; add

```ts
/**
 * The personal area, from whichever sign-in is switched on — the same rule as
 * `authPort`, so the page asks the system that knows who the visitor is.
 */
const accountPort: AccountPort =
  AUTH_PROVIDER === "supabase" && supabase
    ? new SupabaseAccountService(supabase as unknown as SupabaseRpcClient)
    : new Base44AccountService(client);
```

and `account: accountPort,` in `export const services`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/unit/account-services.test.ts && npm run typecheck && npm run lint`
Expected: PASS, tsc 0, lint 0.

- [ ] **Step 8: Document and commit**

Add §4.14 "Personal area adapters — `account-services.test.ts`" to `01-std-unit.md` with `UNIT-ACC-001..007`; add them to F-29's Unit column.

```bash
git add src/services/ports.ts src/services/account-mapping.ts src/services/supabase/SupabaseAccountService.ts src/services/base44/Base44AccountService.ts src/services/index.ts tests/unit/account-services.test.ts tests/test-plan/01-std-unit.md tests/test-plan/09-traceability-matrix.md
git commit -m "One port for the personal area, one adapter per sign-in"
```

---

### Task 5: The `/account` page, its route and the header link

**Files:**
- Create: `src/pages/Account.tsx`
- Modify: `src/App.jsx` (lazy import, route inside a `ProtectedRoute`)
- Modify: `src/components/dorit/layout/FloatingHeader.tsx` (link when signed in)
- Modify: `src/components/SeoRouteGuard.tsx` (`/account` is noindex)
- Create: `tests/component/account-page.test.tsx`
- Create: `e2e/ui/account.spec.ts`
- Modify: `tests/test-plan/02-std-component.md`, `tests/test-plan/06-std-ui-e2e.md`

**Interfaces:**
- Consumes: `services.account.myEnquiries()`, `AccountLoadError`, `Enquiry` (Task 4); `useAuth()` → `{ user, isAuthenticated }` from `@/lib/AuthContext`.
- Produces: route `/account`; component `Account` (default export) taking optional prop `loadEnquiries?: () => Promise<Enquiry[]>` (defaults to `services.account.myEnquiries`) so tests inject data without the SDK.

- [ ] **Step 1: Write the failing component tests**

`tests/component/account-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { full_name: "רונית אבני", email: "ronit@example.com" }, isAuthenticated: true }),
}));

import Account from "@/pages/Account";
import { AccountLoadError, type Enquiry } from "@/services/ports";

const base: Enquiry = {
  createdAt: "2026-10-06T07:55:18Z", source: "interview", track: "pension", trackLabel: "פנסיה, גמל והשתלמות",
  meetingTopic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduledAt: "2026-10-11T07:00:00Z",
  summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, inCalendar: true,
};

const renderWith = (load: () => Promise<Enquiry[]>) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Account loadEnquiries={load} />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("<Account />", () => {
  it("shows who is signed in", async () => {
    renderWith(async () => []);
    expect(await screen.findByText("רונית אבני")).toBeInTheDocument();
    expect(screen.getByText("ronit@example.com")).toBeInTheDocument();
  });

  it("says so when there are no enquiries, and why some may be missing", async () => {
    renderWith(async () => []);
    expect(await screen.findByText("עוד אין כאן פניות")).toBeInTheDocument();
    expect(screen.getByText(/בלי כתובת מייל, או מכתובת אחרת/)).toBeInTheDocument();
  });

  it("shows a meeting with its status", async () => {
    renderWith(async () => [base, { ...base, inCalendar: false, createdAt: "2026-10-05T07:00:00Z" }]);
    expect(await screen.findByText("ביומן")).toBeInTheDocument();
    expect(screen.getByText("ממתינה לאישור דורית")).toBeInTheDocument();
  });

  it("shows the interview's answers with the mail's labels", async () => {
    renderWith(async () => [base]);
    expect(await screen.findByText("יעד עיקרי")).toBeInTheDocument();
    expect(screen.getByText("פרישה")).toBeInTheDocument();
  });

  it("marks a partial interview as not finished", async () => {
    renderWith(async () => [{ ...base, completed: false, summary: undefined, profile: [] }]);
    expect(await screen.findByText("לא הושלם")).toBeInTheDocument();
  });

  it("renders an old enquiry with no stored answers", async () => {
    renderWith(async () => [{ ...base, summary: undefined, profile: [] }]);
    expect(await screen.findByText(/הסיכום לא נשמר/)).toBeInTheDocument();
  });

  it("explains an unverified address instead of an empty list", async () => {
    renderWith(() => Promise.reject(new AccountLoadError("unverified", "r1")));
    expect(await screen.findByText(/כתובת המייל בחשבון עדיין לא אומתה/)).toBeInTheDocument();
  });

  it("shows the rid when loading fails, and keeps the rest of the page", async () => {
    renderWith(() => Promise.reject(new AccountLoadError("failed", "ab12cd34")));
    expect(await screen.findByText(/ab12cd34/)).toBeInTheDocument();
    expect(screen.getByText("רונית אבני")).toBeInTheDocument();
  });

  it("sends a visitor whose session ended back to sign in", async () => {
    renderWith(() => Promise.reject(new AccountLoadError("signed_out", "r2")));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("הפרטים שלי")).toBeNull();
  });

  it("links to the privacy rights", async () => {
    renderWith(async () => []);
    expect(await screen.findByRole("link", { name: /עיון, תיקון או מחיקה/ })).toHaveAttribute("href", "/privacy");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/component/account-page.test.tsx`
Expected: FAIL — cannot resolve `@/pages/Account`.

- [ ] **Step 3: Write the page**

`src/pages/Account.tsx`:

```tsx
import React from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { services } from "@/services";
import { AccountLoadError, type Enquiry } from "@/services/ports";

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" }) : "";

/**
 * האזור האישי — מה שהמבקר מסר, ומתי הוא נפגש עם דורית.
 *
 * Read only. An enquiry appears when its email equals the signed-in user's
 * verified address; see docs/superpowers/specs/2026-10-06-personal-area-design.md.
 * Everything is rendered as text — never markdown or HTML — so nothing stored
 * can turn into markup on this page.
 */
export default function Account({ loadEnquiries = () => services.account.myEnquiries() }: {
  loadEnquiries?: () => Promise<Enquiry[]>;
}) {
  const { user } = useAuth();
  const query = useQuery<Enquiry[], unknown>({ queryKey: ["account", "enquiries"], queryFn: loadEnquiries });
  const enquiries = query.data ?? [];
  const meetings = enquiries.filter((e) => e.scheduledAt || e.meetingTopic);
  const interviews = enquiries.filter((e) => e.source === "interview");
  const error = query.error instanceof AccountLoadError ? query.error : query.error ? new AccountLoadError("failed") : null;
  // The session ended between the route guard and the request: sign in again.
  if (error?.reason === "signed_out") return <Navigate to="/login?returnTo=/account" replace />;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-24 space-y-12">
        <header>
          <h1 className="font-heading text-4xl">האזור שלי</h1>
        </header>

        <section aria-labelledby="details">
          <h2 id="details" className="font-heading text-2xl mb-3">הפרטים שלי</h2>
          <p>{String(user?.full_name ?? "")}</p>
          <p dir="ltr" className="text-start text-muted-foreground">{String(user?.email ?? "")}</p>
        </section>

        {query.isPending ? <p className="text-muted-foreground">טוען…</p> : null}

        {error?.reason === "unverified" ? (
          <p role="status">כתובת המייל בחשבון עדיין לא אומתה. אחרי האימות יופיעו כאן הפניות שנשלחו ממנה.</p>
        ) : error ? (
          <p role="alert">
            לא הצלחנו לטעון את הפרטים. אפשר לנסות שוב.
            {error.rid ? <> מזהה לבירור: <span dir="ltr">{error.rid}</span></> : null}
          </p>
        ) : null}

        {!query.isPending && !error ? (
          <>
            <section aria-labelledby="meetings">
              <h2 id="meetings" className="font-heading text-2xl mb-3">הפגישות שלי</h2>
              {meetings.length === 0 ? <p>עוד אין כאן פניות</p> : (
                <ul className="space-y-3">
                  {meetings.map((e) => (
                    <li key={`m-${e.createdAt}`} className="border border-border/60 p-4">
                      <p className="font-medium">{e.meetingTopic ?? e.trackLabel ?? "פגישה"}</p>
                      <p className="text-sm text-muted-foreground">{e.scheduledAt ? fmt(e.scheduledAt) : e.timing}</p>
                      <p className="text-sm mt-1">{e.inCalendar ? "ביומן" : "ממתינה לאישור דורית"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="interviews">
              <h2 id="interviews" className="font-heading text-2xl mb-3">סיכומי ההיכרות שלי</h2>
              {interviews.length === 0 ? <p>עוד אין כאן פניות</p> : (
                <ul className="space-y-4">
                  {interviews.map((e) => (
                    <li key={`i-${e.createdAt}`} className="border border-border/60 p-4">
                      <p className="font-medium">{e.trackLabel ?? "ראיון היכרות"} · {fmt(e.createdAt)}</p>
                      {!e.completed ? <p className="text-sm text-muted-foreground mt-1">לא הושלם</p> : null}
                      {e.summary ? <p className="mt-2">{e.summary}</p> : null}
                      {e.profile.length ? (
                        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          {e.profile.map(([label, value]) => (
                            <React.Fragment key={label}>
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd>{value}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      ) : e.completed ? (
                        <p className="text-sm text-muted-foreground mt-2">הסיכום לא נשמר לפנייה הזו — היא קודמת לאזור האישי.</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        <section aria-labelledby="rights" className="text-sm text-muted-foreground space-y-2">
          <h2 id="rights" className="sr-only">פרטיות</h2>
          <p>פניות שנשלחו בלי כתובת מייל, או מכתובת אחרת, אינן מופיעות כאן.</p>
          <p>
            <Link to="/privacy" className="underline">בקשת עיון, תיקון או מחיקה</Link> — כמפורט במדיניות הפרטיות.
          </p>
        </section>
      </div>
    </main>
  );
}
```

`/account` must not be indexed. It is not done here but in `SeoRouteGuard`, which already marks `/login` and `/admin/*` (Step 4).

- [ ] **Step 4: Add the route and the header link**

In `src/App.jsx`: `const Account = lazy(() => import('@/pages/Account'));`, `import ProtectedRoute from '@/components/ProtectedRoute';`, and next to the admin block:

```jsx
        <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login?returnTo=/account" replace />} />}>
          <Route path="/account" element={<Account />} />
        </Route>
```

In `src/components/dorit/layout/FloatingHeader.tsx`: `import { useAuth } from "@/lib/AuthContext";`, `const { isAuthenticated, user } = useAuth();` inside the component, and in both the desktop `<nav>` and the drawer `<nav>`, after `{NAV.map(...)}`:

```tsx
            {isAuthenticated ? (
              <Link to="/account" className="text-[13px] tracking-[0.04em] text-foreground/75 hover:text-accent transition-colors duration-300 py-1">
                האזור שלי
              </Link>
            ) : null}
```

(drawer variant: same `Link` with the drawer row's class string and `onClick={() => setOpen(false)}`).

For an admin, the spec also asks for the admin pages beside it. After the "האזור שלי" link, in both navs:

```tsx
            {isAuthenticated && user?.role === "admin" ? (
              <Link to="/admin/leads" className="text-[13px] tracking-[0.04em] text-foreground/75 hover:text-accent transition-colors duration-300 py-1">
                ניהול
              </Link>
            ) : null}
```

(`/admin/leads` links on to `/admin/blog` already.)

In `src/components/SeoRouteGuard.tsx`, add to `NO_INDEX_ROUTES`:

```ts
  { match: /^\/account\/?$/, title: "האזור שלי | דורית גוב ארי", description: "האזור האישי." },
```

and add `/account` to `PRIVATE_ROUTES` in `e2e/seo/metadata.spec.ts` so the noindex rule is asserted for it.

- [ ] **Step 5: Write the e2e case**

`e2e/ui/account.spec.ts`:

```ts
import { expect, gotoApp, test, test_step } from "../fixtures/app";

/** The personal area is behind a sign-in, like the admin pages. */
test.describe("Personal area", () => {
  test("bounces an anonymous visitor to login, and back afterwards", async ({ page }) => {
    await test_step("open /account without a session", async () => {
      await gotoApp(page, "/account");
    });
    await test_step("the visitor is sent to the login screen", async () => {
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
```

The signed-in path is covered by the component tests: the e2e fixture answers `/entities/User/me` with 401 unconditionally and has no session path. Giving it one is a separate change; note it in `06-std-ui-e2e.md` under this case.

- [ ] **Step 6: Run everything this task touches**

Run: `npx vitest run tests/component/account-page.test.tsx && npm run typecheck && npm run lint && npx playwright test e2e/ui/account.spec.ts e2e/seo/metadata.spec.ts e2e/ui/navigation.spec.ts --retries=0`
Expected: PASS everywhere except the known local-only `home.spec` failure, which this run does not include.

- [ ] **Step 7: Document and commit**

`02-std-component.md`: new §4.x `<Account />` with `CMP-ACC-001..010`. `06-std-ui-e2e.md`: `E2E-ACC-001` and the note about the signed-in path. F-29 gains both.

```bash
git add src/pages/Account.tsx src/App.jsx src/components/dorit/layout/FloatingHeader.tsx src/components/SeoRouteGuard.tsx tests/component/account-page.test.tsx e2e/ui/account.spec.ts e2e/seo/metadata.spec.ts tests/test-plan/02-std-component.md tests/test-plan/06-std-ui-e2e.md tests/test-plan/09-traceability-matrix.md
git commit -m "The personal area: details, meetings and interview summaries"
```

---

### Task 6: Disclosure and docs

**Files:**
- Modify: `src/pages/PrivacyPolicy.tsx`
- Modify: `base44/agents/COMPLIANCE.md` (§6)
- Modify: `AGENTS.md` (Key Files)
- Modify: `README.md` (one paragraph near the Supabase section)

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Privacy policy paragraph**

In `src/pages/PrivacyPolicy.tsx`, in the section on what is collected and why, add a list item:

```tsx
              <li>
                אזור אישי: משתמש מחובר רואה את הפניות שנשלחו מכתובת המייל המאומתת
                שלו — מועדי פגישה, נושא, וסיכום ראיון ההיכרות כפי שנשלח אליו במייל.
                לא מוצגים בו מספר טלפון, הערות פנימיות או סטטוס הטיפול. אפשר לבקש עיון,
                תיקון או מחיקה בכל עת.
              </li>
```

- [ ] **Step 2: COMPLIANCE.md and AGENTS.md**

`COMPLIANCE.md` §6, a new bullet: the matching rule (verified email, `lower(trim)`), the accepted risk and why (the confirmation mail already went to that address), and the column list from Global Constraints. `AGENTS.md` Key Files: `supabase/migrations/20261006000000_personal_area.sql` — "`enquiries_for` is the only door to a visitor's own data; add a column to it deliberately, never by opening `leads`"; and `base44/functions/myAccount` with the same `VISIBLE` rule.

- [ ] **Step 3: Verify nothing pins the old privacy text**

Run: `npx vitest run tests/contract tests/security && npx playwright test e2e/ui/navigation.spec.ts --retries=0`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PrivacyPolicy.tsx base44/agents/COMPLIANCE.md AGENTS.md README.md
git commit -m "Say what the personal area shows, and to whom"
```

---

## Release notes for whoever merges

1. Apply the migration to the Supabase project (`supabase db push`, or the SQL editor) **before** the release that ships `myAccount`: the function calls `enquiries_for`, which does not exist until then.
2. `myAccount` reaches Base44 with CI's `base44 deploy` on green `main`; it needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Base44 secrets, which `contentAdmin` already uses.
3. Enquiries from before Task 2 have no `summary`, `profile` or `track_label`; the page says so.
