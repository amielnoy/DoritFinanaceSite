# Entities → Supabase (read cutover) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the public blog/testimonials, the admin content lists and the admin leads list from Supabase whenever a Supabase client is configured, falling back to the existing Base44 adapters when it is not — and make `contentAdmin` fail the request when its Supabase mirror write fails.

**Architecture:** Three new read adapters under `src/services/supabase/`, all built on one narrow PostgREST interface (`SupabaseTableClient`) plus two shared helpers (`fetchRows`, `toPortRow`) that own the error check and the `base44_id`→`id` / `created_at`→`created_date` mapping. The composition root picks Supabase or Base44 per port with the same `supabase ? … : …` shape `uploadPort` already uses. Writes do not move: content writes stay in `contentAdmin` (now failing loudly on a mirror failure), lead writes stay in `adminLead`, reached by delegation from the new lead adapter to the existing `Base44LeadAdminService`.

**Tech Stack:** TypeScript, React Query hooks (unchanged), supabase-js (via a narrowed interface — no new dependency), Vitest (unit/integration/contract), Playwright (e2e, config only). Base44 function code is plain JS in Deno (`base44/functions/contentAdmin/entry.ts`, Hebrew comments by file convention).

**Spec:** `docs/superpowers/specs/2026-10-11-entities-to-supabase-design.md` (parents: `docs/base44-exit/00-inventory.md`, `docs/superpowers/specs/2026-10-10-multi-agent-platform-design.md`)

## Global Constraints

- `npm run typecheck`, `npm run lint` and `npx vitest run` stay green after every task.
- The three Base44 read adapters (`Base44ContentService`, `Base44ContentAdminService`, `Base44LeadAdminService`) are **not deleted** — they remain the live fallback when `supabase` is `null`.
- Port-facing `id` is **`base44_id`**, never Supabase's uuid (except as a last-resort fallback for a row that has no `base44_id`, the same key `scripts/reconcile-stores.mjs` uses: `row.base44_id ?? row.id`).
- `getArticle(id)` filters on the **`base44_id`** column, never `id`.
- Public `listArticles` filters `published = true` in the query (defence in depth over RLS); admin `listArticles` does **not**.
- `contentAdmin`'s write order stays **Base44 first, Supabase second**. Only the failure signal changes.
- `adminLead`, `submitLead`, `submitClaim`, `escalateToHuman`, `upsertContact`, `LeadPort`, the agents and `tests/contract/agents.contract.test.ts` are not touched.
- No real or mocked Supabase credentials are added to CI. Every automated test run, local or CI, takes the Base44 fallback (Task 1 enforces this locally too).
- New code is TypeScript; `contentAdmin/entry.ts` stays untyped JS with Hebrew comments, matching every other Base44 function.
- Zero unrelated diffs.

**One deliberate addition beyond the spec:** Task 1 pins `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` to empty for Vitest and for the e2e build. Vitest loads `.env.local`, which now holds real credentials (verified while planning: `import.meta.env.VITE_SUPABASE_URL` is set inside a local Vitest run). Without the pin, once this piece wires Supabase into `services.content`, every component test that mocks `@/api/base44Client` would read the **live** Supabase project on a developer's machine, while CI kept passing. The pin makes local runs match CI, which is what the spec's "Out" section assumes already happens.

## Review Focus

1. **A failed Supabase read must throw, not render an empty page.** supabase-js *resolves* with `{ data: null, error }` instead of rejecting, so an adapter that skipped the check would turn an outage or an RLS refusal into "no articles". Pinned by `fetchRows` tests (Task 2) and one error test per adapter (Tasks 2–4).
2. **A missing article must still be "not found".** `BlogPost.tsx` reads `isError` from `useArticle` as `notFound`; Base44's `get` threw on a missing id, while a PostgREST filter returns `[]`. `getArticle` must throw on an empty result. Pinned in Task 2.
3. **`rating` arrives from PostgREST as a string** (`numeric` column; `scripts/reconcile-stores.mjs` already documents this). Stars rendered from `"5"` instead of `5` misbehave. `toTestimonial` coerces it with `Number()`. Pinned in Task 2.
4. **Postgres `null` where Base44 left a field out.** The ports declare these fields optional (`excerpt?: string`), not nullable, and components call things like `actionMinutes(p.action_time)`. `toPortRow` drops `null` columns. Pinned in Task 2.
5. **A lead in Supabase with no `base44_id` must still appear in the admin list**, not vanish or crash the page. It is someone's enquiry. `toPortRow` falls back to the Supabase uuid; acting on it then fails loudly in `adminLead` (no Base44 row to update) rather than silently. Pinned in Task 4.

Also worth a reviewer's eye, but not unit-testable: an admin whose Supabase session has expired gets **only published** posts back from `blog_posts` (RLS filters silently, with no error), so drafts would seem to vanish from `/admin/blog`. `autoRefreshToken: true` in `src/api/supabaseClient.ts` is the existing mitigation; Task 8's manual check includes a draft.

---

### Task 0: Branch

The spec commit (`c827058`) sits on local `main`, one ahead of `origin/main`. Carry it onto a feature branch.

- [ ] **Step 1: Create the branch**

```bash
git switch -c feat/entities-to-supabase
git log --oneline -2
```
Expected: `c827058 Spec: cut Base44's remaining content/lead-admin reads to Supabase` on top of `63b65c8`.

---

### Task 1: Keep every automated run on the Base44 fallback

**Files:**
- Modify: `vitest.config.ts` (inside `test: { … }`)
- Modify: `playwright.config.ts:147-165` (`webServer.env`)
- Modify: `scripts/run-tests.sh:146` (next to `export VITE_BASE44_APP_BASE_URL=""`)

**Interfaces:**
- Consumes: nothing.
- Produces: the guarantee that `supabase` (from `src/api/supabaseClient.ts`) is `null` in every Vitest run and every e2e build. Tasks 5–6 rely on this. Their tests mock `@/api/supabaseClient` explicitly when they want a client.

- [ ] **Step 1: Write a throwaway probe showing the leak**

Create `tests/unit/zz-env-probe.test.ts`:

```ts
import { expect, it } from "vitest";

it("vitest sees no Supabase credentials", () => {
  expect(import.meta.env.VITE_SUPABASE_URL || "").toBe("");
  expect(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").toBe("");
});
```

- [ ] **Step 2: Run it and watch it fail locally**

Run: `npx vitest run tests/unit/zz-env-probe.test.ts`
Expected: FAIL on a machine whose `.env.local` has `VITE_SUPABASE_URL` (the developer's machine does). If it passes, `.env.local` has no Supabase values. Continue anyway; the pin is still needed for the machines that do.

- [ ] **Step 3: Pin the Vitest env**

In `vitest.config.ts`, add inside `test: { … }` (after `environment: "node",`):

```ts
    // Every test run takes the Base44 fallback, as CI always has. Vitest loads
    // .env.local, which holds real Supabase credentials on a developer's
    // machine — without this, a component test that mocks the Base44 client
    // would read the live Supabase project instead, and pass or fail on
    // whatever production holds that day. Tests that want a Supabase client
    // mock `@/api/supabaseClient` explicitly.
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
```

- [ ] **Step 4: Run the probe again**

Run: `npx vitest run tests/unit/zz-env-probe.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the probe**

```bash
rm tests/unit/zz-env-probe.test.ts
```

- [ ] **Step 6: Pin the e2e build the same way**

In `playwright.config.ts`, inside `webServer.env`, after `VITE_BASE44_APP_BASE_URL: "",` add:

```ts
          // The same reasoning for Supabase: the e2e fixtures stub Base44, so a
          // build that inlined .env.local's Supabase credentials would read the
          // live project for every blog, testimonial and admin list instead.
          VITE_SUPABASE_URL: "",
          VITE_SUPABASE_PUBLISHABLE_KEY: "",
```

In `scripts/run-tests.sh`, directly after the line `export VITE_BASE44_APP_BASE_URL=""`, add:

```bash
    # Same for Supabase — see playwright.config.ts. Empty, not unset: Vite
    # lets process env override .env.local only when the variable exists.
    export VITE_SUPABASE_URL=""
    export VITE_SUPABASE_PUBLISHABLE_KEY=""
```

- [ ] **Step 7: Verify an e2e-style build inlines no Supabase host**

```bash
VITE_BASE44_APP_ID=e2e-sanity-app VITE_BASE44_APP_BASE_URL="" VITE_SUPABASE_URL="" VITE_SUPABASE_PUBLISHABLE_KEY="" npx vite build --outDir /tmp/e2e-env-check >/dev/null 2>&1; echo "build exit: $?"
grep -l "supabase.co" /tmp/e2e-env-check/assets/*.js | wc -l
rm -rf /tmp/e2e-env-check
```
Expected: `build exit: 0`, then `0`. (Capture `$?` directly. `${PIPESTATUS[0]}` is empty in this zsh.)

- [ ] **Step 8: Full Vitest run**

Run: `npx vitest run`
Expected: PASS, the same count as before this task.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts playwright.config.ts scripts/run-tests.sh
git commit -m "Tests: keep every automated run on the Base44 fallback

Vitest and the e2e build both load .env.local, which now holds real
Supabase credentials. Once content reads go to Supabase when it is
configured, a local test run would read the live project. Pin both to
empty so local runs take the same path CI does."
```

---

### Task 2: Shared PostgREST interface + `SupabaseContentService`

**Files:**
- Create: `src/services/supabase/SupabaseTableClient.ts`
- Create: `src/services/supabase/SupabaseContentService.ts`
- Create: `tests/helpers/supabase-table-fake.ts`
- Test: `tests/unit/supabase-content.test.ts`

**Interfaces:**
- Consumes: `Article`, `Testimonial`, `ContentPort` from `src/services/ports.ts`.
- Produces (later tasks import these exact names):
  - `SupabaseTableClient.ts`: `interface SupabaseReadResult { data: unknown[] | null; error: { message: string; code?: string } | null }`, `interface SupabaseQuery extends PromiseLike<SupabaseReadResult> { eq(column: string, value: unknown): SupabaseQuery; order(column: string, options: { ascending: boolean }): SupabaseQuery; limit(count: number): SupabaseQuery }`, `interface SupabaseTableClient { from(table: string): { select(columns: string): SupabaseQuery } }`, `fetchRows(query: SupabaseQuery, table: string): Promise<Record<string, unknown>[]>`, `toPortRow(row: Record<string, unknown>): Record<string, unknown>`.
  - `SupabaseContentService.ts`: `class SupabaseContentService implements ContentPort` (ctor `(client: SupabaseTableClient)`), `ARTICLE_COLUMNS: string`, `TESTIMONIAL_COLUMNS: string`, `toArticle(row): Article`, `toTestimonial(row): Testimonial`.
  - `tests/helpers/supabase-table-fake.ts`: `tableFake(result: SupabaseReadResult): { client: SupabaseTableClient; calls: [string, ...unknown[]][] }`.

- [ ] **Step 1: Write the fake**

Create `tests/helpers/supabase-table-fake.ts`:

```ts
import type {
  SupabaseQuery,
  SupabaseReadResult,
  SupabaseTableClient,
} from "@/services/supabase/SupabaseTableClient";

export type Call = [method: string, ...args: unknown[]];

/**
 * A PostgREST query builder that records every call and resolves to `result`.
 *
 * Recording the chain, not just the answer, is the point: the one mistake the
 * spec singles out — filtering `getArticle` on `id` instead of `base44_id` —
 * returns the right *shape* either way, and only the recorded `eq` tells them
 * apart.
 */
export function tableFake(result: SupabaseReadResult): { client: SupabaseTableClient; calls: Call[] } {
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
  const client: SupabaseTableClient = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return query;
        },
      };
    },
  };
  return { client, calls };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/supabase-content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fetchRows, toPortRow } from "@/services/supabase/SupabaseTableClient";
import { SupabaseContentService } from "@/services/supabase/SupabaseContentService";
import { tableFake } from "../helpers/supabase-table-fake";

const articleRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-000000000001",
  base44_id: "b44-post-1",
  title: "כותרת",
  excerpt: "תקציר",
  body: "גוף",
  image_url: null,
  tags: "פנסיה",
  action_time: "רבע שעה",
  published: true,
  created_at: "2026-10-01T09:00:00+00:00",
  ...over,
});

const testimonialRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-000000000002",
  base44_id: "b44-t-1",
  name: "רונית",
  role: null,
  quote: "שירות מצוין",
  image_url: null,
  rating: "5",
  source: "google",
  created_at: "2026-09-01T09:00:00+00:00",
  ...over,
});

const ok = (data: unknown[]) => ({ data, error: null });
const failed = { data: null, error: { message: "permission denied for table blog_posts", code: "42501" } };

describe("toPortRow", () => {
  it("exposes base44_id as id and created_at as created_date", () => {
    const out = toPortRow(articleRow());
    expect(out.id).toBe("b44-post-1");
    expect(out.created_date).toBe("2026-10-01T09:00:00+00:00");
    expect(out).not.toHaveProperty("base44_id");
    expect(out).not.toHaveProperty("created_at");
  });

  it("falls back to the Supabase id for a row that never had a Base44 one", () => {
    expect(toPortRow(articleRow({ base44_id: null })).id).toBe("6f1c0e3a-0000-4000-8000-000000000001");
  });

  it("drops null columns, since the ports declare them optional, not nullable", () => {
    const out = toPortRow(articleRow({ excerpt: null, action_time: null }));
    expect(out).not.toHaveProperty("excerpt");
    expect(out).not.toHaveProperty("action_time");
    expect(out).not.toHaveProperty("image_url");
  });
});

describe("fetchRows", () => {
  it("throws when PostgREST answers with an error instead of rows", async () => {
    const { client } = tableFake(failed);
    await expect(fetchRows(client.from("blog_posts").select("*"), "blog_posts")).rejects.toThrow(
      /blog_posts read failed: permission denied/,
    );
  });

  it("treats a null data with no error as no rows", async () => {
    const { client } = tableFake({ data: null, error: null });
    await expect(fetchRows(client.from("blog_posts").select("*"), "blog_posts")).resolves.toEqual([]);
  });
});

describe("SupabaseContentService.listArticles", () => {
  it("asks for published posts only, newest first, up to the limit", async () => {
    const { client, calls } = tableFake(ok([articleRow()]));
    await new SupabaseContentService(client).listArticles(7);
    expect(calls[0]).toEqual(["from", "blog_posts"]);
    expect(calls).toContainEqual(["eq", "published", true]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 7]);
  });

  it("defaults to 50, as the Base44 adapter does", async () => {
    const { client, calls } = tableFake(ok([]));
    await new SupabaseContentService(client).listArticles();
    expect(calls).toContainEqual(["limit", 50]);
  });

  it("returns articles keyed by their Base44 id", async () => {
    const { client } = tableFake(ok([articleRow()]));
    const [a] = await new SupabaseContentService(client).listArticles();
    expect(a).toMatchObject({ id: "b44-post-1", title: "כותרת", action_time: "רבע שעה", created_date: "2026-10-01T09:00:00+00:00" });
  });

  it("throws on a failed read rather than reporting no articles", async () => {
    const { client } = tableFake(failed);
    await expect(new SupabaseContentService(client).listArticles()).rejects.toThrow();
  });
});

describe("SupabaseContentService.getArticle", () => {
  it("filters on base44_id, not on Supabase's own id", async () => {
    const { client, calls } = tableFake(ok([articleRow()]));
    await new SupabaseContentService(client).getArticle("b44-post-1");
    expect(calls).toContainEqual(["eq", "base44_id", "b44-post-1"]);
    expect(calls.filter((c) => c[0] === "eq" && c[1] === "id")).toEqual([]);
  });

  it("returns the article under the id it was asked for", async () => {
    const { client } = tableFake(ok([articleRow()]));
    const a = await new SupabaseContentService(client).getArticle("b44-post-1");
    expect(a.id).toBe("b44-post-1");
  });

  it("throws when no row matches, so the page shows 'not found'", async () => {
    const { client } = tableFake(ok([]));
    await expect(new SupabaseContentService(client).getArticle("gone")).rejects.toThrow(/not found/);
  });
});

describe("SupabaseContentService.listTestimonials", () => {
  it("reads testimonials newest first, up to 50 by default", async () => {
    const { client, calls } = tableFake(ok([]));
    await new SupabaseContentService(client).listTestimonials();
    expect(calls[0]).toEqual(["from", "testimonials"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 50]);
  });

  it("turns PostgREST's string rating back into a number", async () => {
    const { client } = tableFake(ok([testimonialRow({ rating: "4" })]));
    const [t] = await new SupabaseContentService(client).listTestimonials();
    expect(t.rating).toBe(4);
    expect(t.id).toBe("b44-t-1");
    expect(t).not.toHaveProperty("role");
  });

  it("leaves a missing rating missing, rather than NaN", async () => {
    const { client } = tableFake(ok([testimonialRow({ rating: null })]));
    const [t] = await new SupabaseContentService(client).listTestimonials();
    expect(t).not.toHaveProperty("rating");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/supabase-content.test.ts`
Expected: FAIL. The suite cannot resolve `@/services/supabase/SupabaseTableClient`.

- [ ] **Step 4: Write `SupabaseTableClient.ts`**

Create `src/services/supabase/SupabaseTableClient.ts`:

```ts
/** What a PostgREST read resolves to. supabase-js never rejects for a failed query. */
export interface SupabaseReadResult {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}

/** The chainable part of a select — only the calls the read adapters make. */
export interface SupabaseQuery extends PromiseLike<SupabaseReadResult> {
  eq(column: string, value: unknown): SupabaseQuery;
  order(column: string, options: { ascending: boolean }): SupabaseQuery;
  limit(count: number): SupabaseQuery;
}

/** Just the table reads these adapters make — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseTableClient {
  from(table: string): { select(columns: string): SupabaseQuery };
}

/**
 * Await a read and hand back its rows, or throw.
 *
 * supabase-js resolves a failed query with `{ error }` instead of rejecting.
 * A read that skipped this check would turn an outage or an RLS refusal into an
 * empty list, and "no articles" looks like content, not like a failure.
 */
export async function fetchRows(query: SupabaseQuery, table: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * A Supabase row in the shape the ports promise.
 *
 * `id` is the Base44 id, because that is what every URL, bookmark and indexed
 * link already holds (`/blog/:id`); Supabase's own uuid would 404 all of them.
 * A row that never had a Base44 id falls back to the uuid, the same key
 * scripts/reconcile-stores.mjs uses, so it still shows up instead of vanishing.
 *
 * Null columns are dropped: Postgres says null where Base44 left the field out,
 * and the ports declare these fields optional, not nullable.
 */
export function toPortRow(row: Record<string, unknown>): Record<string, unknown> {
  const { id, base44_id, created_at, ...rest } = row;
  const out: Record<string, unknown> = { id: base44_id ?? id, created_date: created_at };
  for (const [key, value] of Object.entries(rest)) if (value !== null) out[key] = value;
  return out;
}
```

- [ ] **Step 5: Write `SupabaseContentService.ts`**

Create `src/services/supabase/SupabaseContentService.ts`:

```ts
import type { Article, ContentPort, Testimonial } from "../ports";
import { fetchRows, toPortRow, type SupabaseTableClient } from "./SupabaseTableClient";

/** Named columns, not `*`: the port's fields and the two the mapping needs. */
export const ARTICLE_COLUMNS =
  "id,base44_id,title,excerpt,body,image_url,tags,action_time,published,created_at";
export const TESTIMONIAL_COLUMNS = "id,base44_id,name,role,quote,image_url,rating,source,created_at";

export const toArticle = (row: Record<string, unknown>): Article => toPortRow(row) as unknown as Article;

/** `rating` is a numeric column, and PostgREST sends numerics as strings. */
export const toTestimonial = (row: Record<string, unknown>): Testimonial => {
  const out = toPortRow(row);
  if (out.rating !== undefined) out.rating = Number(out.rating);
  return out as unknown as Testimonial;
};

/**
 * Read side of the content store, on Supabase.
 *
 * The `published` filter is in the query even though RLS already hides drafts
 * from an anonymous reader: a signed-in admin passes that policy, and the
 * public blog must not list drafts to her either. The rule belongs to the
 * port, as it did in Base44ContentService.
 */
export class SupabaseContentService implements ContentPort {
  constructor(private readonly client: SupabaseTableClient) {}

  async listArticles(limit = 50): Promise<Article[]> {
    const rows = await fetchRows(
      this.client
        .from("blog_posts")
        .select(ARTICLE_COLUMNS)
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(limit),
      "blog_posts",
    );
    return rows.map(toArticle);
  }

  /** `id` is a Base44 id — see toPortRow — so the filter is on `base44_id`. */
  async getArticle(id: string): Promise<Article> {
    const [row] = await fetchRows(
      this.client.from("blog_posts").select(ARTICLE_COLUMNS).eq("base44_id", id).limit(1),
      "blog_posts",
    );
    // Base44's `get` threw on a missing id, and BlogPost.tsx reads that error as
    // "not found". An empty result has to say the same thing.
    if (!row) throw new Error(`article ${id} not found`);
    return toArticle(row);
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const rows = await fetchRows(
      this.client
        .from("testimonials")
        .select(TESTIMONIAL_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit),
      "testimonials",
    );
    return rows.map(toTestimonial);
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/supabase-content.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0. If the fake's `then` fails to typecheck against the generic `PromiseLike.then`, write it with explicit generics: `then<A = SupabaseReadResult, B = never>(f?: ((v: SupabaseReadResult) => A | PromiseLike<A>) | null, r?: ((e: unknown) => B | PromiseLike<B>) | null) { return Promise.resolve(result).then(f, r); }`.

- [ ] **Step 8: Commit**

```bash
git add src/services/supabase/SupabaseTableClient.ts src/services/supabase/SupabaseContentService.ts tests/helpers/supabase-table-fake.ts tests/unit/supabase-content.test.ts
git commit -m "Content reads: a Supabase ContentPort, not yet wired"
```

---

### Task 3: `SupabaseContentAdminService`

**Files:**
- Create: `src/services/supabase/SupabaseContentAdminService.ts`
- Test: `tests/unit/supabase-content-admin.test.ts`

**Interfaces:**
- Consumes: `SupabaseTableClient`, `fetchRows` (Task 2); `ARTICLE_COLUMNS`, `TESTIMONIAL_COLUMNS`, `toArticle`, `toTestimonial` (Task 2); `ContentAdminPort`, `Article`, `Testimonial` (ports).
- Produces: `class SupabaseContentAdminService implements ContentAdminPort`, ctor `(client: SupabaseTableClient)`. Task 5 passes it as the `reads` argument of `FunctionContentAdminService`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/supabase-content-admin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SupabaseContentAdminService } from "@/services/supabase/SupabaseContentAdminService";
import { tableFake } from "../helpers/supabase-table-fake";

const draftRow = {
  id: "6f1c0e3a-0000-4000-8000-000000000003",
  base44_id: "b44-draft",
  title: "טיוטה",
  body: "גוף",
  published: false,
  created_at: "2026-10-02T09:00:00+00:00",
};

describe("SupabaseContentAdminService reads", () => {
  it("does not filter on published — the admin list must include drafts", async () => {
    const { client, calls } = tableFake({ data: [draftRow], error: null });
    const [a] = await new SupabaseContentAdminService(client).listArticles();
    expect(calls.filter((c) => c[0] === "eq")).toEqual([]);
    expect(a).toMatchObject({ id: "b44-draft", published: false, created_date: "2026-10-02T09:00:00+00:00" });
  });

  it("lists articles newest first, up to 100 by default", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseContentAdminService(client).listArticles();
    expect(calls[0]).toEqual(["from", "blog_posts"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 100]);
  });

  it("lists testimonials newest first, up to 50 by default, rating as a number", async () => {
    const { client, calls } = tableFake({
      data: [{ id: "u", base44_id: "b44-t", name: "נ", quote: "ק", rating: "5", created_at: "2026-09-01" }],
      error: null,
    });
    const [t] = await new SupabaseContentAdminService(client).listTestimonials();
    expect(calls[0]).toEqual(["from", "testimonials"]);
    expect(calls).toContainEqual(["limit", 50]);
    expect(t.rating).toBe(5);
  });

  it("throws on a failed read", async () => {
    const { client } = tableFake({ data: null, error: { message: "JWT expired", code: "PGRST301" } });
    await expect(new SupabaseContentAdminService(client).listArticles()).rejects.toThrow(/JWT expired/);
  });
});

describe("SupabaseContentAdminService writes", () => {
  const service = () => new SupabaseContentAdminService(tableFake({ data: [], error: null }).client);

  it.each([
    ["createArticle", (s: SupabaseContentAdminService) => s.createArticle({ title: "t", body: "b", published: false })],
    ["updateArticle", (s: SupabaseContentAdminService) => s.updateArticle("x", { title: "t" })],
    ["removeArticle", (s: SupabaseContentAdminService) => s.removeArticle("x")],
    ["createTestimonial", (s: SupabaseContentAdminService) => s.createTestimonial({ name: "n", quote: "q" })],
    ["removeTestimonial", (s: SupabaseContentAdminService) => s.removeTestimonial("x")],
  ])("refuses %s — writes belong to FunctionContentAdminService", async (_name, call) => {
    await expect(call(service())).rejects.toThrow("writes go through FunctionContentAdminService");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/supabase-content-admin.test.ts`
Expected: FAIL. The suite cannot resolve `@/services/supabase/SupabaseContentAdminService`.

- [ ] **Step 3: Implement**

Create `src/services/supabase/SupabaseContentAdminService.ts`:

```ts
import type { Article, ContentAdminPort, Testimonial } from "../ports";
import { ARTICLE_COLUMNS, TESTIMONIAL_COLUMNS, toArticle, toTestimonial } from "./SupabaseContentService";
import { fetchRows, type SupabaseTableClient } from "./SupabaseTableClient";

const WRITES_ELSEWHERE = "writes go through FunctionContentAdminService";

/**
 * The admin's content lists, on Supabase.
 *
 * No `published` filter: the signed-in admin satisfies the `... or is_admin()`
 * half of the blog_posts read policy, so drafts come back, which is the one
 * thing this list must do that ContentPort.listArticles must never do.
 *
 * Only the reads are real. This class is only ever the `reads` argument of
 * FunctionContentAdminService, which sends every write to the `contentAdmin`
 * function, where the admin check lives. The write methods exist to satisfy
 * the port and throw, so a future wiring mistake fails loudly instead of
 * writing past that check.
 */
export class SupabaseContentAdminService implements ContentAdminPort {
  constructor(private readonly client: SupabaseTableClient) {}

  async listArticles(limit = 100): Promise<Article[]> {
    const rows = await fetchRows(
      this.client.from("blog_posts").select(ARTICLE_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "blog_posts",
    );
    return rows.map(toArticle);
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const rows = await fetchRows(
      this.client
        .from("testimonials")
        .select(TESTIMONIAL_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit),
      "testimonials",
    );
    return rows.map(toTestimonial);
  }

  async createArticle(): Promise<string> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async updateArticle(): Promise<void> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async removeArticle(): Promise<void> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async createTestimonial(): Promise<string> {
    throw new Error(WRITES_ELSEWHERE);
  }

  async removeTestimonial(): Promise<void> {
    throw new Error(WRITES_ELSEWHERE);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/supabase-content-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/services/supabase/SupabaseContentAdminService.ts tests/unit/supabase-content-admin.test.ts
git commit -m "Content admin reads: a Supabase ContentAdminPort, reads only"
```

---

### Task 4: `SupabaseLeadAdminService`

**Files:**
- Create: `src/services/supabase/SupabaseLeadAdminService.ts`
- Test: `tests/unit/supabase-lead-admin.test.ts`

**Interfaces:**
- Consumes: `SupabaseTableClient`, `fetchRows`, `toPortRow` (Task 2); `LeadAdminPort`, `LeadRecord`, `LeadStatus` (ports).
- Produces: `class SupabaseLeadAdminService implements LeadAdminPort`, ctor `(client: SupabaseTableClient, writes: Pick<LeadAdminPort, "setStatus" | "remove">)`. Task 5 passes the existing `Base44LeadAdminService` instance as `writes`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/supabase-lead-admin.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SupabaseLeadAdminService } from "@/services/supabase/SupabaseLeadAdminService";
import { tableFake } from "../helpers/supabase-table-fake";

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-0000000000aa",
  base44_id: "b44-lead-1",
  name: "דנה",
  phone: "050-0000000",
  email: null,
  source: "consultation",
  topic: "פנסיה",
  timing: null,
  message: null,
  status: "new",
  created_at: "2026-10-10T08:00:00+00:00",
  ...over,
});

const writes = () => ({ setStatus: vi.fn(async () => {}), remove: vi.fn(async () => {}) });

describe("SupabaseLeadAdminService.list", () => {
  it("reads leads newest first, up to 500 by default", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client, writes()).list();
    expect(calls[0]).toEqual(["from", "leads"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 500]);
  });

  it("asks for the port's columns only, not the whole row", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client, writes()).list();
    const select = calls.find((c) => c[0] === "select")!;
    expect(select[1]).not.toBe("*");
    expect(String(select[1]).split(",")).toEqual(
      expect.arrayContaining(["base44_id", "name", "phone", "status", "created_at"]),
    );
  });

  it("returns leads under their Base44 id, which is what adminLead acts on", async () => {
    const { client } = tableFake({ data: [leadRow()], error: null });
    const [lead] = await new SupabaseLeadAdminService(client, writes()).list();
    expect(lead).toMatchObject({ id: "b44-lead-1", name: "דנה", status: "new", created_date: "2026-10-10T08:00:00+00:00" });
    expect(lead).not.toHaveProperty("email");
  });

  it("still lists a lead that has no Base44 id, rather than dropping someone's enquiry", async () => {
    const { client } = tableFake({ data: [leadRow({ base44_id: null })], error: null });
    const leads = await new SupabaseLeadAdminService(client, writes()).list();
    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe("6f1c0e3a-0000-4000-8000-0000000000aa");
  });

  it("throws on a failed read rather than showing an empty inbox", async () => {
    const { client } = tableFake({ data: null, error: { message: "permission denied for table leads", code: "42501" } });
    await expect(new SupabaseLeadAdminService(client, writes()).list()).rejects.toThrow(/leads read failed/);
  });
});

describe("SupabaseLeadAdminService writes", () => {
  it("hands setStatus to the adminLead-backed writer unchanged", async () => {
    const w = writes();
    await new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, w).setStatus("b44-lead-1", "contacted");
    expect(w.setStatus).toHaveBeenCalledWith("b44-lead-1", "contacted");
  });

  it("hands remove to the adminLead-backed writer unchanged", async () => {
    const w = writes();
    await new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, w).remove("b44-lead-1");
    expect(w.remove).toHaveBeenCalledWith("b44-lead-1");
  });

  it("lets a refused write fail the call", async () => {
    const w = { setStatus: vi.fn(async () => { throw new Error("adminLead did not confirm the write"); }), remove: vi.fn() };
    const service = new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, w);
    await expect(service.setStatus("x", "closed")).rejects.toThrow("adminLead did not confirm the write");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/supabase-lead-admin.test.ts`
Expected: FAIL. The suite cannot resolve `@/services/supabase/SupabaseLeadAdminService`.

- [ ] **Step 3: Implement**

Create `src/services/supabase/SupabaseLeadAdminService.ts`:

```ts
import type { LeadAdminPort, LeadRecord, LeadStatus } from "../ports";
import { fetchRows, toPortRow, type SupabaseTableClient } from "./SupabaseTableClient";

/** The port's fields and the two the mapping needs. Not `*`: a lead row also
 *  carries the visitor's summary, profile and consent record, none of which
 *  this list shows, and personal data the screen does not need stays out of
 *  the browser. */
const LEAD_COLUMNS = "id,base44_id,name,phone,email,source,topic,timing,message,status,created_at";

/**
 * The admin's leads, read from Supabase under her own session.
 *
 * The `leads_read_admin` RLS policy is the gate, as it is for `my_enquiries`
 * in SupabaseAccountService. No backend function is needed to read.
 *
 * Writes are not reimplemented. They go to `writes`, the Base44LeadAdminService
 * that calls `adminLead`, which already writes Supabase first and fails the
 * request if that write fails. The ids match because the list hands out
 * Base44 ids, which is what `adminLead` acts on.
 */
export class SupabaseLeadAdminService implements LeadAdminPort {
  constructor(
    private readonly client: SupabaseTableClient,
    private readonly writes: Pick<LeadAdminPort, "setStatus" | "remove">,
  ) {}

  async list(limit = 500): Promise<LeadRecord[]> {
    const rows = await fetchRows(
      this.client.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "leads",
    );
    return rows.map((row) => toPortRow(row) as unknown as LeadRecord);
  }

  setStatus(id: string, status: LeadStatus): Promise<void> {
    return this.writes.setStatus(id, status);
  }

  remove(id: string): Promise<void> {
    return this.writes.remove(id);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/supabase-lead-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/services/supabase/SupabaseLeadAdminService.ts tests/unit/supabase-lead-admin.test.ts
git commit -m "Lead admin reads: a Supabase LeadAdminPort; writes stay on adminLead"
```

---

### Task 5: Wire the composition root

**Files:**
- Modify: `src/services/index.ts` (imports; the `contentAdmin` block and its comment; the `services` object)
- Modify: `src/services/base44/FunctionContentAdminService.ts` (class doc comment, last paragraph only)
- Modify: `tests/contract/frontend-payloads.contract.test.ts:285-291` (regex)
- Test: `tests/unit/services-wiring.test.ts`

**Interfaces:**
- Consumes: `SupabaseTableClient` (Task 2), `SupabaseContentService` (Task 2), `SupabaseContentAdminService` (Task 3), `SupabaseLeadAdminService` (Task 4); existing `Base44ContentService`, `Base44ContentAdminService`, `Base44LeadAdminService`, `FunctionContentAdminService`.
- Produces: `services.content`, `services.contentAdmin` (reads), `services.leadsAdmin` backed by Supabase when `supabase` is non-null, Base44 when it is null.

- [ ] **Step 1: Write the failing wiring test**

Create `tests/unit/services-wiring.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableFake } from "../helpers/supabase-table-fake";

/**
 * Which adapter the composition root picks, with and without a Supabase client.
 *
 * Each case re-imports `@/services` under its own mocks, because the choice is
 * made once, at module load.
 */
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const base44Fake = () => {
  const blogList = vi.fn(async () => []);
  const entities = new Proxy(
    {},
    { get: () => ({ list: blogList, filter: vi.fn(async () => []), get: vi.fn(async () => ({})) }) },
  );
  return { client: { entities, functions: { invoke: vi.fn(), fetch: vi.fn() } }, blogList };
};

async function load(supabase: unknown, base44: unknown) {
  vi.resetModules();
  vi.doMock("@/api/base44Client", () => ({ base44 }));
  vi.doMock("@/api/supabaseClient", () => ({ supabase }));
  const { services } = await import("@/services");
  return {
    services,
    SupabaseContentService: (await import("@/services/supabase/SupabaseContentService")).SupabaseContentService,
    SupabaseLeadAdminService: (await import("@/services/supabase/SupabaseLeadAdminService")).SupabaseLeadAdminService,
    Base44ContentService: (await import("@/services/base44/Base44ContentService")).Base44ContentService,
    Base44LeadAdminService: (await import("@/services/base44/Base44LeadAdminService")).Base44LeadAdminService,
  };
}

describe("composition root", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads content and leads from Supabase when a client is configured", async () => {
    const fake = tableFake({ data: [], error: null });
    // Only `from` is exercised; `auth` and `storage` are there because other
    // ports are built from the same client at load time.
    const supabase = {
      ...fake.client,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({}) },
      rpc: async () => ({ data: [], error: null }),
    };
    const m = await load(supabase, base44Fake().client);
    expect(m.services.content).toBeInstanceOf(m.SupabaseContentService);
    expect(m.services.leadsAdmin).toBeInstanceOf(m.SupabaseLeadAdminService);

    await m.services.contentAdmin.listArticles();
    expect(fake.calls).toContainEqual(["from", "blog_posts"]);
    expect(fake.calls.filter((c) => c[0] === "eq")).toEqual([]); // admin list: drafts included
  });

  it("falls back to Base44 when Supabase is not configured", async () => {
    const b = base44Fake();
    const m = await load(null, b.client);
    expect(m.services.content).toBeInstanceOf(m.Base44ContentService);
    expect(m.services.leadsAdmin).toBeInstanceOf(m.Base44LeadAdminService);

    await m.services.contentAdmin.listArticles();
    expect(b.blogList).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/services-wiring.test.ts`
Expected: the first test FAILS (`services.content` is a `Base44ContentService`). The second passes. If the first fails earlier, while loading, because `SupabaseAuthService`/`SupabaseAccountService`/`SupabaseUploadService` touch a client method the stub lacks, add that method to the stub and re-run until the failure is the `toBeInstanceOf` assertion.

- [ ] **Step 3: Rewire `src/services/index.ts`**

Add the imports (keep them alphabetised with the existing block):

```ts
import { SupabaseContentAdminService } from "./supabase/SupabaseContentAdminService";
import { SupabaseContentService } from "./supabase/SupabaseContentService";
import { SupabaseLeadAdminService } from "./supabase/SupabaseLeadAdminService";
import type { SupabaseTableClient } from "./supabase/SupabaseTableClient";
```

Replace the `contentAdmin` comment and declaration (the block that starts `/**\n * Content admin: reads stay on Base44, …` and ends with the closing `);` of `new FunctionContentAdminService(…)`) with:

```ts
/**
 * Table reads, on Supabase when it is configured.
 *
 * Every write already mirrors into these tables, so the data is there and
 * current. A build without Supabase reads Base44 as before. Content and leads
 * are data, not identity, so a missing client means "the old path", not
 * "broken", unlike `authPort` below.
 */
const tables: SupabaseTableClient | null = supabase ? (supabase as unknown as SupabaseTableClient) : null;

const contentPort: ContentPort = tables ? new SupabaseContentService(tables) : new Base44ContentService(client);

/**
 * Content admin: writes go through a backend function authenticated by the
 * Supabase session; reads come from `tables` like the public ones.
 *
 * The browser cannot write Base44 directly: its rules want a Base44 admin
 * session, and the only identity on offer now is Supabase's, which is refused
 * with 403 before the shadow write is even reached. So the writes go through a
 * backend function, which holds both credentials and needs no browser identity
 * — only proof of who is asking.
 */
const contentAdmin: ContentAdminPort = new FunctionContentAdminService(
  client as unknown as FunctionsClient,
  tables ? new SupabaseContentAdminService(tables) : new Base44ContentAdminService(client),
  async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
);

/** Lead writes stay on `adminLead` (through the Base44 adapter) whichever store is read. */
const base44LeadsAdmin = new Base44LeadAdminService(client);
const leadsAdminPort: LeadAdminPort = tables
  ? new SupabaseLeadAdminService(tables, base44LeadsAdmin)
  : base44LeadsAdmin;
```

In the `services` object, change two lines:

```ts
  content: contentPort,
  …
  leadsAdmin: leadsAdminPort,
```

- [ ] **Step 4: Fix the stale comment in `FunctionContentAdminService.ts`**

Replace its last doc paragraph:

```ts
 * Reads stay on Base44 and stay anonymous: posts and testimonials are readable
 * by anyone, which is the point of a public site.
```

with:

```ts
 * Reads are not this class's concern: they go to `reads`, which the composition
 * root builds from Supabase when it is configured and from Base44 when not.
```

- [ ] **Step 5: Widen the composition-root contract check**

In `tests/contract/frontend-payloads.contract.test.ts`, inside `it("only the composition root names a concrete implementation", …)`, change:

```ts
      return /new Base44\w+Service\(/.test(read(f));
```

to:

```ts
      return /new (Base44|Supabase)\w+Service\(/.test(read(f));
```

- [ ] **Step 6: Run the wiring and contract tests**

Run: `npx vitest run tests/unit/services-wiring.test.ts tests/contract/frontend-payloads.contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Full Vitest run, typecheck, lint**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: all green. Component tests that mock `@/api/base44Client` still pass because Task 1 keeps `supabase` null in Vitest.

- [ ] **Step 8: Commit**

```bash
git add src/services/index.ts src/services/base44/FunctionContentAdminService.ts tests/unit/services-wiring.test.ts tests/contract/frontend-payloads.contract.test.ts
git commit -m "Composition root: content and lead reads from Supabase when configured"
```

---

### Task 6: `contentAdmin` fails the request when its mirror fails

**Files:**
- Modify: `tests/helpers/base44-function.ts` (`HarnessOptions`; the request built in `invokeFunction`; `fetchImpl`)
- Modify: `base44/functions/contentAdmin/entry.ts` (`mirror()` and its comment)
- Test: `tests/integration/content-admin.integration.test.ts`

**Interfaces:**
- Consumes: `invokeFunction(name, body, options)` from `tests/helpers/base44-function.ts`.
- Produces: two new `HarnessOptions` fields:
  - `headers?: Record<string, string>`: extra request headers.
  - `routes?: { match: string; status: number; json?: unknown; text?: string }[]`: per-URL answers. The first route whose `match` is a substring of the URL wins.

  No other task depends on these.

- [ ] **Step 1: Extend the harness**

In `HarnessOptions`, after `rpc?: Record<string, unknown>;`, add:

```ts
  /** Extra request headers — `X-Supabase-Auth` for `contentAdmin`, which reads the caller's token there. */
  headers?: Record<string, string>;
  /**
   * Answers for particular upstream URLs: the first route whose `match` the URL
   * contains wins. `fetchStatus` sets every call at once, which cannot say
   * "the admin check passed but the mirror write did not".
   */
  routes?: { match: string; status: number; json?: unknown; text?: string }[];
```

In `fetchImpl`, directly after the line `if (options.failFetch || options.failCalendar) throw new Error("simulated network failure");`, add:

```ts
    const route = options.routes?.find((r) => String(url).includes(r.match));
    if (route) {
      return {
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: async () => route.json ?? {},
        text: async () => route.text ?? "",
      };
    }
```

In the `new Request(…)` call, change the headers line to:

```ts
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
```

- [ ] **Step 2: Write the integration test**

Create `tests/integration/content-admin.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * The admin's content writes and their Supabase mirror.
 *
 * The site reads posts and testimonials from Supabase, so a write that reached
 * Base44 but not Supabase is, to a visitor, a write that never happened. The
 * function writes Base44 first, because creating a row there is what produces
 * the id stamped into Supabase's base44_id, and fails the request when the
 * mirror does.
 */
const SUPABASE = "https://stub.supabase.co";
const env = { SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key" };
const headers = { "X-Supabase-Auth": "test-access-token" };
const asAdmin = [
  { match: "/auth/v1/user", status: 200, json: { id: "admin-1" } },
  { match: "/rest/v1/profiles", status: 200, json: [{ role: "admin" }] },
];
const mirrorDown = (table: string) => [...asAdmin, { match: `/rest/v1/${table}`, status: 500, text: "mirror down" }];
const draft = { title: "כותרת", body: "גוף", published: true };

const ops: [string, Record<string, unknown>, string][] = [
  ["createArticle", { op: "createArticle", draft }, "blog_posts"],
  ["updateArticle", { op: "updateArticle", id: "post-1", draft: { title: "חדש" } }, "blog_posts"],
  ["removeArticle", { op: "removeArticle", id: "post-1" }, "blog_posts"],
  ["createTestimonial", { op: "createTestimonial", draft: { name: "נועה", quote: "ציטוט" } }, "testimonials"],
  ["removeTestimonial", { op: "removeTestimonial", id: "t-1" }, "testimonials"],
];

describe("contentAdmin — the harness reaches it", () => {
  it("refuses a caller with no token with 401", async () => {
    const r = await invokeFunction("contentAdmin", ops[0][1], { env, routes: asAdmin });
    expect(r.status).toBe(401);
  });
});

describe("contentAdmin — the Supabase mirror", () => {
  it("answers 200 with the Base44 id, and stamps that id into Supabase", async () => {
    const r = await invokeFunction("contentAdmin", ops[0][1], { env, headers, routes: asAdmin });
    expect(r.status).toBe(200);
    const created = r.leads[0] as { id: string }; // the harness records every entity create here
    expect(r.json.id).toBe(created.id);
    const [mirror] = r.callsTo("/rest/v1/blog_posts");
    expect((mirror.body as { base44_id: string }).base44_id).toBe(created.id);
  });

  it.each(ops)("succeeds on %s when both stores take the write", async (_name, body) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: asAdmin });
    expect(r.status).toBe(200);
  });

  it.each(ops)("fails %s with 500 when the mirror write fails", async (_name, body, table) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: mirrorDown(table) });
    expect(r.status).toBe(500);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
  });
});
```

- [ ] **Step 3: Run it and confirm the red**

Run: `npx vitest run tests/integration/content-admin.integration.test.ts`
Expected: the 401 test, the 200-with-id test and the five "succeeds" cases PASS. The five "fails … with 500" cases FAIL with `expected 200 to be 500`. That is today's behaviour, the bug this task fixes. If the 401 or 200 tests fail instead, the harness extension is wrong. Fix it before going on.

- [ ] **Step 4: Make `mirror()` fail loudly**

In `base44/functions/contentAdmin/entry.ts`, replace the whole `mirror` function and its comment:

```js
/** שיקוף ל-Supabase. לעולם לא זורק — Base44 הוא המקור הסמכותי בשלב הזה. */
async function mirror(rid, op, table, body, query = '') {
  …
}
```

with:

```js
/**
 * שיקוף ל-Supabase. כשל זורק, והבקשה כולה נכשלת.
 *
 * האתר קורא מ-Supabase, ולכן כתיבה שלא הגיעה לשם היא — מבחינת המבקר — כתיבה
 * שלא קרתה. הסדר נשאר Base44 ואז Supabase: ביצירה, Base44 הוא שמנפיק את המזהה
 * שנחתם ב-base44_id, ואין מזהה לכתוב איתו קודם. יצירה שנכשלה כאן משאירה שורה
 * ב-Base44 בלבד; המזהה שלה נרשם ביומן, ו-scripts/reconcile-stores.mjs מוצא אותה.
 */
async function mirror(rid, op, table, body, query = '') {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('Supabase is not configured');
  try {
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method: op === 'delete' ? 'DELETE' : 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: op === 'delete' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'content.mirrored', { rid, table, op });
  } catch (e) {
    log('error', 'content.mirror_failed', {
      rid, table, op, base44Id: body?.base44_id ?? null, err: String(e?.message ?? e).slice(0, 200),
    });
    throw e;
  }
}
```

The `request.failed` catch at the bottom of the handler already turns the throw into `500 { error, rid }`. Nothing else in the handler changes.

- [ ] **Step 5: Run the integration test, now green**

Run: `npx vitest run tests/integration/content-admin.integration.test.ts`
Expected: PASS (all 12).

- [ ] **Step 6: Run the other function tests and the contracts that scan function source**

Run: `npx vitest run tests/integration tests/contract tests/security`
Expected: PASS. `tests/contract/logging.contract.test.ts` scans log calls. If it objects to the new `base44Id` field or the `error` level, follow its rule rather than weakening the test.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/base44-function.ts tests/integration/content-admin.integration.test.ts base44/functions/contentAdmin/entry.ts
git commit -m "contentAdmin: a failed Supabase mirror fails the request

The site now reads content from Supabase, so a write that reached only
Base44 is invisible to visitors. Order is unchanged (Base44 first, since
it issues the id stamped into base44_id); the mirror just stops
swallowing its failure."
```

---

### Task 7: Parity gate — the stores must agree before the reads move

**Files:**
- Modify: `scripts/reconcile-stores.mjs` (`SPECS.BlogPost.compare`)
- Modify: `scripts/backfill-from-base44.mjs` (`TABLES.BlogPost.cols`)
- Test: `tests/unit/reconcile.test.ts`

**Interfaces:**
- Consumes: `SPECS`, `compareRows` from `scripts/reconcile-stores.mjs`.
- Produces: nothing code-level. It produces the evidence the merge waits for.

`action_time` is now read from Supabase (`ARTICLE_COLUMNS`) and shown on every blog card, but neither the reconcile check nor the backfill knows the column. A post whose `action_time` exists only in Base44 would lose its chip silently on cutover.

- [ ] **Step 1: Write the failing test**

Append to the `describe` block in `tests/unit/reconcile.test.ts` that holds the `SPECS.BlogPost` case (around line 107):

```ts
  it("flags a post whose action_time reached only one store", () => {
    const { mismatched } = compareRows(
      [{ id: "p1", title: "t", body: "b", published: true, action_time: "רבע שעה" }],
      [{ base44_id: "p1", title: "t", body: "b", published: true, action_time: null }],
      SPECS.BlogPost,
    );
    expect(mismatched).toEqual([{ key: "p1", fields: ["action_time"] }]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/reconcile.test.ts`
Expected: FAIL. `mismatched` is `[]`.

- [ ] **Step 3: Add the column to both scripts**

In `scripts/reconcile-stores.mjs`, `SPECS.BlogPost.compare` becomes:

```js
    compare: ["title", "excerpt", "body", "image_url", "tags", "action_time", "published"],
```

In `scripts/backfill-from-base44.mjs`, `TABLES.BlogPost.cols` becomes:

```js
    cols: ["title","excerpt","body","image_url","tags","action_time","published"],
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/reconcile.test.ts tests/unit/reconcile-leads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reconcile-stores.mjs scripts/backfill-from-base44.mjs tests/unit/reconcile.test.ts
git commit -m "Reconcile: compare and backfill BlogPost.action_time too"
```

- [ ] **Step 6: Run the parity check against production (human step: the export holds personal data)**

The user does this step, because the Base44 export contains customer names and phone numbers and must never pass through an agent's context or the repo:

1. Export the `Lead`, `BlogPost` and `Testimonial` entities (and `Contact`, which the script also compares) from the Base44 dashboard into one JSON file shaped `{ "Lead": [...], "BlogPost": [...], "Testimonial": [...], "Contact": [...] }`, saved **outside** the repo.
2. Run:
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/reconcile-stores.mjs /path/outside/repo/export.json
   ```
3. **Gate:** the `Lead`, `BlogPost` and `Testimonial` rows must show `0` missing, `0` mismatched. `Contact` drift is not this piece's gate (no port reads contacts). An `orphaned` row is a Supabase-only row. Look at it before merging, because Task 4's fallback will show it in the admin list.
4. On drift: `node scripts/backfill-from-base44.mjs /path/outside/repo/export.json > /path/outside/repo/backfill.sql`, inspect it, apply it with the Supabase SQL editor, and re-run step 2 until the three rows are clean.
5. Delete the export and the SQL file.

Do not merge until this gate is clean.

---

### Task 8: Prove the real Supabase path, then ship

**Files:** none (verification, PR).

- [ ] **Step 1: Full automated battery**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 2: e2e, which now takes the Base44 fallback locally too**

Run: `npm run test:e2e:web`
Expected: green, matching CI. The three e2e specs that used to fail locally only because of `.env.local` should now pass too. If they do, update the memory note `local-env-auth-provider.md`. If any still fail, check whether they also fail on `main` before blaming this branch.

- [ ] **Step 3: Exercise the real Supabase path locally**

`npm run dev` (this *does* read `.env.local`, so `supabase` is live) and confirm, with the browser devtools Network tab showing requests to `…supabase.co/rest/v1/…` rather than Base44 entity calls:

- `/blog` lists published posts, with their `action_time` chips.
- Opening a post from the list works (`/blog/<base44 id>`), and `/blog/does-not-exist` shows the not-found page.
- The home page's testimonials render with the right number of stars.
- Signed in as admin: `/admin/blog` lists drafts as well as published posts. `/admin/leads` lists leads, newest first.
- Change a lead's status in `/admin/leads`; it persists after reload (write via `adminLead`, read back from Supabase).
- Create a draft article in `/admin/blog`; it appears in the admin list after the save (write via `contentAdmin`, read back from Supabase) and **not** on `/blog`. Delete it afterwards.

- [ ] **Step 4: Deploy the function change**

`contentAdmin/entry.ts` changed, so it ships with the Base44 publish, as every function change does (see `dorit-pipeline-shape`: Base44 production only on green). Confirm after deploy that a content save still answers 200.

- [ ] **Step 5: Open the PR**

Use `commit-commands:commit-push-pr` (or `gh pr create`) from `feat/entities-to-supabase`. Title: `Off Base44, piece 5: content and lead-admin reads from Supabase`. The body lists the spec, this plan, the Task 7 parity result (counts only, no ids), and the one addition beyond the spec (Task 1).

- [ ] **Step 6: Post-merge production check**

On the production site, repeat Task 8 Step 3's public checks (blog, a post, testimonials) and the admin lists, confirming in the Network tab that reads hit Supabase. Production has real Supabase credentials as of 2026-10-11.
