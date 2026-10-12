# Claims and the admin's lead writes → Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claims are saved and announced by a Supabase Edge Function (`submit-claim`), the admin's status changes and deletes write Supabase `leads` directly under her session, and the unused `myAccount` Base44 function is gone.

**Architecture:**
- **Edge Function:** `supabase/functions/submit-claim` is a Deno function.
  - `handler.ts` exports the request handler; `index.ts` serves it.
  - Its helpers live once, in `supabase/functions/_shared/`.
  - It writes `leads` through PostgREST with the service key and sends mail through `dorit-mailer`, exactly as today's Base44 `submitClaim` does.
- **Frontend:** follows the existing port/adapter pattern.
  - `SupabaseLeadService` sends claims to the Edge Function and delegates every other lead path to Base44.
  - `SupabaseLeadAdminService` writes `leads` itself.
- **CI:** deploys the functions on green `main`, before either production (Base44 publish, Vercel `--prod`) is allowed to go out.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, React/Vite, `@supabase/supabase-js` 2.x, Vitest, esbuild (test harness), Playwright (smoke), GitHub Actions, Supabase CLI.

**Spec:** [docs/superpowers/specs/2026-10-12-claims-and-lead-writes-to-supabase-design.md](../specs/2026-10-12-claims-and-lead-writes-to-supabase-design.md)

## Global Constraints

- **Don't touch the old functions:** do not modify `base44/functions/submitClaim/entry.ts` or `base44/functions/adminLead/entry.ts`. They are the rollback.
- **TypeScript for new code** (memory: prefer TS). Edge Function code uses **single quotes**: `tests/contract/logging.contract.test.ts` matches `log('info', 'request.start'` literally.
- **Logs:** say what happened, never who. A log line never carries `name, phone, email, message, summary, profile, notes, transcript, topic, body, consentAt`. Every line carries `rid`, and every `err:` value is `.slice(0, N)`.
- **Answers:** every JSON answer carries `rid`.
- **Hebrew copy is verbatim from the Base44 function:**
  - `'נדרשים שם וטלפון'`
  - `'לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.'`
  - `'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.'`
  - the mail templates
- **Supabase project ref:** `hjowdyiwjjrqceumkvgt` (DoritFinanaceSite). The token secret is `SUPABASE_ACCESS_TOKEN`: Edge Functions read-write only, checked 2026-10-12.
- **No migration.** `leads.agency_id` defaults to agency 1, and the admin update and delete policies already exist.
- **Never `new Date(x).toISOString()` for a wall-clock value.** Log timestamps are the existing exception, copied as-is.
- **Worktree:** all work is in the worktree at `$SP/piece6` (branch `feat/off-base44-piece6`), where
  `SP=/private/tmp/claude-501/-Users-amielpeled-CommercialProjects-DoritFinanaceSite/6c53b657-8a8d-4c33-ad09-e32ed10ea5d4/scratchpad`.
  Never touch the main checkout.
- **Exit codes:** in zsh, capture `$?` directly after a command (memory: `${PIPESTATUS[0]}` is empty here).

## Review Focus

1. **A body that isn't JSON, or is empty.** Expected: 400 `'נדרשים שם וטלפון'` with `rid`; nothing written, nothing mailed. Test in Task 3.
2. **Supabase credentials missing inside the function.** Expected: 500 with today's "could not save" text and `rid`, and **no mail**: an unsaved claim is never announced. Test in Task 3.
3. **A database refusal whose text quotes the row** (Postgres "Failing row contains (…)"). Expected: the visitor's name and phone never reach a log line. Test in Task 3.
4. **An admin write the access rules silently refuse** (0 rows changed, no error). Expected: the screen sees an error, not a success. Test in Task 6.
5. **A red `main`, or a missing token.** Expected: production (Base44 and Vercel `--prod`) is never promoted ahead of the functions, and a skipped deploy turns the smoke test red. Tests in Tasks 7 and 8.

---

### Task 1: Remove the unused `myAccount` function

**Files:**
- Delete: `base44/functions/myAccount/` (whole directory)
- Delete: `tests/integration/my-account.integration.test.ts`
- Modify: `AGENTS.md` (the `base44/functions/myAccount` bullet, lines 48-52)
- Modify: `tests/test-plan/12-std-integration.md` (row at line 50; section `### 4.20 myAccount` through the line before `### 4.21`)
- Modify: `tests/test-plan/01-std-unit.md` (row `UNIT-ACC-006`)
- Modify: `tests/test-plan/00-master-test-plan.md` (line 62: drop `myAccount` from the function list)

**Interfaces:** none. Nothing in `src/`, `e2e/` or `scripts/` references `myAccount`; confirm in step 1.

- [ ] **Step 1: Confirm there is no caller**

Run: `cd $SP/piece6 && grep -rn "myAccount" src e2e scripts api; echo "exit=$?"`
Expected: no output, `exit=1`.

- [ ] **Step 2: Delete the function and its test**

```bash
cd $SP/piece6 && git rm -rq base44/functions/myAccount tests/integration/my-account.integration.test.ts
```

- [ ] **Step 3: Remove the documentation entries**

- **AGENTS.md:** delete the five-line bullet that starts ``- `base44/functions/myAccount`: the same rule on the Base44 side.`` and ends ``per sign-in.``
- **`tests/test-plan/12-std-integration.md`:**
  - Delete the table row ``| `myAccount` | the personal area, for a visitor signed in through Base44 |``.
  - Delete the whole `### 4.20 `myAccount` …` section, up to but not including `### 4.21`.
  - Leave the numbering as it is; 4.21 keeps its number.
- **`tests/test-plan/01-std-unit.md`:** delete the `UNIT-ACC-006` row.
- **`tests/test-plan/00-master-test-plan.md`:** on line 62, remove `myAccount` and its separating comma from the `base44/functions/{…}` list.

- [ ] **Step 4: Run the suites that enumerate functions**

Run: `cd $SP/piece6 && npx vitest run tests/contract tests/integration tests/security > /tmp/t1.log 2>&1; echo "exit=$?"; grep -E "Test Files|Tests " /tmp/t1.log`
Expected: `exit=0`; all pass. The logging, clock and payload contracts iterate `base44/functions/*` and simply see one fewer.

- [ ] **Step 5: Commit**

```bash
cd $SP/piece6 && git add -A && git commit -q -m "Remove myAccount: no caller since the personal area moved to Supabase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 2: The CORS allow-list, as a shared Edge module

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Test: `tests/unit/edge-cors.test.ts`

**Interfaces:**
- Produces: `allowedOrigin(origin: string | null): string | null` and `corsHeaders(origin: string | null): Record<string, string>`, used by Task 3's handler.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/edge-cors.test.ts
import { describe, expect, it } from "vitest";
import { allowedOrigin, corsHeaders } from "../../supabase/functions/_shared/cors.ts";

describe("allowedOrigin", () => {
  it.each([
    "https://govari-fin.co.il",
    "https://www.govari-fin.co.il",
    "https://safe-arch-plan.base44.app",
    "https://dorit-finance-site.vercel.app",
    "https://dorit-finance-site-git-main-amielnoy-9725s-projects.vercel.app",
    "https://dorit-finance-site-abc123-amielnoy-9725s-projects.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
  ])("lets %s in", (origin) => {
    expect(allowedOrigin(origin)).toBe(origin);
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "https://govari-fin.co.il.evil.example",
    "http://govari-fin.co.il",
    "https://someone-else.vercel.app",
    "https://dorit-finance-site.vercel.app.evil.example",
    "http://localhost.evil.example",
  ])("refuses %s", (origin) => {
    expect(allowedOrigin(origin)).toBeNull();
  });
});

describe("corsHeaders", () => {
  it("echoes an allowed origin and varies on it", () => {
    const h = corsHeaders("https://govari-fin.co.il");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://govari-fin.co.il");
    expect(h.Vary).toBe("Origin");
  });

  it("allows the headers supabase-js sends, and only POST", () => {
    const h = corsHeaders("https://govari-fin.co.il");
    for (const header of ["authorization", "apikey", "content-type", "x-client-info"]) {
      expect(h["Access-Control-Allow-Headers"]).toContain(header);
    }
    expect(h["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
  });

  it("names no origin for one that is not on the list", () => {
    expect(corsHeaders("https://evil.example")).not.toHaveProperty("Access-Control-Allow-Origin");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd $SP/piece6 && npx vitest run tests/unit/edge-cors.test.ts > /tmp/t2.log 2>&1; echo "exit=$?"; grep -m3 -E "Error|FAIL" /tmp/t2.log`
Expected: `exit=1`, failing to resolve `../../supabase/functions/_shared/cors.ts`.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/cors.ts
/**
 * Which pages may read an Edge Function's answer.
 *
 * supabase-js sends `authorization`, `apikey` and `x-client-info`, so every call
 * from the site is preflighted, and an answer without an allow header is one the
 * browser throws away — the claim would be saved and the visitor told it failed.
 *
 * This is browser hygiene, not access control: the functions are public, like the
 * forms that call them, and a script outside a browser ignores CORS entirely.
 *
 * The Vercel project is `dorit-finance-site` — spelled "finance", unlike the
 * repository — and its preview hosts start with that name.
 */
const EXACT = new Set([
  'https://govari-fin.co.il',
  'https://www.govari-fin.co.il',
  'https://safe-arch-plan.base44.app',
]);
const VERCEL = /^https:\/\/dorit-finance-site(-[a-z0-9-]+)?\.vercel\.app$/;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return EXACT.has(origin) || VERCEL.test(origin) || LOCAL.test(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const allowed = allowedOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd $SP/piece6 && npx vitest run tests/unit/edge-cors.test.ts > /tmp/t2.log 2>&1; echo "exit=$?"; grep -E "Tests " /tmp/t2.log`
Expected: `exit=0`, all passed.

- [ ] **Step 5: Commit**

```bash
cd $SP/piece6 && git add supabase/functions/_shared/cors.ts tests/unit/edge-cors.test.ts && git commit -q -m "Edge Functions: the CORS allow-list, shared

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 3: `submit-claim`, its shared modules and its test harness

**Files:**
- Create: `supabase/functions/_shared/log.ts`
- Create: `supabase/functions/_shared/attribution.ts`
- Create: `supabase/functions/_shared/html.ts`
- Create: `supabase/functions/_shared/mail.ts`
- Create: `supabase/functions/_shared/device.ts`
- Create: `supabase/functions/_shared/rest.ts`
- Create: `supabase/functions/submit-claim/handler.ts`
- Create: `supabase/functions/submit-claim/index.ts`
- Modify: `supabase/config.toml` (append a `[functions.submit-claim]` block)
- Create: `tests/helpers/edge-function.ts`
- Modify: `tests/integration/submit-claim.integration.test.ts` (run every case against both implementations)
- Create: `tests/integration/submit-claim-edge.integration.test.ts`

**Interfaces:**
- Consumes: `corsHeaders(origin)` from Task 2.
- Produces:
  - **The function's answer**, at `POST /functions/v1/submit-claim`:
    - 200 `{ ok: true, rid, leadId, warnings }`
    - 400 `{ error, rid }`
    - 500 `{ error, rid }`
    - `OPTIONS` → 204
  - **Its body:** the same keys `Base44LeadService.submitClaim` sends.
  - **The test harness**, for Task 4 and later functions:
    `invokeEdge(name, body, options?): Promise<EdgeInvocation>`, exported from `tests/helpers/edge-function.ts`, together with the `SUPABASE_URL` constant.

- [ ] **Step 1: Write the test harness**

```ts
// tests/helpers/edge-function.ts
import { join } from "node:path";
import { buildSync } from "esbuild";
import { REPO_ROOT } from "./entity-schema";
import { MAILER_URL, type EmailCall, type FetchCall } from "./base44-function";

/**
 * Runs a Supabase Edge Function in-process, the way tests/helpers/base44-function.ts
 * runs a Base44 one: what executes is the code that deploys.
 *
 * `handler.ts` and the `_shared` modules it imports are bundled with esbuild
 * into one CommonJS chunk and evaluated with `fetch` and `Deno` passed in, so
 * every outbound call is recorded and answered here. Nothing reaches a network.
 */

export const SUPABASE_URL = "https://project-ref.supabase.test";
const SERVICE_KEY = "service-role-test";

export interface EdgeOptions {
  /** PostgREST refuses the insert with this status (default 500 when set). */
  failLeadWrite?: boolean | { status: number; body: string };
  /** Recipients whose delivery the mailer refuses. */
  failEmailTo?: string[];
  env?: Record<string, string>;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as-is instead of JSON.stringify(body). */
  rawBody?: string;
}

export interface EdgeInvocation {
  status: number;
  json: Record<string, unknown>;
  headers: Headers;
  /** Rows PostgREST accepted, as stored (with their generated `id`). */
  leads: Record<string, unknown>[];
  emails: EmailCall[];
  fetches: FetchCall[];
  mailTo(address: string): EmailCall;
}

type Handler = (req: Request) => Promise<Response>;
type Factory = (module: { exports: Record<string, unknown> }, exports: unknown, fetch: unknown, deno: unknown) => Handler;

const compiled = new Map<string, Factory>();

function compile(name: string): Factory {
  const out = buildSync({
    entryPoints: [join(REPO_ROOT, "supabase/functions", name, "handler.ts")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });
  // eslint-disable-next-line no-new-func -- the point of this harness
  return new Function("module", "exports", "fetch", "Deno", `${out.outputFiles[0].text}\n;return module.exports.handler;`) as Factory;
}

export async function invokeEdge(name: string, body: unknown, options: EdgeOptions = {}): Promise<EdgeInvocation> {
  if (!compiled.has(name)) compiled.set(name, compile(name));
  const leads: Record<string, unknown>[] = [];
  const emails: EmailCall[] = [];
  const fetches: FetchCall[] = [];

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET");
    const parsed = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    fetches.push({ url: u, method, headers: (init.headers ?? {}) as Record<string, string>, body: parsed });

    if (u === MAILER_URL) {
      const ok = !options.failEmailTo?.includes(parsed.to);
      if (ok) emails.push({ to: parsed.to, subject: parsed.subject, html: parsed.html, text: parsed.text, body: parsed.text });
      return new Response(JSON.stringify(ok ? { ok: true, ids: ["mailer-test-id"] } : { ok: false, failed: ["http_422"] }), {
        status: ok ? 200 : 422,
      });
    }
    if (u === `${SUPABASE_URL}/rest/v1/leads` && method === "POST") {
      if (options.failLeadWrite) {
        const f = options.failLeadWrite === true ? { status: 500, body: '{"message":"simulated outage"}' } : options.failLeadWrite;
        return new Response(f.body, { status: f.status });
      }
      const row = { id: `00000000-0000-4000-8000-${String(leads.length + 1).padStart(12, "0")}`, ...parsed };
      leads.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    throw new Error(`unexpected fetch in an Edge Function test: ${method} ${u}`);
  };

  const env = options.env ?? {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  };
  const module = { exports: {} as Record<string, unknown> };
  const handler = compiled.get(name)!(module, module.exports, fetchImpl, { env: { get: (k: string) => env[k] } });

  const method = options.method ?? "POST";
  const response = await handler(
    new Request(`https://edge.test/functions/v1/${name}`, {
      method,
      headers: { "content-type": "application/json", origin: "https://govari-fin.co.il", ...(options.headers ?? {}) },
      body: method === "OPTIONS" ? undefined : (options.rawBody ?? JSON.stringify(body ?? {})),
    }),
  );
  const text = await response.text();

  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers,
    leads,
    emails,
    fetches,
    mailTo(address) {
      const found = emails.filter((e) => e.to === address);
      if (found.length !== 1) {
        throw new Error(`expected exactly one email to ${address}, saw ${found.length} (recipients: ${emails.map((e) => e.to).join(", ") || "none"})`);
      }
      return found[0];
    },
  };
}
```

- [ ] **Step 2: Run every existing case against both implementations (failing test)**

Replace the body of `tests/integration/submit-claim.integration.test.ts` after its doc comment and constants:
- Change the imports to:
  ```ts
  import { describe, expect, it } from "vitest";
  import { invokeFunction } from "../helpers/base44-function";
  import { invokeEdge } from "../helpers/edge-function";
  ```
- Keep the doc comment, `AGENCY`, `OPS`, `OPS2` and `claim` unchanged.
- Add this paragraph to the end of the doc comment:
  ```
   * Both implementations run every case below while both exist: Base44's
   * `submitClaim` (the rollback) and the `submit-claim` Edge Function that
   * replaced it. A case that passes for one and fails for the other is drift.
  ```
- Then:

```ts
type Run = (
  body: unknown,
  options?: { failLeadWrite?: boolean; failEmailTo?: string[] },
) => Promise<{
  status: number;
  json: Record<string, unknown>;
  leads: Record<string, unknown>[];
  emails: { to: string; subject: string; html?: string; text?: string; body?: string }[];
  mailTo(address: string): { subject: string; html?: string; text?: string; body?: string };
}>;

const IMPLEMENTATIONS: { label: string; run: Run }[] = [
  { label: "Base44 submitClaim", run: (body, options) => invokeFunction("submitClaim", body, options) },
  { label: "Edge submit-claim", run: (body, options) => invokeEdge("submit-claim", body, options) },
];

describe.each(IMPLEMENTATIONS)("$label", ({ run }) => {
  // ← every existing `describe(...)` block from this file goes here unchanged,
  //   except that each `invokeFunction("submitClaim", X)` becomes `run(X)` and
  //   each `invokeFunction("submitClaim", X, O)` becomes `run(X, O)`.
});

describe("the two implementations say the same thing", () => {
  it("send the reporter the same HTML", async () => {
    const [base44, edge] = await Promise.all([invokeFunction("submitClaim", claim), invokeEdge("submit-claim", claim)]);
    expect(edge.mailTo("ronit@example.com").html).toBe(base44.mailTo("ronit@example.com").html);
    expect(edge.mailTo("ronit@example.com").subject).toBe(base44.mailTo("ronit@example.com").subject);
  });

  it("send the staff the same report, apart from the timestamp line", async () => {
    const [base44, edge] = await Promise.all([invokeFunction("submitClaim", claim), invokeEdge("submit-claim", claim)]);
    const rest = (text = "") => text.split("\n").slice(1).join("\n");
    for (const to of [AGENCY, OPS, OPS2]) {
      expect(rest(edge.mailTo(to).text), to).toBe(rest(base44.mailTo(to).body ?? base44.mailTo(to).text));
      expect(edge.mailTo(to).subject, to).toBe(base44.mailTo(to).subject);
    }
  });
});
```

The existing describe blocks move inside `describe.each` verbatim. These are their titles, so none is lost:
- `"submitClaim — the report lands"` (5 cases)
- `"submitClaim — the operations mailboxes"` (3)
- `"submitClaim — what survives a failure"` (4)
- `"submitClaim — a name that is really a payload"` (1)
- `"submitClaim — channel attribution"` (4)

- [ ] **Step 3: Write the Edge-only cases (failing test)**

```ts
// tests/integration/submit-claim-edge.integration.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAILER_URL } from "../helpers/base44-function";
import { invokeEdge, SUPABASE_URL } from "../helpers/edge-function";

/**
 * What only the Edge Function does: the row it writes to Supabase, the CORS
 * answer the browser needs, and the failures that are new because the database
 * is now the one store rather than a mirror.
 */

const claim = {
  name: "רונית מזרחי",
  phone: "0536667788",
  email: "ronit@example.com",
  claimType: "תאונת דרכים",
  eventDate: "2026-09-01",
  policyNumber: "POL-99",
  description: "נזק לרכב בחניון, דווח למשטרה.",
  documents: ["אישור משטרה.pdf", "תמונות.zip"],
};

afterEach(() => vi.restoreAllMocks());

describe("submit-claim — the row", () => {
  it("writes exactly today's fields, with no Base44 id", async () => {
    const r = await invokeEdge("submit-claim", claim);
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    const { id, ...row } = r.leads[0];
    expect(id).toEqual(expect.any(String));
    expect(row).toEqual({
      name: "רונית מזרחי",
      phone: "0536667788",
      email: "ronit@example.com",
      source: "claim",
      topic: "תאונת דרכים",
      timing: "2026-09-01",
      message: "סוג: תאונת דרכים\nתאריך אירוע: 2026-09-01\nפוליסה: POL-99\nנזק לרכב בחניון, דווח למשטרה.\nמסמכים: אישור משטרה.pdf | תמונות.zip",
      status: "new",
      channel: "unknown",
      campaign: null,
    });
  });

  it("answers with the Supabase id of the row it wrote", async () => {
    const r = await invokeEdge("submit-claim", claim);
    expect(r.json).toMatchObject({ ok: true, leadId: r.leads[0].id, warnings: [] });
    expect(r.json.rid).toEqual(expect.any(String));
  });

  it("writes with the service key and asks for the row back, before any mail", async () => {
    const r = await invokeEdge("submit-claim", claim);
    const at = r.fetches.findIndex((f) => f.url === `${SUPABASE_URL}/rest/v1/leads`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(r.fetches.slice(0, at).some((f) => f.url === MAILER_URL)).toBe(false);
    expect(r.fetches[at].headers).toMatchObject({
      apikey: "service-role-test",
      Authorization: "Bearer service-role-test",
      Prefer: "return=representation",
    });
  });
});

describe("submit-claim — what it refuses", () => {
  it("answers a body that is not JSON as a missing name and phone, touching nothing", async () => {
    const r = await invokeEdge("submit-claim", null, { rawBody: "not json" });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "נדרשים שם וטלפון", rid: expect.any(String) });
    expect(r.fetches).toEqual([]);
  });

  it("saves nothing and mails nobody when Supabase is not configured", async () => {
    const r = await invokeEdge("submit-claim", claim, { env: { MAILER_URL, MAILER_TOKEN: "t" } });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.", rid: expect.any(String) });
    expect(r.emails).toEqual([]);
  });

  it("keeps the row's contents out of the log when the database quotes them back", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    }
    const r = await invokeEdge("submit-claim", claim, {
      failLeadWrite: {
        status: 400,
        body: JSON.stringify({ code: "23514", message: "new row violates check constraint", details: "Failing row contains (רונית מזרחי, 0536667788)." }),
      },
    });
    expect(r.status).toBe(500);
    const all = lines.join("\n");
    expect(all).toContain("lead.create_failed");
    expect(all).toContain("23514");
    expect(all).not.toContain("רונית");
    expect(all).not.toContain("0536667788");
  });
});

describe("submit-claim — the browser's side", () => {
  it("answers a preflight without doing anything", async () => {
    const r = await invokeEdge("submit-claim", undefined, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
    expect(r.fetches).toEqual([]);
  });

  it("names the site's origin on every answer, including a refusal", async () => {
    const r = await invokeEdge("submit-claim", { ...claim, phone: "" });
    expect(r.status).toBe(400);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
  });

  it("names no origin for a page that is not ours", async () => {
    const r = await invokeEdge("submit-claim", claim, { headers: { origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});
```

- [ ] **Step 4: Run both test files to see them fail**

Run: `cd $SP/piece6 && npx vitest run tests/integration/submit-claim.integration.test.ts tests/integration/submit-claim-edge.integration.test.ts > /tmp/t3.log 2>&1; echo "exit=$?"; grep -m3 -E "Could not resolve|FAIL|Error" /tmp/t3.log`
Expected: `exit=1`. The Edge cases fail because esbuild cannot resolve `supabase/functions/submit-claim/handler.ts`; the Base44 cases still pass.

- [ ] **Step 5: Write the shared modules**

**`supabase/functions/_shared/log.ts`:**

```ts
/**
 * One structured line per event, to the function's output: what happened, never
 * who. The rule and its reasons are in tests/contract/logging.contract.test.ts,
 * which reads these files as it reads the Base44 functions.
 */
export type Level = 'info' | 'warn' | 'error';
export type Log = (level: Level, event: string, fields: Record<string, unknown>) => void;

export function createLog(fn: string): Log {
  return function log(level, event, fields) {
    const line = JSON.stringify({ t: new Date().toISOString(), level, fn, event, ...fields });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
}

/** A short id that ties one request's lines together. */
export const newRequestId = (): string => crypto.randomUUID().slice(0, 8);
```

**`supabase/functions/_shared/attribution.ts`:**
- Header comment:
  ```
  /** The closed marketing-channel vocabulary — the same list as src/lib/attribution.ts plus the server-only 'unknown'. tests/contract/edge-functions.contract.test.ts fails if it drifts from base44/functions/submitClaim. */
  ```
- **Copy verbatim** from `base44/functions/submitClaim/entry.ts`:
  - `CHANNEL_TAXONOMY` (lines 92-95), with `export`
  - `validChannel` (98-100)
  - `validCampaign` (103-107)
  - `validLandingPath` (110-113)
  - `channelLine` (116-122)
- Add `export` to each, and these types and nothing else:

```ts
export function validChannel(value: unknown): string | null
export function validCampaign(value: unknown): string | null
export function validLandingPath(value: unknown): string | null
export function channelLine({ channel, campaign, landingPath }: { channel: string | null; campaign: string | null; landingPath: string | null }): string
```

**`supabase/functions/_shared/html.ts`:**
- **Copy verbatim:**
  - `escapeHtml` (lines 198-205), as `export function escapeHtml(text: unknown): string`
  - `buildClientHtml` (lines 225-287) and its doc comment, as `export function buildClientHtml({ firstName, eyebrow, heading, intro, panelTitle, details }: ClientMail): string`
- **Change these two lines in `buildClientHtml`:**
  - the first line of its body: `const rows = (details || []).filter(([, value]) => value);`
  - in the doc comment, the paragraph beginning "One letter, three messages. Base44 gives these entry points no shared module…" becomes "One letter for every message to a visitor. Edge Functions share this module; the Base44 copies are kept identical by tests/integration/submit-claim.integration.test.ts, which compares the HTML both send."
- **Add the type:**

```ts
export interface ClientMail {
  firstName: string;
  eyebrow: string;
  heading: string;
  intro: string;
  panelTitle: string;
  details: [label: string, value: string][];
}
```

**`supabase/functions/_shared/mail.ts`:**

```ts
import type { Log } from './log.ts';

// Lines 39-42 of base44/functions/submitClaim/entry.ts, verbatim, typed:
export function deliveryWarning(label: string, error: unknown): string {
  const reason = String((error as Error)?.message ?? error ?? '').slice(0, 300);
  return reason ? `${label} (${reason})` : label;
}

// Lines 78-84, verbatim, typed:
export function upstreamReasons(result: unknown): string {
  const failed = (result as { failed?: unknown } | null)?.failed;
  const reasons = Array.isArray(failed) ? failed : [];
  const safe = [...new Set(reasons.filter(
    (r) => typeof r === 'string' && /^(http_\d{3}|no_message_id|network_error)$/.test(r)
  ))];
  return safe.length ? `:${safe.join(',')}` : '';
}

export interface Mail {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  body?: string;
  rid: string;
  role: string;
}

/**
 * The one way these functions send mail: a finished message posted to
 * `dorit-mailer`, which holds the Resend key. Lines 124-166 of
 * base44/functions/submitClaim/entry.ts, with `log` passed in.
 */
export async function sendMail(log: Log, { to, subject, html, text, body, rid, role }: Mail): Promise<void> {
  // ← the body of submitClaim's `sendMail` (lines 125-165), verbatim, with
  //   `let response;` typed as `let response: Response;`
}
```

**`supabase/functions/_shared/device.ts`:**
- The doc comment and `deviceLabel` from lines 330-352, verbatim, exported as `export function deviceLabel(ua: string | null): string`.

**`supabase/functions/_shared/rest.ts`:**

```ts
/**
 * One row into a Supabase table through PostgREST, with the service key, and
 * the row as stored — its generated `id` is the lead id the page reports.
 *
 * Plain `fetch`, as the Base44 functions' mirror writes have always been: no
 * client library, so the in-process test harness runs it unchanged.
 *
 * A refusal is reported by status and PostgREST's error code only. Its message
 * and details can quote the row back ("Failing row contains (…)"), which is
 * the visitor's name and phone, and the caller logs whatever this throws.
 */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('supabase_not_configured');

  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
    const safe = typeof code === 'string' && /^[A-Z0-9]{1,10}$/.test(code) ? `:${code}` : '';
    throw new Error(`insert_http_${res.status}${safe}`);
  }
  const rows = await res.json();
  const inserted = Array.isArray(rows) ? rows[0] : null;
  if (!inserted || typeof inserted !== 'object') throw new Error('insert_returned_nothing');
  return inserted as Record<string, unknown>;
}
```

- [ ] **Step 6: Write the handler and the entry point**

```ts
// supabase/functions/submit-claim/handler.ts
/**
 * A claim report: saved first, then announced.
 *
 * The Supabase twin of base44/functions/submitClaim — same input, same checks,
 * same mail — except that the record is written to Supabase, the only store
 * from here on. tests/integration/submit-claim.integration.test.ts runs both
 * against one set of cases while both exist.
 */
import { channelLine, validCampaign, validChannel, validLandingPath } from '../_shared/attribution.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { deviceLabel } from '../_shared/device.ts';
import { buildClientHtml, type ClientMail } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { insertRow } from '../_shared/rest.ts';

const FN = 'submit-claim';
const log = createLog(FN);

// Several mailboxes, one team — see the note in base44/functions/submitLead/entry.ts.
const NOTIFY_EMAILS = ['amielnoy@gmail.com', 'amielnoy@outlook.com'];
const SECONDARY_EMAIL = 'dorit@govari-fin.co.il';

/** What changes in this function's confirmation — the content only; the template is shared. */
function clientMailFor(data: { name?: string; claimType?: string; eventDate?: string }): ClientMail {
  // ← the body of submitClaim's clientMailFor (lines 173-187), verbatim,
  //   including its comment about '—'.
}

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid, source: 'claim' });
    // A body that is not JSON is answered as what it amounts to — no name and
    // no phone — rather than as a server fault.
    const body = await req.json().catch(() => null);
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents, channel, campaign, landingPath } = body || {};
    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);

    if (!name || !phone) {
      log('warn', 'request.rejected', { rid, reason: 'missing_contact_fields' });
      return Response.json({ error: 'נדרשים שם וטלפון', rid }, { status: 400, headers: cors });
    }

    // ← lines 372-406 of base44/functions/submitClaim/entry.ts, verbatim:
    //   docList, docLines, claimChannelText, agentBody (its first line keeps
    //   `new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })`),
    //   subject, and messageBody — with `deviceLabel(req.headers.get('user-agent'))`.

    let leadId: string | null = null;
    try {
      const row = await insertRow('leads', {
        name,
        phone,
        email: email || '',
        source: 'claim',
        topic: claimType || '',
        timing: eventDate || '',
        message: messageBody,
        status: 'new',
        channel: safeChannel,
        campaign: safeCampaign,
      });
      leadId = typeof row.id === 'string' ? row.id : null;
      log('info', 'lead.created', { rid, leadId, source: 'claim' });
    } catch (e) {
      // The one hard failure: a report nobody stored is never announced.
      log('error', 'lead.create_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json(
        { error: 'לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.', rid },
        { status: 500, headers: cors },
      );
    }

    const warnings: string[] = [];

    for (const to of NOTIFY_EMAILS) {
      try {
        await sendMail(log, { to, subject, body: agentBody, rid, role: 'ops' });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'ops', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }

    try {
      await sendMail(log, { to: SECONDARY_EMAIL, subject, body: agentBody, rid, role: 'agency' });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'agency', err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('secondary_email_failed', e));
    }

    if (email) {
      try {
        // ← clientText and the sendMail call from lines 483-498 of
        //   base44/functions/submitClaim/entry.ts, verbatim, with `sendMail(log, {…})`.
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('client_confirmation_failed', e));
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, warnings: warnings.length });
    return Response.json({ ok: true, rid, leadId, warnings }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json(
      { error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.', rid },
      { status: 500, headers: cors },
    );
  }
}
```

```ts
// supabase/functions/submit-claim/index.ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

Append to `supabase/config.toml`:

```toml

# The claim form posts without signing in, as it always has; the function
# checks its own input. The new `sb_publishable_` keys are not JWTs either, so
# the gateway's JWT check would refuse every visitor.
[functions.submit-claim]
verify_jwt = false
```

- [ ] **Step 7: Run both test files to see them pass**

Run: `cd $SP/piece6 && npx vitest run tests/integration/submit-claim.integration.test.ts tests/integration/submit-claim-edge.integration.test.ts > /tmp/t3.log 2>&1; echo "exit=$?"; grep -E "Tests " /tmp/t3.log`
Expected: `exit=0`. There are 17 cases × 2 implementations, 2 parity cases and 9 Edge cases, so 45 pass.

- [ ] **Step 8: Type-check with Deno**

Run: `cd $SP/piece6 && deno check --no-config supabase/functions/submit-claim/index.ts; echo "exit=$?"`
Expected: `exit=0`.
- If it reports `any`-typed destructuring from `body`, annotate `const body: Record<string, unknown> | null = …` and cast each field where it is used. Do not weaken checking with `// @ts-nocheck`.
- If Deno refuses to run without a config, add `supabase/functions/deno.json` containing `{}`, rerun with `deno check supabase/functions/submit-claim/index.ts`, and use that form in Task 7 too.

- [ ] **Step 9: Commit**

```bash
cd $SP/piece6 && git add supabase tests/helpers/edge-function.ts tests/integration/submit-claim.integration.test.ts tests/integration/submit-claim-edge.integration.test.ts && git commit -q -m "submit-claim: the first Supabase Edge Function, run against the same cases as Base44's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 4: Hold the Edge Functions to the backend's contracts

**Files:**
- Modify: `tests/helpers/source-scan.ts` (add `edgeFunctionFiles()`)
- Modify: `tests/contract/logging.contract.test.ts`
- Modify: `tests/contract/function-clock.contract.test.ts`
- Modify: `tests/contract/frontend-payloads.contract.test.ts` (adapter → submit-claim; this case is written now and goes green in Task 5)
- Create: `tests/contract/edge-functions.contract.test.ts`

**Interfaces:**
- Produces: `edgeFunctionFiles(): string[]`. Each entry is one function's `handler.ts` source followed by every `_shared/*.ts` file it imports, for scanning. It returns the list of `handler.ts` paths; `edgeSource(path)` returns the concatenated text.

- [ ] **Step 1: Add the scanner helpers**

Append to `tests/helpers/source-scan.ts`:

```ts
/** Supabase Edge Function handlers: supabase/functions/<name>/handler.ts, skipping `_shared`. */
export function edgeFunctionFiles(): string[] {
  const root = join(REPO_ROOT, "supabase/functions");
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name.startsWith("_")) continue;
    const handler = join(root, name, "handler.ts");
    try {
      if (statSync(handler).isFile()) out.push(handler);
    } catch {
      /* not a function directory */
    }
  }
  return out.sort();
}

/**
 * A handler and the shared modules it imports, as one text — what a scan of
 * "this function's source" means once helpers stop being duplicated into it.
 */
export function edgeSource(handler: string): string {
  const src = read(handler);
  const shared = [...src.matchAll(/from '\.\.\/_shared\/([a-z-]+\.ts)'/g)].map((m) =>
    read(join(REPO_ROOT, "supabase/functions/_shared", m[1])),
  );
  return [src, ...shared].join("\n");
}
```

- [ ] **Step 2: Extend the logging contract (failing first only if a rule is broken)**

In `tests/contract/logging.contract.test.ts`:
- **Import:** add `edgeFunctionFiles, edgeSource` to the `../helpers/source-scan` import.
- **Sources:** after the `sources` constant, add:

```ts
/** Supabase Edge Functions, keyed by directory name, each with the shared modules it imports. */
const edgeNames = edgeFunctionFiles().map((f) => f.split("/").at(-2)!);
for (const f of edgeFunctionFiles()) sources[f.split("/").at(-2)!] = edgeSource(f);
const allNames = [...functionNames, ...edgeNames];
```

- **Swap the name list:** in the `"every backend function keeps a diary"` and `"what the diary may not contain"` describes, replace `it.each(functionNames)` with `it.each(allNames)`, and `for (const name of functionNames)` with `for (const name of allNames)`, **except** in these two tests:
  - `"writes the same helper in every function"`: it compares Base44's duplicated `function log(` copies. Keep `functionNames`.
  - `"names the function it came from, and never the same name twice"`: change it to:

```ts
  it("names the function it came from, and never the same name twice", () => {
    const declared = allNames.map((n) => sources[n].match(/const FN = '([^']+)'/)?.[1] ?? null);
    expect(declared).toEqual(allNames);
  });
```

- **The `rid` contract:** in `describe("a failure you can look up")`, change `const fns = backendFiles();` to `const fns = [...backendFiles(), ...edgeFunctionFiles()];`.

Run: `cd $SP/piece6 && npx vitest run tests/contract/logging.contract.test.ts > /tmp/t4.log 2>&1; echo "exit=$?"; grep -E "Tests |FAIL|✗|×" /tmp/t4.log | head`
Expected: `exit=0`, with the Edge Function now listed as `submit-claim` in each `it.each`. If a rule fails, fix the Edge source, not the rule.

- [ ] **Step 3: Extend the clock contract**

In `tests/contract/function-clock.contract.test.ts`, after `entries` is built, append the Edge handlers:

```ts
import { edgeFunctionFiles, edgeSource } from "../helpers/source-scan";
// …
entries.push(...edgeFunctionFiles().map((path) => ({ path, source: edgeSource(path) })));
```

Run: `cd $SP/piece6 && npx vitest run tests/contract/function-clock.contract.test.ts > /tmp/t4b.log 2>&1; echo "exit=$?"`
Expected: `exit=0`. The Edge handler's only `toLocaleString` already names `Asia/Jerusalem`.

- [ ] **Step 4: Write the Edge-specific contract**

```ts
// tests/contract/edge-functions.contract.test.ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { edgeFunctionFiles, read } from "../helpers/source-scan";

/**
 * The shape every Supabase Edge Function keeps, and the one list that must
 * stay identical to the Base44 copies while both run.
 */

const names = edgeFunctionFiles().map((f) => f.split("/").at(-2)!);
const quoted = (src: string, decl: string) => {
  const start = src.indexOf(decl);
  expect(start, `${decl} not found`).toBeGreaterThan(-1);
  return [...src.slice(start, src.indexOf("];", start)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe("Edge Functions", () => {
  it("there is at least one, so the cases below are not vacuous", () => {
    expect(names).toContain("submit-claim");
  });

  it.each(names)("%s serves its handler and does nothing else at load", (name) => {
    const index = read(join(REPO_ROOT, "supabase/functions", name, "index.ts")).trim();
    expect(index).toBe("import { handler } from './handler.ts';\n\nDeno.serve(handler);");
  });

  it.each(names)("%s declares its JWT setting in config.toml", (name) => {
    const config = read(join(REPO_ROOT, "supabase/config.toml"));
    expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = (true|false)`));
  });

  it("keeps submit-claim public, like the form that calls it", () => {
    expect(read(join(REPO_ROOT, "supabase/config.toml"))).toMatch(/\[functions\.submit-claim\]\s*\nverify_jwt = false/);
  });

  it("uses the same channel vocabulary as the Base44 functions", () => {
    const edge = quoted(read(join(REPO_ROOT, "supabase/functions/_shared/attribution.ts")), "CHANNEL_TAXONOMY = [");
    const base44 = quoted(read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts")), "const CHANNEL_TAXONOMY = [");
    expect(edge).toEqual(base44);
  });
});
```

Run: `cd $SP/piece6 && npx vitest run tests/contract/edge-functions.contract.test.ts > /tmp/t4c.log 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 5: Add the payload contract for the new adapter (fails until Task 5)**

In `tests/contract/frontend-payloads.contract.test.ts`, after the `describe("adapter → submitClaim", …)` block, add:

```ts
describe("adapter → submit-claim (Supabase)", () => {
  const ADAPTER = [join(REPO_ROOT, "src/services/supabase/SupabaseLeadService.ts")];
  const calls = findObjectLiteralCalls(/functions\.invoke\(\s*["']submit-claim["']\s*,\s*\{\s*body:\s*/, ADAPTER);
  const accepted = destructuredBody(readFileSync(join(REPO_ROOT, "supabase/functions/submit-claim/handler.ts"), "utf8"));

  it("exactly one adapter owns the call", () => {
    expect(calls).toHaveLength(1);
  });

  it("sends only fields the function reads, including name and phone", () => {
    expect(calls[0].keys.filter((k) => !accepted.includes(k))).toEqual([]);
    for (const required of ["name", "phone"]) expect(calls[0].keys).toContain(required);
  });

  it("sends what the Base44 adapter sends, so switching store changes nothing the function sees", () => {
    const base44 = findObjectLiteralCalls(
      /invokeFunction(?:<\w+>)?\(\s*this\.client\s*,\s*["']submitClaim["']\s*,\s*/,
      [join(REPO_ROOT, "src/services/base44/Base44LeadService.ts")],
    );
    expect([...calls[0].keys].sort()).toEqual([...base44[0].keys].sort());
  });
});
```

Run: `cd $SP/piece6 && npx vitest run tests/contract/frontend-payloads.contract.test.ts > /tmp/t4d.log 2>&1; echo "exit=$?"`
Expected: `exit=1`. Only the three new cases fail, because `SupabaseLeadService.ts` doesn't exist yet. **Do not commit this file in this task;** it is committed with Task 5.

- [ ] **Step 6: Commit the rest**

```bash
cd $SP/piece6 && git add tests/helpers/source-scan.ts tests/contract/logging.contract.test.ts tests/contract/function-clock.contract.test.ts tests/contract/edge-functions.contract.test.ts && git commit -q -m "Contracts: Edge Functions keep the backend's logging, clock and shape rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 5: `SupabaseLeadService`: claims to the Edge Function

**Files:**
- Create: `src/services/supabase/SupabaseLeadService.ts`
- Modify: `src/services/index.ts`
- Test: `tests/unit/supabase-lead.test.ts` (new)
- Modify: `tests/unit/services-wiring.test.ts`
- Commit with: `tests/contract/frontend-payloads.contract.test.ts` (from Task 4, step 5)

**Interfaces:**
- Consumes: `LeadPort`, `ClaimReport`, `SubmissionReceipt`, `Lead`, `InterviewSummary` from `src/services/ports.ts`, and `Base44LeadService`.
- Produces:
  - `class SupabaseLeadService implements LeadPort`, constructed with `(client: SupabaseFunctionsClient, rest: LeadPort)`
  - `interface SupabaseFunctionsClient`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/supabase-lead.test.ts
import { describe, expect, it, vi } from "vitest";
import { SupabaseLeadService, type SupabaseFunctionsClient } from "@/services/supabase/SupabaseLeadService";
import type { LeadPort } from "@/services/ports";

const report = { name: "רונית", phone: "0536667788", claimType: "תאונת דרכים", documents: ["https://x/a.pdf"] };

const rest = (): LeadPort => ({
  submitLead: vi.fn(async () => ({ ok: true, rid: "b44" })),
  submitClaim: vi.fn(async () => ({ ok: true })),
  requestConsultationEvent: vi.fn(async () => {}),
  submitInterview: vi.fn(async () => ({ ok: true, rid: "b44" })),
});

const functionsClient = (result: Awaited<ReturnType<SupabaseFunctionsClient["functions"]["invoke"]>>) => {
  const invoke = vi.fn(async () => result);
  return { client: { functions: { invoke } } as SupabaseFunctionsClient, invoke };
};

describe("SupabaseLeadService.submitClaim", () => {
  it("invokes submit-claim with the body the Base44 adapter sends, blanks filled", async () => {
    const { client, invoke } = functionsClient({ data: { ok: true, rid: "r1", leadId: "uuid-1", warnings: [] }, error: null });
    await new SupabaseLeadService(client, rest()).submitClaim(report);
    expect(invoke).toHaveBeenCalledWith("submit-claim", {
      body: {
        name: "רונית",
        phone: "0536667788",
        email: "",
        claimType: "תאונת דרכים",
        eventDate: "",
        policyNumber: "",
        description: "",
        documents: ["https://x/a.pdf"],
        channel: "",
        campaign: "",
        landingPath: "",
      },
    });
  });

  it("returns the function's receipt", async () => {
    const { client } = functionsClient({ data: { ok: true, rid: "r1", leadId: "uuid-1", warnings: [] }, error: null });
    await expect(new SupabaseLeadService(client, rest()).submitClaim(report)).resolves.toEqual({
      ok: true, rid: "r1", leadId: "uuid-1", warnings: [],
    });
  });

  it("throws on a refusal, carrying the function's message and rid", async () => {
    const context = new Response(JSON.stringify({ error: "לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.", rid: "ab12cd34" }), { status: 500 });
    const { client } = functionsClient({ data: null, error: { message: "Edge Function returned a non-2xx status code", context } });
    await expect(new SupabaseLeadService(client, rest()).submitClaim(report)).rejects.toThrow(/לא הצלחנו לשמור.*rid ab12cd34/);
  });

  it("throws on a network failure, which has no response to read", async () => {
    const { client } = functionsClient({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    await expect(new SupabaseLeadService(client, rest()).submitClaim(report)).rejects.toThrow(/Failed to send a request/);
  });
});

describe("SupabaseLeadService — everything else stays on Base44", () => {
  it("passes submitLead, submitInterview and requestConsultationEvent to the Base44 adapter untouched", async () => {
    const r = rest();
    const { client, invoke } = functionsClient({ data: null, error: null });
    const service = new SupabaseLeadService(client, r);
    const lead = { name: "a", phone: "050" } as never;
    const summary = { name: "a", phone: "050" } as never;
    await service.submitLead(lead);
    await service.submitInterview(summary);
    await service.requestConsultationEvent(lead);
    expect(r.submitLead).toHaveBeenCalledWith(lead);
    expect(r.submitInterview).toHaveBeenCalledWith(summary);
    expect(r.requestConsultationEvent).toHaveBeenCalledWith(lead);
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd $SP/piece6 && npx vitest run tests/unit/supabase-lead.test.ts > /tmp/t5.log 2>&1; echo "exit=$?"`
Expected: `exit=1`, failing to resolve `@/services/supabase/SupabaseLeadService`.

- [ ] **Step 3: Implement**

```ts
// src/services/supabase/SupabaseLeadService.ts
import type { ClaimReport, InterviewSummary, Lead, LeadPort, SubmissionReceipt } from "../ports";

/** The one call this adapter makes — narrowed for the reason SupabaseAuthClient is. */
export interface SupabaseFunctionsClient {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
  };
}

/**
 * Claims, on the `submit-claim` Edge Function; every other lead path, unchanged.
 *
 * Contact forms, interviews and calendar holds still run on Base44's functions,
 * which hold the calendar and Sheets connections. They go to `rest`, the Base44
 * adapter, as they did before this class existed.
 */
export class SupabaseLeadService implements LeadPort {
  constructor(
    private readonly client: SupabaseFunctionsClient,
    private readonly rest: LeadPort,
  ) {}

  submitLead(lead: Lead): Promise<SubmissionReceipt> {
    return this.rest.submitLead(lead);
  }

  submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    return this.rest.submitInterview(summary);
  }

  requestConsultationEvent(lead: Lead): Promise<void> {
    return this.rest.requestConsultationEvent(lead);
  }

  async submitClaim(report: ClaimReport): Promise<SubmissionReceipt> {
    const { data, error } = await this.client.functions.invoke("submit-claim", {
      body: {
        name: report.name,
        phone: report.phone,
        email: report.email ?? "",
        claimType: report.claimType ?? "",
        eventDate: report.eventDate ?? "",
        policyNumber: report.policyNumber ?? "",
        description: report.description ?? "",
        documents: report.documents ?? [],
        channel: report.channel ?? "",
        campaign: report.campaign ?? "",
        landingPath: report.landingPath ?? "",
      },
    });
    if (error) throw await claimFailure(error);
    return (data as SubmissionReceipt | null) ?? { ok: true };
  }
}

/**
 * supabase-js resolves a non-2xx answer as `{ error }`, with the Response on
 * `error.context`; its body carries the function's message and `rid`. The form
 * shows its own failure text either way — the rid is for whoever reads the
 * console when a visitor reports it.
 */
async function claimFailure(error: { message: string; context?: unknown }): Promise<Error> {
  const res = error.context;
  const body =
    res instanceof Response ? ((await res.json().catch(() => null)) as { error?: string; rid?: string } | null) : null;
  const rid = body?.rid ? ` (rid ${body.rid})` : "";
  return new Error(`submit-claim failed: ${body?.error ?? error.message}${rid}`);
}
```

In `src/services/index.ts`:
- Add the import: `import { SupabaseLeadService, type SupabaseFunctionsClient } from "./supabase/SupabaseLeadService";`
- Add `LeadPort` to the type import from `./ports` if it isn't there.
- Before `export const services`, add:

```ts
/**
 * Claims go to the `submit-claim` Edge Function when Supabase is configured.
 * Every other lead path still runs on Base44's functions, which hold the
 * calendar and Sheets connections, so it is passed through untouched.
 */
const base44Leads = new Base44LeadService(client);
const leadPort: LeadPort = supabase
  ? new SupabaseLeadService(supabase as unknown as SupabaseFunctionsClient, base44Leads)
  : base44Leads;
```

- In `services`, change `leads: new Base44LeadService(client),` to `leads: leadPort,`.

In `tests/unit/services-wiring.test.ts`:
- In `load()`, add:
  - `SupabaseLeadService: (await import("@/services/supabase/SupabaseLeadService")).SupabaseLeadService,`
  - `Base44LeadService: (await import("@/services/base44/Base44LeadService")).Base44LeadService,`
- In the configured case add `functions: { invoke: vi.fn() },` to the fake `supabase`, and assert `expect(m.services.leads).toBeInstanceOf(m.SupabaseLeadService);`.
- In the fallback case assert `expect(m.services.leads).toBeInstanceOf(m.Base44LeadService);`.

- [ ] **Step 4: Run the unit, wiring and payload tests**

Run: `cd $SP/piece6 && npx vitest run tests/unit/supabase-lead.test.ts tests/unit/services-wiring.test.ts tests/contract/frontend-payloads.contract.test.ts > /tmp/t5.log 2>&1; echo "exit=$?"; grep -E "Tests " /tmp/t5.log`
Expected: `exit=0`.

Run: `cd $SP/piece6 && npm run typecheck > /tmp/t5tc.log 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
cd $SP/piece6 && git add src/services/supabase/SupabaseLeadService.ts src/services/index.ts tests/unit/supabase-lead.test.ts tests/unit/services-wiring.test.ts tests/contract/frontend-payloads.contract.test.ts && git commit -q -m "Claims go to the submit-claim Edge Function when Supabase is configured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 6: The admin's lead writes, straight to Supabase

**Files:**
- Modify: `src/services/supabase/SupabaseTableClient.ts` (write types)
- Modify: `src/services/supabase/SupabaseLeadAdminService.ts`
- Modify: `src/services/index.ts`
- Modify: `tests/helpers/supabase-table-fake.ts`
- Modify: `tests/unit/supabase-lead-admin.test.ts`

**Interfaces:**
- Produces:
  - `SupabaseWriteQuery`, `SupabaseLeadTableClient` (in `SupabaseTableClient.ts`)
  - `new SupabaseLeadAdminService(client: SupabaseLeadTableClient)`: a single argument now
  - `tableFake(result, writeResult?)`, returning a `SupabaseLeadTableClient`

- [ ] **Step 1: Extend the table fake**

Replace `tests/helpers/supabase-table-fake.ts`'s `tableFake` with:

```ts
export function tableFake(
  result: SupabaseReadResult,
  writeResult: SupabaseReadResult = result,
): { client: SupabaseLeadTableClient; calls: Call[] } {
  const calls: Call[] = [];
  const query: SupabaseQuery = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    order(column, options) {
      calls.push(["order", column, options]);
      return query;
    },
    limit(count) {
      calls.push(["limit", count]);
      return query;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  const write: SupabaseWriteQuery = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return { then: (onFulfilled, onRejected) => Promise.resolve(writeResult).then(onFulfilled, onRejected) };
        },
      };
    },
  };
  const client: SupabaseLeadTableClient = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return query;
        },
        update(values) {
          calls.push(["update", values]);
          return write;
        },
        delete() {
          calls.push(["delete"]);
          return write;
        },
      };
    },
  };
  return { client, calls };
}
```

Update its imports to add `SupabaseLeadTableClient` and `SupabaseWriteQuery`.

- [ ] **Step 2: Write the failing tests**

In `tests/unit/supabase-lead-admin.test.ts`:
- Delete the `writes` helper and the whole `describe("SupabaseLeadAdminService writes", …)` block.
- Change every `new SupabaseLeadAdminService(client, writes())` to `new SupabaseLeadAdminService(client)`.
- Replace the two tests that assert Base44 ids with:

```ts
  it("returns leads under their Supabase id, which the writes act on", async () => {
    const { client } = tableFake({ data: [leadRow()], error: null });
    const [lead] = await new SupabaseLeadAdminService(client).list();
    expect(lead).toMatchObject({ id: "6f1c0e3a-0000-4000-8000-0000000000aa", name: "דנה", status: "new", created_date: "2026-10-10T08:00:00+00:00" });
    expect(lead).not.toHaveProperty("email");
  });

  it("lists a lead that never had a Base44 id the same way", async () => {
    const { client } = tableFake({ data: [leadRow({ base44_id: null })], error: null });
    const leads = await new SupabaseLeadAdminService(client).list();
    expect(leads.map((l) => l.id)).toEqual(["6f1c0e3a-0000-4000-8000-0000000000aa"]);
  });
```

- In "asks for the port's columns only", change the expected columns to `expect.arrayContaining(["id", "name", "phone", "status", "created_at"])`.
- Then append:

```ts
describe("SupabaseLeadAdminService writes", () => {
  const changed = { data: [{ id: "6f1c0e3a-0000-4000-8000-0000000000aa" }], error: null };

  it("sets a status on the row with that Supabase id, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, changed);
    await new SupabaseLeadAdminService(client).setStatus("6f1c0e3a-0000-4000-8000-0000000000aa", "contacted");
    expect(calls).toEqual([
      ["from", "leads"],
      ["update", { status: "contacted" }],
      ["eq", "id", "6f1c0e3a-0000-4000-8000-0000000000aa"],
      ["select", "id"],
    ]);
  });

  it("deletes the row with that Supabase id, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, changed);
    await new SupabaseLeadAdminService(client).remove("6f1c0e3a-0000-4000-8000-0000000000aa");
    expect(calls).toEqual([["from", "leads"], ["delete"], ["eq", "id", "6f1c0e3a-0000-4000-8000-0000000000aa"], ["select", "id"]]);
  });

  it("throws on a refused write, naming the action", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: null, error: { message: "permission denied", code: "42501" } });
    await expect(new SupabaseLeadAdminService(client).setStatus("x", "closed")).rejects.toThrow(/leads status failed: permission denied/);
  });

  it("throws when nothing changed — a write the access rules refuse returns no error", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: [], error: null });
    await expect(new SupabaseLeadAdminService(client).remove("x")).rejects.toThrow("הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת");
    await expect(new SupabaseLeadAdminService(client).setStatus("x", "closed")).rejects.toThrow("הפעולה לא בוצעה");
  });
});
```

Run: `cd $SP/piece6 && npx vitest run tests/unit/supabase-lead-admin.test.ts > /tmp/t6.log 2>&1; echo "exit=$?"`
Expected: `exit=1`. The write cases fail and the id cases fail; the constructor still takes two arguments.

- [ ] **Step 3: Implement**

Append to `src/services/supabase/SupabaseTableClient.ts`, after `SupabaseTableClient`:

```ts
/** An update or delete narrowed to one row, asking for what it changed. */
export interface SupabaseWriteQuery {
  eq(column: string, value: unknown): { select(columns: string): PromiseLike<SupabaseReadResult> };
}

/** The table client with the two writes the lead admin makes. */
export interface SupabaseLeadTableClient extends SupabaseTableClient {
  from(table: string): {
    select(columns: string): SupabaseQuery;
    update(values: Record<string, unknown>): SupabaseWriteQuery;
    delete(): SupabaseWriteQuery;
  };
}
```

Replace `src/services/supabase/SupabaseLeadAdminService.ts` with:

```ts
import type { LeadAdminPort, LeadRecord, LeadStatus } from "../ports";
import {
  fetchRows,
  toPortRow,
  type SupabaseLeadTableClient,
  type SupabaseReadResult,
} from "./SupabaseTableClient";

/** The port's fields. Not `*`: a lead row also carries the visitor's summary,
 *  profile and consent record, none of which this list shows, and personal data
 *  the screen does not need stays out of the browser. */
const LEAD_COLUMNS = "id,name,phone,email,source,topic,timing,message,status,created_at";

const NOT_APPLIED = "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת";

/**
 * The admin's leads, read and written in Supabase under her own session.
 *
 * `leads_read_admin`, `leads_update_admin` and `leads_delete_admin` are the gate:
 * `can_see(agency_id) or is_admin()`. No backend function is involved.
 *
 * Leads are handed out under their Supabase `id`, not `base44_id ?? id` as
 * `toPortRow` does for content — the writes below act on `id`, and claims
 * written by the `submit-claim` Edge Function have no Base44 id at all.
 */
export class SupabaseLeadAdminService implements LeadAdminPort {
  constructor(private readonly client: SupabaseLeadTableClient) {}

  async list(limit = 500): Promise<LeadRecord[]> {
    const rows = await fetchRows(
      this.client.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "leads",
    );
    return rows.map((row) => ({ ...toPortRow(row), id: row.id }) as unknown as LeadRecord);
  }

  setStatus(id: string, status: LeadStatus): Promise<void> {
    return applied(this.client.from("leads").update({ status }).eq("id", id).select("id"), "status");
  }

  remove(id: string): Promise<void> {
    return applied(this.client.from("leads").delete().eq("id", id).select("id"), "delete");
  }
}

/**
 * A write that changed exactly the row it named, or an error.
 *
 * Row-level security does not refuse an update or delete it filters out: it
 * changes nothing and reports success. Asking for the row back is the only way
 * to tell "done" from "not allowed", and the screen must not show a refused
 * deletion as a deleted lead.
 */
async function applied(query: PromiseLike<SupabaseReadResult>, action: string): Promise<void> {
  const { data, error } = await query;
  if (error) throw new Error(`leads ${action} failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error(NOT_APPLIED);
}
```

In `src/services/index.ts`:
- Change the `tables` declaration to `const tables: SupabaseLeadTableClient | null = supabase ? (supabase as unknown as SupabaseLeadTableClient) : null;`, importing `SupabaseLeadTableClient` beside `SupabaseTableClient`.
- Replace

```ts
/** Lead writes stay on `adminLead` (through the Base44 adapter) whichever store is read. */
const base44LeadsAdmin = new Base44LeadAdminService(client);
const leadsAdminPort: LeadAdminPort = tables
  ? new SupabaseLeadAdminService(tables, base44LeadsAdmin)
  : base44LeadsAdmin;
```

with

```ts
/** The admin's leads: read and written in Supabase when it is configured, else through Base44 as before. */
const leadsAdminPort: LeadAdminPort = tables
  ? new SupabaseLeadAdminService(tables)
  : new Base44LeadAdminService(client);
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `cd $SP/piece6 && npx vitest run tests/unit > /tmp/t6.log 2>&1; echo "exit=$?"; grep -E "Tests " /tmp/t6.log; npm run typecheck > /tmp/t6tc.log 2>&1; echo "tsc=$?"`
Expected: `exit=0` and `tsc=0`. The other tests that use `tableFake` still pass, because the client it returns is a subtype of the read-only one.

- [ ] **Step 5: Commit**

```bash
cd $SP/piece6 && git add src/services tests/helpers/supabase-table-fake.ts tests/unit/supabase-lead-admin.test.ts && git commit -q -m "Admin lead writes go straight to Supabase, and a refused write is an error

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 7: CI deploys the functions, and neither production goes out ahead of them

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/contract/deploy-gate.contract.test.ts`

**Interfaces:**
- Produces: a job `deploy-supabase` whose `result` the Vercel promotion step and "Publish to Base44" both depend on.

**Ruling recorded in the plan** (the spec predates it): production is served by **Vercel** since 2026-10-11 (`govari-fin.co.il` → 216.198.79.1; `vars.PRODUCTION_URL=https://govari-fin.co.il`). The spec's "the Vercel staging deploy is not gated" no longer holds, so Vercel's `--prod` promotion also requires `deploy-supabase` to have succeeded. The deploy names no function (`supabase functions deploy --project-ref … --use-api` deploys every directory under `supabase/functions` except `_shared`), so the next function needs no CI edit. Task 9 amends the spec to match.

- [ ] **Step 1: Write the failing contract**

Append to `tests/contract/deploy-gate.contract.test.ts`:

```ts
describe("Supabase Edge Functions deploy from green main, before production", () => {
  const workflow = read(".github/workflows/ci.yml");
  const job = workflow.slice(workflow.indexOf("  deploy-supabase:"), workflow.indexOf("\n  deploy:\n"));

  it("exists, ahead of the Base44 publish", () => {
    expect(workflow.indexOf("  deploy-supabase:")).toBeGreaterThan(-1);
    expect(workflow.indexOf("  deploy-supabase:")).toBeLessThan(workflow.indexOf("\n  deploy:\n"));
  });

  it("runs only on main, only after the suites pass", () => {
    expect(job).toContain("needs: [build, test-node, test-e2e]");
    expect(job).toMatch(/if: >-\s*\n\s*github\.ref == 'refs\/heads\/main' &&/);
    // No `!cancelled()` / `always()`: the implicit success() is the gate.
    expect(job).not.toMatch(/!cancelled\(\)|always\(\)/);
  });

  it("deploys every function to this project, bundled by Supabase", () => {
    expect(job).toContain("SUPABASE_PROJECT_REF: hjowdyiwjjrqceumkvgt");
    expect(job).toMatch(/supabase functions deploy --project-ref "\$SUPABASE_PROJECT_REF" --use-api/);
  });

  it("skips with a notice rather than failing when the token is not set", () => {
    expect(job).toMatch(/::notice::SUPABASE_ACCESS_TOKEN is not set/);
    expect(job).toMatch(/ready=false/);
  });

  it("holds the Base44 publish until the functions are deployed", () => {
    expect(workflow).toMatch(/\n  deploy:\n[\s\S]*?needs: \[build, test-node, test-e2e, deploy-supabase\]/);
  });

  it("promotes Vercel to production only once the functions are deployed", () => {
    const step = workflow.slice(
      workflow.indexOf("- name: Choose production or preview"),
      workflow.indexOf("- name: Build for Vercel"),
    );
    expect(step).toContain("needs.deploy-supabase.result");
    expect(step).toMatch(/\$E2E[\s\S]*?\$FUNCTIONS[\s\S]*?prod=--prod/);
  });
});
```

In the existing test `"keeps CI the thing that deploys"`, change
`expect(workflow).toMatch(/deploy-vercel:[\s\S]*?needs: \[build, test-node, test-e2e\]/);`
to
`expect(workflow).toMatch(/deploy-vercel:[\s\S]*?needs: \[build, test-node, test-e2e, deploy-supabase\]/);`.

Run: `cd $SP/piece6 && npx vitest run tests/contract/deploy-gate.contract.test.ts > /tmp/t7.log 2>&1; echo "exit=$?"`
Expected: `exit=1`; the new cases fail.

- [ ] **Step 2: Add the job, the gates and the Deno check**

**The job.** In `.github/workflows/ci.yml`, insert immediately before the line `  deploy:` (the "Publish to Base44" job):

```yaml
  # ── Supabase Edge Functions ───────────────────────────────────────────────
  # The backend the site calls for claims (and, piece by piece, the rest). On
  # green main only — the same rule as the Base44 publish — and before either
  # production goes out, so the site is never live ahead of the function it
  # calls. The token is scoped to Edge Functions read-write on this one
  # project; without it the job says so and skips, and the production smoke
  # (e2e/api/supabase-live.spec.ts) then fails on the missing function.
  deploy-supabase:
    name: Deploy Supabase functions
    runs-on: ubuntu-latest
    needs: [build, test-node, test-e2e]
    if: >-
      github.ref == 'refs/heads/main' &&
      (github.event_name == 'push' || inputs.deploy)
    timeout-minutes: 10
    env:
      SUPABASE_PROJECT_REF: hjowdyiwjjrqceumkvgt
    steps:
      - uses: actions/checkout@v4

      - name: Check deploy credentials
        id: creds
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: |
          if [ -n "$SUPABASE_ACCESS_TOKEN" ]; then
            echo "ready=true" >> "$GITHUB_OUTPUT"
          else
            echo "ready=false" >> "$GITHUB_OUTPUT"
            echo "::notice::SUPABASE_ACCESS_TOKEN is not set — the Edge Functions were not deployed."
          fi

      - uses: supabase/setup-cli@v1
        if: steps.creds.outputs.ready == 'true'
        with:
          version: latest

      # No function named: every directory under supabase/functions except
      # `_shared`, with each one's verify_jwt from supabase/config.toml.
      # --use-api bundles on Supabase's side, so the runner needs no Docker.
      - name: Deploy
        if: steps.creds.outputs.ready == 'true'
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF" --use-api

```

**The Base44 gate.** In the `deploy:` job, change `needs: [build, test-node, test-e2e]` to `needs: [build, test-node, test-e2e, deploy-supabase]`.

**The Vercel gate.** In `deploy-vercel:`:
- Change `needs: [build, test-node, test-e2e]` to `needs: [build, test-node, test-e2e, deploy-supabase]`. Its `if:` already starts with `!cancelled()`, so a red run still deploys a preview.
- In the step `- name: Choose production or preview`:
  - Add `FUNCTIONS: ${{ needs.deploy-supabase.result }}` to its `env:`.
  - Change the condition to
    ```bash
    if [ "$GITHUB_REF" = "refs/heads/main" ] \
      && [ "$UNIT" = "success" ] && [ "$E2E" = "success" ] \
      && [ "$FUNCTIONS" = "success" ]; then
    ```
  - Change the warning line to
    ```bash
              echo "::warning::Not promoting (unit: ${UNIT}, e2e: ${E2E}, functions: ${FUNCTIONS}) — deploying this as a preview instead of production."
    ```

**The Deno check.** In `test-node:`, after the `Contract tests` step, add:

```yaml
      # The Edge Functions run on Deno and are outside tsconfig (src/** only);
      # this is the one place their types are checked before a deploy.
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - name: Type-check the Edge Functions
        run: deno check --no-config supabase/functions/*/index.ts
```

If Task 3 step 8 needed `supabase/functions/deno.json`, drop `--no-config` here.

- [ ] **Step 3: Run the workflow contracts**

Run: `cd $SP/piece6 && npx vitest run tests/contract/deploy-gate.contract.test.ts tests/contract/workflow.contract.test.ts tests/contract/logging.contract.test.ts > /tmp/t7.log 2>&1; echo "exit=$?"; grep -E "Tests " /tmp/t7.log`
Expected: `exit=0`.

Run: `cd $SP/piece6 && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"; echo "yaml=$?"`
Expected: `yaml=0`.

- [ ] **Step 4: Commit**

```bash
cd $SP/piece6 && git add .github/workflows/ci.yml tests/contract/deploy-gate.contract.test.ts && git commit -q -m "CI: deploy the Edge Functions on green main, before either production

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 8: The production smoke asks the claim function

**Files:**
- Modify: `e2e/api/supabase-live.spec.ts`

**Interfaces:**
- Consumes: `E2E_LIVE_API_URL`. The smoke job already sets it to `vars.PRODUCTION_URL`.

- [ ] **Step 1: Add the step**

In the existing test, before `await supabase.dispose();`, add:

```ts
    await test_step("the claim function is deployed and answers the site", async () => {
      // An empty claim: refused for want of a name and phone, so nothing is
      // stored and nobody is mailed — but only a deployed, reachable function
      // that allows this origin answers it this way.
      const origin = new URL(LIVE_URL!).origin;
      const res = await supabase.post("/functions/v1/submit-claim", {
        data: {},
        headers: { Origin: origin, Authorization: `Bearer ${key}` },
      });
      const body = (await res.json().catch(() => ({}))) as { rid?: string };
      expect(res.status(), `submit-claim: ${JSON.stringify(body)}`).toBe(400);
      expect(body.rid, "the answer carries no rid").toBeTruthy();
      expect(res.headers()["access-control-allow-origin"], "the site's origin is not allowed").toBe(origin);
    });
```

Also extend the file's doc comment with one sentence: "It also asks `submit-claim` an empty question, which proves the Edge Function is deployed and allows the site's origin without storing anything."

- [ ] **Step 2: Confirm it skips locally, as the opt-in block does**

Run: `cd $SP/piece6 && CI=1 npx playwright test e2e/api/supabase-live.spec.ts --project=web-chromium > /tmp/t8.log 2>&1; echo "exit=$?"; grep -E "skipped|passed|failed" /tmp/t8.log | tail -2`
Expected: `exit=0`, `1 skipped`. It runs only with `E2E_LIVE_API_URL`, in the production smoke job after deploy.

- [ ] **Step 3: Commit**

```bash
cd $SP/piece6 && git add e2e/api/supabase-live.spec.ts && git commit -q -m "Smoke: ask submit-claim an empty question from the site's origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 9: Bring the documents in line

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-claims-and-lead-writes-to-supabase-design.md`
- Modify: `docs/base44-exit/00-inventory.md`
- Modify: `AGENTS.md`
- Modify: `tests/test-plan/12-std-integration.md`

- [ ] **Step 1: Amend the spec's Deployment section**

Replace these three bullets under **CI job `deploy-supabase`**:
- **Command:**
  ```markdown
  - **Command:** `supabase functions deploy --project-ref hjowdyiwjjrqceumkvgt --use-api`,
    naming no function: every directory under `supabase/functions` except
    `_shared`, so the next function needs no CI edit. `--use-api` bundles on
    Supabase's side, so the runner needs no Docker.
  ```
- **Order:**
  ```markdown
  - **Order:** production has been served by **Vercel** since 2026-10-11
    (`govari-fin.co.il` → Vercel), so both productions wait:
    - "Publish to Base44" adds `deploy-supabase` to its `needs`.
    - Vercel's "Choose production or preview" step passes `--prod` only when
      `needs.deploy-supabase.result == 'success'`. A red run still deploys a
      preview.
  ```
- **Type-check:** add one new bullet:
  ```markdown
  - **Type-check:** `deno check` on `supabase/functions/*/index.ts` runs in
    the test job, because `tsc` covers `src/**` only.
  ```

- [ ] **Step 2: Update the inventory**

In `docs/base44-exit/00-inventory.md` §3:
- Delete the `myAccount` table row.
- Change "Nine functions, 4,029 lines (recounted 2026-10-07; `adminLead` is the ninth)" to "Eight functions on Base44 (`myAccount` removed 2026-10-12). `submitClaim` and `adminLead` remain deployed as the rollback only: claims go to the `submit-claim` Supabase Edge Function and admin lead writes go straight to Supabase."
- In the `AccountPort` row of §2, drop `` `functions.invoke` (`myAccount`), via `invokeFunction` / ``.
- Delete the sentence on line 74 that names `myAccount`.

- [ ] **Step 3: Tell the next agent how Edge Functions are built**

In `AGENTS.md`, in the list that held the `myAccount` bullet, add:

```markdown
- `supabase/functions/<name>/`: Supabase Edge Functions (Deno).
  - **Layout:** `handler.ts` exports `handler`, and `index.ts` is only `Deno.serve(handler)`.
  - **Shared code:** helpers live once in `supabase/functions/_shared/` and are imported, never copied. The Base44 "duplicated helper" rule does not apply here.
  - **JWT:** every function has a `[functions.<name>]` block with `verify_jwt` in `supabase/config.toml`.
  - **Tests:** `tests/helpers/edge-function.ts` runs a handler in-process, as `base44-function.ts` does for Base44.
  - **Deploy:** CI deploys every function on green `main`, before either production goes out.
  - **Contracts:** the logging, clock and rid contracts scan them, with the shared modules each one imports.
```

- [ ] **Step 4: Add the integration test-plan entry**

In `tests/test-plan/12-std-integration.md`:
- In the §3 coverage table, add the row
  ``| `submit-claim` (Edge) | a claim, saved to Supabase and announced — the same cases as `submitClaim`, plus its own |``.
- After the `### 4.21` section, add:

```markdown
### 4.22 `submit-claim` — the claim, on Supabase — `INT-CLM-EDGE-001..011`

Every `submitClaim` case runs against both implementations (`describe.each` in
`submit-claim.integration.test.ts`), and two cases compare what they send: the
reporter's HTML must be identical, and the staff report identical apart from
its timestamp line. `submit-claim-edge.integration.test.ts` holds what only the
Edge Function does: the row it writes (today's fields, no Base44 id, `leadId`
is its uuid), the service-key insert ahead of any mail, a non-JSON body
answered as 400 with nothing touched, missing Supabase credentials as 500 with
no mail, a database refusal that quotes the row kept out of the log, and the
CORS answers — a preflight that does nothing, the site's origin on every
answer, none for a stranger's.
```

- [ ] **Step 5: Commit**

```bash
cd $SP/piece6 && git add docs AGENTS.md tests/test-plan && git commit -q -m "Docs: Edge Functions in AGENTS.md, the inventory and the test plan; Vercel is production

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnWGv3KSRv8fedQnRCuCi9"
```

---

### Task 10: Full verification, then the PR

**Files:** none new.

- [ ] **Step 1: The whole local battery**

```bash
cd $SP/piece6 && npx vitest run > /tmp/v.log 2>&1; echo "vitest=$?"; sed 's/\x1b\[[0-9;]*m//g' /tmp/v.log | grep -E "Test Files|Tests +[0-9]"
npm run lint > /tmp/l.log 2>&1; echo "eslint=$?"
npm run typecheck > /tmp/tc.log 2>&1; echo "tsc=$?"
deno check --no-config supabase/functions/*/index.ts; echo "deno=$?"
CI=1 npx playwright test e2e/ui e2e/a11y e2e/security e2e/api --project=web-chromium --project=android-chrome > /tmp/e.log 2>&1; echo "e2e=$?"; sed 's/\x1b\[[0-9;]*m//g' /tmp/e.log | grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)"
```

Expected: `vitest=0`, `eslint=0`, `tsc=0`, `deno=0` and `e2e=0`.
- e2e runs with Supabase switched off, so it covers the Base44 claim path.
- If eslint reports `supabase/functions/**` (Deno globals, `.ts` import extensions), add `"supabase/functions/**"` to the `ignores` list in `eslint.config.js`, with a comment saying `deno check` covers them in CI. Rerun.

- [ ] **Step 2: Ask the user to set the two mailer secrets before merging**

They are not readable by CI's token, by design. The user sets them in the Supabase dashboard:
1. Go to DoritFinanaceSite → Edge Functions → Secrets.
2. Add `MAILER_URL` and `MAILER_TOKEN`, with the same values the Base44 functions use.

Without them, claims are saved but each mail becomes a warning.

- [ ] **Step 3: Push and open the PR**

Push `feat/off-base44-piece6`. Open a PR against `main` whose body says:
- what moved
- what stays deployed as the rollback
- the Vercel-is-production ruling
- the pre-merge secrets step
- the post-deploy check from the spec's **Rollout**: one real claim, then a status change and a delete from `/admin/leads`

End it with the attribution lines.
