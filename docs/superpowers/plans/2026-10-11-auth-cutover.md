# Retiring Base44 as an Auth Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase the only `AuthPort`/`AccountPort`/`ContentAdminPort` implementation, deleting the `VITE_AUTH_PROVIDER` flag and the Base44 adapters it chose between.

**Architecture:** This is a deletion-heavy refactor, not new plumbing — `SupabaseAuthService` and `SupabaseAccountService` are already fully implemented and proven against production (parent spec). The work is: close a test-coverage gap on the one class that's about to become unconditionally live (`FunctionContentAdminService`), delete the now-dead Base44 auth/account code and the flag that chose it, then prove the local/CI e2e divergence this closes is actually closed.

**Tech Stack:** TypeScript, Vitest (unit/component/contract/integration), Playwright (e2e). No new dependencies, no Base44 function changes, no Supabase migration.

**Spec:** `docs/superpowers/specs/2026-10-11-auth-cutover-design.md` (parent: `docs/superpowers/specs/2026-09-21-supabase-auth-data-migration-design.md`)

## Global Constraints

- `npm run typecheck`, `npm run lint`, and the full `npx vitest run` suite (unit, component, contract, integration) must stay green after every task.
- Zero unrelated diffs — touch only the files this plan names.
- Do **not** touch, delete, or modify: `src/pages/{Login,Register,ForgotPassword,ResetPassword,OAuthConsent}.jsx`, `src/components/{AuthLayout,GoogleIcon}.jsx`, `vite.config.js`'s `resolve.extensions`, the `PLATFORM_AUTH_PAGES` list in `tests/contract/frontend-payloads.contract.test.ts`, or AGENTS.md's note about them. AGENTS.md documents five prior deletion attempts and a two-day production outage from one of them — this plan does not touch that accommodation.
- Do **not** touch: password sign-in (`signInWithPassword` stays live in `SupabaseAuthService` and on the login page), domain restriction, admin bootstrap, or `base44/functions/myAccount` (and its integration test / `base44/agents/COMPLIANCE.md` references) — all explicitly deferred in the spec.
- `src/services/base44/invoke.ts` is **not** deleted — `responseBody`/`invokeFunction` are still used by `Base44LeadAdminService.ts`, `Base44LeadService.ts`, and `Base44SupportService.ts`, none of which this plan touches. Only the `failureOf` function (used solely by `Base44AccountService`) is removed from it.
- `src/services/base44/Base44ContentAdminService.ts` is **not** deleted — `FunctionContentAdminService` wraps it for reads (`listArticles`/`listTestimonials`) regardless of auth provider, because content data itself stays on Base44 until a later, separate phase. Only the conditional construction in `src/services/index.ts` changes to unconditional.
- No feature-flag transition period. This is a hard cutover in one set of commits, not a dual-path rollout.

## Review Focus

1. **A visitor with no stored Supabase session must still be redirected to login, not crash, even if `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are unset** (a contributor's checkout, a preview without Supabase configured) — `supabase` is `null` in that case, and `authPort` now constructs `SupabaseAuthService` unconditionally. Already pinned by `tests/unit/supabase-auth.test.ts:206-208` (`hasStoredToken()` never touches `this.client`, only the injected `sessionPresent()` callback) — Task 2, Step 2 re-runs this file to confirm it still holds after the composition-root change.
2. **`FunctionContentAdminService` has zero existing test coverage today**, and is about to become the sole `ContentAdminPort` implementation instead of a conditional one. Pinned by the new test file in Task 1.
3. **The local/CI e2e divergence this piece exists to close** (`.env.local` forcing `VITE_AUTH_PROVIDER=supabase`, CI never setting it) must actually be closed, not just worked around — pinned by Task 3, which runs the three affected specs (and the full suite) both with and without the now-inert variable set, proving it has zero effect either way.
4. **`AccountLoadError` reason mapping (`signed_out`/`unverified`/`failed`) must keep working identically** once `Base44AccountService`'s own version of those tests is deleted — pinned by the `SupabaseAccountService` block already in `tests/unit/account-services.test.ts` (lines 33-54), which Task 2 leaves untouched and re-runs.
5. **No file outside `src/services/` may still construct a concrete `Base44*Service`** — pinned by the existing contract test `tests/contract/frontend-payloads.contract.test.ts:285-291` ("only the composition root names a concrete implementation"), re-run in Task 2 to confirm it holds with two fewer implementations to name.

---

### Task 1: Close the `FunctionContentAdminService` test-coverage gap

**Files:**
- Create: `tests/unit/function-content-admin.test.ts`

**Interfaces:**
- Consumes: `FunctionContentAdminService` and `FunctionsClient` from `src/services/base44/FunctionContentAdminService.ts` (constructor: `(client: FunctionsClient, reads: ContentAdminPort, accessToken: () => Promise<string | null>)`); `ContentAdminPort`, `ArticleDraft`, `TestimonialDraft` from `src/services/ports.ts`.
- Produces: nothing new — this is pure test coverage for existing code. No other task depends on this file's contents, only on the class it covers continuing to behave as tested.

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  FunctionContentAdminService,
  type FunctionsClient,
} from "@/services/base44/FunctionContentAdminService";
import type { ContentAdminPort } from "@/services/ports";

function fakeReads(): ContentAdminPort {
  return {
    listArticles: vi.fn().mockResolvedValue(["article"]),
    listTestimonials: vi.fn().mockResolvedValue(["testimonial"]),
    createArticle: vi.fn(),
    updateArticle: vi.fn(),
    removeArticle: vi.fn(),
    createTestimonial: vi.fn(),
    removeTestimonial: vi.fn(),
  } as unknown as ContentAdminPort;
}

function fakeClient(status: number, body: unknown): FunctionsClient {
  return {
    functions: {
      fetch: vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }),
    },
  };
}

describe("FunctionContentAdminService", () => {
  it("delegates reads to the injected reads port, untouched", async () => {
    const reads = fakeReads();
    const svc = new FunctionContentAdminService(fakeClient(200, {}), reads, async () => "tok");

    await svc.listArticles(5);
    await svc.listTestimonials(3);

    expect(reads.listArticles).toHaveBeenCalledWith(5);
    expect(reads.listTestimonials).toHaveBeenCalledWith(3);
  });

  it("refuses to write without a token, before any call reaches the client", async () => {
    const client = fakeClient(200, { id: "x" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => null);

    await expect(svc.createArticle({ title: "t", body: "b", published: false })).rejects.toThrow(
      "נדרשת התחברות.",
    );
    expect(client.functions.fetch).not.toHaveBeenCalled();
  });

  it("sends the visitor's token in X-Supabase-Auth, not Authorization", async () => {
    const client = fakeClient(200, { id: "new-id" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "the-token");

    const id = await svc.createArticle({ title: "t", body: "b", published: false });

    expect(id).toBe("new-id");
    const [path, init] = (client.functions.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("contentAdmin");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Supabase-Auth"]).toBe("the-token");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ op: "createArticle", draft: { title: "t" } });
  });

  it("throws the server's error message on a refusal, rather than treating 200-with-error as success", async () => {
    const client = fakeClient(403, { error: "not an admin" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "tok");

    await expect(svc.removeTestimonial("t1")).rejects.toThrow("not an admin");
  });

  it("falls back to a status-coded message when the body carries no error text", async () => {
    const client = fakeClient(500, {});
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "tok");

    await expect(svc.removeArticle("a1")).rejects.toThrow("500");
  });

  it("passes id and draft through for updateArticle and createTestimonial", async () => {
    const client = fakeClient(200, { id: "" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "tok");

    await svc.updateArticle("a1", { title: "new" });
    const [, init] = (client.functions.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ op: "updateArticle", id: "a1", draft: { title: "new" } });

    await svc.createTestimonial({ name: "n", quote: "q" });
    const [, init2] = (client.functions.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse(init2.body)).toMatchObject({ op: "createTestimonial", draft: { name: "n", quote: "q" } });
  });
});
```

- [ ] **Step 2: Run it to confirm it passes against the existing class**

Run: `npx vitest run tests/unit/function-content-admin.test.ts`
Expected: PASS, 6 tests. This class is not changing in this task — the test documents and pins behavior that already exists, ahead of Task 2 making it the sole `ContentAdminPort` implementation.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/function-content-admin.test.ts
git commit -m "Test: cover FunctionContentAdminService before it becomes unconditional"
```

---

### Task 2: Hard-wire the composition root to Supabase, delete the dead Base44 adapters

**Files:**
- Modify: `tests/unit/account-services.test.ts`
- Modify: `src/services/base44/invoke.ts`
- Delete: `src/services/base44/Base44AccountService.ts`
- Delete: `src/services/base44/Base44AuthService.ts`
- Modify: `src/services/index.ts`
- Delete: `src/config/auth-provider.ts`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `SupabaseAuthService`/`SupabaseAuthClient` from `src/services/supabase/SupabaseAuthService.ts`; `SupabaseAccountService`/`SupabaseRpcClient` from `src/services/supabase/SupabaseAccountService.ts`; `FunctionContentAdminService` (Task 1 added its missing test, not a signature change) and `Base44ContentAdminService` (unchanged); `AuthPort`, `AccountPort`, `ContentAdminPort` from `src/services/ports.ts` (unchanged).
- Produces: `services.auth`, `services.account`, `services.contentAdmin` are now always the Supabase-backed (or, for `contentAdmin`, Supabase-write/Base44-read) implementations — no later task depends on this beyond Task 3's verification.

This task is ordered so that deleting a file and re-running typecheck gives a real red/green signal: deleting a class while something still imports it is the "red," and fixing that import is the "green."

- [ ] **Step 1: Trim the Base44 account tests out of `tests/unit/account-services.test.ts`**

The file currently has four blocks: `toEnquiry`, `SupabaseAccountService`, `Base44AccountService — fed the SDK's real response shape (A-67)`, and `failureOf`. Remove the last two entirely, and remove their now-unused imports.

Delete these two import lines (currently lines 4 and 6):
```ts
import { Base44AccountService } from "@/services/base44/Base44AccountService";
```
```ts
import { failureOf } from "@/services/base44/invoke";
```

Delete the `describe("Base44AccountService — fed the SDK's real response shape (A-67)", ...)` block in full (currently lines 57-97), and the `describe("failureOf", ...)` block in full (currently lines 99-115).

The file should afterwards contain only: the `toEnquiry` describe block and the `SupabaseAccountService` describe block, with imports trimmed to `toEnquiry`, `SupabaseAccountService`, and `AccountLoadError`.

- [ ] **Step 2: Run the trimmed file to confirm nothing else broke**

Run: `npx vitest run tests/unit/account-services.test.ts`
Expected: PASS, 7 tests (down from 17) — the `toEnquiry` and `SupabaseAccountService` blocks are untouched.

- [ ] **Step 3: Remove `failureOf` from `invoke.ts`**

In `src/services/base44/invoke.ts`, delete the `failureOf` function (the last block in the file, currently lines 34-39):

```ts
/** Status and body of a failed function call — AxiosError (`response`) or Base44Error (`status`/`data`). */
export function failureOf(e: unknown): { status?: number; body?: Record<string, unknown> } {
  const err = e as { status?: number; data?: unknown; response?: { status?: number; data?: unknown } };
  const body = (err?.response?.data ?? err?.data) as Record<string, unknown> | undefined;
  return { status: err?.response?.status ?? err?.status, body: body && typeof body === "object" ? body : undefined };
}
```

Leave `responseBody` and `invokeFunction` untouched — they are still used by `Base44LeadAdminService.ts`, `Base44LeadService.ts`, and `Base44SupportService.ts`.

Run: `npm run typecheck`
Expected: no errors (nothing outside the test file you just trimmed referenced `failureOf`).

- [ ] **Step 4: Delete `Base44AccountService.ts` and watch typecheck go red**

```bash
rm src/services/base44/Base44AccountService.ts
```

Run: `npm run typecheck`
Expected: **FAILS** — `src/services/index.ts` still imports `Base44AccountService`. This is the red signal confirming `index.ts` was the only remaining consumer.

- [ ] **Step 5: Delete `Base44AuthService.ts` too**

```bash
rm src/services/base44/Base44AuthService.ts
```

Run: `npm run typecheck`
Expected: still FAILS, now citing both missing imports in `src/services/index.ts` plus the still-present `AUTH_PROVIDER` import.

- [ ] **Step 6: Rewrite the auth/account/contentAdmin wiring in `src/services/index.ts`**

Remove these imports:
```ts
import { AUTH_PROVIDER } from "@/config/auth-provider";
import { Base44AccountService } from "./base44/Base44AccountService";
import { Base44AuthService } from "./base44/Base44AuthService";
```

Replace the `contentAdmin` construction:
```ts
const contentAdmin: ContentAdminPort = (() => {
  const base44Admin = new Base44ContentAdminService(client);
  if (AUTH_PROVIDER !== "supabase") return base44Admin;

  return new FunctionContentAdminService(
    client as unknown as FunctionsClient,
    base44Admin,
    async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
  );
})();
```
with:
```ts
const contentAdmin: ContentAdminPort = new FunctionContentAdminService(
  client as unknown as FunctionsClient,
  new Base44ContentAdminService(client),
  async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
);
```

Replace the `authPort` construction:
```ts
const authPort: AuthPort =
  AUTH_PROVIDER === "supabase" && supabase
    ? new SupabaseAuthService(supabase as unknown as SupabaseAuthClient)
    : new Base44AuthService(client, () => !!appParams.token);
```
with:
```ts
const authPort: AuthPort = new SupabaseAuthService(supabase as unknown as SupabaseAuthClient);
```

Replace the `accountPort` construction:
```ts
const accountPort: AccountPort =
  AUTH_PROVIDER === "supabase" && supabase
    ? new SupabaseAccountService(supabase as unknown as SupabaseRpcClient)
    : new Base44AccountService(client);
```
with:
```ts
const accountPort: AccountPort = new SupabaseAccountService(supabase as unknown as SupabaseRpcClient);
```

Leave `uploadPort` and its `UPLOAD_PROVIDER` import exactly as they are — that flag is untouched.

Also remove the now-stale doc comments above `contentAdmin` and `authPort`/`accountPort` that describe "during the migration" / provider branching, since there is no longer a branch. Replace them with a short comment noting these are the Supabase implementations unconditionally, matching this plan's own framing: identity and the personal area answer through Supabase now; `appParams` import can be removed from `src/services/index.ts` if nothing else in the file still uses it (check with `grep -n appParams src/services/index.ts` after the edit — `appParams` was only read by the deleted `Base44AuthService` construction call).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Delete `src/config/auth-provider.ts`**

```bash
rm src/config/auth-provider.ts
```

Run: `npm run typecheck`
Expected: PASS — nothing imports it anymore after Step 6.

- [ ] **Step 8: Remove `VITE_AUTH_PROVIDER` from `src/vite-env.d.ts`**

Delete this line and its doc comment from the `ImportMetaEnv` interface:
```ts
  /** Who answers "who is signed in" — see `src/config/auth-provider.ts`. */
  readonly VITE_AUTH_PROVIDER?: "base44" | "supabase";
```

Leave `VITE_UPLOAD_PROVIDER` and every other entry untouched.

- [ ] **Step 9: Full verification**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all green, including `tests/contract/frontend-payloads.contract.test.ts` (Review Focus #5) and `tests/unit/supabase-auth.test.ts` (Review Focus #1).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Retire Base44 as an auth fallback: Supabase is now the only AuthPort/AccountPort"
```

---

### Task 3: Prove the local/CI e2e divergence is closed

**Files:** none — this task runs commands and reports results; it does not change source.

**Interfaces:**
- Consumes: the composition root as changed by Task 2; the three specs named in the spec (`e2e/ui/navigation.spec.ts`, `e2e/security/security.spec.ts`, `e2e/ui/account.spec.ts`); the full e2e suite as a broader safety net (no e2e spec calls `signInWithPassword`/`signInWithGoogle`/`loginViaEmailPassword` today — confirmed by repo-wide search — so none should be newly sensitive to `supabase` being `null` in CI, but running the full suite catches anything that search missed).
- Produces: nothing a later task consumes — this is the plan's acceptance check.

- [ ] **Step 1: Run the three named specs locally, with `.env.local` exactly as it is today**

```bash
npx playwright test e2e/ui/navigation.spec.ts e2e/security/security.spec.ts e2e/ui/account.spec.ts
```

Expected: PASS. `.env.local` still has `VITE_AUTH_PROVIDER=supabase` in it, but after Task 2 nothing in the codebase reads that variable anymore — it is dead text in a dotenv file.

- [ ] **Step 2: Run the same three specs with the variable unset, to prove that change truly had zero effect**

```bash
VITE_AUTH_PROVIDER= npx playwright test e2e/ui/navigation.spec.ts e2e/security/security.spec.ts e2e/ui/account.spec.ts
```

Expected: PASS, identically. (Do not edit `.env.local` itself — it's local and gitignored; overriding the variable for one command is enough to prove the point without touching anyone's environment.)

- [ ] **Step 3: Run the full e2e suite locally, as the broader safety net**

```bash
npx playwright test
```

Expected: PASS. If anything fails here that didn't fail before Task 2, stop and investigate before continuing — this plan's constraint is zero unrelated regressions, and this is the step that would catch one in the e2e layer.

- [ ] **Step 4: Confirm CI is green on the branch**

Push the branch and confirm the CI workflow's "Choose the e2e matrix" and e2e job(s) pass, the same three specs included, under CI's environment (no `.env.local`, no `VITE_AUTH_PROVIDER` set at all — CI never set it, and after Task 2 there is nothing left for it to default). This is the other half of "divergence closed": the same specs passing for the same reason in both environments, not two different reasons that happened to agree.

- [ ] **Step 5: Record the result**

No commit needed for this task (no file changes) — report the four results (Steps 1-4) in the task's completion report so the ledger (if using subagent-driven-development) or the final summary (if executing inline) states explicitly that the divergence this plan set out to close was verified closed, not just assumed.

---

## Post-merge checklist (not a task — a reminder for whoever merges)

- [ ] Manually sign in to production as the admin account via Google and confirm `/admin/leads` loads. The Supabase auth path was proven against production data on 2026-09-22, but this merge is the first time nothing else can catch a regression — there's no more `Base44AuthService` to fall back to.
- [ ] Watch for one expected, harmless side effect: any visitor who previously signed in to `/account` via Base44's Google login will need to sign in again under Supabase. Same Google identity, matched by verified email — no data lost, just a one-time re-login (see spec's "Known one-time user impact").
