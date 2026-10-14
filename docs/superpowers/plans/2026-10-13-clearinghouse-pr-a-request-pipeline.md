# Clearinghouse PR A — Request pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client who asked for a clearinghouse (המסלקה הפנסיונית) pull hands over their power-of-attorney code and ID number through `/masleka`; the values are held only as AES-GCM ciphertext until a staff member submits the request in the clearinghouse portal; the site chases everybody (client invitation and reminder, staff notices) and the staff board shows each request's state. Everything ships dark behind `MASLEKA_ENABLED` / `VITE_MASLEKA_ENABLED`, both off by default, until Dorit's compliance adviser has reviewed it.

**Architecture:** One migration adds `masleka_requests` and `masleka_access_log` (RLS: agency members only; column grants keep ciphertext and token hashes away from the browser), the `staff_role`/`my_staff_role` helpers, the housekeeping functions and guarded `pg_cron`/`pg_net` jobs. Five Supabase Edge Functions (`masleka-code` public; `masleka-reveal`, `masleka-submitted`, `masleka-create` members-only; `masleka-remind` cron-only) share `_shared/{masleka,seal,staff,masleka-mail,business-days,israeli-id}.ts`; `submit-lead` creates the request for an interview that answered "מעוניין/ת". The browser gets a `MaslekaPort` (Supabase adapter + unconfigured stand-in, wired in the composition root and the lazy front), the public page `/masleka`, a `StaffRoute` guard, the staff board `/admin/masleka` and the advisor guide `/admin/masleka/guide`.

**Tech Stack:** Postgres (Supabase, RLS, pg_cron, pg_net, Vault), Deno Edge Functions (Web Crypto AES-GCM), React 18 + react-router 6 + TanStack Query 5 + Tailwind, Vitest (+ Testing Library, jsdom), Playwright.

**Spec:** docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md (PR A)

## Global Constraints

- Migration file: `supabase/migrations/20261015000000_masleka_requests.sql` (sorts after `20261013010000_no_public_lead_inserts.sql`). Applied to production by hand only on the user's request.
- Agency 1 id: `00000000-0000-0000-0000-000000000001`.
- Request statuses: `invited` · `code_received` · `submitted` · `completed` · `expired` · `cancelled`. PR A sets `invited`, `code_received`, `submitted`, `expired`; `completed` is PR B's (the board's third column renders an empty state); `cancelled` is reserved.
- Token: 32 random bytes, base64url (43 chars). Only `sha256` hex is stored (`token_hash`). Link: `https://govari-fin.co.il/masleka#t=<token>` (fragment, not query — see Review Focus 6). Single-use: a code is accepted only while `status = 'invited'`. Expires 30 days after issue (`token_expires_at`).
- Ciphertext: AES-GCM, key = Edge secret `MASLEKA_KEY` (base64 of exactly 32 bytes), random 12-byte IV per value, stored as `base64(iv | ciphertext+tag)`. Present only while `status = 'code_received'` (DB check constraint). Wiped by **הגשתי**; hard wipe of anything older than 9 days by the hourly housekeeping job.
- Dark switches: Edge secret `MASLEKA_ENABLED` and Vite env `VITE_MASLEKA_ENABLED`; each is on only when exactly `"true"`. While off: `/masleka` shows "השירות אינו זמין כרגע" and never posts; every `masleka-*` function answers 404 `{ error: 'disabled', rid }` before reading its body; `submit-lead` keeps today's `POA_URL` mail and creates no request; `/admin/masleka*` routes are not registered.
- Rate limits on `masleka-code`: 10 per hour per IP hash (`masleka-ip:`), 5 per hour per link (`masleka-link:<token_hash>`), through `allow_submission`.
- Reminders: staff notice "קוד מסלקה חדש לטיפול" when a code arrives; "יש קבצים להורדה" 4 hours after `submitted_at`; "נמחק במסלקה בעוד יומיים" on Israeli business day 5 after `submitted_at` (Sunday–Thursday in `Asia/Jerusalem`, holidays not modelled); `clearinghouse_deletes_at` = business day 7; one client reminder 7 days after `client_invited_at`, which rotates the token. Requests still `submitted` 14 days after `clearinghouse_deletes_at` expire.
- Staff = `profiles.role = 'admin'` OR a `memberships` row in agency 1 (`owner`/`agent`/`staff`). Staff mail goes to `masleka_staff_emails()` (the profile e-mails of exactly those people); if that is empty or unreadable, to `dorit@govari-fin.co.il`.
- `verify_jwt = false` for all five `masleka-*` functions. Members-only functions check the bearer token with `GET /auth/v1/user` and the role with the `staff_role` RPC on every call. `masleka-remind` requires header `x-masleka-cron` equal to Edge secret `MASLEKA_CRON_SECRET`.
- Cron (only where `pg_available_extensions` has them): `masleka-housekeeping` at minute 5 hourly (`masleka_wipe_stale()` + `masleka_expire()`); `masleka-remind` at minute 20 hourly via `pg_net`, reading Vault secrets `masleka_functions_url` and `masleka_cron_secret`.
- No new GA4 event; `ALLOWED_PARAMS` and `LEAD_EVENTS` unchanged.
- `/masleka` and `/admin/masleka*` are `noindex` (SeoRouteGuard); `Disallow: /masleka` in the `*` group of `public/robots.txt`; not in the sitemap, prerender `ROUTES` or `llms.txt`.
- CSP unchanged. The clearinghouse link is a plain navigation to `https://www.swiftness.co.il/` with `target="_blank" rel="noopener noreferrer"`.
- Edge Function shape (contracts): `handler.ts` exports `handler`, `index.ts` is exactly `import { handler } from './handler.ts';\n\nDeno.serve(handler);`, `const FN = '<dir name>'`, `const rid = newRequestId()`, `request.start` and `request.end`/`request.failed`, `Date.now() - startedAt`, every log line has `rid`, every `err:` is `.slice(0, 200)` inline, every `mail.` line has `role`, no personal field in a log, every answer carries `rid` with `ok` before it, no `error.message` returned.
- New code is TypeScript; `supabase/functions/submit-lead/lead.js` stays plain JS.
- Commit trailers, exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
  ```

## Review Focus

1. **A code submitted twice (double click, two tabs, replay).** Acceptance is one conditional `PATCH … token_hash=eq.H&status=eq.invited&token_expires_at=gt.now`; the second submission matches nothing and gets `link_invalid`, keeps the first ciphertext, and mails nobody. Pinned in Task 7 ("a second submission of the same link is refused and changes nothing").
2. **A token reused after expiry, after use, or after rotation.** Expired, used and rotated tokens all answer the same `link_invalid`. Pinned in Task 7 (expired / used / unknown) and Task 11 ("the old link stops working once the reminder has rotated it").
3. **A staff member whose membership was removed mid-session.** No function trusts the JWT's claims or the browser's role: `staff_role` is asked on every call, so the next call is 403 and the board says the access was removed. Pinned in Task 8 ("a membership removed between two calls is refused on the second") and Task 17 ("tells a staff member whose access was removed").
4. **Ciphertext surviving a failed wipe.** הגשתי is one `PATCH` that sets the status and nulls both ciphertexts together; a failure answers 500 so nobody is told it was wiped; the DB refuses any row outside `code_received` that still holds ciphertext; the hourly job wipes anything older than 9 days. Pinned in Task 9 ("a failed wipe is reported as a failure, not as done") and Task 6 (`masleka_check.sql`: check constraint and `masleka_wipe_stale`).
5. **Clipboard API unavailable or denied (non-secure context, permissions, old Safari).** Copy falls back to a selected read-only field with "העתק ידנית". Pinned in Task 14 (`copyOrFallback`) and Task 17 (no clipboard; clipboard refuses).
6. **The token leaking through the URL.** GA4's `config` page_view and request logs carry the query string, so the token travels in the fragment and the page removes it with `history.replaceState` before anything else reads it. Pinned in Task 15 ("takes the link's token out of the address bar") and Task 19 (e2e: URL ends `/masleka`).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261015000000_masleka_requests.sql` | Tables, RLS, column grants, `staff_role`/`my_staff_role`/`masleka_staff_emails`, `masleka_expire`/`masleka_wipe_stale`/`masleka_call_remind`, guarded cron jobs |
| `supabase/tests/masleka_check.sql` | Manual local-Supabase proof of the RLS, grants, constraint and housekeeping functions |
| `supabase/functions/_shared/israeli-id.ts` | ת״ז check digit (Edge copy) |
| `supabase/functions/_shared/seal.ts` | AES-GCM seal/unseal with `MASLEKA_KEY` |
| `supabase/functions/_shared/business-days.ts` | Israeli business-day arithmetic |
| `supabase/functions/_shared/masleka.ts` | Switch, constants, token/link helpers, `createRequest` |
| `supabase/functions/_shared/staff.ts` | Who is calling (session + `staff_role`), staff mail recipients |
| `supabase/functions/_shared/masleka-mail.ts` | Staff notices and client invitation/reminder mails |
| `supabase/functions/_shared/rest.ts` (modify) | `updateWhere` (conditional PATCH returning rows), `authUser` |
| `supabase/functions/masleka-code/{handler,index}.ts` | Public: accept a code + ID for a valid link |
| `supabase/functions/masleka-reveal/{handler,index}.ts` | Members: decrypt one value, write the access log |
| `supabase/functions/masleka-submitted/{handler,index}.ts` | Members: הגשתי — wipe ciphertext, record time |
| `supabase/functions/masleka-create/{handler,index}.ts` | Members: hand-made request, or a fresh link for an invited one |
| `supabase/functions/masleka-remind/{handler,index}.ts` | Cron: staff reminders and the client reminder |
| `supabase/functions/submit-lead/{handler.ts,lead.js}` (modify) | Create the request and put the `/masleka` link where the POA link was |
| `supabase/config.toml` (modify) | `verify_jwt = false` blocks for the five functions |
| `tests/helpers/edge-function.ts` (modify) | Fake auth, `staff_role`, `masleka_staff_emails`, `masleka_requests`, `masleka_access_log` |
| `src/lib/israeli-id.ts` | ת״ז check digit (browser copy) |
| `src/lib/masleka.ts` | Board columns, readiness/deletion labels, clipboard fallback, token-from-hash, code shape |
| `src/config/masleka.ts` | `MASLEKA_ENABLED`, clearinghouse URLs |
| `src/vite-env.d.ts` (modify) | `VITE_MASLEKA_ENABLED` typing |
| `src/services/ports.ts` (modify) | `MaslekaPort` and its types, `MaslekaError` |
| `src/services/supabase/SupabaseMaslekaService.ts` | The port over supabase-js (RPC, table read, function calls) |
| `src/services/unconfigured/UnconfiguredMaslekaService.ts` | The port when Supabase is not configured |
| `src/services/composition.ts`, `src/services/index.ts` (modify) | Wire the port in the root and the lazy front |
| `src/components/masleka/MaslekaSteps.tsx` | Numbered steps with an optional, empty-by-default screenshots slot |
| `src/pages/Masleka.tsx` | Public `/masleka` page |
| `src/components/StaffRoute.tsx` | Guard: signed in AND (admin OR agency-1 member) |
| `src/pages/MaslekaBoard.tsx` | Staff board `/admin/masleka` |
| `src/pages/MaslekaGuide.tsx` | Advisor-registration guide `/admin/masleka/guide` |
| `src/App.jsx`, `src/components/SeoRouteGuard.tsx`, `public/robots.txt` (modify) | Routes, noindex, robots |
| `tests/...` (new/modify) | One test file per unit, listed per task |
| `e2e/ui/masleka.spec.ts` | Dark build: no form, no indexing, token stripped, no board |
| `README.md`, `base44/agents/COMPLIANCE.md`, `tests/test-plan/*.md` (modify) | Switches, secrets, staff SQL, compliance review list, STD rows |

---

## Task 1: The Israeli ID check digit, in the browser and on the Edge

**Files:**
- Create: `src/lib/israeli-id.ts`
- Create: `supabase/functions/_shared/israeli-id.ts`
- Create: `tests/unit/israeli-id.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: nothing.
- Produces (identical in both files): `normalizeIsraeliId(raw: unknown): string | null` — the nine zero-padded digits, or `null`; `isValidIsraeliId(raw: unknown): boolean`.

- [ ] **Step 1: Write the failing test** — `tests/unit/israeli-id.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as browser from "@/lib/israeli-id";
import * as edge from "../../supabase/functions/_shared/israeli-id.ts";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The ת״ז check digit, as the page checks it before sending and the Edge
 * Function checks it again before storing. Every value here is constructed
 * from the algorithm (zero-padded, so no real person's number), never copied
 * from anywhere.
 */
const VALID: Array<[string, string]> = [
  ["000000018", "000000018"],
  ["00018", "000000018"],
  ["000000026", "000000026"],
  ["000000034", "000000034"],
  ["000001016", "000001016"],
  ["000 000 018", "000000018"],
  ["0000-00018", "000000018"],
];

const INVALID: unknown[] = [
  "000000019",
  "000000017",
  "000000000",
  "0018",
  "0000000018",
  "00000001a",
  "",
  "   ",
  null,
  undefined,
  18,
];

describe.each([
  ["browser", browser],
  ["edge", edge],
] as const)("the %s copy", (_label, impl) => {
  it.each(VALID)("accepts %s as %s", (raw, normalized) => {
    expect(impl.normalizeIsraeliId(raw)).toBe(normalized);
    expect(impl.isValidIsraeliId(raw)).toBe(true);
  });

  it.each(INVALID.map((v) => [v]))("rejects %s", (raw) => {
    expect(impl.normalizeIsraeliId(raw)).toBeNull();
    expect(impl.isValidIsraeliId(raw)).toBe(false);
  });
});

describe("the two copies", () => {
  it("are the same code, so the page and the function never disagree", () => {
    const body = (path: string) => {
      const src = readFileSync(join(REPO_ROOT, path), "utf8");
      return src.slice(src.indexOf("export function normalizeIsraeliId")).replace(/\s+/g, " ").trim();
    };
    expect(body("src/lib/israeli-id.ts")).toBe(body("supabase/functions/_shared/israeli-id.ts"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/israeli-id.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/israeli-id"`.

- [ ] **Step 3: Implement** — `src/lib/israeli-id.ts`

```ts
/**
 * The Israeli ID number (ת״ז) check digit.
 *
 * Nine digits, left-padded with zeros. Each digit is multiplied by 1 and 2 in
 * turn, a two-digit product is reduced by 9, and the sum must divide by 10. A
 * single mistyped digit always fails it, which is why /masleka checks it
 * before anything is sent and `masleka-code` checks it again before anything
 * is stored.
 *
 * The Edge Functions keep an identical copy in
 * supabase/functions/_shared/israeli-id.ts — Deno cannot import from src/.
 * tests/unit/israeli-id.test.ts runs both over one table and compares their
 * code, so they cannot drift.
 */
export function normalizeIsraeliId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{5,9}$/.test(digits)) return null;
  const padded = digits.padStart(9, "0");
  if (/^0+$/.test(padded)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let step = Number(padded[i]) * (i % 2 === 0 ? 1 : 2);
    if (step > 9) step -= 9;
    sum += step;
  }
  return sum % 10 === 0 ? padded : null;
}

export function isValidIsraeliId(raw: unknown): boolean {
  return normalizeIsraeliId(raw) !== null;
}
```

And `supabase/functions/_shared/israeli-id.ts`:

```ts
/**
 * The Israeli ID number (ת״ז) check digit — the Edge copy.
 *
 * Identical to src/lib/israeli-id.ts, which the page uses before sending;
 * tests/unit/israeli-id.test.ts compares the two. `masleka-code` checks again
 * here because the page is not the only thing that can post.
 */
export function normalizeIsraeliId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{5,9}$/.test(digits)) return null;
  const padded = digits.padStart(9, "0");
  if (/^0+$/.test(padded)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let step = Number(padded[i]) * (i % 2 === 0 ? 1 : 2);
    if (step > 9) step -= 9;
    sum += step;
  }
  return sum % 10 === 0 ? padded : null;
}

export function isValidIsraeliId(raw: unknown): boolean {
  return normalizeIsraeliId(raw) !== null;
}
```

Add to `tests/test-plan/01-std-unit.md`, as a new section before "## 5. Pass criteria" (and raise the case count there by 37):

```markdown
### 4.21 The ת״ז check digit — `tests/unit/israeli-id.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-ILID-001..014 | "accepts %s as %s" (7 values × browser/edge) | Zero-padded nine digits returned; spaces and hyphens ignored |
| UNIT-ILID-015..036 | "rejects %s" (11 values × browser/edge) | `null` for a wrong check digit, all zeros, 4 or 10 digits, letters, empty, non-strings |
| UNIT-ILID-037 | "are the same code, so the page and the function never disagree" | The two function bodies match after whitespace normalisation |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/israeli-id.test.ts && npm run typecheck`
Expected: PASS (37 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/israeli-id.ts supabase/functions/_shared/israeli-id.ts tests/unit/israeli-id.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: the ID check digit, in the page and on the Edge, kept identical by a test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 2: Sealing the code and the ID (AES-GCM)

**Files:**
- Create: `supabase/functions/_shared/seal.ts`
- Create: `tests/unit/edge-seal.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: Edge secret `MASLEKA_KEY` (base64 of 32 bytes) through `Deno.env`.
- Produces: `sealConfigured(): boolean`; `importSealKey(base64: string): Promise<CryptoKey>` (throws `seal_key_length`); `sealKeyFromEnv(): Promise<CryptoKey | null>`; `seal(key: CryptoKey, plaintext: string): Promise<string>`; `unseal(key: CryptoKey, value: string): Promise<string>` (throws on tamper, wrong key, truncation).

- [ ] **Step 1: Write the failing test** — `tests/unit/edge-seal.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importSealKey,
  seal,
  sealConfigured,
  sealKeyFromEnv,
  unseal,
} from "../../supabase/functions/_shared/seal.ts";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");

const withEnv = (env: Record<string, string>) =>
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });

afterEach(() => vi.unstubAllGlobals());

describe("seal / unseal", () => {
  it("round-trips a value", async () => {
    const key = await importSealKey(KEY_A);
    expect(await unseal(key, await seal(key, "AB12-CD34"))).toBe("AB12-CD34");
  });

  it("uses a fresh IV every time, so equal values never look equal", async () => {
    const key = await importSealKey(KEY_A);
    expect(await seal(key, "000000018")).not.toBe(await seal(key, "000000018"));
  });

  it("stores the IV, then the ciphertext and its 16-byte tag", async () => {
    const key = await importSealKey(KEY_A);
    const sealed = await seal(key, "000000018");
    expect(Buffer.from(sealed, "base64").length).toBe(12 + 9 + 16);
  });

  it("refuses a value that was changed after sealing", async () => {
    const key = await importSealKey(KEY_A);
    const bytes = Buffer.from(await seal(key, "000000018"), "base64");
    bytes[14] ^= 0xff;
    await expect(unseal(key, bytes.toString("base64"))).rejects.toThrow();
  });

  it("refuses a value sealed with another key", async () => {
    const sealed = await seal(await importSealKey(KEY_A), "000000018");
    await expect(unseal(await importSealKey(KEY_B), sealed)).rejects.toThrow();
  });

  it("refuses a value too short to hold an IV and a tag", async () => {
    const key = await importSealKey(KEY_A);
    await expect(unseal(key, Buffer.alloc(20).toString("base64"))).rejects.toThrow("sealed_too_short");
  });

  it("refuses text that is not base64", async () => {
    const key = await importSealKey(KEY_A);
    await expect(unseal(key, "not base64 at all!")).rejects.toThrow();
  });

  it("refuses a key that is not 32 bytes", async () => {
    await expect(importSealKey(Buffer.alloc(16, 1).toString("base64"))).rejects.toThrow("seal_key_length");
  });
});

describe("the key from the environment", () => {
  it("is not configured when MASLEKA_KEY is missing", async () => {
    withEnv({});
    expect(sealConfigured()).toBe(false);
    expect(await sealKeyFromEnv()).toBeNull();
  });

  it("is not configured when MASLEKA_KEY is short or not base64", async () => {
    withEnv({ MASLEKA_KEY: Buffer.alloc(16, 1).toString("base64") });
    expect(sealConfigured()).toBe(false);
    withEnv({ MASLEKA_KEY: "!!!" });
    expect(sealConfigured()).toBe(false);
    expect(await sealKeyFromEnv()).toBeNull();
  });

  it("is configured with 32 bytes, and the key it gives works", async () => {
    withEnv({ MASLEKA_KEY: ` ${KEY_A}\n` });
    expect(sealConfigured()).toBe(true);
    const key = await sealKeyFromEnv();
    expect(key).not.toBeNull();
    expect(await unseal(key!, await seal(key!, "x"))).toBe("x");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/edge-seal.test.ts`
Expected: FAIL — `Failed to load url ../../supabase/functions/_shared/seal.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/_shared/seal.ts`

```ts
/**
 * AES-GCM for the two values the clearinghouse pipeline holds: a client's
 * power-of-attorney code and ID number.
 *
 * The key is an Edge Function secret (`MASLEKA_KEY`, base64 of 32 bytes) and
 * never reaches the database, so a copy of the database — a backup, a leaked
 * service key used to read a table — holds nothing readable. Each value gets
 * its own random 12-byte IV; what is stored is base64(iv | ciphertext+tag), so
 * a changed byte or the wrong key fails the tag instead of decrypting to
 * nonsense.
 *
 * No return types are spelled out on the byte helpers on purpose: newer
 * TypeScript types `Uint8Array` by its buffer, and inference keeps Deno's
 * checker and Web Crypto's `BufferSource` in agreement.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Whether a usable key is set — present and exactly 32 bytes. Never its value. */
export function sealConfigured(): boolean {
  try {
    return fromBase64((Deno.env.get('MASLEKA_KEY') || '').trim()).length === KEY_BYTES;
  } catch {
    return false;
  }
}

export async function importSealKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64(base64.trim());
  if (raw.length !== KEY_BYTES) throw new Error('seal_key_length');
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** The key from `MASLEKA_KEY`, or null when it is missing or malformed. */
export async function sealKeyFromEnv(): Promise<CryptoKey | null> {
  if (!sealConfigured()) return null;
  return await importSealKey((Deno.env.get('MASLEKA_KEY') || '').trim());
}

export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv, 0);
  out.set(sealed, IV_BYTES);
  return toBase64(out);
}

/** The plaintext, or a throw: tampered, truncated, not base64, or another key. */
export async function unseal(key: CryptoKey, value: string): Promise<string> {
  const bytes = fromBase64(value);
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error('sealed_too_short');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
    key,
    bytes.slice(IV_BYTES),
  );
  return new TextDecoder().decode(plain);
}
```

Add to `tests/test-plan/01-std-unit.md` before "## 5. Pass criteria" (raise the count by 11):

```markdown
### 4.22 Sealing the clearinghouse values — `tests/unit/edge-seal.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-SEAL-001 | "round-trips a value" | `unseal(seal(x)) === x` |
| UNIT-SEAL-002 | "uses a fresh IV every time, so equal values never look equal" | Two seals of one value differ |
| UNIT-SEAL-003 | "stores the IV, then the ciphertext and its 16-byte tag" | Decoded length = 12 + plaintext + 16 |
| UNIT-SEAL-004 | "refuses a value that was changed after sealing" | Rejects |
| UNIT-SEAL-005 | "refuses a value sealed with another key" | Rejects |
| UNIT-SEAL-006 | "refuses a value too short to hold an IV and a tag" | `sealed_too_short` |
| UNIT-SEAL-007 | "refuses text that is not base64" | Rejects |
| UNIT-SEAL-008 | "refuses a key that is not 32 bytes" | `seal_key_length` |
| UNIT-SEAL-009 | "is not configured when MASLEKA_KEY is missing" | `false`, `null` |
| UNIT-SEAL-010 | "is not configured when MASLEKA_KEY is short or not base64" | `false`, `null` |
| UNIT-SEAL-011 | "is configured with 32 bytes, and the key it gives works" | `true`; round trip through the env key |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/edge-seal.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS (11 tests); Deno check clean (no function imports seal.ts yet, so this only proves nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/seal.ts tests/unit/edge-seal.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: AES-GCM seal/unseal with a key the database never sees

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 3: Israeli business days

**Files:**
- Create: `supabase/functions/_shared/business-days.ts`
- Create: `tests/unit/edge-business-days.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Produces: `addBusinessDays(from: Date, days: number): Date` — the same instant moved forward past `days` days whose weekday **in Asia/Jerusalem** is Sunday–Thursday.

- [ ] **Step 1: Write the failing test** — `tests/unit/edge-business-days.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { addBusinessDays } from "../../supabase/functions/_shared/business-days.ts";

/**
 * The clearinghouse keeps a download for 7 business days and the site warns
 * on day 5. 2026-10-11 is a Sunday. Holidays are not modelled (README).
 */
describe("addBusinessDays", () => {
  const sunday = new Date("2026-10-11T09:00:00Z");

  it("skips Friday and Saturday: day 5 after a Sunday is the next Sunday", () => {
    expect(addBusinessDays(sunday, 5).toISOString()).toBe("2026-10-18T09:00:00.000Z");
  });

  it("puts day 7 after a Sunday on the Tuesday after", () => {
    expect(addBusinessDays(sunday, 7).toISOString()).toBe("2026-10-20T09:00:00.000Z");
  });

  it("goes from a Thursday straight to Sunday", () => {
    expect(addBusinessDays(new Date("2026-10-15T09:00:00Z"), 1).toISOString()).toBe("2026-10-18T09:00:00.000Z");
  });

  it("reads the weekday in Israel, not in UTC", () => {
    // 22:30 UTC on Thursday is 01:30 on Friday in Israel. One business day on
    // is 01:30 on Sunday in Israel — 22:30 UTC on Saturday.
    expect(addBusinessDays(new Date("2026-10-15T22:30:00Z"), 1).toISOString()).toBe("2026-10-17T22:30:00.000Z");
  });

  it("leaves the instant alone for zero days", () => {
    expect(addBusinessDays(sunday, 0).toISOString()).toBe(sunday.toISOString());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/edge-business-days.test.ts`
Expected: FAIL — cannot load `business-days.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/_shared/business-days.ts`

```ts
/**
 * Israeli business days: Sunday to Thursday, read in Asia/Jerusalem.
 *
 * The clearinghouse deletes a download "after 7 business days", and the site
 * warns on day 5. The functions run in UTC, where late Thursday evening is
 * already Friday in Israel, so the weekday is always read in Israel's zone.
 * Holidays are not modelled: on a holiday week the warning comes a day or two
 * early, never late — the side to err on when a missed file costs ₪14.
 */
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' });
const WORKDAYS = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
const DAY_MS = 86_400_000;

export function addBusinessDays(from: Date, days: number): Date {
  let at = from.getTime();
  let left = days;
  while (left > 0) {
    at += DAY_MS;
    if (WORKDAYS.has(WEEKDAY.format(new Date(at)))) left -= 1;
  }
  return new Date(at);
}
```

Add to `tests/test-plan/01-std-unit.md` before "## 5. Pass criteria" (raise the count by 5):

```markdown
### 4.23 Israeli business days — `tests/unit/edge-business-days.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-BDAY-001 | "skips Friday and Saturday: day 5 after a Sunday is the next Sunday" | 2026-10-18 |
| UNIT-BDAY-002 | "puts day 7 after a Sunday on the Tuesday after" | 2026-10-20 |
| UNIT-BDAY-003 | "goes from a Thursday straight to Sunday" | 2026-10-18 |
| UNIT-BDAY-004 | "reads the weekday in Israel, not in UTC" | Israel Friday 01:30 + 1 → Israel Sunday 01:30 |
| UNIT-BDAY-005 | "leaves the instant alone for zero days" | Same instant |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/edge-business-days.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/business-days.ts tests/unit/edge-business-days.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: Israeli business days, read in Asia/Jerusalem

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 4: The shared pipeline module, the caller check, and two REST helpers

**Files:**
- Create: `supabase/functions/_shared/masleka.ts`
- Create: `supabase/functions/_shared/staff.ts`
- Modify: `supabase/functions/_shared/rest.ts` (append `updateWhere` and `authUser`)
- Create: `tests/unit/edge-masleka-shared.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: `sha256Hex`, `isEmail` (guard.ts); `insertRow`, `callRpc` (rest.ts); `Log` (log.ts).
- Produces, `_shared/masleka.ts`: `AGENCY_1`, `AGENCY_MAILBOX`, `MASLEKA_PAGE`, `MASLEKA_BOARD`, `TOKEN_TTL_DAYS = 30`, `CLIENT_REMINDER_DAYS = 7`, `READY_AFTER_HOURS = 4`, `DEADLINE_REMINDER_BUSINESS_DAY = 5`, `CLEARINGHOUSE_RETENTION_BUSINESS_DAYS = 7`, `UUID: RegExp`, `maslekaEnabled(): boolean`, `newToken(): string`, `isToken(v: unknown): v is string`, `tokenHash(token: string): Promise<string>`, `maslekaLink(token: string): string`, `tokenExpiry(from?: Date): string`, `normalizeCode(v: unknown): string | null`, `interface NewRequest { clientName: string; contactEmail: string | null; leadId: string | null; createdBy: string | null }`, `createRequest(input: NewRequest): Promise<{ id: string; link: string }>`.
- Produces, `_shared/staff.ts`: `type StaffRole = 'admin' | 'owner' | 'agent' | 'staff'`, `type Caller = { kind: 'anonymous' } | { kind: 'outsider'; userId: string } | { kind: 'staff'; userId: string; role: StaffRole }`, `bearer(req: Request): string | null`, `staffCaller(req: Request): Promise<Caller>`, `staffRecipients(log: Log, rid: string): Promise<string[]>`.
- Produces, `rest.ts`: `updateWhere(table: string, query: string, fields: Record<string, unknown>): Promise<Record<string, unknown>[]>`, `authUser(token: string): Promise<{ id: string } | null>`.

- [ ] **Step 1: Write the failing test** — `tests/unit/edge-masleka-shared.test.ts`

```ts
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENCY_1,
  createRequest,
  isToken,
  maslekaEnabled,
  maslekaLink,
  newToken,
  normalizeCode,
  tokenExpiry,
} from "../../supabase/functions/_shared/masleka.ts";
import { authUser, updateWhere } from "../../supabase/functions/_shared/rest.ts";
import { staffCaller, staffRecipients } from "../../supabase/functions/_shared/staff.ts";

const SUPABASE_URL = "https://project-ref.supabase.test";
const BASE_ENV = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "service-role-test" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const withEnv = (env: Record<string, string>) =>
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });

type Call = { url: string; init: RequestInit };
function withFetch(answer: (url: string, init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return answer(String(url), init);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("the switch", () => {
  it("is off unless MASLEKA_ENABLED is exactly true", () => {
    withEnv({});
    expect(maslekaEnabled()).toBe(false);
    withEnv({ MASLEKA_ENABLED: "TRUE" });
    expect(maslekaEnabled()).toBe(false);
    withEnv({ MASLEKA_ENABLED: "1" });
    expect(maslekaEnabled()).toBe(false);
    withEnv({ MASLEKA_ENABLED: " true " });
    expect(maslekaEnabled()).toBe(true);
  });
});

describe("tokens and links", () => {
  it("makes 43-character base64url tokens, never the same twice", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("recognises nothing else as a token", () => {
    expect(isToken("A".repeat(42))).toBe(false);
    expect(isToken("A".repeat(42) + "+")).toBe(false);
    expect(isToken(42)).toBe(false);
  });

  it("puts the token in the fragment of the agency's own page", () => {
    expect(maslekaLink("T".repeat(43))).toBe(`https://govari-fin.co.il/masleka#t=${"T".repeat(43)}`);
  });

  it("expires a token thirty days after it is issued", () => {
    expect(tokenExpiry(new Date("2026-10-13T00:00:00Z"))).toBe("2026-11-12T00:00:00.000Z");
  });

  it("accepts a code as pasted, and nothing that cannot be one", () => {
    expect(normalizeCode("  AB12-cd34 ")).toBe("AB12-cd34");
    expect(normalizeCode("abc")).toBeNull();
    expect(normalizeCode("<script>")).toBeNull();
    expect(normalizeCode("A".repeat(65))).toBeNull();
    expect(normalizeCode(1234)).toBeNull();
  });
});

describe("createRequest", () => {
  it("stores the token's hash, never the token, and returns the one link to it", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch((_u, init) => {
      const row = { id: "11111111-1111-4111-8111-111111111111", ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify([row]), { status: 201 });
    });
    const { id, link } = await createRequest({
      clientName: "רונית מזרחי",
      contactEmail: "ronit@example.com",
      leadId: null,
      createdBy: null,
    });
    const token = link.split("#t=")[1];
    const sent = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/masleka_requests`);
    expect(id).toBe("11111111-1111-4111-8111-111111111111");
    expect(sent).toMatchObject({ agency_id: AGENCY_1, client_name: "רונית מזרחי", token_hash: sha(token) });
    expect(String(calls[0].init.body)).not.toContain(token);
  });
});

describe("updateWhere", () => {
  it("patches the rows the query matches and returns them", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response(JSON.stringify([{ id: "x" }]), { status: 200 }));
    const rows = await updateWhere("masleka_requests", "id=eq.x&status=eq.invited&select=id", { status: "expired" });
    expect(rows).toEqual([{ id: "x" }]);
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/masleka_requests?id=eq.x&status=eq.invited&select=id`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.stringify(calls[0].init.headers)).toContain("return=representation");
  });

  it("reports a refusal by status and code only", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response(JSON.stringify({ code: "23514", message: "Failing row contains (secret)" }), { status: 400 }));
    await expect(updateWhere("masleka_requests", "id=eq.x", {})).rejects.toThrow(/^update_http_400:23514$/);
  });
});

describe("authUser", () => {
  it("answers who the token belongs to, asking the auth server with the service key", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response(JSON.stringify({ id: "u1", email: "x@example.com" }), { status: 200 }));
    expect(await authUser("user-token-0123456789")).toEqual({ id: "u1" });
    expect(calls[0].url).toBe(`${SUPABASE_URL}/auth/v1/user`);
    expect(calls[0].init.headers).toMatchObject({ apikey: "service-role-test", Authorization: "Bearer user-token-0123456789" });
  });

  it("answers nobody for a token the auth server refuses", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("{}", { status: 401 }));
    expect(await authUser("stale-token-0123456789")).toBeNull();
  });

  it("throws when the auth server is down, rather than calling it a refusal", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("{}", { status: 503 }));
    await expect(authUser("user-token-0123456789")).rejects.toThrow("auth_http_503");
  });
});

describe("staffCaller", () => {
  const request = (auth?: string) =>
    new Request("https://edge.test/x", { method: "POST", headers: auth ? { authorization: auth } : {} });

  function server(role: unknown) {
    withEnv(BASE_ENV);
    return withFetch((url) => {
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (url.endsWith("/rpc/staff_role")) return new Response(JSON.stringify(role), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
  }

  it("is anonymous without a bearer token, and asks nobody", async () => {
    const calls = server("staff");
    expect(await staffCaller(request())).toEqual({ kind: "anonymous" });
    expect(calls).toHaveLength(0);
  });

  it("is an outsider when the database knows no role for the user", async () => {
    server(null);
    expect(await staffCaller(request("Bearer user-token-0123456789"))).toEqual({ kind: "outsider", userId: "u1" });
  });

  it("is an outsider for a role it does not recognise", async () => {
    server("superuser");
    expect(await staffCaller(request("Bearer user-token-0123456789"))).toEqual({ kind: "outsider", userId: "u1" });
  });

  it("is staff with the role the database gives", async () => {
    server("staff");
    expect(await staffCaller(request("Bearer user-token-0123456789"))).toEqual({ kind: "staff", userId: "u1", role: "staff" });
  });
});

describe("staffRecipients", () => {
  it("mails each staff address once, in lower case, and skips what is not an address", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response(JSON.stringify(["Staff@Example.com", "staff@example.com", "not-an-address"]), { status: 200 }));
    expect(await staffRecipients(vi.fn(), "rid1")).toEqual(["staff@example.com"]);
  });

  it("falls back to Dorit's mailbox when nobody can be read", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("{}", { status: 500 }));
    const log = vi.fn();
    expect(await staffRecipients(log, "rid1")).toEqual(["dorit@govari-fin.co.il"]);
    expect(log).toHaveBeenCalledWith("warn", "staff.lookup_failed", expect.objectContaining({ rid: "rid1" }));
  });

  it("falls back to Dorit's mailbox when the staff list is empty", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("[]", { status: 200 }));
    const log = vi.fn();
    expect(await staffRecipients(log, "rid1")).toEqual(["dorit@govari-fin.co.il"]);
    expect(log).toHaveBeenCalledWith("warn", "staff.none", { rid: "rid1" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/edge-masleka-shared.test.ts`
Expected: FAIL — cannot load `_shared/masleka.ts`.

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/rest.ts` (after `upsertRow`, before `callRpc`):

```ts
/**
 * A conditional update: every row the PostgREST query matches, changed, and
 * returned. The query carries the conditions (`status=eq.invited`, …) and a
 * `select=` naming the columns to return — always name them, or the answer
 * echoes every column, ciphertext included.
 *
 * One statement, so the condition and the change cannot be split by a second
 * request: two submissions of one link cannot both find it `invited`.
 */
export async function updateWhere(
  table: string,
  query: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`update_http_${res.status}${await refusal(res)}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * Who a Supabase session token belongs to, asked of the auth server now.
 *
 * null for a token it refuses (expired, signed out, forged); a throw when it
 * cannot answer, so an outage is a 500 and never mistaken for "not signed in".
 */
export async function authUser(token: string): Promise<{ id: string } | null> {
  const { url, auth } = target();
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: auth.apikey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`auth_http_${res.status}`);
  const user = (await res.json().catch(() => null)) as { id?: unknown } | null;
  return typeof user?.id === 'string' ? { id: user.id } : null;
}
```

Create `supabase/functions/_shared/masleka.ts`:

```ts
/**
 * The clearinghouse request pipeline's shared rules —
 * docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md, PR A.
 *
 * A request starts `invited`, with a link that carries a random token. Only
 * the token's SHA-256 is stored, so the link is the only way to the request
 * and the database cannot rebuild it. The client posts their code and ID
 * through the link (`code_received`), a staff member submits them in the
 * clearinghouse portal and presses הגשתי (`submitted`), and PR B's parser
 * completes it (`completed`).
 *
 * Everything here is dark until `MASLEKA_ENABLED` is exactly "true".
 */
import { sha256Hex } from './guard.ts';
import { insertRow } from './rest.ts';

export const AGENCY_1 = '00000000-0000-0000-0000-000000000001';
/** Where a staff notice goes when no staff address can be read. */
export const AGENCY_MAILBOX = 'dorit@govari-fin.co.il';
/** The agency's own page — never derived from a request's Origin. */
export const MASLEKA_PAGE = 'https://govari-fin.co.il/masleka';
export const MASLEKA_BOARD = 'https://govari-fin.co.il/admin/masleka';

export const TOKEN_TTL_DAYS = 30;
export const CLIENT_REMINDER_DAYS = 7;
export const READY_AFTER_HOURS = 4;
export const DEADLINE_REMINDER_BUSINESS_DAY = 5;
export const CLEARINGHOUSE_RETENTION_BUSINESS_DAYS = 7;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY_MS = 86_400_000;

/** Off unless the secret says exactly "true": a typo leaves it dark, never half on. */
export function maslekaEnabled(): boolean {
  return (Deno.env.get('MASLEKA_ENABLED') || '').trim() === 'true';
}

/** 32 random bytes, base64url — 43 characters, unguessable. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * The link the client opens. The token rides in the fragment, which browsers
 * never send to a server: not to Vercel's request log, not in a Referer, and
 * not in the page_view GA4 sends from index.html before the page can scrub
 * the address bar.
 */
export function maslekaLink(token: string): string {
  return `${MASLEKA_PAGE}#t=${token}`;
}

export function tokenExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + TOKEN_TTL_DAYS * DAY_MS).toISOString();
}

/**
 * A power-of-attorney code as a person would paste it, or null. The
 * clearinghouse's exact format is not published; letters, digits and hyphens,
 * 4 to 64 of them, admit every plausible one and nothing that could carry
 * markup or a link.
 */
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^[A-Za-z0-9-]{4,64}$/.test(code) ? code : null;
}

export interface NewRequest {
  clientName: string;
  contactEmail: string | null;
  leadId: string | null;
  createdBy: string | null;
}

/** A new `invited` request, and the only link that will ever reach it. */
export async function createRequest(input: NewRequest): Promise<{ id: string; link: string }> {
  const token = newToken();
  const row = await insertRow('masleka_requests', {
    agency_id: AGENCY_1,
    lead_id: input.leadId,
    client_name: input.clientName,
    contact_email: input.contactEmail,
    token_hash: await tokenHash(token),
    token_expires_at: tokenExpiry(),
    created_by: input.createdBy,
  });
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) throw new Error('request_returned_no_id');
  return { id, link: maslekaLink(token) };
}
```

Create `supabase/functions/_shared/staff.ts`:

```ts
/**
 * Who is calling a members-only function, and who the staff are.
 *
 * The gateway does not check these callers (`verify_jwt = false`, see
 * config.toml), so every call proves itself here: the bearer token is shown
 * to the auth server, and the role is asked of the database through
 * `staff_role`. Neither the token's claims nor anything the browser says is
 * trusted — a membership removed a minute ago is refused on the next call.
 */
import { isEmail } from './guard.ts';
import type { Log } from './log.ts';
import { AGENCY_MAILBOX } from './masleka.ts';
import { authUser, callRpc } from './rest.ts';

export type StaffRole = 'admin' | 'owner' | 'agent' | 'staff';
const ROLES: readonly string[] = ['admin', 'owner', 'agent', 'staff'];

export type Caller =
  | { kind: 'anonymous' }
  | { kind: 'outsider'; userId: string }
  | { kind: 'staff'; userId: string; role: StaffRole };

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S{20,4096})$/i);
  return match ? match[1] : null;
}

export async function staffCaller(req: Request): Promise<Caller> {
  const token = bearer(req);
  if (!token) return { kind: 'anonymous' };
  const user = await authUser(token);
  if (!user) return { kind: 'anonymous' };
  const role = await callRpc('staff_role', { p_user_id: user.id });
  return typeof role === 'string' && ROLES.includes(role)
    ? { kind: 'staff', userId: user.id, role: role as StaffRole }
    : { kind: 'outsider', userId: user.id };
}

/**
 * Every staff member's address: the profile e-mail of each admin and each
 * agency-1 member (`masleka_staff_emails`). The mailer's own list (MAIL_TO)
 * is not reachable — a rendered message must name its recipient — and the
 * memberships are what "staff" means everywhere else. Dorit's mailbox when
 * the list cannot be read, so a notice is late at worst, never lost.
 */
export async function staffRecipients(log: Log, rid: string): Promise<string[]> {
  try {
    const rows = await callRpc('masleka_staff_emails', {});
    const list = Array.isArray(rows)
      ? [...new Set(rows.filter(isEmail).map((e) => e.toLowerCase()))]
      : [];
    if (list.length) return list;
    log('warn', 'staff.none', { rid });
  } catch (e) {
    log('warn', 'staff.lookup_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  return [AGENCY_MAILBOX];
}
```

Add to `tests/test-plan/01-std-unit.md` before "## 5. Pass criteria" (raise the count by 19):

```markdown
### 4.24 The clearinghouse pipeline's shared Edge modules — `tests/unit/edge-masleka-shared.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKSH-001 | "is off unless MASLEKA_ENABLED is exactly true" | Only `true` (trimmed) turns it on |
| UNIT-MSKSH-002 | "makes 43-character base64url tokens, never the same twice" | Format and uniqueness |
| UNIT-MSKSH-003 | "recognises nothing else as a token" | 42 chars, `+`, numbers refused |
| UNIT-MSKSH-004 | "puts the token in the fragment of the agency's own page" | `https://govari-fin.co.il/masleka#t=…` |
| UNIT-MSKSH-005 | "expires a token thirty days after it is issued" | +30 days |
| UNIT-MSKSH-006 | "accepts a code as pasted, and nothing that cannot be one" | Trimmed; short, markup, 65 chars, numbers refused |
| UNIT-MSKSH-007 | "stores the token's hash, never the token, and returns the one link to it" | Body has `token_hash = sha256(token)` and not the token |
| UNIT-MSKSH-008 | "patches the rows the query matches and returns them" | PATCH, conditions in the URL, `return=representation` |
| UNIT-MSKSH-009 | "reports a refusal by status and code only" | `update_http_400:23514`, no message text |
| UNIT-MSKSH-010 | "answers who the token belongs to, asking the auth server with the service key" | `/auth/v1/user`, apikey + bearer |
| UNIT-MSKSH-011 | "answers nobody for a token the auth server refuses" | `null` on 401 |
| UNIT-MSKSH-012 | "throws when the auth server is down, rather than calling it a refusal" | `auth_http_503` |
| UNIT-MSKSH-013 | "is anonymous without a bearer token, and asks nobody" | No fetch |
| UNIT-MSKSH-014 | "is an outsider when the database knows no role for the user" | `outsider` |
| UNIT-MSKSH-015 | "is an outsider for a role it does not recognise" | `outsider` |
| UNIT-MSKSH-016 | "is staff with the role the database gives" | `staff`, role `staff` |
| UNIT-MSKSH-017 | "mails each staff address once, in lower case, and skips what is not an address" | Deduplicated list |
| UNIT-MSKSH-018 | "falls back to Dorit's mailbox when nobody can be read" | `dorit@govari-fin.co.il`, `staff.lookup_failed` |
| UNIT-MSKSH-019 | "falls back to Dorit's mailbox when the staff list is empty" | `dorit@govari-fin.co.il`, `staff.none` |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/edge-masleka-shared.test.ts && npx vitest run tests/contract/logging.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS; the logging contract still passes (no function imports the new modules yet); Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/masleka.ts supabase/functions/_shared/staff.ts supabase/functions/_shared/rest.ts tests/unit/edge-masleka-shared.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: shared switch, tokens, caller check and conditional updates for the Edge functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 5: The pipeline's mails

**Files:**
- Create: `supabase/functions/_shared/masleka-mail.ts`
- Create: `tests/unit/edge-masleka-mail.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: `buildClientHtml`, `escapeHtml` (html.ts); `greetingName` (guard.ts); `MASLEKA_BOARD` (masleka.ts).
- Produces: `type StaffNoticeKind = 'code_received' | 'ready' | 'deadline'`; `interface BuiltMail { subject: string; html: string; text: string }`; `buildStaffNotice(kind: StaffNoticeKind, clientNames: string[]): BuiltMail`; `buildClientInvite(clientName: string, link: string, reminder?: boolean): BuiltMail`. Neither builder takes the code or the ID, so no mail can carry them.

- [ ] **Step 1: Write the failing test** — `tests/unit/edge-masleka-mail.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildClientInvite, buildStaffNotice } from "../../supabase/functions/_shared/masleka-mail.ts";

const LINK = `https://govari-fin.co.il/masleka#t=${"T".repeat(43)}`;
const hrefHosts = (html: string) => [...html.matchAll(/href="https?:\/\/([^/"]+)/g)].map((m) => m[1]);

describe("staff notices", () => {
  it("names the client in the subject and links the board", () => {
    const mail = buildStaffNotice("code_received", ["רונית מזרחי"]);
    expect(mail.subject).toBe("קוד מסלקה חדש לטיפול — רונית מזרחי");
    expect(mail.html).toContain('href="https://govari-fin.co.il/admin/masleka"');
    expect(mail.text).toContain("https://govari-fin.co.il/admin/masleka");
  });

  it("lists every client in one digest when there are several", () => {
    const mail = buildStaffNotice("ready", ["רונית מזרחי", "יעל כהן"]);
    expect(mail.subject).toBe("יש קבצים להורדה מהמסלקה — 2 לקוחות");
    expect(mail.html).toContain("רונית מזרחי");
    expect(mail.html).toContain("יעל כהן");
    expect(mail.text).toContain("• יעל כהן");
  });

  it("says the deadline plainly", () => {
    expect(buildStaffNotice("deadline", ["יעל כהן"]).subject).toBe("נמחק במסלקה בעוד יומיים — יעל כהן");
  });

  it("escapes a name that is really markup", () => {
    const mail = buildStaffNotice("code_received", ['<img src=x onerror="alert(1)">']);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("keeps a line break in a name out of the subject", () => {
    expect(buildStaffNotice("code_received", ["רונית\nBcc: x@example.com"]).subject).not.toMatch(/\n/);
  });

  it("links only to the agency's own domain", () => {
    for (const kind of ["code_received", "ready", "deadline"] as const) {
      for (const host of hrefHosts(buildStaffNotice(kind, ["א"]).html)) expect(host).toBe("govari-fin.co.il");
    }
  });
});

describe("the client invitation", () => {
  it("carries the personal link in both halves", () => {
    const mail = buildClientInvite("רונית מזרחי", LINK);
    expect(mail.subject).toBe("שליפת נתוני מסלקה — מסירת קוד · דורית גוב ארי");
    expect(mail.html).toContain(LINK);
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain("שלום רונית,");
  });

  it("says a reminder replaces the earlier link", () => {
    const mail = buildClientInvite("רונית מזרחי", LINK, true);
    expect(mail.subject).toBe("תזכורת: מסירת קוד המסלקה · דורית גוב ארי");
    expect(mail.text).toContain("מחליף");
  });

  it("greets without a name that is not a name", () => {
    const mail = buildClientInvite("<a href='https://evil.example'>x</a>", LINK);
    expect(mail.html).toContain("שלום,");
    expect(mail.html).not.toContain("evil.example");
    expect(mail.text).not.toContain("evil.example");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/edge-masleka-mail.test.ts`
Expected: FAIL — cannot load `masleka-mail.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/_shared/masleka-mail.ts`

```ts
/**
 * The clearinghouse pipeline's mails: notices to the staff, and the
 * invitation (or its one reminder) to a client.
 *
 * None of these builders takes the code or the ID number, so no mail can
 * carry them whatever a caller passes. Names are escaped at the binding site,
 * as html.ts does for every visitor-facing letter; the only link a notice
 * carries is the board's, and the only link an invitation carries is the
 * client's own page on the agency's domain.
 */
import { greetingName } from './guard.ts';
import { buildClientHtml, escapeHtml } from './html.ts';
import { MASLEKA_BOARD } from './masleka.ts';

export type StaffNoticeKind = 'code_received' | 'ready' | 'deadline';

export interface BuiltMail {
  subject: string;
  html: string;
  text: string;
}

const NOTICE: Record<StaffNoticeKind, { subject: string; intro: string }> = {
  code_received: {
    subject: 'קוד מסלקה חדש לטיפול',
    intro: 'לקוח מסר קוד ייפוי כוח ומספר זהות. אפשר להגיש את הבקשה בפורטל המסלקה ולסמן "הגשתי" בלוח.',
  },
  ready: {
    subject: 'יש קבצים להורדה מהמסלקה',
    intro: 'עברו 4 שעות מההגשה, והקבצים אמורים להיות מוכנים להורדה בפורטל המסלקה.',
  },
  deadline: {
    subject: 'נמחק במסלקה בעוד יומיים',
    intro: 'הקבצים של הלקוחות האלה יימחקו במסלקה בעוד כיומיים עסקים, ועדיין לא סומנו כמטופלים. יש להוריד אותם לפני כן.',
  },
};

/** One line of plain text: no line break reaches a subject or a list. */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function buildStaffNotice(kind: StaffNoticeKind, clientNames: string[]): BuiltMail {
  const notice = NOTICE[kind];
  const names = clientNames.map(oneLine).filter(Boolean);
  const subject =
    names.length === 1
      ? `${notice.subject} — ${names[0]}`
      : names.length > 1
        ? `${notice.subject} — ${names.length} לקוחות`
        : notice.subject;
  const list = names.length
    ? `<ul style="margin:0 0 16px; padding-right:20px;">${names
        .map((n) => `<li style="margin:0 0 6px;">${escapeHtml(n)}</li>`)
        .join('')}</ul>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:24px; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; direction:rtl; text-align:right;">
  <h1 style="margin:0 0 16px; font-family:Georgia,serif; font-size:22px;">${escapeHtml(notice.subject)}</h1>
  <p style="margin:0 0 16px; font-size:15px; line-height:1.7;">${escapeHtml(notice.intro)}</p>
  ${list}
  <p style="margin:0;"><a href="${MASLEKA_BOARD}" style="color:#7D6B5D;">למסך המסלקה</a></p>
</body>
</html>`;
  const text = [notice.intro, ...names.map((n) => `• ${n}`), `למסך המסלקה: ${MASLEKA_BOARD}`].join('\n');
  return { subject, html, text };
}

export function buildClientInvite(clientName: string, link: string, reminder = false): BuiltMail {
  const firstName = greetingName(clientName);
  const intro = reminder
    ? 'עדיין לא התקבל ממך קוד המסלקה. הקישור כאן מחליף את הקישור הקודם — ההסבר המלא, צעד אחר צעד, מחכה בו.'
    : 'כדי שאוכל לשלוף עבורך תמונת מצב פנסיונית מלאה מהמסלקה הפנסיונית לפני הפגישה, יש להפיק באתר המסלקה קוד ייפוי כוח ולמסור אותו בקישור האישי שלמטה, יחד עם מספר הזהות. ההסבר המלא, צעד אחר צעד, מחכה שם.';
  const html = buildClientHtml({
    firstName,
    eyebrow: reminder ? 'תזכורת' : 'שליפת נתוני מסלקה',
    heading: 'מסירת קוד המסלקה',
    intro,
    panelTitle: 'הקישור האישי שלך',
    details: [
      ['קישור', link],
      ['תוקף', '30 יום מיום ההזמנה'],
    ],
  });
  const hello = firstName ? `שלום ${firstName}, ` : 'שלום, ';
  const text = [
    `${hello}${intro}`,
    `הקישור האישי שלך: ${link}`,
    'לכל שאלה — ניתן להשיב ישירות למייל זה.',
    'בברכה, דורית גוב ארי · dorit@govari-fin.co.il',
  ].join('\n');
  return {
    subject: reminder ? 'תזכורת: מסירת קוד המסלקה · דורית גוב ארי' : 'שליפת נתוני מסלקה — מסירת קוד · דורית גוב ארי',
    html,
    text,
  };
}
```

Add to `tests/test-plan/01-std-unit.md` before "## 5. Pass criteria" (raise the count by 9):

```markdown
### 4.25 The clearinghouse mails — `tests/unit/edge-masleka-mail.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKML-001 | "names the client in the subject and links the board" | Subject with the name; board link in both halves |
| UNIT-MSKML-002 | "lists every client in one digest when there are several" | "— 2 לקוחות"; both names |
| UNIT-MSKML-003 | "says the deadline plainly" | "נמחק במסלקה בעוד יומיים — …" |
| UNIT-MSKML-004 | "escapes a name that is really markup" | `&lt;img`, no `<img` |
| UNIT-MSKML-005 | "keeps a line break in a name out of the subject" | No newline in the subject |
| UNIT-MSKML-006 | "links only to the agency's own domain" | Every href host is `govari-fin.co.il` |
| UNIT-MSKML-007 | "carries the personal link in both halves" | Link in HTML and text; greeting by first name |
| UNIT-MSKML-008 | "says a reminder replaces the earlier link" | Reminder subject; "מחליף" |
| UNIT-MSKML-009 | "greets without a name that is not a name" | "שלום,"; no foreign link |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/edge-masleka-mail.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/masleka-mail.ts tests/unit/edge-masleka-mail.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: staff notices and the client invitation, with no way to carry the code or ID

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 6: The schema — tables, RLS, staff roles, housekeeping, cron

**Files:**
- Create: `supabase/migrations/20261015000000_masleka_requests.sql`
- Create: `supabase/tests/masleka_check.sql`
- Create: `tests/contract/masleka-schema.contract.test.ts`
- Modify: `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: `public.agencies`, `public.memberships`, `public.profiles`, `public.leads`, `public.can_see(uuid)`, `public.is_admin()`, `public.touch_updated_at()`.
- Produces: tables `public.masleka_requests` (columns below), `public.masleka_access_log(id, agency_id, request_id, user_id, field, at)`; functions `public.staff_role(p_user_id uuid) returns text` (service_role only), `public.my_staff_role() returns text` (authenticated), `public.masleka_staff_emails() returns text[]` (service_role), `public.masleka_expire() returns integer`, `public.masleka_wipe_stale() returns integer`, `public.masleka_call_remind() returns void` (service_role; cron runs them as postgres); cron jobs `masleka-housekeeping`, `masleka-remind`.
- Columns of `masleka_requests` the browser may read (exactly): `id, agency_id, lead_id, client_name, contact_email, status, id_last4, token_expires_at, created_at, client_invited_at, client_reminded_at, code_received_at, submitted_at, clearinghouse_deletes_at, completed_at, expired_at, cancelled_at`.

- [ ] **Step 1: Write the failing contract test** — `tests/contract/masleka-schema.contract.test.ts`

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The clearinghouse schema, read as source. `supabase/tests/masleka_check.sql`
 * proves the behaviour against a local Supabase; this runs in CI and fails
 * the moment a grant, a revoke or a guard is edited away.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261015000000_masleka_requests.sql";
const SQL = readFileSync(join(DIR, FILE), "utf8");
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("the clearinghouse migration", () => {
  it("sorts after every migration that came before it", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261013010000_no_public_lead_inserts.sql"));
  });

  it("turns row-level security on for both tables", () => {
    expect(code).toMatch(/alter table public\.masleka_requests\s+enable row level security;/);
    expect(code).toMatch(/alter table public\.masleka_access_log\s+enable row level security;/);
  });

  it("grants anon nothing at all", () => {
    for (const grant of code.match(/grant [^;]+;/gi) ?? []) {
      expect(grant, grant).not.toMatch(/\banon\b/);
    }
  });

  it("lets the browser read neither the ciphertext nor the token hash", () => {
    const grant = code.match(/grant select \(([^)]+)\) on public\.masleka_requests to authenticated;/);
    expect(grant, "no column grant to authenticated").not.toBeNull();
    const columns = grant![1].split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["id", "client_name", "status", "id_last4", "submitted_at"]));
    for (const secret of ["code_ciphertext", "id_ciphertext", "token_hash"]) expect(columns).not.toContain(secret);
    expect(code).not.toMatch(/grant select on public\.masleka_requests to authenticated/);
    expect(code).not.toMatch(/grant (insert|update|delete)[^;]*on public\.masleka_(requests|access_log) to authenticated/);
  });

  it("keeps the service-only functions away from anon and authenticated, by name", () => {
    for (const signature of [
      "staff_role(uuid)",
      "masleka_staff_emails()",
      "masleka_expire()",
      "masleka_wipe_stale()",
      "masleka_call_remind()",
    ]) {
      expect(code).toContain(`revoke execute on function public.${signature} from public, anon, authenticated;`);
    }
    expect(code).toContain("revoke execute on function public.my_staff_role() from public, anon;");
    expect(code).toContain("grant execute on function public.my_staff_role() to authenticated;");
  });

  it("refuses ciphertext outside code_received, in the table itself", () => {
    expect(code).toMatch(/constraint masleka_ciphertext_only_while_waiting check/);
    expect(code).toMatch(/status = 'code_received' and code_received_at is not null/);
  });

  it("wipes at nine days and expires links at thirty", () => {
    expect(code).toContain("interval '9 days'");
    expect(code).toContain("interval '30 days'");
  });

  it("schedules its jobs only where pg_cron and pg_net exist", () => {
    const guard = code.indexOf("pg_available_extensions");
    expect(guard).toBeGreaterThan(-1);
    for (const job of ["'masleka-housekeeping'", "'masleka-remind'"]) {
      const at = code.indexOf(`cron.schedule(${job}`);
      expect(at, `${job} not scheduled`).toBeGreaterThan(guard);
    }
  });

  it("keeps the remind call's address and secret in Vault, not in the migration", () => {
    expect(code).toContain("'masleka_functions_url'");
    expect(code).toContain("'masleka_cron_secret'");
    expect(code).not.toMatch(/supabase\.co|https?:\/\//);
  });

  it("creates no storage bucket — no clearinghouse file is ever uploaded", () => {
    expect(code).not.toMatch(/storage\.buckets/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/contract/masleka-schema.contract.test.ts`
Expected: FAIL — `ENOENT … 20261015000000_masleka_requests.sql`.

- [ ] **Step 3: Implement** — `supabase/migrations/20261015000000_masleka_requests.sql`

```sql
-- Clearinghouse analysis, PR A — the request pipeline.
-- docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md
--
-- A client authorises Dorit at the pension clearinghouse (המסלקה הפנסיונית)
-- and hands over the power-of-attorney code and their ID number through
-- /masleka. Both are stored only as AES-GCM ciphertext made by the Edge
-- Functions with MASLEKA_KEY, which this database never sees. They exist only
-- while the request waits for a staff member to submit it in the
-- clearinghouse portal, and never longer than nine days.
--
-- Ships dark: nothing writes here until MASLEKA_ENABLED is "true" on the
-- functions, so applying this migration changes no behaviour by itself.

-- ── the requests ────────────────────────────────────────────────────────────

create table public.masleka_requests (
  id                       uuid primary key default gen_random_uuid(),
  agency_id                uuid not null default '00000000-0000-0000-0000-000000000001'
                             references public.agencies(id),
  -- Null for a request a staff member made by hand (a lead from the phone).
  lead_id                  uuid references public.leads(id) on delete set null,
  client_name              text not null check (length(btrim(client_name)) between 1 and 80),
  contact_email            text check (contact_email is null or length(contact_email) <= 254),
  -- SHA-256 of the link's token. The token itself is never stored, so the
  -- database cannot rebuild a link; a reminder or a staff member issues a new one.
  token_hash               text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at         timestamptz not null default now() + interval '30 days',
  status                   text not null default 'invited'
                             check (status in ('invited', 'code_received', 'submitted', 'completed', 'expired', 'cancelled')),
  code_ciphertext          text,
  id_ciphertext            text,
  -- Kept after the wipe, with the client's name, so PR B can match a file to a request.
  id_last4                 text check (id_last4 is null or id_last4 ~ '^[0-9]{4}$'),
  created_by               uuid references auth.users(id) on delete set null,
  submitted_by             uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  client_invited_at        timestamptz,
  client_reminded_at       timestamptz,
  code_received_at         timestamptz,
  ciphertext_wiped_at      timestamptz,
  submitted_at             timestamptz,
  -- Business day 7 after submission, when the clearinghouse deletes the download.
  clearinghouse_deletes_at timestamptz,
  ready_reminded_at        timestamptz,
  deadline_reminded_at     timestamptz,
  completed_at             timestamptz,
  expired_at               timestamptz,
  cancelled_at             timestamptz,
  updated_at               timestamptz not null default now(),
  -- Ciphertext exists only while a request waits to be submitted. הגשתי moves
  -- the status and nulls both values in one statement; a write that tried to
  -- move the status and keep either value is refused here, whatever wrote it.
  constraint masleka_ciphertext_only_while_waiting check (
    (code_ciphertext is null and id_ciphertext is null)
    or (status = 'code_received' and code_received_at is not null)
  )
);

create index masleka_requests_agency_status on public.masleka_requests (agency_id, status);

create trigger masleka_requests_touch before update on public.masleka_requests
  for each row execute function public.touch_updated_at();

-- Who revealed which value of which request, and when. user_id has no foreign
-- key on purpose: an audit row outlives the account it names.
create table public.masleka_access_log (
  id         bigint generated always as identity primary key,
  agency_id  uuid not null default '00000000-0000-0000-0000-000000000001'
               references public.agencies(id),
  request_id uuid not null references public.masleka_requests(id) on delete cascade,
  user_id    uuid not null,
  field      text not null check (field in ('id', 'code')),
  at         timestamptz not null default now()
);

create index masleka_access_log_request on public.masleka_access_log (request_id);

-- ── row-level security and grants ───────────────────────────────────────────

alter table public.masleka_requests   enable row level security;
alter table public.masleka_access_log enable row level security;

create policy masleka_requests_read_member on public.masleka_requests
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());
create policy masleka_access_log_read_member on public.masleka_access_log
  for select to authenticated using (public.can_see(agency_id) or public.is_admin());

-- Every write goes through an Edge Function holding the service key; the
-- browser reads, and reads only the columns below. The ciphertext and the
-- token hash are not among them: a member's session that leaked would still
-- not carry them out.
revoke all on public.masleka_requests, public.masleka_access_log from anon, authenticated;
grant select (id, agency_id, lead_id, client_name, contact_email, status, id_last4, token_expires_at, created_at, client_invited_at, client_reminded_at, code_received_at, submitted_at, clearinghouse_deletes_at, completed_at, expired_at, cancelled_at) on public.masleka_requests to authenticated;
grant select on public.masleka_access_log to authenticated;
grant select, insert, update on public.masleka_requests to service_role;
grant select, insert on public.masleka_access_log to service_role;

-- ── staff ───────────────────────────────────────────────────────────────────

-- Staff are a platform admin or a member of agency 1, in any role. The Edge
-- Functions ask this on every call, so a membership deleted a minute ago is
-- refused on the next one. memberships is revoked from service_role, hence
-- security definer.
create function public.staff_role(p_user_id uuid) returns text
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select case
    when exists (select 1 from public.profiles where id = p_user_id and role = 'admin') then 'admin'
    else (select m.role from public.memberships m
           where m.user_id = p_user_id
             and m.agency_id = '00000000-0000-0000-0000-000000000001')
  end;
$$;

-- The browser's question: which screens to offer. Decides nothing — RLS and
-- the functions decide.
create function public.my_staff_role() returns text
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select public.staff_role(auth.uid());
$$;

-- Every staff member's address, for the pipeline's notices.
create function public.masleka_staff_emails() returns text[]
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(p.email)), '{}')
    from public.profiles p
   where p.email is not null and p.email <> ''
     and (p.role = 'admin'
          or exists (select 1 from public.memberships m
                      where m.user_id = p.id
                        and m.agency_id = '00000000-0000-0000-0000-000000000001'));
$$;

-- ── housekeeping ────────────────────────────────────────────────────────────

-- An unused link expires at 30 days; a submission whose download the
-- clearinghouse deleted two weeks ago is no longer waiting for anything.
create function public.masleka_expire() returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  changed integer;
begin
  update public.masleka_requests
     set status = 'expired', expired_at = now()
   where (status = 'invited' and token_expires_at <= now())
      or (status = 'submitted' and clearinghouse_deletes_at <= now() - interval '14 days');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- The hard limit: no ciphertext older than nine days, whatever its status.
-- A request still waiting with its values wiped cannot be submitted, so it
-- expires with them; staff send a fresh link.
create function public.masleka_wipe_stale() returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  changed integer;
begin
  update public.masleka_requests
     set code_ciphertext = null,
         id_ciphertext = null,
         ciphertext_wiped_at = now(),
         status = case when status = 'code_received' then 'expired' else status end,
         expired_at = case when status = 'code_received' then now() else expired_at end
   where (code_ciphertext is not null or id_ciphertext is not null)
     and coalesce(code_received_at, created_at) <= now() - interval '9 days';
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- The hourly reminder run: one POST to masleka-remind with the shared secret.
-- The address and the secret live in Vault (names below), never in a
-- migration; until both are set this does nothing, quietly.
create function public.masleka_call_remind() returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  base_url text;
  secret   text;
begin
  begin
    select decrypted_secret into base_url from vault.decrypted_secrets where name = 'masleka_functions_url';
    select decrypted_secret into secret   from vault.decrypted_secrets where name = 'masleka_cron_secret';
  exception when undefined_table or invalid_schema_name then
    return;
  end;
  if base_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/masleka-remind',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-masleka-cron', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so `from public` alone would leave these open (A-69).
revoke execute on function public.staff_role(uuid) from public, anon, authenticated;
revoke execute on function public.masleka_staff_emails() from public, anon, authenticated;
revoke execute on function public.masleka_expire() from public, anon, authenticated;
revoke execute on function public.masleka_wipe_stale() from public, anon, authenticated;
revoke execute on function public.masleka_call_remind() from public, anon, authenticated;
revoke execute on function public.my_staff_role() from public, anon;
grant execute on function public.staff_role(uuid) to service_role;
grant execute on function public.masleka_staff_emails() to service_role;
grant execute on function public.masleka_expire() to service_role;
grant execute on function public.masleka_wipe_stale() to service_role;
grant execute on function public.masleka_call_remind() to service_role;
grant execute on function public.my_staff_role() to authenticated;

-- ── schedules ───────────────────────────────────────────────────────────────

-- Hourly rather than nightly: the nine-day wipe is then never more than an
-- hour late. Guarded, so a database without pg_cron (or pg_net) still takes
-- the migration; the functions above can be called by hand there, and
-- supabase/tests/masleka_check.sql calls them directly.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('masleka-housekeeping', '5 * * * *', 'select public.masleka_wipe_stale(); select public.masleka_expire();');
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net with schema extensions;
      perform cron.schedule('masleka-remind', '20 * * * *', 'select public.masleka_call_remind();');
    else
      raise notice 'pg_net is not available: masleka reminders are not scheduled';
    end if;
  else
    raise notice 'pg_cron is not available: masleka housekeeping and reminders are not scheduled';
  end if;
end
$do$;
```

Create `supabase/tests/masleka_check.sql`:

```sql
-- The clearinghouse pipeline's gate, against a local `supabase start`, in the
-- style of agency_isolation_check.sql: every block raises on a wrong answer,
-- so a clean run is the assertion. Synthetic fixtures only; rolled back.
\set ON_ERROR_STOP on
begin;

insert into public.agencies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'סוכנות ב׳', 'active');

-- A staff member of agency 1, a signed-in outsider, a platform admin, and a
-- member of agency 2.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000001','authenticated','authenticated','masleka-staff@example.com'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000002','authenticated','authenticated','masleka-outsider@example.com'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000003','authenticated','authenticated','masleka-admin@example.com'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000004','authenticated','authenticated','masleka-other-agency@example.com');

insert into public.memberships (user_id, agency_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'staff'),
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'owner');
update public.profiles set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000003';

-- Six requests, as the table owner: invited, invited and expired, a code ten
-- days old, a code two days old, a submission long past the clearinghouse's
-- deletion, and one of agency 2.
insert into public.masleka_requests (id, client_name, token_hash, status, token_expires_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'לקוח מוזמן', repeat('a', 64), 'invited', now() + interval '20 days'),
  ('cccccccc-0000-0000-0000-000000000002', 'לקוח שפג תוקפו', repeat('b', 64), 'invited', now() - interval '1 hour');
insert into public.masleka_requests (id, client_name, token_hash, status, code_ciphertext, id_ciphertext, id_last4, code_received_at) values
  ('cccccccc-0000-0000-0000-000000000003', 'לקוח ישן', repeat('c', 64), 'code_received', 'sealed-code', 'sealed-id', '0018', now() - interval '10 days'),
  ('cccccccc-0000-0000-0000-000000000004', 'לקוח טרי', repeat('d', 64), 'code_received', 'sealed-code', 'sealed-id', '0026', now() - interval '2 days');
insert into public.masleka_requests (id, client_name, token_hash, status, submitted_at, clearinghouse_deletes_at) values
  ('cccccccc-0000-0000-0000-000000000005', 'לקוח שהוגש מזמן', repeat('e', 64), 'submitted', now() - interval '40 days', now() - interval '20 days');
insert into public.masleka_requests (id, agency_id, client_name, token_hash) values
  ('cccccccc-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000002', 'לקוח של סוכנות ב׳', repeat('f', 64));
insert into public.masleka_access_log (request_id, user_id, field) values
  ('cccccccc-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000001', 'id');

-- ── anon: nothing ───────────────────────────────────────────────────────────
set local role anon;
do $$ begin
  begin
    perform count(id) from public.masleka_requests;
    raise exception 'anon read masleka_requests';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(id) from public.masleka_access_log;
    raise exception 'anon read masleka_access_log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.my_staff_role();
    raise exception 'anon called my_staff_role';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── a signed-in outsider: no rows, no role ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 0 then
    raise exception 'an outsider read clearinghouse requests';
  end if;
  if (select count(id) from public.masleka_access_log) <> 0 then
    raise exception 'an outsider read the access log';
  end if;
  if public.my_staff_role() is not null then
    raise exception 'an outsider has a staff role';
  end if;
  begin
    perform public.staff_role('dddddddd-0000-0000-0000-000000000001');
    raise exception 'authenticated called staff_role directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.masleka_staff_emails();
    raise exception 'authenticated read the staff addresses';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.masleka_wipe_stale();
    raise exception 'authenticated ran the wipe';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── the agency-1 staff member: their agency's rows, never the secrets ───────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 5 then
    raise exception 'staff member does not see exactly agency 1''s five requests';
  end if;
  if (select count(id) from public.masleka_access_log) <> 1 then
    raise exception 'staff member cannot read the access log';
  end if;
  if public.my_staff_role() is distinct from 'staff' then
    raise exception 'staff member''s role is not staff';
  end if;
  begin
    perform code_ciphertext from public.masleka_requests limit 1;
    raise exception 'staff member read code_ciphertext through the Data API role';
  exception when insufficient_privilege then null;
  end;
  begin
    perform id_ciphertext from public.masleka_requests limit 1;
    raise exception 'staff member read id_ciphertext';
  exception when insufficient_privilege then null;
  end;
  begin
    perform token_hash from public.masleka_requests limit 1;
    raise exception 'staff member read token_hash';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.masleka_requests set status = 'cancelled' where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'staff member wrote a request directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.masleka_requests (client_name, token_hash) values ('מזויף', repeat('9', 64));
    raise exception 'staff member inserted a request directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── a member of agency 2: only their own agency's row ──────────────────────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 1 then
    raise exception 'agency 2 member does not see exactly their own request';
  end if;
  if public.my_staff_role() is not null then
    raise exception 'agency 2 member counts as agency 1 staff';
  end if;
end $$;

-- ── the platform admin: everything ─────────────────────────────────────────
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(id) from public.masleka_requests) <> 6 then
    raise exception 'platform admin cannot read every request';
  end if;
  if public.my_staff_role() is distinct from 'admin' then
    raise exception 'platform admin''s role is not admin';
  end if;
end $$;
reset role;

-- ── the staff mailing list ─────────────────────────────────────────────────
do $$
declare
  list text[] := public.masleka_staff_emails();
begin
  if not (list @> array['masleka-staff@example.com', 'masleka-admin@example.com']) then
    raise exception 'staff addresses miss the member or the admin: %', list;
  end if;
  if 'masleka-outsider@example.com' = any(list) or 'masleka-other-agency@example.com' = any(list) then
    raise exception 'staff addresses include someone who is not staff: %', list;
  end if;
end $$;

-- ── ciphertext outside code_received is refused by the table ───────────────
do $$ begin
  begin
    update public.masleka_requests set status = 'submitted' where id = 'cccccccc-0000-0000-0000-000000000004';
    raise exception 'a request moved to submitted while still holding ciphertext';
  exception when check_violation then null;
  end;
end $$;

-- ── the nine-day wipe ───────────────────────────────────────────────────────
do $$ begin
  if public.masleka_wipe_stale() <> 1 then
    raise exception 'the wipe did not touch exactly the one stale request';
  end if;
  if exists (select 1 from public.masleka_requests
              where id = 'cccccccc-0000-0000-0000-000000000003'
                and (code_ciphertext is not null or id_ciphertext is not null or status <> 'expired' or ciphertext_wiped_at is null)) then
    raise exception 'the stale request kept its ciphertext or its status';
  end if;
  if not exists (select 1 from public.masleka_requests
                  where id = 'cccccccc-0000-0000-0000-000000000004'
                    and code_ciphertext is not null and status = 'code_received') then
    raise exception 'the wipe touched a request only two days old';
  end if;
  if public.masleka_wipe_stale() <> 0 then
    raise exception 'a second wipe found something to do';
  end if;
end $$;

-- ── expiry ─────────────────────────────────────────────────────────────────
do $$ begin
  if public.masleka_expire() <> 2 then
    raise exception 'expiry did not touch exactly the expired link and the long-gone submission';
  end if;
  if (select status from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000002') <> 'expired' then
    raise exception 'an expired link stayed invited';
  end if;
  if (select status from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000005') <> 'expired' then
    raise exception 'a submission two weeks past the clearinghouse''s deletion stayed submitted';
  end if;
  if (select status from public.masleka_requests where id = 'cccccccc-0000-0000-0000-000000000001') <> 'invited' then
    raise exception 'expiry touched a link that is still valid';
  end if;
end $$;

-- ── the remind call does nothing without its Vault secrets ─────────────────
do $$ begin
  perform public.masleka_call_remind();
end $$;

-- ── the schedules, where pg_cron exists ────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'masleka-housekeeping') then
      raise exception 'masleka-housekeeping is not scheduled';
    end if;
    if exists (select 1 from pg_extension where extname = 'pg_net')
       and not exists (select 1 from cron.job where jobname = 'masleka-remind') then
      raise exception 'masleka-remind is not scheduled';
    end if;
  end if;
end $$;

rollback;
```

Add to `tests/test-plan/03-std-contract.md`, as a new section before "## 5. Runtime counterpart" (raise the count in "## 6. Pass criteria" by 10):

```markdown
### 4.8 The clearinghouse schema — `masleka-schema.contract.test.ts`

Reads `supabase/migrations/20261015000000_masleka_requests.sql`. The behaviour
itself is proved by `supabase/tests/masleka_check.sql` against a local
`supabase start` (manual, like the other SQL checks):
`supabase start && supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/masleka_check.sql`.

| ID | Title | Expected result |
|---|---|---|
| CTR-MSK-001 | "sorts after every migration that came before it" | After `20261013010000_no_public_lead_inserts.sql` |
| CTR-MSK-002 | "turns row-level security on for both tables" | Both `enable row level security` |
| CTR-MSK-003 | "grants anon nothing at all" | No grant names `anon` |
| CTR-MSK-004 | "lets the browser read neither the ciphertext nor the token hash" | Column grant without `code_ciphertext`, `id_ciphertext`, `token_hash`; no table-wide select; no writes |
| CTR-MSK-005 | "keeps the service-only functions away from anon and authenticated, by name" | Five revokes `from public, anon, authenticated`; `my_staff_role` to authenticated only |
| CTR-MSK-006 | "refuses ciphertext outside code_received, in the table itself" | The check constraint |
| CTR-MSK-007 | "wipes at nine days and expires links at thirty" | Both intervals present |
| CTR-MSK-008 | "schedules its jobs only where pg_cron and pg_net exist" | Both `cron.schedule` calls after the `pg_available_extensions` guard |
| CTR-MSK-009 | "keeps the remind call's address and secret in Vault, not in the migration" | Vault names present; no URL |
| CTR-MSK-010 | "creates no storage bucket — no clearinghouse file is ever uploaded" | No `storage.buckets` |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/contract/masleka-schema.contract.test.ts`
Expected: PASS (10 tests).

Then, with Docker available, the behaviour check:
Run: `supabase start && supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/masleka_check.sql`
Expected: the script ends with `ROLLBACK` and no `ERROR`. (If Docker is not available in the worktree, record that in the PR description; the check must be run before the migration is applied to production.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261015000000_masleka_requests.sql supabase/tests/masleka_check.sql tests/contract/masleka-schema.contract.test.ts tests/test-plan/03-std-contract.md
git commit -m "masleka: requests and access log behind agency RLS, ciphertext columns closed to the browser, hourly wipe and expiry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 7: `masleka-code` — the client hands over the code (and the test harness learns the new tables)

**Files:**
- Modify: `tests/helpers/edge-function.ts`
- Create: `supabase/functions/masleka-code/handler.ts`
- Create: `supabase/functions/masleka-code/index.ts`
- Modify: `supabase/config.toml`
- Modify: `tests/contract/edge-functions.contract.test.ts`
- Create: `tests/integration/masleka-code.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: `maslekaEnabled`, `isToken`, `tokenHash`, `normalizeCode` (masleka.ts); `normalizeIsraeliId` (israeli-id.ts); `seal`, `sealKeyFromEnv` (seal.ts); `updateWhere` (rest.ts); `withinLimit`, `clientIp`, `sha256Hex` (guard.ts); `staffRecipients` (staff.ts); `buildStaffNotice` (masleka-mail.ts); `sendMail` (mail.ts).
- Produces: `POST /functions/v1/masleka-code` with body `{ token: string, code: string, idNumber: string }`. Answers: `200 { ok: true, rid }`; `404 { error: 'disabled' | 'link_invalid', rid }`; `400 { error: 'bad_id' | 'bad_code', rid }`; `429 { error: 'rate_limited', rid }`; `503 { error: 'unavailable', rid }`; `500 { error: 'failed', rid }`.
- Produces (harness): `EdgeOptions.masleka?: MaslekaFake` and `EdgeInvocation.maslekaRequests`, `EdgeInvocation.accessLog`, `EdgeInvocation.requestPatches`.

- [ ] **Step 1: Extend the harness** — `tests/helpers/edge-function.ts`

(a) Above `export interface EdgeOptions`, add:

```ts
/** The clearinghouse tables, Supabase Auth and the staff RPCs, for the masleka functions. */
export interface MaslekaFake {
  /** Rows of `masleka_requests` as stored (copied; read the result's `maslekaRequests`). */
  requests?: Record<string, unknown>[];
  /** Bearer token → the user id `GET /auth/v1/user` answers; any other token is a 401. */
  sessions?: Record<string, string>;
  /** User id → what `staff_role` answers; absent means null (no membership). */
  roles?: Record<string, string | null>;
  /** What `masleka_staff_emails` answers. */
  staffEmails?: string[];
  /** `masleka_staff_emails` answers 500. */
  failStaffEmails?: boolean;
  /** Inserts into `masleka_access_log` answer 500. */
  failAccessLog?: boolean;
  /** Inserts into and updates of `masleka_requests` answer 500. */
  failRequestWrite?: boolean;
}
```

(b) In `EdgeOptions`, add the member:

```ts
  /** The clearinghouse fakes — see MaslekaFake. */
  masleka?: MaslekaFake;
```

(c) In `EdgeInvocation`, add:

```ts
  /** `masleka_requests` after the call, every write applied. */
  maslekaRequests: Record<string, unknown>[];
  /** Rows written to `masleka_access_log`. */
  accessLog: Record<string, unknown>[];
  /** Each PATCH to `masleka_requests`: its query string and the fields it set. */
  requestPatches: { query: string; fields: Record<string, unknown> }[];
```

(d) Above `export async function invokeEdge`, add the PostgREST emulation:

```ts
/**
 * Whether a row satisfies a PostgREST filter string — the operators the
 * masleka functions use, and nothing else: an unknown one throws, so a
 * function that starts filtering differently fails its tests instead of
 * matching everything.
 */
function postgrestMatch(row: Record<string, unknown>, q: URLSearchParams): boolean {
  for (const [column, raw] of q.entries()) {
    if (["select", "order", "limit", "on_conflict"].includes(column)) continue;
    const value = row[column];
    if (raw === "is.null") {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (raw === "not.is.null") {
      if (value === null || value === undefined) return false;
      continue;
    }
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const operand = raw.slice(dot + 1);
    const compare = () => {
      const a = Date.parse(String(value));
      const b = Date.parse(operand);
      return Number.isNaN(a) || Number.isNaN(b) ? String(value ?? "").localeCompare(operand) : a - b;
    };
    if (op === "eq") {
      if (String(value) !== operand) return false;
    } else if (op === "in") {
      if (!operand.replace(/^\(|\)$/g, "").split(",").includes(String(value))) return false;
    } else if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
      if (value === null || value === undefined) return false;
      const c = compare();
      const ok = op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
      if (!ok) return false;
    } else {
      throw new Error(`unsupported PostgREST filter in an Edge Function test: ${column}=${raw}`);
    }
  }
  return true;
}

/** A row cut down to `select=a,b,c`, as PostgREST answers it. */
function postgrestProject(row: Record<string, unknown>, select: string | null): Record<string, unknown> {
  if (!select || select === "*") return { ...row };
  return Object.fromEntries(select.split(",").map((c) => [c, row[c] ?? null]));
}
```

(e) Inside `invokeEdge`, right after the `const stored = …` line, add:

```ts
  const masleka = options.masleka ?? {};
  const maslekaRequests: Record<string, unknown>[] = (masleka.requests ?? []).map((r) => ({ ...r }));
  const accessLog: Record<string, unknown>[] = [];
  const requestPatches: { query: string; fields: Record<string, unknown> }[] = [];
```

(f) Inside `fetchImpl`, immediately before the final `throw new Error(\`unexpected fetch in an Edge Function test: …\`)`, add:

```ts
    if (u === `${SUPABASE_URL}/auth/v1/user` && method === "GET") {
      const header = String((init.headers as Record<string, string> | undefined)?.Authorization ?? "");
      const userId = masleka.sessions?.[header.replace(/^Bearer /, "")];
      return userId
        ? new Response(JSON.stringify({ id: userId, aud: "authenticated" }), { status: 200 })
        : new Response('{"msg":"invalid JWT"}', { status: 401 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/staff_role` && method === "POST") {
      return new Response(JSON.stringify(masleka.roles?.[parsed.p_user_id] ?? null), { status: 200 });
    }
    if (u === `${SUPABASE_URL}/rest/v1/rpc/masleka_staff_emails` && method === "POST") {
      if (masleka.failStaffEmails) return new Response('{"message":"simulated"}', { status: 500 });
      return new Response(JSON.stringify(masleka.staffEmails ?? []), { status: 200 });
    }
    const requestsUrl = `${SUPABASE_URL}/rest/v1/masleka_requests`;
    if (u === requestsUrl && method === "POST") {
      if (masleka.failRequestWrite) return new Response('{"message":"simulated"}', { status: 500 });
      const row: Record<string, unknown> = {
        id: `22222222-2222-4222-8222-${String(maslekaRequests.length + 1).padStart(12, "0")}`,
        status: "invited",
        created_at: new Date().toISOString(),
        code_ciphertext: null,
        id_ciphertext: null,
        client_invited_at: null,
        client_reminded_at: null,
        ...parsed,
      };
      maslekaRequests.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (u.startsWith(`${requestsUrl}?`)) {
      const query = u.split("?")[1];
      const q = new URLSearchParams(query);
      if (method === "GET") {
        const rows = maslekaRequests.filter((r) => postgrestMatch(r, q)).map((r) => postgrestProject(r, q.get("select")));
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (method === "PATCH") {
        if (masleka.failRequestWrite) return new Response('{"message":"simulated"}', { status: 500 });
        requestPatches.push({ query, fields: parsed });
        const hit = maslekaRequests.filter((r) => postgrestMatch(r, q));
        for (const r of hit) Object.assign(r, parsed);
        const representation = /return=representation/.test(JSON.stringify(init.headers ?? {}));
        return representation
          ? new Response(JSON.stringify(hit.map((r) => postgrestProject(r, q.get("select")))), { status: 200 })
          : new Response(null, { status: 204 });
      }
    }
    if (u === `${SUPABASE_URL}/rest/v1/masleka_access_log` && method === "POST") {
      if (masleka.failAccessLog) return new Response('{"message":"simulated"}', { status: 500 });
      const row = { id: accessLog.length + 1, at: new Date().toISOString(), ...parsed };
      accessLog.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
```

(g) In the returned object, after `sheetRows,`, add:

```ts
    maslekaRequests,
    accessLog,
    requestPatches,
```

- [ ] **Step 2: Write the failing test** — `tests/integration/masleka-code.integration.test.ts`

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";
import { importSealKey, unseal } from "../../supabase/functions/_shared/seal.ts";

/**
 * The public door: a client's link, their code and their ID. Every value
 * here is synthetic; 000000018 is built from the check-digit rule.
 */
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ON = { MASLEKA_ENABLED: "true", MASLEKA_KEY: KEY };
const TOKEN = "Ab3_-".repeat(8) + "xyz";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const invited = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  agency_id: AGENCY_1,
  client_name: "רונית מזרחי",
  contact_email: "ronit@example.com",
  token_hash: sha(TOKEN),
  token_expires_at: FUTURE,
  status: "invited",
  code_ciphertext: null,
  id_ciphertext: null,
  id_last4: null,
  code_received_at: null,
  ...over,
});
const body = { token: TOKEN, code: "AB12-CD34", idNumber: "000000018" };

function run(b: unknown, o: EdgeOptions & { fake?: MaslekaFake } = {}) {
  const { fake, ...rest } = o;
  return invokeEdge("masleka-code", b, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: { "x-forwarded-for": "203.0.113.7", ...(rest.headers ?? {}) },
    masleka: { requests: [invited()], staffEmails: ["dorit@govari-fin.co.il", "staff@example.com"], ...fake },
  });
}

const open = async (value: unknown) => unseal(await importSealKey(KEY), String(value));

describe("masleka-code — dark by default", () => {
  it("answers disabled and touches nothing while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-code", body, { masleka: { requests: [invited()] } });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "disabled" });
    expect(r.callsTo("/rest/v1/")).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });
});

describe("masleka-code — the code arrives", () => {
  it("stores both values sealed and moves the request to code_received", async () => {
    const r = await run(body);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["ok", "rid"]);
    const row = r.maslekaRequests[0];
    expect(row.status).toBe("code_received");
    expect(row.id_last4).toBe("0018");
    expect(row.code_received_at).toEqual(expect.any(String));
    expect(await open(row.code_ciphertext)).toBe("AB12-CD34");
    expect(await open(row.id_ciphertext)).toBe("000000018");
  });

  it("pads a short ID before sealing it", async () => {
    const r = await run({ ...body, idNumber: "00018" });
    expect(await open(r.maslekaRequests[0].id_ciphertext)).toBe("000000018");
  });

  it("never echoes the code or the ID — not in the answer, not in any mail", async () => {
    const r = await run(body);
    const everything = JSON.stringify(r.json) + r.emails.map((e) => `${e.subject}${e.html}${e.text}`).join("");
    expect(everything).not.toContain("AB12-CD34");
    expect(everything).not.toContain("000000018");
  });

  it("tells every staff member, once each", async () => {
    const r = await run(body);
    expect(r.emails.map((e) => e.to).sort()).toEqual(["dorit@govari-fin.co.il", "staff@example.com"]);
    expect(r.mailTo("staff@example.com").subject).toBe("קוד מסלקה חדש לטיפול — רונית מזרחי");
  });

  it("falls back to Dorit's mailbox when the staff list cannot be read, and still accepts the code", async () => {
    const r = await run(body, { fake: { failStaffEmails: true } });
    expect(r.status).toBe(200);
    expect(r.emails.map((e) => e.to)).toEqual(["dorit@govari-fin.co.il"]);
  });
});

describe("masleka-code — links that no longer admit", () => {
  it("a second submission of the same link is refused and changes nothing", async () => {
    const first = await run(body);
    const second = await run({ ...body, code: "ZZ99-ZZ99" }, { fake: { requests: first.maslekaRequests } });
    expect(second.status).toBe(404);
    expect(second.json).toMatchObject({ error: "link_invalid" });
    expect(await open(second.maslekaRequests[0].code_ciphertext)).toBe("AB12-CD34");
    expect(second.emails).toHaveLength(0);
  });

  it("refuses an expired link", async () => {
    const r = await run(body, { fake: { requests: [invited({ token_expires_at: PAST })] } });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "link_invalid" });
    expect(r.maslekaRequests[0].status).toBe("invited");
    expect(r.maslekaRequests[0].code_ciphertext).toBeNull();
  });

  it("refuses a link whose request was already submitted", async () => {
    const r = await run(body, { fake: { requests: [invited({ status: "submitted" })] } });
    expect(r.json).toMatchObject({ error: "link_invalid" });
  });

  it("refuses a well-formed token nobody issued", async () => {
    const r = await run({ ...body, token: "Z".repeat(43) });
    expect(r.json).toMatchObject({ error: "link_invalid" });
    expect(r.maslekaRequests[0].status).toBe("invited");
  });

  it("refuses a malformed token without asking the database", async () => {
    const r = await run({ ...body, token: "short" });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "link_invalid" });
    expect(r.requestPatches).toHaveLength(0);
  });
});

describe("masleka-code — bad input and floods", () => {
  it("refuses an ID that fails the check digit, before storing anything", async () => {
    const r = await run({ ...body, idNumber: "000000019" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "bad_id" });
    expect(r.requestPatches).toHaveLength(0);
  });

  it("refuses a code that cannot be one", async () => {
    const r = await run({ ...body, code: "<b>" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "bad_code" });
    expect(r.requestPatches).toHaveLength(0);
  });

  it("answers a non-JSON body as a bad link", async () => {
    const r = await run(undefined, { rawBody: "not json" });
    expect(r.json).toMatchObject({ error: "link_invalid" });
  });

  it("refuses a flood from one address", async () => {
    const r = await run(body, { overLimit: ["masleka-ip:"] });
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ error: "rate_limited" });
    expect(r.requestPatches).toHaveLength(0);
  });

  it("refuses a flood on one link", async () => {
    const r = await run(body, { overLimit: ["masleka-link:"] });
    expect(r.status).toBe(429);
    expect(r.requestPatches).toHaveLength(0);
  });
});

describe("masleka-code — when something is missing or down", () => {
  it("stores nothing when there is no key to seal with", async () => {
    const r = await run(body, { envPatch: { MASLEKA_KEY: null } });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: "unavailable" });
    expect(r.requestPatches).toHaveLength(0);
  });

  it("reports a database failure with its rid and nothing else", async () => {
    const r = await run(body, { fake: { failRequestWrite: true } });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "failed", rid: expect.any(String) });
    expect(r.emails).toHaveLength(0);
  });

  it("answers the browser's preflight and does nothing else", async () => {
    const r = await run(undefined, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.fetches).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/integration/masleka-code.integration.test.ts`
Expected: FAIL — esbuild cannot resolve `supabase/functions/masleka-code/handler.ts`.

- [ ] **Step 4: Implement** — `supabase/functions/masleka-code/handler.ts`

```ts
/**
 * The client's half of the clearinghouse request: the link's token, their
 * power-of-attorney code and their ID number.
 *
 * Public, like the forms: the token is what admits a caller, and it admits
 * once — the acceptance is one conditional update on `status = 'invited'`
 * and an unexpired link, so a replay, a double click or a second tab finds
 * nothing to change. The ID is checked against its check digit, both values
 * are sealed with MASLEKA_KEY before they leave this function, and every
 * staff member is told a code is waiting. Neither value is ever logged,
 * mailed or returned.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { clientIp, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { normalizeIsraeliId } from '../_shared/israeli-id.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { buildStaffNotice } from '../_shared/masleka-mail.ts';
import { isToken, maslekaEnabled, normalizeCode, tokenHash } from '../_shared/masleka.ts';
import { updateWhere } from '../_shared/rest.ts';
import { seal, sealKeyFromEnv } from '../_shared/seal.ts';
import { staffRecipients } from '../_shared/staff.ts';

const FN = 'masleka-code';
const log = createLog(FN);
const PER_IP_PER_HOUR = 10;
const PER_LINK_PER_HOUR = 5;

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const ip = clientIp(req);
    if (ip && !(await withinLimit(log, rid, `masleka-ip:${await sha256Hex(ip)}`, 3600, PER_IP_PER_HOUR))) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited_ip' });
      return Response.json({ error: 'rate_limited', rid }, { status: 429, headers: cors });
    }

    const token = input?.token;
    if (!isToken(token)) {
      log('warn', 'request.rejected', { rid, reason: 'malformed_token' });
      return Response.json({ error: 'link_invalid', rid }, { status: 404, headers: cors });
    }
    const hash = await tokenHash(token);
    if (!(await withinLimit(log, rid, `masleka-link:${hash}`, 3600, PER_LINK_PER_HOUR))) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited_link' });
      return Response.json({ error: 'rate_limited', rid }, { status: 429, headers: cors });
    }

    const idNumber = normalizeIsraeliId(input?.idNumber);
    if (!idNumber) {
      log('warn', 'request.rejected', { rid, reason: 'bad_id' });
      return Response.json({ error: 'bad_id', rid }, { status: 400, headers: cors });
    }
    const code = normalizeCode(input?.code);
    if (!code) {
      log('warn', 'request.rejected', { rid, reason: 'bad_code' });
      return Response.json({ error: 'bad_code', rid }, { status: 400, headers: cors });
    }

    const key = await sealKeyFromEnv();
    if (!key) {
      log('error', 'seal.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503, headers: cors });
    }

    const now = new Date().toISOString();
    const rows = await updateWhere(
      'masleka_requests',
      `token_hash=eq.${hash}&status=eq.invited&token_expires_at=gt.${encodeURIComponent(now)}&select=id,client_name`,
      {
        status: 'code_received',
        code_ciphertext: await seal(key, code),
        id_ciphertext: await seal(key, idNumber),
        id_last4: idNumber.slice(-4),
        code_received_at: now,
      },
    );
    if (!rows.length) {
      // Unknown, used, rotated and expired links all look the same from here,
      // on purpose: the answer says nothing about which.
      log('warn', 'request.rejected', { rid, reason: 'link_invalid' });
      return Response.json({ error: 'link_invalid', rid }, { status: 404, headers: cors });
    }
    const requestId = String(rows[0].id);
    log('info', 'masleka.code_received', { rid, requestId });

    // The notice is best-effort: the code is stored, and the board shows it
    // whether or not a mail went out.
    const notice = buildStaffNotice('code_received', [String(rows[0].client_name ?? '')]);
    let notified = 0;
    for (const to of await staffRecipients(log, rid)) {
      try {
        await sendMail(log, { to, ...notice, rid, role: 'staff' });
        notified += 1;
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'staff', err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, notified });
    return Response.json({ ok: true, rid }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
```

`supabase/functions/masleka-code/index.ts` (exactly):

```ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

Append to `supabase/config.toml`:

```toml

# The clearinghouse functions (PR A). None asks the gateway to check a JWT:
# masleka-code is reached from a link without signing in, the members-only
# ones prove the caller themselves (auth server + staff_role on every call,
# see _shared/staff.ts), and masleka-remind is called by pg_cron with a
# shared secret. The site's sb_publishable_ key is not a JWT either.
[functions.masleka-code]
verify_jwt = false
```

Add a case to `tests/contract/edge-functions.contract.test.ts`, inside `describe("the lead functions on Edge", …)` after "are each registered without JWT verification, as submit-claim is":

```ts
  it("registers each clearinghouse function without the gateway's JWT check, because each checks its caller itself", () => {
    const toml = readFileSync(join(REPO_ROOT, "supabase/config.toml"), "utf8");
    const masleka = names.filter((n) => n.startsWith("masleka-"));
    expect(masleka.length).toBeGreaterThan(0);
    for (const fn of masleka) {
      expect(toml).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt = false`));
    }
  });
```

Add to `tests/test-plan/03-std-contract.md` §4.7's table (raise the count by 1):

```markdown
| CTR-EDGE-004 | "registers each clearinghouse function without the gateway's JWT check, because each checks its caller itself" | `verify_jwt = false` for every `masleka-*` directory |
```

Add to `tests/test-plan/12-std-integration.md`, as a new section after §4.23 (and raise the count in its pass criteria by 19):

```markdown
### 4.24 `masleka-code` — the client hands over the code — `INT-MSK-CODE-001..019`

`tests/integration/masleka-code.integration.test.ts`, through the in-process
harness with its clearinghouse fakes (`MaslekaFake`).

| ID | Title | Expected result |
|---|---|---|
| INT-MSK-CODE-001 | "answers disabled and touches nothing while MASLEKA_ENABLED is unset" | 404 `disabled`; no REST call, no mail |
| INT-MSK-CODE-002 | "stores both values sealed and moves the request to code_received" | Answer is `{ok, rid}` only; both decrypt; `id_last4` 0018 |
| INT-MSK-CODE-003 | "pads a short ID before sealing it" | `00018` stored as `000000018` |
| INT-MSK-CODE-004 | "never echoes the code or the ID — not in the answer, not in any mail" | Neither value in the answer or any mail |
| INT-MSK-CODE-005 | "tells every staff member, once each" | One notice per staff address |
| INT-MSK-CODE-006 | "falls back to Dorit's mailbox when the staff list cannot be read, and still accepts the code" | 200; one notice to dorit@ |
| INT-MSK-CODE-007 | "a second submission of the same link is refused and changes nothing" | 404 `link_invalid`; first ciphertext kept; no mail |
| INT-MSK-CODE-008 | "refuses an expired link" | `link_invalid`; row unchanged |
| INT-MSK-CODE-009 | "refuses a link whose request was already submitted" | `link_invalid` |
| INT-MSK-CODE-010 | "refuses a well-formed token nobody issued" | `link_invalid` |
| INT-MSK-CODE-011 | "refuses a malformed token without asking the database" | No PATCH |
| INT-MSK-CODE-012 | "refuses an ID that fails the check digit, before storing anything" | 400 `bad_id`; no PATCH |
| INT-MSK-CODE-013 | "refuses a code that cannot be one" | 400 `bad_code`; no PATCH |
| INT-MSK-CODE-014 | "answers a non-JSON body as a bad link" | `link_invalid` |
| INT-MSK-CODE-015 | "refuses a flood from one address" | 429; no PATCH |
| INT-MSK-CODE-016 | "refuses a flood on one link" | 429; no PATCH |
| INT-MSK-CODE-017 | "stores nothing when there is no key to seal with" | 503 `unavailable`; no PATCH |
| INT-MSK-CODE-018 | "reports a database failure with its rid and nothing else" | 500 `failed` + rid; no mail |
| INT-MSK-CODE-019 | "answers the browser's preflight and does nothing else" | 204; no fetch |
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run tests/integration/masleka-code.integration.test.ts tests/integration/edge-harness.integration.test.ts tests/integration/submit-claim-edge.integration.test.ts tests/contract/edge-functions.contract.test.ts tests/contract/logging.contract.test.ts tests/contract/function-clock.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS — the new suite (19), the existing harness users unchanged, the contracts now including `masleka-code`; Deno check clean.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/edge-function.ts supabase/functions/masleka-code/handler.ts supabase/functions/masleka-code/index.ts supabase/config.toml tests/contract/edge-functions.contract.test.ts tests/integration/masleka-code.integration.test.ts tests/test-plan/12-std-integration.md tests/test-plan/03-std-contract.md
git commit -m "masleka-code: a link admits once, the ID is checked, both values are sealed, staff are told

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 8: `masleka-reveal` — a member decrypts one value, and it is logged

**Files:**
- Create: `supabase/functions/masleka-reveal/handler.ts`
- Create: `supabase/functions/masleka-reveal/index.ts`
- Modify: `supabase/config.toml`
- Create: `tests/integration/masleka-reveal.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: `staffCaller` (staff.ts); `AGENCY_1`, `UUID`, `maslekaEnabled` (masleka.ts); `selectRows`, `insertRow` (rest.ts); `sealKeyFromEnv`, `unseal` (seal.ts).
- Produces: `POST /functions/v1/masleka-reveal`, `Authorization: Bearer <session>`, body `{ requestId: string, field: 'id' | 'code' }`. Answers `200 { ok: true, value, rid }` with `Cache-Control: no-store`; `401 unauthorized`; `403 forbidden`; `400 invalid`; `404 disabled | not_found`; `409 not_available`; `503 unavailable`; `500 failed`.

- [ ] **Step 1: Write the failing test** — `tests/integration/masleka-reveal.integration.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";
import { importSealKey, seal } from "../../supabase/functions/_shared/seal.ts";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ON = { MASLEKA_ENABLED: "true", MASLEKA_KEY: KEY };
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const STAFF = "aaaaaaaa-1111-4111-8111-000000000001";
const OUTSIDER = "aaaaaaaa-1111-4111-8111-000000000002";
const STAFF_TOKEN = "staff-session-token-0123456789";
const OUTSIDER_TOKEN = "outsider-session-token-012345";

let sealedCode = "";
let sealedId = "";
beforeAll(async () => {
  const key = await importSealKey(KEY);
  sealedCode = await seal(key, "AB12-CD34");
  sealedId = await seal(key, "000000018");
});

const waiting = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  agency_id: AGENCY_1,
  client_name: "רונית מזרחי",
  status: "code_received",
  code_ciphertext: sealedCode,
  id_ciphertext: sealedId,
  id_last4: "0018",
  ...over,
});

function run(b: unknown, o: EdgeOptions & { fake?: MaslekaFake; token?: string | null } = {}) {
  const { fake, token = STAFF_TOKEN, ...rest } = o;
  return invokeEdge("masleka-reveal", b, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    masleka: {
      requests: [waiting()],
      sessions: { [STAFF_TOKEN]: STAFF, [OUTSIDER_TOKEN]: OUTSIDER },
      roles: { [STAFF]: "staff", [OUTSIDER]: null },
      ...fake,
    },
  });
}

describe("masleka-reveal — who may", () => {
  it("answers disabled while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-reveal", { requestId: REQUEST_ID, field: "id" }, {
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
    });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "disabled" });
  });

  it("refuses a caller with no session", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { token: null });
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ error: "unauthorized" });
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
  });

  it("refuses a session the auth server does not recognise", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { token: "forged-session-token-0123456" });
    expect(r.status).toBe(401);
  });

  it("refuses a signed-in user who is not staff, and logs no access", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { token: OUTSIDER_TOKEN });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: "forbidden" });
    expect(r.accessLog).toHaveLength(0);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
  });

  it("a membership removed between two calls is refused on the second", async () => {
    const first = await run({ requestId: REQUEST_ID, field: "id" });
    expect(first.status).toBe(200);
    const second = await run({ requestId: REQUEST_ID, field: "id" }, { fake: { roles: { [STAFF]: null } } });
    expect(second.status).toBe(403);
    expect(second.json).not.toHaveProperty("value");
  });
});

describe("masleka-reveal — what a member gets", () => {
  it("decrypts the ID for a member, never cached, and logs who asked", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, value: "000000018" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.accessLog).toEqual([
      expect.objectContaining({ agency_id: AGENCY_1, request_id: REQUEST_ID, user_id: STAFF, field: "id" }),
    ]);
  });

  it("decrypts the code", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "code" });
    expect(r.json).toMatchObject({ ok: true, value: "AB12-CD34" });
    expect(r.accessLog[0]).toMatchObject({ field: "code" });
  });

  it("has nothing to give once the request was submitted", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, {
      fake: { requests: [waiting({ status: "submitted", code_ciphertext: null, id_ciphertext: null })] },
    });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "not_available" });
    expect(r.accessLog).toHaveLength(0);
  });

  it("does not find another agency's request", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, {
      fake: { requests: [waiting({ agency_id: "aaaaaaaa-0000-0000-0000-000000000002" })] },
    });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "not_found" });
  });

  it("refuses a field it does not hold, or an id that is not one", async () => {
    expect((await run({ requestId: REQUEST_ID, field: "phone" })).json).toMatchObject({ error: "invalid" });
    expect((await run({ requestId: "1 or 1=1", field: "id" })).json).toMatchObject({ error: "invalid" });
  });
});

describe("masleka-reveal — failing closed", () => {
  it("reveals nothing when the access log cannot be written", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { fake: { failAccessLog: true } });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "failed" });
    expect(JSON.stringify(r.json)).not.toContain("000000018");
  });

  it("reveals nothing from a value that fails its tag", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, {
      fake: { requests: [waiting({ id_ciphertext: Buffer.alloc(40, 1).toString("base64") })] },
    });
    expect(r.status).toBe(500);
    expect(r.json).not.toHaveProperty("value");
  });

  it("reveals nothing without the key", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { envPatch: { MASLEKA_KEY: null } });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: "unavailable" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/masleka-reveal.integration.test.ts`
Expected: FAIL — cannot resolve `supabase/functions/masleka-reveal/handler.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/masleka-reveal/handler.ts`

```ts
/**
 * A staff member's copy button: one value of one waiting request, decrypted.
 *
 * Members only, proved on every call (`staffCaller`): a removed membership is
 * refused at once, whatever the browser still shows. The access is written to
 * `masleka_access_log` before the value is decrypted, and a failed write
 * reveals nothing — the audit cannot be skipped by breaking it. The answer is
 * `no-store`, and the value is never logged.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { AGENCY_1, UUID, maslekaEnabled } from '../_shared/masleka.ts';
import { insertRow, selectRows } from '../_shared/rest.ts';
import { sealKeyFromEnv, unseal } from '../_shared/seal.ts';
import { staffCaller } from '../_shared/staff.ts';

const FN = 'masleka-reveal';
const log = createLog(FN);

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const caller = await staffCaller(req);
    if (caller.kind === 'anonymous') {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401, headers: cors });
    }
    if (caller.kind === 'outsider') {
      log('warn', 'request.rejected', { rid, reason: 'forbidden', userId: caller.userId });
      return Response.json({ error: 'forbidden', rid }, { status: 403, headers: cors });
    }

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const requestId = input?.requestId;
    const field = input?.field;
    if (typeof requestId !== 'string' || !UUID.test(requestId) || (field !== 'id' && field !== 'code')) {
      log('warn', 'request.rejected', { rid, reason: 'invalid' });
      return Response.json({ error: 'invalid', rid }, { status: 400, headers: cors });
    }

    const key = await sealKeyFromEnv();
    if (!key) {
      log('error', 'seal.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503, headers: cors });
    }

    const rows = await selectRows(
      'masleka_requests',
      `select=id,status,code_ciphertext,id_ciphertext&id=eq.${requestId}&agency_id=eq.${AGENCY_1}`,
    );
    const row = rows[0];
    if (!row) {
      log('warn', 'request.rejected', { rid, reason: 'not_found', requestId });
      return Response.json({ error: 'not_found', rid }, { status: 404, headers: cors });
    }
    const sealed = field === 'id' ? row.id_ciphertext : row.code_ciphertext;
    if (row.status !== 'code_received' || typeof sealed !== 'string' || !sealed) {
      log('warn', 'request.rejected', { rid, reason: 'not_available', requestId });
      return Response.json({ error: 'not_available', rid }, { status: 409, headers: cors });
    }

    try {
      await insertRow('masleka_access_log', { agency_id: AGENCY_1, request_id: requestId, user_id: caller.userId, field });
    } catch (e) {
      log('error', 'access_log.failed', { rid, requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
    }

    let value: string;
    try {
      value = await unseal(key, sealed);
    } catch (e) {
      log('error', 'unseal.failed', { rid, requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, field, userId: caller.userId });
    return Response.json({ ok: true, value, rid }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
```

`supabase/functions/masleka-reveal/index.ts` (exactly):

```ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

Append to `supabase/config.toml`:

```toml

[functions.masleka-reveal]
verify_jwt = false
```

Add to `tests/test-plan/12-std-integration.md` after §4.24 (raise the count by 13):

```markdown
### 4.25 `masleka-reveal` — a member decrypts one value — `INT-MSK-REV-001..013`

| ID | Title | Expected result |
|---|---|---|
| INT-MSK-REV-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 `disabled` |
| INT-MSK-REV-002 | "refuses a caller with no session" | 401; no table read |
| INT-MSK-REV-003 | "refuses a session the auth server does not recognise" | 401 |
| INT-MSK-REV-004 | "refuses a signed-in user who is not staff, and logs no access" | 403; no log row; no table read |
| INT-MSK-REV-005 | "a membership removed between two calls is refused on the second" | 200 then 403 with the same session |
| INT-MSK-REV-006 | "decrypts the ID for a member, never cached, and logs who asked" | Value; `no-store`; one log row with user and field |
| INT-MSK-REV-007 | "decrypts the code" | Value; log field `code` |
| INT-MSK-REV-008 | "has nothing to give once the request was submitted" | 409 `not_available`; no log row |
| INT-MSK-REV-009 | "does not find another agency's request" | 404 `not_found` |
| INT-MSK-REV-010 | "refuses a field it does not hold, or an id that is not one" | 400 `invalid` |
| INT-MSK-REV-011 | "reveals nothing when the access log cannot be written" | 500; no value |
| INT-MSK-REV-012 | "reveals nothing from a value that fails its tag" | 500; no value |
| INT-MSK-REV-013 | "reveals nothing without the key" | 503 `unavailable` |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/integration/masleka-reveal.integration.test.ts tests/contract/edge-functions.contract.test.ts tests/contract/logging.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS (13 + contracts); Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/masleka-reveal/handler.ts supabase/functions/masleka-reveal/index.ts supabase/config.toml tests/integration/masleka-reveal.integration.test.ts tests/test-plan/12-std-integration.md
git commit -m "masleka-reveal: members only, checked on every call; logged before decrypting, nothing revealed if the log fails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 9: `masleka-submitted` — הגשתי wipes the ciphertext

**Files:**
- Create: `supabase/functions/masleka-submitted/handler.ts`
- Create: `supabase/functions/masleka-submitted/index.ts`
- Modify: `supabase/config.toml`
- Create: `tests/integration/masleka-submitted.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: `staffCaller`; `AGENCY_1`, `UUID`, `maslekaEnabled`, `CLEARINGHOUSE_RETENTION_BUSINESS_DAYS`; `updateWhere`, `selectRows`; `addBusinessDays`.
- Produces: `POST /functions/v1/masleka-submitted`, bearer session, body `{ requestId: string }`. Answers `200 { ok: true, rid }` or `200 { ok: true, already: true, rid }`; `401`/`403`/`400 invalid`/`404 disabled | not_found`/`409 not_available`/`500 failed`.

- [ ] **Step 1: Write the failing test** — `tests/integration/masleka-submitted.integration.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";
import { addBusinessDays } from "../../supabase/functions/_shared/business-days.ts";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const ON = { MASLEKA_ENABLED: "true" };
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const STAFF = "aaaaaaaa-1111-4111-8111-000000000001";
const OUTSIDER = "aaaaaaaa-1111-4111-8111-000000000002";
const STAFF_TOKEN = "staff-session-token-0123456789";
const OUTSIDER_TOKEN = "outsider-session-token-012345";

const waiting = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  agency_id: AGENCY_1,
  client_name: "רונית מזרחי",
  status: "code_received",
  code_ciphertext: "c2VhbGVkLWNvZGU=",
  id_ciphertext: "c2VhbGVkLWlk",
  id_last4: "0018",
  code_received_at: "2026-10-12T08:00:00.000Z",
  ...over,
});

function run(b: unknown, o: EdgeOptions & { fake?: MaslekaFake; token?: string | null } = {}) {
  const { fake, token = STAFF_TOKEN, ...rest } = o;
  return invokeEdge("masleka-submitted", b, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    masleka: {
      requests: [waiting()],
      sessions: { [STAFF_TOKEN]: STAFF, [OUTSIDER_TOKEN]: OUTSIDER },
      roles: { [STAFF]: "staff" },
      ...fake,
    },
  });
}

describe("masleka-submitted", () => {
  it("answers disabled while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-submitted", { requestId: REQUEST_ID }, {
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
    });
    expect(r.status).toBe(404);
  });

  it("refuses a caller with no session, and an outsider", async () => {
    expect((await run({ requestId: REQUEST_ID }, { token: null })).status).toBe(401);
    const outsider = await run({ requestId: REQUEST_ID }, { token: OUTSIDER_TOKEN });
    expect(outsider.status).toBe(403);
    expect(outsider.maslekaRequests[0].code_ciphertext).not.toBeNull();
  });

  it("wipes both values, marks the request submitted and records who and when", async () => {
    const r = await run({ requestId: REQUEST_ID });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    const row = r.maslekaRequests[0];
    expect(row).toMatchObject({ status: "submitted", code_ciphertext: null, id_ciphertext: null, submitted_by: STAFF, id_last4: "0018" });
    expect(row.ciphertext_wiped_at).toBe(row.submitted_at);
    expect(row.clearinghouse_deletes_at).toBe(addBusinessDays(new Date(String(row.submitted_at)), 7).toISOString());
  });

  it("does it in one write that is conditional on the request still waiting", async () => {
    const r = await run({ requestId: REQUEST_ID });
    expect(r.requestPatches).toHaveLength(1);
    expect(r.requestPatches[0].query).toContain("status=eq.code_received");
    expect(r.requestPatches[0].fields).toMatchObject({ status: "submitted", code_ciphertext: null, id_ciphertext: null });
  });

  it("treats a second click as done, not as an error", async () => {
    const first = await run({ requestId: REQUEST_ID });
    const second = await run({ requestId: REQUEST_ID }, { fake: { requests: first.maslekaRequests } });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ ok: true, already: true });
  });

  it("a failed wipe is reported as a failure, not as done", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { failRequestWrite: true } });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "failed" });
    expect(r.json).not.toHaveProperty("ok");
    expect(r.maslekaRequests[0]).toMatchObject({ status: "code_received" });
  });

  it("refuses a request that never received a code", async () => {
    const r = await run({ requestId: REQUEST_ID }, {
      fake: { requests: [waiting({ status: "invited", code_ciphertext: null, id_ciphertext: null, code_received_at: null })] },
    });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "not_available" });
  });

  it("does not find a request that is not there, or not the agency's", async () => {
    expect((await run({ requestId: "99999999-9999-4999-8999-999999999999" })).status).toBe(404);
    const other = await run({ requestId: REQUEST_ID }, {
      fake: { requests: [waiting({ agency_id: "aaaaaaaa-0000-0000-0000-000000000002" })] },
    });
    expect(other.status).toBe(404);
    expect(other.maslekaRequests[0].code_ciphertext).not.toBeNull();
  });

  it("refuses an id that is not one", async () => {
    const r = await run({ requestId: "x" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "invalid" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/masleka-submitted.integration.test.ts`
Expected: FAIL — cannot resolve `supabase/functions/masleka-submitted/handler.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/masleka-submitted/handler.ts`

```ts
/**
 * הגשתי: the request went in at the clearinghouse, so the code and the ID are
 * no longer needed and are wiped.
 *
 * One conditional write moves the status and nulls both values together —
 * the table's check constraint refuses any other combination — so there is
 * no moment, and no failure, in which a request reads "submitted" while its
 * values survive. A write that fails answers 500: the staff member is never
 * told the values are gone when they are not. The time is kept, with the
 * clearinghouse's deletion date (business day 7), for the reminders.
 */
import { addBusinessDays } from '../_shared/business-days.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { AGENCY_1, CLEARINGHOUSE_RETENTION_BUSINESS_DAYS, UUID, maslekaEnabled } from '../_shared/masleka.ts';
import { selectRows, updateWhere } from '../_shared/rest.ts';
import { staffCaller } from '../_shared/staff.ts';

const FN = 'masleka-submitted';
const log = createLog(FN);

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const caller = await staffCaller(req);
    if (caller.kind === 'anonymous') {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401, headers: cors });
    }
    if (caller.kind === 'outsider') {
      log('warn', 'request.rejected', { rid, reason: 'forbidden', userId: caller.userId });
      return Response.json({ error: 'forbidden', rid }, { status: 403, headers: cors });
    }

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const requestId = input?.requestId;
    if (typeof requestId !== 'string' || !UUID.test(requestId)) {
      log('warn', 'request.rejected', { rid, reason: 'invalid' });
      return Response.json({ error: 'invalid', rid }, { status: 400, headers: cors });
    }

    const now = new Date();
    const rows = await updateWhere(
      'masleka_requests',
      `id=eq.${requestId}&agency_id=eq.${AGENCY_1}&status=eq.code_received&select=id`,
      {
        status: 'submitted',
        code_ciphertext: null,
        id_ciphertext: null,
        ciphertext_wiped_at: now.toISOString(),
        submitted_at: now.toISOString(),
        submitted_by: caller.userId,
        clearinghouse_deletes_at: addBusinessDays(now, CLEARINGHOUSE_RETENTION_BUSINESS_DAYS).toISOString(),
      },
    );

    if (!rows.length) {
      const existing = await selectRows('masleka_requests', `select=id,status&id=eq.${requestId}&agency_id=eq.${AGENCY_1}`);
      if (!existing.length) {
        log('warn', 'request.rejected', { rid, reason: 'not_found', requestId });
        return Response.json({ error: 'not_found', rid }, { status: 404, headers: cors });
      }
      if (existing[0].status === 'submitted') {
        log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, already: true });
        return Response.json({ ok: true, already: true, rid }, { headers: cors });
      }
      log('warn', 'request.rejected', { rid, reason: 'not_available', requestId });
      return Response.json({ error: 'not_available', rid }, { status: 409, headers: cors });
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, userId: caller.userId });
    return Response.json({ ok: true, rid }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
```

`supabase/functions/masleka-submitted/index.ts` (exactly):

```ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

Append to `supabase/config.toml`:

```toml

[functions.masleka-submitted]
verify_jwt = false
```

Add to `tests/test-plan/12-std-integration.md` after §4.25 (raise the count by 9):

```markdown
### 4.26 `masleka-submitted` — הגשתי wipes the ciphertext — `INT-MSK-SUB-001..009`

| ID | Title | Expected result |
|---|---|---|
| INT-MSK-SUB-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 |
| INT-MSK-SUB-002 | "refuses a caller with no session, and an outsider" | 401, 403; ciphertext untouched |
| INT-MSK-SUB-003 | "wipes both values, marks the request submitted and records who and when" | Nulls; `submitted`; `submitted_by`; deletion at business day 7 |
| INT-MSK-SUB-004 | "does it in one write that is conditional on the request still waiting" | One PATCH with `status=eq.code_received`, status and both nulls |
| INT-MSK-SUB-005 | "treats a second click as done, not as an error" | 200 `already: true` |
| INT-MSK-SUB-006 | "a failed wipe is reported as a failure, not as done" | 500, no `ok`; row still `code_received` |
| INT-MSK-SUB-007 | "refuses a request that never received a code" | 409 `not_available` |
| INT-MSK-SUB-008 | "does not find a request that is not there, or not the agency's" | 404; other agency's ciphertext untouched |
| INT-MSK-SUB-009 | "refuses an id that is not one" | 400 `invalid` |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/integration/masleka-submitted.integration.test.ts tests/contract/edge-functions.contract.test.ts tests/contract/logging.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS (9 + contracts); Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/masleka-submitted/handler.ts supabase/functions/masleka-submitted/index.ts supabase/config.toml tests/integration/masleka-submitted.integration.test.ts tests/test-plan/12-std-integration.md
git commit -m "masleka-submitted: one conditional write moves the status and wipes both values; a failure says so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 10: `masleka-create` — a hand-made request, or a fresh link

**Files:**
- Create: `supabase/functions/masleka-create/handler.ts`
- Create: `supabase/functions/masleka-create/index.ts`
- Modify: `supabase/config.toml`
- Create: `tests/integration/masleka-create.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: `staffCaller`; `AGENCY_1`, `UUID`, `createRequest`, `maslekaEnabled`, `maslekaLink`, `newToken`, `tokenExpiry`, `tokenHash`; `updateRow`, `updateWhere`; `isEmail`; `buildClientInvite`; `sendMail`.
- Produces: `POST /functions/v1/masleka-create`, bearer session. Body either `{ clientName: string, contactEmail?: string, sendInvite?: boolean }` (create) or `{ requestId: string }` (fresh link for an `invited` request). Answers `200 { ok: true, requestId, link, invited, rid }` with `Cache-Control: no-store`; `400 invalid_name | invalid_email | invalid`; `401`/`403`; `404 disabled`; `409 not_available`; `500 failed`.

- [ ] **Step 1: Write the failing test** — `tests/integration/masleka-create.integration.test.ts`

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const ON = { MASLEKA_ENABLED: "true" };
const STAFF = "aaaaaaaa-1111-4111-8111-000000000001";
const OUTSIDER = "aaaaaaaa-1111-4111-8111-000000000002";
const STAFF_TOKEN = "staff-session-token-0123456789";
const OUTSIDER_TOKEN = "outsider-session-token-012345";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const tokenOf = (link: unknown) => String(link).split("#t=")[1];

function run(b: unknown, o: EdgeOptions & { fake?: MaslekaFake; token?: string | null } = {}) {
  const { fake, token = STAFF_TOKEN, ...rest } = o;
  return invokeEdge("masleka-create", b, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    masleka: {
      sessions: { [STAFF_TOKEN]: STAFF, [OUTSIDER_TOKEN]: OUTSIDER },
      roles: { [STAFF]: "owner" },
      ...fake,
    },
  });
}

describe("masleka-create — who may", () => {
  it("answers disabled while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-create", { clientName: "משה כהן" }, {
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
    });
    expect(r.status).toBe(404);
  });

  it("refuses a caller with no session, and an outsider", async () => {
    expect((await run({ clientName: "משה כהן" }, { token: null })).status).toBe(401);
    const outsider = await run({ clientName: "משה כהן" }, { token: OUTSIDER_TOKEN });
    expect(outsider.status).toBe(403);
    expect(outsider.maslekaRequests).toHaveLength(0);
  });
});

describe("masleka-create — a new request", () => {
  it("creates an invited request, mails the client the link, and returns it for copying", async () => {
    const r = await run({ clientName: " משה כהן ", contactEmail: "moshe@example.com", sendInvite: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.json).toMatchObject({ ok: true, requestId: expect.any(String), invited: true });
    const row = r.maslekaRequests[0];
    expect(row).toMatchObject({ agency_id: AGENCY_1, client_name: "משה כהן", contact_email: "moshe@example.com", created_by: STAFF, lead_id: null });
    expect(row.token_hash).toBe(sha(tokenOf(r.json.link)));
    expect(row.client_invited_at).toEqual(expect.any(String));
    const mail = r.mailTo("moshe@example.com");
    expect(mail.text).toContain(String(r.json.link));
    expect(mail.html).toContain(String(r.json.link));
  });

  it("only returns the link when the staff member will send it themselves", async () => {
    const r = await run({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: false });
    expect(r.json).toMatchObject({ ok: true, invited: false });
    expect(String(r.json.link)).toMatch(/^https:\/\/govari-fin\.co\.il\/masleka#t=[A-Za-z0-9_-]{43}$/);
    expect(r.emails).toHaveLength(0);
    expect(r.maslekaRequests[0].client_invited_at).toBeNull();
  });

  it("mails nobody when there is no address", async () => {
    const r = await run({ clientName: "משה כהן", sendInvite: true });
    expect(r.json).toMatchObject({ ok: true, invited: false });
    expect(r.maslekaRequests[0].contact_email).toBeNull();
    expect(r.emails).toHaveLength(0);
  });

  it("still returns the link when the invitation mail fails", async () => {
    const r = await run({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true }, {
      failEmailTo: ["moshe@example.com"],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, invited: false, link: expect.any(String) });
    expect(r.maslekaRequests[0].client_invited_at).toBeNull();
  });

  it("refuses an empty or overlong name", async () => {
    expect((await run({ clientName: "  " })).json).toMatchObject({ error: "invalid_name" });
    expect((await run({ clientName: "א".repeat(81) })).json).toMatchObject({ error: "invalid_name" });
  });

  it("refuses an address that is not one", async () => {
    const r = await run({ clientName: "משה כהן", contactEmail: "moshe@, other@example.com" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "invalid_email" });
    expect(r.maslekaRequests).toHaveLength(0);
  });
});

describe("masleka-create — a fresh link", () => {
  const invited = (over: Record<string, unknown> = {}) => ({
    id: REQUEST_ID,
    agency_id: AGENCY_1,
    client_name: "אורי לוי",
    contact_email: "uri@example.com",
    status: "invited",
    token_hash: "a".repeat(64),
    token_expires_at: "2026-10-20T00:00:00.000Z",
    client_reminded_at: null,
    ...over,
  });

  it("replaces the token, restarts its thirty days and stops the automatic reminder", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited()] } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, requestId: REQUEST_ID, invited: false });
    const row = r.maslekaRequests[0];
    expect(row.token_hash).toBe(sha(tokenOf(r.json.link)));
    expect(Date.parse(String(row.token_expires_at))).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(row.client_reminded_at).toEqual(expect.any(String));
    expect(r.emails).toHaveLength(0);
  });

  it("refuses a request that is no longer waiting for a code", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited({ status: "code_received" })] } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "not_available" });
    expect(r.maslekaRequests[0].token_hash).toBe("a".repeat(64));
  });

  it("refuses an id that is not one", async () => {
    expect((await run({ requestId: "x" })).json).toMatchObject({ error: "invalid" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/masleka-create.integration.test.ts`
Expected: FAIL — cannot resolve `supabase/functions/masleka-create/handler.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/masleka-create/handler.ts`

```ts
/**
 * A staff member's two ways to start a client off: a request made by hand
 * (a lead that came by phone), or a fresh link for one still waiting.
 *
 * The link is returned once, to the staff member, so they can send it by
 * WhatsApp if they like; only its hash is stored, so it cannot be shown again
 * — a lost link is replaced, never recovered. A fresh link also marks the
 * request reminded: the automatic reminder rotates the token, and must not
 * kill a link a person just sent by hand.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { isEmail } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { buildClientInvite } from '../_shared/masleka-mail.ts';
import {
  AGENCY_1, UUID, createRequest, maslekaEnabled, maslekaLink, newToken, tokenExpiry, tokenHash,
} from '../_shared/masleka.ts';
import { updateRow, updateWhere } from '../_shared/rest.ts';
import { staffCaller } from '../_shared/staff.ts';

const FN = 'masleka-create';
const log = createLog(FN);

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const noStore = { ...cors, 'Cache-Control': 'no-store' };

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const caller = await staffCaller(req);
    if (caller.kind === 'anonymous') {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401, headers: cors });
    }
    if (caller.kind === 'outsider') {
      log('warn', 'request.rejected', { rid, reason: 'forbidden', userId: caller.userId });
      return Response.json({ error: 'forbidden', rid }, { status: 403, headers: cors });
    }

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    // A fresh link for a request still waiting for its code.
    if (input?.requestId !== undefined) {
      const requestId = input.requestId;
      if (typeof requestId !== 'string' || !UUID.test(requestId)) {
        log('warn', 'request.rejected', { rid, reason: 'invalid' });
        return Response.json({ error: 'invalid', rid }, { status: 400, headers: cors });
      }
      const token = newToken();
      const rows = await updateWhere(
        'masleka_requests',
        `id=eq.${requestId}&agency_id=eq.${AGENCY_1}&status=eq.invited&select=id`,
        { token_hash: await tokenHash(token), token_expires_at: tokenExpiry(), client_reminded_at: new Date().toISOString() },
      );
      if (!rows.length) {
        log('warn', 'request.rejected', { rid, reason: 'not_available', requestId });
        return Response.json({ error: 'not_available', rid }, { status: 409, headers: cors });
      }
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, relinked: true });
      return Response.json({ ok: true, requestId, link: maslekaLink(token), invited: false, rid }, { headers: noStore });
    }

    // A new request.
    const clientName = typeof input?.clientName === 'string' ? input.clientName.trim() : '';
    if (!clientName || clientName.length > 80) {
      log('warn', 'request.rejected', { rid, reason: 'invalid_name' });
      return Response.json({ error: 'invalid_name', rid }, { status: 400, headers: cors });
    }
    const rawEmail = typeof input?.contactEmail === 'string' ? input.contactEmail.trim() : '';
    if (rawEmail && !isEmail(rawEmail)) {
      log('warn', 'request.rejected', { rid, reason: 'invalid_email' });
      return Response.json({ error: 'invalid_email', rid }, { status: 400, headers: cors });
    }
    const contactEmail = rawEmail || null;

    const created = await createRequest({ clientName, contactEmail, leadId: null, createdBy: caller.userId });
    let invited = false;
    if (input?.sendInvite === true && contactEmail) {
      try {
        await sendMail(log, { to: contactEmail, ...buildClientInvite(clientName, created.link), rid, role: 'visitor' });
        invited = true;
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    if (invited) {
      try {
        await updateRow('masleka_requests', created.id, { client_invited_at: new Date().toISOString() });
      } catch (e) {
        log('warn', 'masleka.invite_mark_failed', { rid, requestId: created.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId: created.id, invited });
    return Response.json({ ok: true, requestId: created.id, link: created.link, invited, rid }, { headers: noStore });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
```

`supabase/functions/masleka-create/index.ts` (exactly):

```ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

Append to `supabase/config.toml`:

```toml

[functions.masleka-create]
verify_jwt = false
```

Add to `tests/test-plan/12-std-integration.md` after §4.26 (raise the count by 11):

```markdown
### 4.27 `masleka-create` — a hand-made request, or a fresh link — `INT-MSK-NEW-001..011`

| ID | Title | Expected result |
|---|---|---|
| INT-MSK-NEW-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 |
| INT-MSK-NEW-002 | "refuses a caller with no session, and an outsider" | 401, 403; no row |
| INT-MSK-NEW-003 | "creates an invited request, mails the client the link, and returns it for copying" | Row with hash of the returned token; invitation carries the link; `no-store` |
| INT-MSK-NEW-004 | "only returns the link when the staff member will send it themselves" | No mail; `client_invited_at` null |
| INT-MSK-NEW-005 | "mails nobody when there is no address" | `contact_email` null; no mail |
| INT-MSK-NEW-006 | "still returns the link when the invitation mail fails" | 200, `invited: false` |
| INT-MSK-NEW-007 | "refuses an empty or overlong name" | 400 `invalid_name` |
| INT-MSK-NEW-008 | "refuses an address that is not one" | 400 `invalid_email`; no row |
| INT-MSK-NEW-009 | "replaces the token, restarts its thirty days and stops the automatic reminder" | New hash; expiry ≥ 29 days on; `client_reminded_at` set |
| INT-MSK-NEW-010 | "refuses a request that is no longer waiting for a code" | 409; hash unchanged |
| INT-MSK-NEW-011 | "refuses an id that is not one" | 400 `invalid` |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/integration/masleka-create.integration.test.ts tests/contract/edge-functions.contract.test.ts tests/contract/logging.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS (11 + contracts); Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/masleka-create/handler.ts supabase/functions/masleka-create/index.ts supabase/config.toml tests/integration/masleka-create.integration.test.ts tests/test-plan/12-std-integration.md
git commit -m "masleka-create: staff make a request by hand or issue a fresh link, shown once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 11: `masleka-remind` — the site does the chasing

**Files:**
- Create: `supabase/functions/masleka-remind/handler.ts`
- Create: `supabase/functions/masleka-remind/index.ts`
- Modify: `supabase/config.toml`
- Create: `tests/integration/masleka-remind.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: `maslekaEnabled`, `AGENCY_1`, `READY_AFTER_HOURS`, `DEADLINE_REMINDER_BUSINESS_DAY`, `CLIENT_REMINDER_DAYS`, `newToken`, `tokenHash`, `maslekaLink`; `addBusinessDays`; `selectRows`, `updateWhere`; `staffRecipients`; `buildStaffNotice`, `buildClientInvite`; `sendMail`; `isEmail`. Edge secret `MASLEKA_CRON_SECRET`.
- Produces: `POST /functions/v1/masleka-remind` with header `x-masleka-cron: <MASLEKA_CRON_SECRET>` (sent by `public.masleka_call_remind()`). Answers `200 { ok: true, rid, ready: number, deadline: number, clients: number, warnings: string[] }`; `401 unauthorized`; `404 disabled`; `503 unavailable`; `500 failed`.

- [ ] **Step 1: Write the failing test** — `tests/integration/masleka-remind.integration.test.ts`

```ts
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const SECRET = "cron-secret-for-tests-0123456789";
const ON = { MASLEKA_ENABLED: "true", MASLEKA_CRON_SECRET: SECRET, MASLEKA_KEY: Buffer.alloc(32, 7).toString("base64") };
const STAFF_EMAILS = ["dorit@govari-fin.co.il", "staff@example.com"];
// Sunday, 13:00 in Israel.
const NOW = new Date("2026-10-18T10:00:00Z");
const OLD_TOKEN = "Old_-".repeat(8) + "tok";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const req = (id: string, over: Record<string, unknown>) => ({
  id,
  agency_id: AGENCY_1,
  client_name: "לקוח",
  contact_email: null,
  status: "submitted",
  token_hash: sha(id),
  token_expires_at: "2099-01-01T00:00:00.000Z",
  code_ciphertext: null,
  id_ciphertext: null,
  submitted_at: null,
  ready_reminded_at: null,
  deadline_reminded_at: null,
  client_invited_at: null,
  client_reminded_at: null,
  ...over,
});

const ROWS = () => [
  req("11111111-0000-4000-8000-000000000001", { client_name: "רונית מזרחי", submitted_at: "2026-10-18T05:00:00.000Z" }),
  req("11111111-0000-4000-8000-000000000002", { client_name: "יעל כהן", submitted_at: "2026-10-18T08:00:00.000Z" }),
  req("11111111-0000-4000-8000-000000000003", {
    client_name: "דן לוי",
    submitted_at: "2026-10-11T09:00:00.000Z",
    ready_reminded_at: "2026-10-11T13:00:00.000Z",
  }),
  req("11111111-0000-4000-8000-000000000004", { client_name: "הושלם", status: "completed", submitted_at: "2026-10-01T09:00:00.000Z" }),
  req("22222222-0000-4000-8000-000000000001", {
    client_name: "אורי לוי",
    status: "invited",
    contact_email: "uri@example.com",
    token_hash: sha(OLD_TOKEN),
    client_invited_at: "2026-10-10T10:00:00.000Z",
  }),
  req("22222222-0000-4000-8000-000000000002", {
    status: "invited",
    contact_email: "recent@example.com",
    client_invited_at: "2026-10-13T10:00:00.000Z",
  }),
  req("22222222-0000-4000-8000-000000000003", {
    status: "invited",
    contact_email: "reminded@example.com",
    client_invited_at: "2026-10-01T10:00:00.000Z",
    client_reminded_at: "2026-10-08T10:00:00.000Z",
  }),
  req("22222222-0000-4000-8000-000000000004", { status: "invited", contact_email: "byhand@example.com" }),
  req("22222222-0000-4000-8000-000000000005", { status: "invited", client_invited_at: "2026-10-01T10:00:00.000Z" }),
];

function run(o: EdgeOptions & { fake?: MaslekaFake; secret?: string | null } = {}) {
  const { fake, secret = SECRET, ...rest } = o;
  return invokeEdge("masleka-remind", {}, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: secret ? { "x-masleka-cron": secret } : {},
    masleka: { requests: ROWS(), staffEmails: STAFF_EMAILS, ...fake },
  });
}
const byId = (rows: Record<string, unknown>[], id: string) => rows.find((r) => r.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("masleka-remind — who may call it", () => {
  it("answers disabled while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-remind", {}, { headers: { "x-masleka-cron": SECRET } });
    expect(r.status).toBe(404);
  });

  it("refuses everything when no secret is configured", async () => {
    const r = await run({ envPatch: { MASLEKA_CRON_SECRET: null } });
    expect(r.status).toBe(503);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
  });

  it("refuses a caller without the secret, or with another", async () => {
    expect((await run({ secret: null })).status).toBe(401);
    const wrong = await run({ secret: "cron-secret-for-tests-0123456780" });
    expect(wrong.status).toBe(401);
    expect(wrong.callsTo("masleka_requests")).toHaveLength(0);
  });
});

describe("masleka-remind — the staff", () => {
  it("tells staff the files are ready four hours after הגשתי", async () => {
    const r = await run();
    const ready = r.emails.filter((e) => e.subject.startsWith("יש קבצים להורדה"));
    expect(ready.map((e) => e.to).sort()).toEqual(STAFF_EMAILS);
    expect(ready[0].subject).toBe("יש קבצים להורדה מהמסלקה — רונית מזרחי");
    expect(ready[0].text).not.toContain("יעל כהן");
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000001").ready_reminded_at).toBe(NOW.toISOString());
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000002").ready_reminded_at).toBeNull();
  });

  it("sends one digest when several are ready", async () => {
    const rows: Record<string, unknown>[] = ROWS();
    rows[1].submitted_at = "2026-10-18T04:00:00.000Z";
    const r = await run({ fake: { requests: rows } });
    const ready = r.emails.filter((e) => e.subject.startsWith("יש קבצים להורדה"));
    expect(ready).toHaveLength(STAFF_EMAILS.length);
    expect(ready[0].subject).toBe("יש קבצים להורדה מהמסלקה — 2 לקוחות");
  });

  it("tells staff on business day 5 that the clearinghouse deletes in two days", async () => {
    const r = await run();
    const deadline = r.emails.filter((e) => e.subject.startsWith("נמחק במסלקה"));
    expect(deadline.map((e) => e.to).sort()).toEqual(STAFF_EMAILS);
    expect(deadline[0].subject).toBe("נמחק במסלקה בעוד יומיים — דן לוי");
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000003").deadline_reminded_at).toBe(NOW.toISOString());
  });

  it("does not warn before business day 5", async () => {
    vi.setSystemTime(new Date("2026-10-18T08:00:00Z"));
    const r = await run();
    expect(r.emails.filter((e) => e.subject.startsWith("נמחק במסלקה"))).toHaveLength(0);
  });

  it("ignores requests PR B has completed", async () => {
    const r = await run();
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000004")).toMatchObject({
      ready_reminded_at: null,
      deadline_reminded_at: null,
    });
  });

  it("never repeats a reminder", async () => {
    const first = await run();
    const second = await run({ fake: { requests: first.maslekaRequests } });
    expect(second.emails).toHaveLength(0);
    expect(second.json).toMatchObject({ ok: true, ready: 0, deadline: 0, clients: 0 });
  });
});

describe("masleka-remind — the client", () => {
  it("reminds a client once, a week after the invitation, with a new link", async () => {
    const r = await run();
    const mail = r.mailTo("uri@example.com");
    expect(mail.subject).toBe("תזכורת: מסירת קוד המסלקה · דורית גוב ארי");
    const token = mail.text!.match(/masleka#t=([A-Za-z0-9_-]{43})/)![1];
    const row = byId(r.maslekaRequests, "22222222-0000-4000-8000-000000000001");
    expect(row.token_hash).toBe(sha(token));
    expect(row.token_hash).not.toBe(sha(OLD_TOKEN));
    expect(row.client_reminded_at).toBe(NOW.toISOString());
    for (const other of ["recent@example.com", "reminded@example.com", "byhand@example.com"]) {
      expect(r.emails.some((e) => e.to === other), other).toBe(false);
    }
  });

  it("the old link stops working once the reminder has rotated it", async () => {
    const reminded = await run();
    const fresh = reminded.mailTo("uri@example.com").text!.match(/masleka#t=([A-Za-z0-9_-]{43})/)![1];
    const code = { code: "AB12-CD34", idNumber: "000000018" };
    const asClient = (token: string) =>
      invokeEdge("masleka-code", { ...code, token }, {
        envPatch: ON,
        headers: { "x-forwarded-for": "203.0.113.7" },
        masleka: { requests: reminded.maslekaRequests.map((x) => ({ ...x })), staffEmails: STAFF_EMAILS },
      });
    expect((await asClient(OLD_TOKEN)).json).toMatchObject({ error: "link_invalid" });
    expect((await asClient(fresh)).json).toMatchObject({ ok: true });
  });

  it("puts the reminder back when the client's mail fails, so the next run tries again", async () => {
    const r = await run({ failEmailTo: ["uri@example.com"] });
    expect(byId(r.maslekaRequests, "22222222-0000-4000-8000-000000000001").client_reminded_at).toBeNull();
    expect(r.json.warnings).toContain("client_reminder_failed");
  });

  it("answers how many it sent", async () => {
    const r = await run();
    expect(r.json).toMatchObject({ ok: true, ready: 1, deadline: 1, clients: 1, warnings: [] });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/masleka-remind.integration.test.ts`
Expected: FAIL — cannot resolve `supabase/functions/masleka-remind/handler.ts`.

- [ ] **Step 3: Implement** — `supabase/functions/masleka-remind/handler.ts`

```ts
/**
 * The hourly chase, called by pg_cron through pg_net
 * (`public.masleka_call_remind`), with a shared secret in `x-masleka-cron`.
 *
 * Staff: "יש קבצים להורדה" four hours after הגשתי, and "נמחק במסלקה בעוד
 * יומיים" on business day 5 — one digest per kind per run, each request
 * marked so it is never sent twice. A request PR B completes is no longer
 * `submitted` and drops out by itself.
 *
 * Client: one reminder a week after the invitation went out by mail. The
 * stored hash cannot rebuild the old link, so the reminder carries a new
 * one and the old one stops working; if the mail fails, the mark is undone
 * and the next run tries again with yet another link.
 */
import { addBusinessDays } from '../_shared/business-days.ts';
import { isEmail } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { buildClientInvite, buildStaffNotice, type StaffNoticeKind } from '../_shared/masleka-mail.ts';
import {
  AGENCY_1, CLIENT_REMINDER_DAYS, DEADLINE_REMINDER_BUSINESS_DAY, READY_AFTER_HOURS,
  maslekaEnabled, maslekaLink, newToken, tokenHash,
} from '../_shared/masleka.ts';
import { selectRows, updateWhere } from '../_shared/rest.ts';
import { staffRecipients } from '../_shared/staff.ts';

const FN = 'masleka-remind';
const log = createLog(FN);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Equal strings, compared without stopping at the first difference. */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const instant = (value: unknown): number => Date.parse(String(value ?? ''));

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404 });
    }
    const secret = (Deno.env.get('MASLEKA_CRON_SECRET') || '').trim();
    if (!secret) {
      log('error', 'cron.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503 });
    }
    if (!sameSecret(req.headers.get('x-masleka-cron') || '', secret)) {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401 });
    }

    const now = new Date();
    const warnings: string[] = [];

    // ── staff ──────────────────────────────────────────────────────────────
    const submitted = await selectRows(
      'masleka_requests',
      `select=id,client_name,submitted_at,ready_reminded_at,deadline_reminded_at&agency_id=eq.${AGENCY_1}&status=eq.submitted`,
    );
    const readyDue = submitted.filter(
      (r) => !r.ready_reminded_at && instant(r.submitted_at) <= now.getTime() - READY_AFTER_HOURS * HOUR_MS,
    );
    const deadlineDue = submitted.filter(
      (r) =>
        !r.deadline_reminded_at &&
        Number.isFinite(instant(r.submitted_at)) &&
        addBusinessDays(new Date(instant(r.submitted_at)), DEADLINE_REMINDER_BUSINESS_DAY).getTime() <= now.getTime(),
    );

    let recipients: string[] | null = null;
    const digests: Array<[StaffNoticeKind, Record<string, unknown>[], string]> = [
      ['ready', readyDue, 'ready_reminded_at'],
      ['deadline', deadlineDue, 'deadline_reminded_at'],
    ];
    for (const [kind, rows, column] of digests) {
      if (!rows.length) continue;
      recipients ??= await staffRecipients(log, rid);
      const notice = buildStaffNotice(kind, rows.map((r) => String(r.client_name ?? '')));
      let sent = 0;
      for (const to of recipients) {
        try {
          await sendMail(log, { to, ...notice, rid, role: 'staff' });
          sent += 1;
        } catch (e) {
          log('warn', 'mail.failed', { rid, role: 'staff', kind, err: String((e as Error)?.message ?? e).slice(0, 200) });
        }
      }
      if (!sent) {
        warnings.push(`${kind}_not_sent`);
        continue;
      }
      try {
        await updateWhere(
          'masleka_requests',
          `id=in.(${rows.map((r) => String(r.id)).join(',')})&select=id`,
          { [column]: now.toISOString() },
        );
      } catch (e) {
        log('warn', 'reminder.mark_failed', { rid, kind, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(`${kind}_mark_failed`);
      }
    }

    // ── clients ────────────────────────────────────────────────────────────
    const since = new Date(now.getTime() - CLIENT_REMINDER_DAYS * DAY_MS).toISOString();
    const waiting = await selectRows(
      'masleka_requests',
      `select=id,client_name,contact_email&agency_id=eq.${AGENCY_1}&status=eq.invited` +
        `&client_reminded_at=is.null&client_invited_at=lte.${encodeURIComponent(since)}`,
    );
    let clients = 0;
    for (const row of waiting) {
      const to = typeof row.contact_email === 'string' ? row.contact_email : '';
      if (!isEmail(to)) continue;
      const requestId = String(row.id);
      const token = newToken();
      const claimed = await updateWhere(
        'masleka_requests',
        `id=eq.${requestId}&status=eq.invited&client_reminded_at=is.null&select=id`,
        { token_hash: await tokenHash(token), client_reminded_at: now.toISOString() },
      );
      if (!claimed.length) continue;
      try {
        await sendMail(log, {
          to,
          ...buildClientInvite(String(row.client_name ?? ''), maslekaLink(token), true),
          rid,
          role: 'visitor',
        });
        clients += 1;
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push('client_reminder_failed');
        try {
          await updateWhere('masleka_requests', `id=eq.${requestId}&select=id`, { client_reminded_at: null });
        } catch (e2) {
          log('warn', 'reminder.reset_failed', { rid, requestId, err: String((e2 as Error)?.message ?? e2).slice(0, 200) });
        }
      }
    }

    log('info', 'request.end', {
      rid, ms: Date.now() - startedAt, ready: readyDue.length, deadline: deadlineDue.length, clients, warnings: warnings.length,
    });
    return Response.json({ ok: true, rid, ready: readyDue.length, deadline: deadlineDue.length, clients, warnings });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500 });
  }
}
```

`supabase/functions/masleka-remind/index.ts` (exactly):

```ts
import { handler } from './handler.ts';

Deno.serve(handler);
```

Append to `supabase/config.toml`:

```toml

[functions.masleka-remind]
verify_jwt = false
```

Add to `tests/test-plan/12-std-integration.md` after §4.27 (raise the count by 13):

```markdown
### 4.28 `masleka-remind` — the hourly chase — `INT-MSK-REM-001..013`

Time is fixed with `vi.setSystemTime` (Date only) at Sunday 2026-10-18 13:00 Israel.

| ID | Title | Expected result |
|---|---|---|
| INT-MSK-REM-001 | "answers disabled while MASLEKA_ENABLED is unset" | 404 |
| INT-MSK-REM-002 | "refuses everything when no secret is configured" | 503; no table read |
| INT-MSK-REM-003 | "refuses a caller without the secret, or with another" | 401; no table read |
| INT-MSK-REM-004 | "tells staff the files are ready four hours after הגשתי" | One notice per staff address for the 5-hour-old submission only; marked |
| INT-MSK-REM-005 | "sends one digest when several are ready" | One mail per address, "— 2 לקוחות" |
| INT-MSK-REM-006 | "tells staff on business day 5 that the clearinghouse deletes in two days" | Deadline notice for the Sunday-before submission; marked |
| INT-MSK-REM-007 | "does not warn before business day 5" | No deadline notice at 08:00 UTC |
| INT-MSK-REM-008 | "ignores requests PR B has completed" | Completed row untouched |
| INT-MSK-REM-009 | "never repeats a reminder" | Second run sends nothing |
| INT-MSK-REM-010 | "reminds a client once, a week after the invitation, with a new link" | One reminder; stored hash = new token; others untouched |
| INT-MSK-REM-011 | "the old link stops working once the reminder has rotated it" | `masleka-code` refuses the old token, accepts the new |
| INT-MSK-REM-012 | "puts the reminder back when the client's mail fails, so the next run tries again" | `client_reminded_at` null; warning |
| INT-MSK-REM-013 | "answers how many it sent" | `{ready: 1, deadline: 1, clients: 1, warnings: []}` |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/integration/masleka-remind.integration.test.ts tests/contract/edge-functions.contract.test.ts tests/contract/logging.contract.test.ts tests/contract/function-clock.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS (13 + contracts); Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/masleka-remind/handler.ts supabase/functions/masleka-remind/index.ts supabase/config.toml tests/integration/masleka-remind.integration.test.ts tests/test-plan/12-std-integration.md
git commit -m "masleka-remind: hourly staff digests and one client reminder with a rotated link, behind a cron secret

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 12: `submit-lead` creates the request and mails its link

**Files:**
- Modify: `supabase/functions/submit-lead/lead.js`
- Modify: `supabase/functions/submit-lead/handler.ts`
- Create: `tests/integration/submit-lead-masleka.integration.test.ts`
- Modify: `tests/test-plan/12-std-integration.md`

**Interfaces:**
- Consumes: `createRequest`, `maslekaEnabled` (masleka.ts); `updateRow` (rest.ts); `isEmail` (guard.ts).
- Produces (lead.js): `wantsClearinghouse(profile): boolean`; `MASLEKA_INTRO: string`; `clientMailFor` / `buildClientText` read `data.maslekaLink` (a server-built string, `''` when none). Behaviour with the switch off is byte-for-byte today's, so the Base44/Edge shared cases in `submit-lead.integration.test.ts` are untouched.

- [ ] **Step 1: Write the failing test** — `tests/integration/submit-lead-masleka.integration.test.ts`

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { invokeEdge, type EdgeOptions } from "../helpers/edge-function";

/**
 * What only the Edge submit-lead does for the clearinghouse (PR A): with
 * MASLEKA_ENABLED on, an interview that answered "מעוניין/ת" gets a request
 * and its personal /masleka link where the mandate link was. Off, nothing
 * changes — submit-lead.integration.test.ts keeps proving that against Base44.
 */
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const POA = "https://example.test/poa.pdf";
const ON = { MASLEKA_ENABLED: "true" };
const base = {
  name: "אורי לוי",
  phone: "0541112233",
  email: "uri@example.com",
  source: "interview",
  topic: "דמי ניהול בקרן ההשתלמות",
  track: "pension",
};
const interested = { ...base, profile: { clearinghouse: "מעוניין/ת" } };
const declined = { ...base, profile: { clearinghouse: "לא" } };
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const run = (body: unknown, envPatch: Record<string, string | null> = {}, extra: EdgeOptions = {}) =>
  invokeEdge("submit-lead", body, { ...extra, envPatch: { POA_URL: POA, ...envPatch } });

describe("submit-lead — the clearinghouse request", () => {
  it("keeps today's mandate mail, and creates no request, while the switch is off", async () => {
    const r = await run(interested);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    expect(r.mailTo(base.email).text).toContain(POA);
  });

  it("creates a request for an interview that asked for the pull, and mails its link instead of the mandate", async () => {
    const r = await run(interested, ON);
    expect(r.status).toBe(200);
    expect(r.maslekaRequests).toHaveLength(1);
    const row = r.maslekaRequests[0];
    expect(row).toMatchObject({ agency_id: AGENCY_1, client_name: "אורי לוי", contact_email: base.email, lead_id: r.leads[0].id });
    const mail = r.mailTo(base.email);
    const token = mail.text!.match(/https:\/\/govari-fin\.co\.il\/masleka#t=([A-Za-z0-9_-]{43})/)![1];
    expect(mail.html).toContain(`https://govari-fin.co.il/masleka#t=${token}`);
    expect(row.token_hash).toBe(sha(token));
    expect(mail.text).not.toContain(POA);
    expect(mail.html).not.toContain(POA);
    expect(row.client_invited_at).toEqual(expect.any(String));
  });

  it("says nothing about the clearinghouse to a visitor who declined", async () => {
    const r = await run(declined, ON);
    expect(r.maslekaRequests).toHaveLength(0);
    expect(r.mailTo(base.email).text).not.toContain("masleka#t=");
  });

  it("creates nothing for an interview that is still partial", async () => {
    const r = await run({ ...interested, stage: "partial" }, ON);
    expect(r.maslekaRequests).toHaveLength(0);
  });

  it("falls back to the mandate when the request cannot be created", async () => {
    const r = await run(interested, ON, { masleka: { failRequestWrite: true } });
    expect(r.status).toBe(200);
    expect(r.json.warnings).toContain("masleka_request_failed");
    expect(r.mailTo(base.email).text).toContain(POA);
    expect(r.mailTo(base.email).text).not.toContain("masleka#t=");
  });

  it("never takes the link from the request body", async () => {
    for (const envPatch of [{}, ON]) {
      const r = await run({ ...declined, maslekaLink: "https://evil.example/x" }, envPatch);
      for (const e of r.emails) expect(`${e.html}${e.text}`).not.toContain("evil.example");
    }
  });

  it("creates the request without mailing when there is no address", async () => {
    const r = await run({ ...interested, email: "" }, ON);
    expect(r.maslekaRequests).toHaveLength(1);
    expect(r.maslekaRequests[0]).toMatchObject({ contact_email: null, client_invited_at: null });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/submit-lead-masleka.integration.test.ts`
Expected: FAIL — "creates a request for an interview that asked for the pull…" finds 0 rows (and the fallback case lacks the warning).

- [ ] **Step 3: Implement**

In `supabase/functions/submit-lead/lead.js`, insert after `export const POA_URL = …;` (and its `plainOr` neighbour stays where it is):

```js
/**
 * Whether the interview's answers asked for the clearinghouse pull.
 *
 * `profile` is the redacted [label, value] pairs buildInterviewProfile kept;
 * it drops an empty answer, so a row at all means the question was answered.
 */
export function wantsClearinghouse(profile) {
  const row = (Array.isArray(profile) ? profile : [])
    .find(([label]) => String(label).includes('מסלקה'));
  return Boolean(row) && String(row[1]).startsWith('מעוניין');
}

/**
 * The interview confirmation when the clearinghouse request replaces the
 * mandate (PR A, MASLEKA_ENABLED). The link itself is `data.maslekaLink`,
 * built by the handler from a token it just issued — never read from the
 * request, so no visitor can put a link of theirs into a mail from Dorit.
 */
export const MASLEKA_INTRO =
  'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה. ביקשתם שאשלוף עבורכם תמונת מצב פנסיונית מהמסלקה — לשם כך יש להפיק באתר המסלקה קוד ייפוי כוח ולמסור אותו בקישור האישי שלמטה. ההסבר המלא, צעד אחר צעד, מחכה שם.';
```

In `clientMailFor`, replace the whole `if (source === 'interview') { … }` block with:

```js
  if (source === 'interview') {
    // רק למי שאמר שהוא מעוניין. 'לא' או שדה חסר — אין אזכור, ואין מסמך שנשלח
    // למי שלא ביקש אותו.
    const wants = wantsClearinghouse(data?.profile);
    // With the clearinghouse pipeline on, the personal /masleka link replaces
    // the mandate; with it off (or when the request could not be created) the
    // mail is exactly what it was.
    const maslekaOffered = wants && Boolean(data?.maslekaLink);
    const poaOffered = wants && !maslekaOffered && POA_URL;
    return {
      firstName,
      eyebrow: 'אישור קבלה',
      heading: 'קיבלנו את סיכום השיחה',
      intro: maslekaOffered
        ? MASLEKA_INTRO
        : poaOffered
          ? 'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה. ביקשתם שאשלוף עבורכם תמונת מצב פנסיונית מהמסלקה — לשם כך נדרש ייפוי כוח חתום, והוא מצורף כאן למטה. אפשר לחתום עליו לפני הפגישה, וכך נגיע אליה עם התמונה המלאה.'
          : 'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.',
      panelTitle: 'מה נשמר',
      details: maslekaOffered
        ? [['נושא מרכזי', plainOr(data.topic, 'הקשר כללי')], ['מסירת קוד המסלקה', data.maslekaLink]]
        : poaOffered
          ? [['נושא מרכזי', plainOr(data.topic, 'הקשר כללי')], ['ייפוי כוח למסלקה', POA_URL]]
          : [['נושא מרכזי', plainOr(data.topic, 'הקשר כללי')]],
    };
  }
```

In `buildClientText`, replace the whole `if (source === 'interview') { … }` block with:

```js
  if (source === 'interview') {
    // התאום של גרסת ה-HTML. שתי המחציות של אותו מייל חייבות לומר אותו דבר.
    const wants = wantsClearinghouse(data?.profile);
    const maslekaOffered = wants && Boolean(data?.maslekaLink);
    return [
      `${hello}תודה על השיחה. הסיכום שאישרתם הועבר אליי כפי שהוא.`,
      `נושא מרכזי: ${plainOr(data.topic, 'הקשר כללי')}`,
      ...(maslekaOffered
        ? [`מסירת קוד המסלקה — הקישור האישי שלכם: ${data.maslekaLink}`]
        : wants && POA_URL
          ? [`ייפוי כוח לשליפת נתוני מסלקה — לחתימה לפני הפגישה: ${POA_URL}`]
          : []),
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
```

In `supabase/functions/submit-lead/handler.ts`:

(a) Add the import below the `_shared/log.ts` import:

```ts
import { createRequest, maslekaEnabled } from '../_shared/masleka.ts';
```

(b) Add `wantsClearinghouse` to the `./lead.js` import list (after `tomorrowInIsrael,`):

```ts
  redact, sameInterviewee, subjectFor, tomorrowInIsrael, wallClock, wantsClearinghouse,
```

(c) Below `findOpenInterview` (module level), add:

```ts
/** The invitation went out: the request's one client reminder counts from now. Never throws. */
async function markMaslekaInvited(rid: string, requestId: string): Promise<void> {
  try {
    await updateRow('masleka_requests', requestId, { client_invited_at: new Date().toISOString() });
  } catch (e) {
    log('warn', 'masleka.invite_mark_failed', { rid, requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}
```

(d) In the `const data = { … }` literal, add as its last member:

```ts
      // The client's /masleka link, set below only when the pipeline is on.
      maslekaLink: '',
```

(e) Immediately after the `if (partial) { … return … }` block and before the `// אישור ללקוח` comment, insert:

```ts
    // The clearinghouse request (PR A, dark until MASLEKA_ENABLED): an
    // interview that asked for the pull gets a request and its personal link
    // where the mandate link was. If it cannot be created, the mail is today's,
    // mandate and all, and the warning says so.
    let maslekaRequestId: string | null = null;
    if (source === 'interview' && maslekaEnabled() && wantsClearinghouse(safeProfile)) {
      try {
        const created = await createRequest({
          clientName: String(name).trim().slice(0, 80),
          contactEmail: email && isEmail(email) ? email : null,
          leadId,
          createdBy: null,
        });
        maslekaRequestId = created.id;
        data.maslekaLink = created.link;
        log('info', 'masleka.request_created', { rid, requestId: created.id });
      } catch (e) {
        log('warn', 'masleka.request_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push('masleka_request_failed');
      }
    }
```

(f) In the client confirmation `try { … }`, right after its `await sendMail(log, { … role: 'visitor', });`, add:

```ts
        if (maslekaRequestId) await markMaslekaInvited(rid, maslekaRequestId);
```

Add to `tests/test-plan/12-std-integration.md` after §4.28 (raise the count by 7):

```markdown
### 4.29 `submit-lead` — the clearinghouse request — `INT-LEAD-MSK-001..007`

| ID | Title | Expected result |
|---|---|---|
| INT-LEAD-MSK-001 | "keeps today's mandate mail, and creates no request, while the switch is off" | No request; POA link mailed |
| INT-LEAD-MSK-002 | "creates a request for an interview that asked for the pull, and mails its link instead of the mandate" | One row tied to the lead; link (hash matches) in both halves; no POA; `client_invited_at` set |
| INT-LEAD-MSK-003 | "says nothing about the clearinghouse to a visitor who declined" | No request, no link |
| INT-LEAD-MSK-004 | "creates nothing for an interview that is still partial" | No request |
| INT-LEAD-MSK-005 | "falls back to the mandate when the request cannot be created" | 200; `masleka_request_failed`; POA link |
| INT-LEAD-MSK-006 | "never takes the link from the request body" | No foreign link in any mail, on or off |
| INT-LEAD-MSK-007 | "creates the request without mailing when there is no address" | Row with null contact; not marked invited |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/integration/submit-lead-masleka.integration.test.ts tests/integration/submit-lead.integration.test.ts tests/contract/agents.contract.test.ts tests/contract/logging.contract.test.ts && deno check --no-config supabase/functions/*/index.ts`
Expected: PASS — the new 7, and every shared Base44/Edge case unchanged; Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/submit-lead/lead.js supabase/functions/submit-lead/handler.ts tests/integration/submit-lead-masleka.integration.test.ts tests/test-plan/12-std-integration.md
git commit -m "submit-lead: an interested interview gets a clearinghouse request and its link in place of the mandate (dark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 13: The browser's port, its two adapters, and the switch

**Files:**
- Create: `src/config/masleka.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/services/ports.ts`
- Create: `src/services/supabase/SupabaseMaslekaService.ts`
- Create: `src/services/unconfigured/UnconfiguredMaslekaService.ts`
- Modify: `src/services/composition.ts`, `src/services/index.ts`
- Create: `tests/unit/masleka-services.test.ts`, `tests/unit/masleka-config.test.ts`
- Modify: `tests/unit/services-wiring.test.ts`, `tests/unit/lazy-services.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Produces (`src/config/masleka.ts`): `MASLEKA_ENABLED: boolean`, `CLEARINGHOUSE_SAVER_URL = "https://www.swiftness.co.il/"`, `CLEARINGHOUSE_ADVISOR_URL = "https://www.swiftness.co.il/"`.
- Produces (`ports.ts`): `StaffRole`, `MaslekaStatus`, `MaslekaField`, `MaslekaRequest`, `MaslekaLink`, `NewMaslekaRequest`, `MaslekaFailure`, `class MaslekaError(reason: MaslekaFailure, rid?: string)`, `interface MaslekaPort { submitCode(token, code, idNumber): Promise<void>; myRole(): Promise<StaffRole | null>; list(): Promise<MaslekaRequest[]>; create(input: NewMaslekaRequest): Promise<MaslekaLink>; relink(requestId): Promise<MaslekaLink>; reveal(requestId, field: MaslekaField): Promise<string>; markSubmitted(requestId): Promise<void> }`.
- Produces: `SupabaseMaslekaService implements MaslekaPort` (+ `SupabaseMaslekaClient`, `MASLEKA_COLUMNS`, `OPEN_STATUSES`, `toMaslekaRequest`), `UnconfiguredMaslekaService implements MaslekaPort`, `services.masleka` on both the composition root and the lazy front.

- [ ] **Step 1: Write the failing tests**

`tests/unit/masleka-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

/** The UI half of the dark launch: off unless the build says exactly "true". */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const load = async () => (await import("@/config/masleka")).MASLEKA_ENABLED;

describe("VITE_MASLEKA_ENABLED", () => {
  it("is off when unset", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "");
    expect(await load()).toBe(false);
  });

  it.each(["TRUE", "1", "yes", "true "])("is off for %j", async (value) => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", value);
    expect(await load()).toBe(false);
  });

  it("is on for exactly true", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "true");
    expect(await load()).toBe(true);
  });

  it("sends people to the clearinghouse operator over https", async () => {
    const config = await import("@/config/masleka");
    expect(config.CLEARINGHOUSE_SAVER_URL).toMatch(/^https:\/\/www\.swiftness\.co\.il\//);
    expect(config.CLEARINGHOUSE_ADVISOR_URL).toMatch(/^https:\/\/www\.swiftness\.co\.il\//);
  });
});
```

`tests/unit/masleka-services.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MaslekaError } from "@/services/ports";
import {
  MASLEKA_COLUMNS,
  OPEN_STATUSES,
  SupabaseMaslekaService,
  type SupabaseMaslekaClient,
} from "@/services/supabase/SupabaseMaslekaService";
import { UnconfiguredMaslekaService } from "@/services/unconfigured/UnconfiguredMaslekaService";

type Invoke = SupabaseMaslekaClient["functions"]["invoke"];

function fake(options: {
  invoke?: Invoke;
  rpc?: { data: unknown; error: { message: string; code?: string } | null };
  rows?: { data: unknown[] | null; error: { message: string } | null };
} = {}) {
  const calls: unknown[][] = [];
  const client: SupabaseMaslekaClient = {
    rpc: (fn) => {
      calls.push(["rpc", fn]);
      return Promise.resolve(options.rpc ?? { data: "staff", error: null });
    },
    from: (table) => {
      calls.push(["from", table]);
      return {
        select: (columns) => {
          calls.push(["select", columns]);
          return {
            in: (column, values) => {
              calls.push(["in", column, values]);
              return {
                order: (column2, o) => {
                  calls.push(["order", column2, o]);
                  return Promise.resolve(options.rows ?? { data: [], error: null });
                },
              };
            },
          };
        },
      };
    },
    functions: {
      invoke: vi.fn(options.invoke ?? (async () => ({ data: { ok: true, rid: "r1" }, error: null }))),
    },
  };
  return { client, calls, service: new SupabaseMaslekaService(client) };
}

const failure = (status: number, body: unknown) => ({
  data: null,
  error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) },
});

describe("SupabaseMaslekaService — the client's page", () => {
  it("posts the token, the code and the ID to masleka-code", async () => {
    const { client, service } = fake();
    await service.submitCode("T".repeat(43), "AB12-CD34", "000000018");
    expect(client.functions.invoke).toHaveBeenCalledWith("masleka-code", {
      body: { token: "T".repeat(43), code: "AB12-CD34", idNumber: "000000018" },
    });
  });

  it("turns the function's error into a reason the page can word, with the rid", async () => {
    const { service } = fake({ invoke: async () => failure(404, { error: "link_invalid", rid: "abc123" }) });
    const error = await service.submitCode("T".repeat(43), "AB12", "000000018").catch((e) => e);
    expect(error).toBeInstanceOf(MaslekaError);
    expect(error).toMatchObject({ reason: "link_invalid", rid: "abc123" });
  });

  it("calls anything else a failure", async () => {
    const { service } = fake({ invoke: async () => failure(500, { error: "stack trace here" }) });
    await expect(service.submitCode("T".repeat(43), "AB12", "000000018")).rejects.toMatchObject({ reason: "failed" });
    const { service: noContext } = fake({ invoke: async () => ({ data: null, error: { message: "network" } }) });
    await expect(noContext.markSubmitted("r1")).rejects.toMatchObject({ reason: "failed" });
  });
});

describe("SupabaseMaslekaService — the staff board", () => {
  it("asks the database for the caller's role", async () => {
    const { service, calls } = fake({ rpc: { data: "owner", error: null } });
    expect(await service.myRole()).toBe("owner");
    expect(calls).toContainEqual(["rpc", "my_staff_role"]);
  });

  it("knows no role for null or an unknown answer", async () => {
    expect(await fake({ rpc: { data: null, error: null } }).service.myRole()).toBeNull();
    expect(await fake({ rpc: { data: "superuser", error: null } }).service.myRole()).toBeNull();
  });

  it("fails rather than guessing when the role cannot be read", async () => {
    await expect(fake({ rpc: { data: null, error: { message: "boom" } } }).service.myRole()).rejects.toMatchObject({ reason: "failed" });
  });

  it("reads the open requests by the granted columns only, newest first", async () => {
    const row = {
      id: "r1", client_name: "רונית מזרחי", contact_email: null, status: "code_received", lead_id: null,
      id_last4: "0018", created_at: "2026-10-12T08:00:00Z", token_expires_at: "2026-11-11T08:00:00Z",
      client_invited_at: null, code_received_at: "2026-10-13T08:00:00Z", submitted_at: null,
      clearinghouse_deletes_at: null, completed_at: null,
    };
    const { service, calls } = fake({ rows: { data: [row], error: null } });
    expect(await service.list()).toEqual([
      {
        id: "r1", clientName: "רונית מזרחי", contactEmail: null, status: "code_received", leadId: null, idLast4: "0018",
        createdAt: "2026-10-12T08:00:00Z", tokenExpiresAt: "2026-11-11T08:00:00Z", clientInvitedAt: null,
        codeReceivedAt: "2026-10-13T08:00:00Z", submittedAt: null, clearinghouseDeletesAt: null, completedAt: null,
      },
    ]);
    expect(calls).toContainEqual(["from", "masleka_requests"]);
    expect(calls).toContainEqual(["select", MASLEKA_COLUMNS]);
    expect(calls).toContainEqual(["in", "status", [...OPEN_STATUSES]]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    for (const secret of ["code_ciphertext", "id_ciphertext", "token_hash"]) expect(MASLEKA_COLUMNS).not.toContain(secret);
  });

  it("throws when the list cannot be read, so an outage never looks like an empty board", async () => {
    await expect(fake({ rows: { data: null, error: { message: "42501" } } }).service.list()).rejects.toBeInstanceOf(MaslekaError);
  });

  it("creates a request and hands back its link", async () => {
    const { client, service } = fake({
      invoke: async () => ({ data: { ok: true, requestId: "r9", link: "https://govari-fin.co.il/masleka#t=x", invited: true, rid: "q" }, error: null }),
    });
    expect(await service.create({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true })).toEqual({
      requestId: "r9", link: "https://govari-fin.co.il/masleka#t=x", invited: true,
    });
    expect(client.functions.invoke).toHaveBeenCalledWith("masleka-create", {
      body: { clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true },
    });
  });

  it("asks for a fresh link by request id", async () => {
    const { client, service } = fake({
      invoke: async () => ({ data: { ok: true, requestId: "r1", link: "https://govari-fin.co.il/masleka#t=y", invited: false, rid: "q" }, error: null }),
    });
    expect((await service.relink("r1")).link).toBe("https://govari-fin.co.il/masleka#t=y");
    expect(client.functions.invoke).toHaveBeenCalledWith("masleka-create", { body: { requestId: "r1" } });
  });

  it("returns a revealed value, and fails on an answer without one", async () => {
    const ok = fake({ invoke: async () => ({ data: { ok: true, value: "000000018", rid: "q" }, error: null }) });
    expect(await ok.service.reveal("r1", "id")).toBe("000000018");
    expect(ok.client.functions.invoke).toHaveBeenCalledWith("masleka-reveal", { body: { requestId: "r1", field: "id" } });
    const empty = fake({ invoke: async () => ({ data: { ok: true, rid: "q" }, error: null }) });
    await expect(empty.service.reveal("r1", "code")).rejects.toMatchObject({ reason: "failed" });
  });

  it("marks a request submitted", async () => {
    const { client, service } = fake();
    await service.markSubmitted("r1");
    expect(client.functions.invoke).toHaveBeenCalledWith("masleka-submitted", { body: { requestId: "r1" } });
  });

  it("passes a removed membership through as forbidden", async () => {
    const { service } = fake({ invoke: async () => failure(403, { error: "forbidden", rid: "z" }) });
    await expect(service.reveal("r1", "id")).rejects.toMatchObject({ reason: "forbidden", rid: "z" });
  });
});

describe("UnconfiguredMaslekaService", () => {
  it("is never available and gives nobody a role", async () => {
    const service = new UnconfiguredMaslekaService();
    await expect(service.submitCode("t", "c", "i")).rejects.toMatchObject({ reason: "unavailable" });
    await expect(service.list()).rejects.toMatchObject({ reason: "unavailable" });
    expect(await service.myRole()).toBeNull();
  });
});
```

In `tests/unit/services-wiring.test.ts`, add to the object `load()` returns:

```ts
    SupabaseMaslekaService: (await import("@/services/supabase/SupabaseMaslekaService")).SupabaseMaslekaService,
    UnconfiguredMaslekaService: (await import("@/services/unconfigured/UnconfiguredMaslekaService")).UnconfiguredMaslekaService,
```

then in "reads content and leads from Supabase when a client is configured", after `expect(m.services.leads).toBeInstanceOf(m.SupabaseLeadService);`:

```ts
    expect(m.services.masleka).toBeInstanceOf(m.SupabaseMaslekaService);
```

and in "falls back to Base44 when Supabase is not configured", after `expect(m.services.leads).toBeInstanceOf(m.Base44LeadService);`:

```ts
    expect(m.services.masleka).toBeInstanceOf(m.UnconfiguredMaslekaService);
```

Append to `tests/unit/lazy-services.test.ts`:

```ts
describe("the clearinghouse port", () => {
  it("loads the composition root on its first call and delegates to it", async () => {
    const myRole = vi.fn(async () => "staff");
    vi.doMock("@/services/composition", async () => ({ services: { masleka: { myRole } } }));
    const services = await loadFront();
    await expect(services.masleka.myRole()).resolves.toBe("staff");
    expect(myRole).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/masleka-config.test.ts tests/unit/masleka-services.test.ts tests/unit/services-wiring.test.ts tests/unit/lazy-services.test.ts`
Expected: FAIL — `@/config/masleka` and `@/services/supabase/SupabaseMaslekaService` do not exist; `services.masleka` is undefined.

- [ ] **Step 3: Implement**

`src/config/masleka.ts`:

```ts
/**
 * The clearinghouse request pipeline's switch for the site
 * (docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md, PR A).
 *
 * Off unless the build says exactly "true". It ships dark: nothing may
 * collect a code or an ID number before Dorit's compliance adviser has
 * reviewed the page, the storage and the wipe rules (README, "The
 * clearinghouse requests"). The Edge Functions have their own switch,
 * `MASLEKA_ENABLED`; both are turned on together.
 */
export const MASLEKA_ENABLED: boolean = import.meta.env.VITE_MASLEKA_ENABLED === "true";

/**
 * The clearinghouse operator's site, where a saver registers and generates
 * the power-of-attorney code, and where an advisor submits the request. A
 * plain navigation in a new tab — no CSP entry, nothing fetched from it.
 */
export const CLEARINGHOUSE_SAVER_URL = "https://www.swiftness.co.il/";
export const CLEARINGHOUSE_ADVISOR_URL = "https://www.swiftness.co.il/";
```

In `src/vite-env.d.ts`, inside `interface ImportMetaEnv`, after `VITE_LEAD_FUNCTIONS`:

```ts
  /** The clearinghouse pipeline — on only when exactly "true"; see `src/config/masleka.ts`. */
  readonly VITE_MASLEKA_ENABLED?: string;
```

Append to `src/services/ports.ts`:

```ts
/* ─────────────────────────────────────────────────────────────────────────
 * The clearinghouse request pipeline (PR A).
 *
 * The public page calls `submitCode`; the staff board calls the rest.
 * Everything that changes a request is an Edge Function, which checks who is
 * asking on every call; the browser itself only reads, and only the columns
 * the migration grants — never a ciphertext or a token hash.
 * ───────────────────────────────────────────────────────────────────────── */

export type StaffRole = "admin" | "owner" | "agent" | "staff";
export type MaslekaStatus = "invited" | "code_received" | "submitted" | "completed" | "expired" | "cancelled";
export type MaslekaField = "id" | "code";

export interface MaslekaRequest {
  id: string;
  clientName: string;
  contactEmail: string | null;
  status: MaslekaStatus;
  leadId: string | null;
  /** Kept after the wipe, for matching a downloaded file (PR B). */
  idLast4: string | null;
  createdAt: string;
  tokenExpiresAt: string | null;
  clientInvitedAt: string | null;
  codeReceivedAt: string | null;
  submittedAt: string | null;
  /** When the clearinghouse deletes the download: business day 7 after submission. */
  clearinghouseDeletesAt: string | null;
  completedAt: string | null;
}

/** A link to the client's page, shown once to the staff member who asked for it. */
export interface MaslekaLink {
  requestId: string;
  link: string;
  /** Whether it also went to the client by mail. */
  invited: boolean;
}

export interface NewMaslekaRequest {
  clientName: string;
  contactEmail?: string;
  sendInvite: boolean;
}

export type MaslekaFailure =
  | "disabled"
  | "link_invalid"
  | "bad_id"
  | "bad_code"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "not_available"
  | "invalid"
  | "invalid_name"
  | "invalid_email"
  | "unavailable"
  | "failed";

export class MaslekaError extends Error {
  constructor(readonly reason: MaslekaFailure, readonly rid?: string) {
    super(reason);
  }
}

export interface MaslekaPort {
  /** The client's page: the link's token, their code and their ID. */
  submitCode(token: string, code: string, idNumber: string): Promise<void>;
  /** The signed-in user's staff role, or null — decides which screens to offer, nothing more. */
  myRole(): Promise<StaffRole | null>;
  /** Requests still on the board (invited, waiting, submitted, completed), newest first. */
  list(): Promise<MaslekaRequest[]>;
  create(input: NewMaslekaRequest): Promise<MaslekaLink>;
  /** A fresh link for a request still waiting for its code. */
  relink(requestId: string): Promise<MaslekaLink>;
  /** One decrypted value, logged server-side. */
  reveal(requestId: string, field: MaslekaField): Promise<string>;
  /** הגשתי: wipes the code and the ID. */
  markSubmitted(requestId: string): Promise<void>;
}
```

`src/services/supabase/SupabaseMaslekaService.ts`:

```ts
import {
  MaslekaError,
  type MaslekaFailure,
  type MaslekaField,
  type MaslekaLink,
  type MaslekaPort,
  type MaslekaRequest,
  type MaslekaStatus,
  type NewMaslekaRequest,
  type StaffRole,
} from "../ports";

type PostgrestError = { message: string; code?: string } | null;

/** Just the calls this adapter makes — narrowed for the reason SupabaseAuthClient is. */
export interface SupabaseMaslekaClient {
  rpc(fn: "my_staff_role"): PromiseLike<{ data: unknown; error: PostgrestError }>;
  from(table: "masleka_requests"): {
    select(columns: string): {
      in(column: "status", values: string[]): {
        order(column: string, options: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
      };
    };
  };
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
  };
}

/** Exactly the columns the migration grants to `authenticated` and the board shows. */
export const MASLEKA_COLUMNS =
  "id,client_name,contact_email,status,lead_id,id_last4,created_at,token_expires_at,client_invited_at,code_received_at,submitted_at,clearinghouse_deletes_at,completed_at";

/** What the board shows; expired and cancelled requests leave it. */
export const OPEN_STATUSES: readonly MaslekaStatus[] = ["invited", "code_received", "submitted", "completed"];

const ROLES = new Set<string>(["admin", "owner", "agent", "staff"]);
const REASONS = new Set<string>([
  "disabled", "link_invalid", "bad_id", "bad_code", "rate_limited", "unauthorized", "forbidden",
  "not_found", "not_available", "invalid", "invalid_name", "invalid_email", "unavailable", "failed",
]);

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function toMaslekaRequest(row: Record<string, unknown>): MaslekaRequest {
  return {
    id: String(row.id),
    clientName: text(row.client_name) ?? "",
    contactEmail: text(row.contact_email),
    status: (text(row.status) ?? "invited") as MaslekaStatus,
    leadId: text(row.lead_id),
    idLast4: text(row.id_last4),
    createdAt: text(row.created_at) ?? "",
    tokenExpiresAt: text(row.token_expires_at),
    clientInvitedAt: text(row.client_invited_at),
    codeReceivedAt: text(row.code_received_at),
    submittedAt: text(row.submitted_at),
    clearinghouseDeletesAt: text(row.clearinghouse_deletes_at),
    completedAt: text(row.completed_at),
  };
}

/**
 * supabase-js resolves a non-2xx answer as `{ error }` with the Response on
 * `error.context`. Its body names the reason in a closed vocabulary and the
 * rid; anything outside the vocabulary is a plain failure, never shown.
 */
async function failure(error: { message: string; context?: unknown }): Promise<MaslekaError> {
  const res = error.context;
  const body =
    res instanceof Response ? ((await res.json().catch(() => null)) as { error?: unknown; rid?: unknown } | null) : null;
  const reason = typeof body?.error === "string" && REASONS.has(body.error) ? (body.error as MaslekaFailure) : "failed";
  return new MaslekaError(reason, typeof body?.rid === "string" ? body.rid : undefined);
}

function linkFrom(data: Record<string, unknown>): MaslekaLink {
  if (typeof data.requestId !== "string" || typeof data.link !== "string") throw new MaslekaError("failed");
  return { requestId: data.requestId, link: data.link, invited: data.invited === true };
}

/** The clearinghouse pipeline on Supabase: RLS reads under the session, Edge Functions for the rest. */
export class SupabaseMaslekaService implements MaslekaPort {
  constructor(private readonly client: SupabaseMaslekaClient) {}

  private async call(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.functions.invoke(name, { body });
    if (error) throw await failure(error);
    return (data ?? {}) as Record<string, unknown>;
  }

  async submitCode(token: string, code: string, idNumber: string): Promise<void> {
    await this.call("masleka-code", { token, code, idNumber });
  }

  async myRole(): Promise<StaffRole | null> {
    const { data, error } = await this.client.rpc("my_staff_role");
    if (error) throw new MaslekaError("failed");
    return typeof data === "string" && ROLES.has(data) ? (data as StaffRole) : null;
  }

  async list(): Promise<MaslekaRequest[]> {
    const { data, error } = await this.client
      .from("masleka_requests")
      .select(MASLEKA_COLUMNS)
      .in("status", [...OPEN_STATUSES])
      .order("created_at", { ascending: false });
    if (error) throw new MaslekaError("failed");
    return (data ?? []).map((row) => toMaslekaRequest(row as Record<string, unknown>));
  }

  async create(input: NewMaslekaRequest): Promise<MaslekaLink> {
    return linkFrom(
      await this.call("masleka-create", {
        clientName: input.clientName,
        contactEmail: input.contactEmail ?? "",
        sendInvite: input.sendInvite,
      }),
    );
  }

  async relink(requestId: string): Promise<MaslekaLink> {
    return linkFrom(await this.call("masleka-create", { requestId }));
  }

  async reveal(requestId: string, field: MaslekaField): Promise<string> {
    const data = await this.call("masleka-reveal", { requestId, field });
    if (typeof data.value !== "string") throw new MaslekaError("failed");
    return data.value;
  }

  async markSubmitted(requestId: string): Promise<void> {
    await this.call("masleka-submitted", { requestId });
  }
}
```

`src/services/unconfigured/UnconfiguredMaslekaService.ts`:

```ts
import { MaslekaError, type MaslekaPort, type MaslekaRequest, type StaffRole } from "../ports";

/**
 * The clearinghouse pipeline for a build with no Supabase credentials: never
 * available, and nobody is staff — the same "signed out" stance as
 * UnconfiguredAccountService, rather than a TypeError from a null client.
 */
export class UnconfiguredMaslekaService implements MaslekaPort {
  async submitCode(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
  async myRole(): Promise<StaffRole | null> {
    return null;
  }
  async list(): Promise<MaslekaRequest[]> {
    throw new MaslekaError("unavailable");
  }
  async create(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async relink(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async reveal(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async markSubmitted(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
}
```

In `src/services/composition.ts`:

(a) add imports next to the other adapters:

```ts
import { SupabaseMaslekaService, type SupabaseMaslekaClient } from "./supabase/SupabaseMaslekaService";
import { UnconfiguredMaslekaService } from "./unconfigured/UnconfiguredMaslekaService";
```

and add `MaslekaPort,` to the `import type { … } from "./ports";` list.

(b) before `export const services`, add:

```ts
/**
 * The clearinghouse pipeline, on Supabase — the only place its tables and
 * functions exist. Without credentials, a stand-in that is never available.
 * Whether any of it is shown is MASLEKA_ENABLED's decision, not this one.
 */
const maslekaPort: MaslekaPort = supabase
  ? new SupabaseMaslekaService(supabase as unknown as SupabaseMaslekaClient)
  : new UnconfiguredMaslekaService();
```

(c) add `masleka: maslekaPort,` as the last member of `services`.

In `src/services/index.ts`:

(a) add `MaslekaPort,` to the `import type { … } from "./ports";` list;

(b) add to `export interface Services`, after `account: AccountPort;`:

```ts
  /** The clearinghouse requests: the client's page and the staff board. */
  masleka: MaslekaPort;
```

(c) add to `export const services`, after the `account: { … },` member:

```ts
  masleka: {
    submitCode: (token, code, idNumber) => real().then((s) => s.masleka.submitCode(token, code, idNumber)),
    myRole: () => real().then((s) => s.masleka.myRole()),
    list: () => real().then((s) => s.masleka.list()),
    create: (input) => real().then((s) => s.masleka.create(input)),
    relink: (requestId) => real().then((s) => s.masleka.relink(requestId)),
    reveal: (requestId, field) => real().then((s) => s.masleka.reveal(requestId, field)),
    markSubmitted: (requestId) => real().then((s) => s.masleka.markSubmitted(requestId)),
  },
```

Add to `tests/test-plan/01-std-unit.md` before "## 5. Pass criteria" (raise the count by 22):

```markdown
### 4.26 The clearinghouse port and its switch — `tests/unit/masleka-services.test.ts`, `tests/unit/masleka-config.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKSVC-001 | "posts the token, the code and the ID to masleka-code" | One invoke with exactly those three |
| UNIT-MSKSVC-002 | "turns the function's error into a reason the page can word, with the rid" | `MaslekaError('link_invalid', 'abc123')` |
| UNIT-MSKSVC-003 | "calls anything else a failure" | Unknown reason or no Response → `failed` |
| UNIT-MSKSVC-004 | "asks the database for the caller's role" | `rpc('my_staff_role')` |
| UNIT-MSKSVC-005 | "knows no role for null or an unknown answer" | `null` |
| UNIT-MSKSVC-006 | "fails rather than guessing when the role cannot be read" | Rejects `failed` |
| UNIT-MSKSVC-007 | "reads the open requests by the granted columns only, newest first" | `MASLEKA_COLUMNS` (no ciphertext/hash), four statuses, `created_at desc`, camelCase |
| UNIT-MSKSVC-008 | "throws when the list cannot be read, so an outage never looks like an empty board" | Rejects |
| UNIT-MSKSVC-009 | "creates a request and hands back its link" | Body and `MaslekaLink` |
| UNIT-MSKSVC-010 | "asks for a fresh link by request id" | `{ requestId }` |
| UNIT-MSKSVC-011 | "returns a revealed value, and fails on an answer without one" | Value; `failed` |
| UNIT-MSKSVC-012 | "marks a request submitted" | `masleka-submitted` |
| UNIT-MSKSVC-013 | "passes a removed membership through as forbidden" | `forbidden` with rid |
| UNIT-MSKSVC-014 | "is never available and gives nobody a role" | Unconfigured: `unavailable`, `null` |
| UNIT-MSKCFG-001..007 | "is off when unset" / "is off for %j" ×4 / "is on for exactly true" / "sends people to the clearinghouse operator over https" | Only `"true"` enables; https swiftness URLs |
| UNIT-LAZY-007 | "loads the composition root on its first call and delegates to it" | `services.masleka.myRole()` reaches the root once |
| UNIT-WIRE (two existing cases) | "reads content and leads from Supabase…" / "falls back to Base44…" | Also assert `SupabaseMaslekaService` / `UnconfiguredMaslekaService` |
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/unit/masleka-config.test.ts tests/unit/masleka-services.test.ts tests/unit/services-wiring.test.ts tests/unit/lazy-services.test.ts && npm run typecheck && npm run lint`
Expected: PASS; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/masleka.ts src/vite-env.d.ts src/services/ports.ts src/services/supabase/SupabaseMaslekaService.ts src/services/unconfigured/UnconfiguredMaslekaService.ts src/services/composition.ts src/services/index.ts tests/unit/masleka-config.test.ts tests/unit/masleka-services.test.ts tests/unit/services-wiring.test.ts tests/unit/lazy-services.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: the browser's port, its Supabase and unconfigured adapters, and VITE_MASLEKA_ENABLED (off)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 14: The board's and the page's pure helpers (including the clipboard fallback)

**Files:**
- Create: `src/lib/masleka.ts`
- Create: `tests/unit/masleka-board.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: `MaslekaRequest` (ports).
- Produces: `READY_AFTER_MS`; `interface BoardColumns { invited; waiting; submitted; completed: MaslekaRequest[] }`; `boardColumns(requests: MaslekaRequest[]): BoardColumns`; `readinessLabel(submittedAt: string | null, now: Date): string`; `daysUntil(iso: string | null, now: Date): number | null`; `deletionLabel(iso: string | null, now: Date): string`; `interface ClipboardLike { writeText(text: string): Promise<void> }`; `copyOrFallback(value: string, clipboard: ClipboardLike | null | undefined): Promise<'copied' | 'manual'>`; `readTokenFromHash(hash: string): string | null`; `isPlausibleCode(value: string): boolean`.

- [ ] **Step 1: Write the failing test** — `tests/unit/masleka-board.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import {
  boardColumns,
  copyOrFallback,
  daysUntil,
  deletionLabel,
  isPlausibleCode,
  readTokenFromHash,
  readinessLabel,
} from "@/lib/masleka";
import type { MaslekaRequest } from "@/services/ports";

const NOW = new Date("2026-10-13T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (offset: number) => new Date(NOW.getTime() + offset).toISOString();

const request = (over: Partial<MaslekaRequest>): MaslekaRequest => ({
  id: "r", clientName: "לקוח", contactEmail: null, status: "invited", leadId: null, idLast4: null,
  createdAt: iso(-DAY), tokenExpiresAt: null, clientInvitedAt: null, codeReceivedAt: null,
  submittedAt: null, clearinghouseDeletesAt: null, completedAt: null, ...over,
});

describe("boardColumns", () => {
  it("puts each request in its column, oldest waiting first, and drops what left the board", () => {
    const columns = boardColumns([
      request({ id: "w2", status: "code_received", codeReceivedAt: iso(-HOUR) }),
      request({ id: "w1", status: "code_received", codeReceivedAt: iso(-2 * HOUR) }),
      request({ id: "s1", status: "submitted", submittedAt: iso(-HOUR) }),
      request({ id: "i1", status: "invited" }),
      request({ id: "c1", status: "completed", completedAt: iso(-HOUR) }),
      request({ id: "x1", status: "expired" }),
      request({ id: "x2", status: "cancelled" }),
    ]);
    expect(columns.waiting.map((r) => r.id)).toEqual(["w1", "w2"]);
    expect(columns.submitted.map((r) => r.id)).toEqual(["s1"]);
    expect(columns.invited.map((r) => r.id)).toEqual(["i1"]);
    expect(columns.completed.map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("readinessLabel", () => {
  it("says when the files should be ready, then that they are", () => {
    expect(readinessLabel(iso(-2 * HOUR), NOW)).toBe("מוכן בעוד כ־3–4 שעות");
    expect(readinessLabel(iso(-4 * HOUR), NOW)).toBe("מוכן להורדה");
    expect(readinessLabel(null, NOW)).toBe("");
  });
});

describe("deletionLabel", () => {
  it("counts the days the clearinghouse still keeps the files", () => {
    expect(daysUntil(iso(5 * DAY), NOW)).toBe(5);
    expect(deletionLabel(iso(5 * DAY), NOW)).toBe("5 ימים עד מחיקה במסלקה");
    expect(deletionLabel(iso(DAY), NOW)).toBe("יום אחד עד מחיקה במסלקה");
    expect(deletionLabel(iso(12 * HOUR), NOW)).toBe("יום אחד עד מחיקה במסלקה");
  });

  it("says when they are gone, and nothing when there is no date", () => {
    expect(deletionLabel(iso(-HOUR), NOW)).toBe("נמחק במסלקה");
    expect(deletionLabel(null, NOW)).toBe("");
    expect(daysUntil("not a date", NOW)).toBeNull();
  });
});

describe("copyOrFallback", () => {
  it("copies when the clipboard works", async () => {
    const clipboard = { writeText: vi.fn(async () => {}) };
    expect(await copyOrFallback("000000018", clipboard)).toBe("copied");
    expect(clipboard.writeText).toHaveBeenCalledWith("000000018");
  });

  it("falls back when there is no clipboard (a non-secure page, an old browser)", async () => {
    expect(await copyOrFallback("000000018", null)).toBe("manual");
    expect(await copyOrFallback("000000018", undefined)).toBe("manual");
    expect(await copyOrFallback("000000018", {} as never)).toBe("manual");
  });

  it("falls back when the browser refuses, however it refuses", async () => {
    expect(await copyOrFallback("x", { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) })).toBe("manual");
    expect(await copyOrFallback("x", { writeText: () => { throw new TypeError("no"); } })).toBe("manual");
  });
});

describe("readTokenFromHash", () => {
  const token = "Ab3_-".repeat(8) + "xyz";
  it("reads a token from the link's fragment", () => {
    expect(readTokenFromHash(`#t=${token}`)).toBe(token);
  });
  it("reads nothing else", () => {
    expect(readTokenFromHash("")).toBeNull();
    expect(readTokenFromHash("#t=short")).toBeNull();
    expect(readTokenFromHash(`#x=${token}`)).toBeNull();
    expect(readTokenFromHash(`#t=${token}&utm=1`)).toBeNull();
  });
});

describe("isPlausibleCode", () => {
  it("accepts what the clearinghouse could issue and nothing that carries markup", () => {
    expect(isPlausibleCode(" AB12-CD34 ")).toBe(true);
    expect(isPlausibleCode("ab")).toBe(false);
    expect(isPlausibleCode("<b>x</b>")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/masleka-board.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/masleka"`.

- [ ] **Step 3: Implement** — `src/lib/masleka.ts`

```ts
import type { MaslekaRequest } from "@/services/ports";

/**
 * What the clearinghouse page and the staff board compute, without a DOM.
 *
 * The clearinghouse answers an all-bodies request in about 3–4 hours and
 * deletes the download after 7 business days; `clearinghouseDeletesAt` comes
 * from the server (masleka-submitted), so the board only counts down to it.
 */
export const READY_AFTER_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface BoardColumns {
  invited: MaslekaRequest[];
  waiting: MaslekaRequest[];
  submitted: MaslekaRequest[];
  completed: MaslekaRequest[];
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/** Each request in its column; the longest-waiting first, so the oldest is worked first. */
export function boardColumns(requests: MaslekaRequest[]): BoardColumns {
  const of = (status: MaslekaRequest["status"]) => requests.filter((r) => r.status === status);
  return {
    invited: of("invited").sort((a, b) => time(a.createdAt) - time(b.createdAt)),
    waiting: of("code_received").sort((a, b) => time(a.codeReceivedAt) - time(b.codeReceivedAt)),
    submitted: of("submitted").sort((a, b) => time(a.submittedAt) - time(b.submittedAt)),
    completed: of("completed").sort((a, b) => time(b.completedAt) - time(a.completedAt)),
  };
}

export function readinessLabel(submittedAt: string | null, now: Date): string {
  if (!submittedAt) return "";
  return now.getTime() - Date.parse(submittedAt) >= READY_AFTER_MS ? "מוכן להורדה" : "מוכן בעוד כ־3–4 שעות";
}

export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.ceil((at - now.getTime()) / DAY_MS);
}

export function deletionLabel(iso: string | null, now: Date): string {
  const days = daysUntil(iso, now);
  if (days === null) return "";
  if (days <= 0) return "נמחק במסלקה";
  if (days === 1) return "יום אחד עד מחיקה במסלקה";
  return `${days} ימים עד מחיקה במסלקה`;
}

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/**
 * Copy, or say it must be done by hand.
 *
 * `navigator.clipboard` is missing outside a secure context and in older
 * browsers, and a browser may refuse it (permissions, focus) by rejecting or
 * by throwing. Every one of those is "manual": the caller then shows the
 * value selected in a read-only field with "העתק ידנית".
 */
export async function copyOrFallback(
  value: string,
  clipboard: ClipboardLike | null | undefined,
): Promise<"copied" | "manual"> {
  if (!clipboard || typeof clipboard.writeText !== "function") return "manual";
  try {
    await clipboard.writeText(value);
    return "copied";
  } catch {
    return "manual";
  }
}

/** The token from `#t=<43 base64url characters>`, and nothing looser. */
export function readTokenFromHash(hash: string): string | null {
  const match = /^#t=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? match[1] : null;
}

/** The same shape `masleka-code` accepts (normalizeCode): 4–64 letters, digits, hyphens. */
export function isPlausibleCode(value: string): boolean {
  return /^[A-Za-z0-9-]{4,64}$/.test(value.trim());
}
```

Add to `tests/test-plan/01-std-unit.md` before "## 5. Pass criteria" (raise the count by 10):

```markdown
### 4.27 The clearinghouse board's helpers — `tests/unit/masleka-board.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-MSKBD-001 | "puts each request in its column, oldest waiting first, and drops what left the board" | Four columns; expired/cancelled absent |
| UNIT-MSKBD-002 | "says when the files should be ready, then that they are" | 4-hour threshold |
| UNIT-MSKBD-003 | "counts the days the clearinghouse still keeps the files" | 5 / 1 / partial day = 1 |
| UNIT-MSKBD-004 | "says when they are gone, and nothing when there is no date" | "נמחק במסלקה"; "" |
| UNIT-MSKBD-005 | "copies when the clipboard works" | `copied` |
| UNIT-MSKBD-006 | "falls back when there is no clipboard (a non-secure page, an old browser)" | `manual` |
| UNIT-MSKBD-007 | "falls back when the browser refuses, however it refuses" | `manual` for a rejection and a throw |
| UNIT-MSKBD-008 | "reads a token from the link's fragment" | The token |
| UNIT-MSKBD-009 | "reads nothing else" | `null` for empty, short, other key, extra params |
| UNIT-MSKBD-010 | "accepts what the clearinghouse could issue and nothing that carries markup" | Shape check |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/masleka-board.test.ts && npm run typecheck && npm run lint`
Expected: PASS (10); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/masleka.ts tests/unit/masleka-board.test.ts tests/test-plan/01-std-unit.md
git commit -m "masleka: board columns, countdown labels, a clipboard that falls back to manual copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 15: The client's page, `/masleka`

**Files:**
- Create: `src/components/masleka/MaslekaSteps.tsx`
- Create: `src/pages/Masleka.tsx`
- Modify: `src/App.jsx`
- Modify: `src/components/SeoRouteGuard.tsx`
- Modify: `public/robots.txt`
- Modify: `tests/contract/ai-surface.contract.test.ts`
- Create: `tests/component/masleka-page.test.tsx`
- Modify: `tests/test-plan/02-std-component.md`, `tests/test-plan/11-std-seo.md`

**Interfaces:**
- Consumes: `MASLEKA_ENABLED`, `CLEARINGHOUSE_SAVER_URL`; `normalizeIsraeliId`; `readTokenFromHash`, `isPlausibleCode`; `services.masleka.submitCode`, `MaslekaError`.
- Produces: `MaslekaSteps({ steps: MaslekaStep[]; screenshots?: StepScreens })`, `type MaslekaStep = { title: string; body: React.ReactNode }`, `type StepScreens = Partial<Record<number, React.ReactNode>>`; page `Masleka({ enabled?, submit?, screenshots? }: MaslekaPageProps)` routed at `/masleka`.

- [ ] **Step 1: Write the failing test** — `tests/component/masleka-page.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

import Masleka from "@/pages/Masleka";
import SeoRouteGuard from "@/components/SeoRouteGuard";
import { MaslekaError } from "@/services/ports";

const TOKEN = "Ab3_-".repeat(8) + "xyz";

const renderPage = (props: React.ComponentProps<typeof Masleka>) =>
  render(
    <MemoryRouter>
      <Masleka {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.history.replaceState(null, "", `/masleka#t=${TOKEN}`);
});

describe("<Masleka /> — dark", () => {
  it("says the service is unavailable when the switch is off, and offers no form", () => {
    const submit = vi.fn();
    renderPage({ enabled: false, submit });
    expect(screen.getByRole("heading", { name: "השירות אינו זמין כרגע" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("<Masleka /> — on", () => {
  it("takes the link's token out of the address bar", () => {
    renderPage({ enabled: true, submit: vi.fn() });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/masleka");
  });

  it("sends the code and the nine-digit ID with the link's token, then only thanks", async () => {
    const submit = vi.fn(async () => {});
    renderPage({ enabled: true, submit });
    await userEvent.type(screen.getByLabelText("קוד ייפוי הכוח מאתר המסלקה"), " AB12-CD34 ");
    await userEvent.type(screen.getByLabelText("מספר תעודת זהות"), "00018");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(submit).toHaveBeenCalledWith(TOKEN, "AB12-CD34", "000000018");
    expect(await screen.findByRole("heading", { name: "תודה — דורית תטפל בזה" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("00018")).toBeNull();
    expect(screen.queryByDisplayValue(/AB12-CD34/)).toBeNull();
  });

  it("refuses an ID that fails the check digit before sending", async () => {
    const submit = vi.fn();
    renderPage({ enabled: true, submit });
    await userEvent.type(screen.getByLabelText("קוד ייפוי הכוח מאתר המסלקה"), "AB12-CD34");
    await userEvent.type(screen.getByLabelText("מספר תעודת זהות"), "000000019");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(screen.getByRole("alert")).toHaveTextContent("מספר תעודת הזהות אינו תקין");
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a code that cannot be one", async () => {
    const submit = vi.fn();
    renderPage({ enabled: true, submit });
    await userEvent.type(screen.getByLabelText("קוד ייפוי הכוח מאתר המסלקה"), "ab");
    await userEvent.type(screen.getByLabelText("מספר תעודת זהות"), "000000018");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(screen.getByRole("alert")).toHaveTextContent("הקוד אינו נראה תקין");
    expect(submit).not.toHaveBeenCalled();
  });

  it("explains a link that is no longer valid", async () => {
    const submit = vi.fn(async () => {
      throw new MaslekaError("link_invalid", "r1");
    });
    renderPage({ enabled: true, submit });
    await userEvent.type(screen.getByLabelText("קוד ייפוי הכוח מאתר המסלקה"), "AB12-CD34");
    await userEvent.type(screen.getByLabelText("מספר תעודת זהות"), "000000018");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("אינו בתוקף עוד");
  });

  it("asks for the link when there is no token", () => {
    window.history.replaceState(null, "", "/masleka");
    renderPage({ enabled: true, submit: vi.fn() });
    expect(screen.getByRole("heading", { name: "הקישור חסר או שגוי" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("links to the clearinghouse in a new tab without a referrer", () => {
    renderPage({ enabled: true, submit: vi.fn() });
    const link = screen.getByRole("link", { name: "לאתר המסלקה" });
    expect(link).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("renders no screenshot slot when none is given, and the given one when it is", () => {
    const { unmount } = renderPage({ enabled: true, submit: vi.fn() });
    expect(screen.queryAllByRole("figure")).toHaveLength(0);
    unmount();
    window.history.replaceState(null, "", `/masleka#t=${TOKEN}`);
    renderPage({ enabled: true, submit: vi.fn(), screenshots: { 2: <img alt="הפקת הקוד" src="/x.png" /> } });
    expect(screen.getAllByRole("figure")).toHaveLength(1);
    expect(screen.getByAltText("הפקת הקוד")).toBeInTheDocument();
  });
});

describe("/masleka in search", () => {
  it("is marked noindex", async () => {
    render(
      <MemoryRouter initialEntries={["/masleka"]}>
        <SeoRouteGuard />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/),
    );
  });
});
```

In `tests/contract/ai-surface.contract.test.ts`, change the "keeps the private routes out for everyone" loop to:

```ts
    for (const path of ["/admin/", "/login", "/masleka"]) {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/component/masleka-page.test.tsx tests/contract/ai-surface.contract.test.ts`
Expected: FAIL — `@/pages/Masleka` does not exist; robots.txt lacks `Disallow: /masleka`.

- [ ] **Step 3: Implement**

`src/components/masleka/MaslekaSteps.tsx`:

```tsx
import React from "react";

export interface MaslekaStep {
  title: string;
  body: React.ReactNode;
}

/**
 * Screenshots by step number (1-based). None ship today — the clearinghouse
 * screens have not been captured — so an absent entry renders nothing, not a
 * placeholder. Pass `{ 2: <img … /> }` to add one.
 */
export type StepScreens = Partial<Record<number, React.ReactNode>>;

export default function MaslekaSteps({ steps, screenshots = {} }: { steps: MaslekaStep[]; screenshots?: StepScreens }) {
  return (
    <ol className="space-y-6">
      {steps.map((step, i) => {
        const shot = screenshots[i + 1];
        return (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden="true"
              className="flex-none w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-heading"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <h2 className="font-heading text-lg">{step.title}</h2>
              <div className="mt-1 text-muted-foreground leading-relaxed">{step.body}</div>
              {shot ? <figure className="mt-3 border border-border/60 overflow-hidden">{shot}</figure> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

`src/pages/Masleka.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import MaslekaSteps, { type MaslekaStep, type StepScreens } from "@/components/masleka/MaslekaSteps";
import { CLEARINGHOUSE_SAVER_URL, MASLEKA_ENABLED } from "@/config/masleka";
import { normalizeIsraeliId } from "@/lib/israeli-id";
import { isPlausibleCode, readTokenFromHash } from "@/lib/masleka";
import { MaslekaError, services } from "@/services";

/**
 * /masleka — where a client hands over the clearinghouse power-of-attorney
 * code and their ID number, from the personal link in their mail.
 *
 * The token travels in the fragment (`#t=…`) and is taken out of the address
 * bar on the first render, so it stays out of history, screenshots and
 * anything that later reads `location`. Nothing is sent until both values
 * pass the same checks the function makes; after a successful send the page
 * says thank you and nothing else, and the values are cleared.
 *
 * Dark until VITE_MASLEKA_ENABLED: then it only says the service is not
 * available, and never posts.
 */
export interface MaslekaPageProps {
  enabled?: boolean;
  submit?: (token: string, code: string, idNumber: string) => Promise<void>;
  /** Optional screenshots for the three steps; none ship today. */
  screenshots?: StepScreens;
}

const FAILURE: Record<string, string> = {
  link_invalid:
    "הקישור הזה אינו בתוקף עוד — ייתכן שכבר נעשה בו שימוש, שפג תוקפו, או שנשלח אליכם קישור חדש יותר. אפשר להשיב למייל ונשלח קישור חדש.",
  rate_limited: "היו כאן יותר מדי ניסיונות. נסו שוב בעוד שעה.",
  bad_id: "מספר תעודת הזהות אינו תקין. בדקו את הספרות ונסו שוב.",
  bad_code: "הקוד אינו נראה תקין. העתיקו אותו שוב מאתר המסלקה.",
};
const GENERIC_FAILURE = "השליחה לא הצליחה. נסו שוב בעוד כמה דקות, או השיבו למייל שקיבלתם.";

const STEPS: MaslekaStep[] = [
  {
    title: "נרשמים לאתר המסלקה הפנסיונית",
    body: (
      <>
        ההרשמה ללא עלות.{" "}
        <a href={CLEARINGHOUSE_SAVER_URL} target="_blank" rel="noopener noreferrer" className="underline text-accent">
          לאתר המסלקה
        </a>
      </>
    ),
  },
  {
    title: "מפיקים קוד ייפוי כוח",
    body: <>באזור האישי באתר המסלקה לוחצים על „הפקת קוד ייפוי כוח” ומעתיקים את הקוד שמתקבל.</>,
  },
  {
    title: "מדביקים כאן את הקוד ואת מספר הזהות",
    body: <>ושולחים. דורית תגיש בשמכם את הבקשה במסלקה ותקבל את הנתונים לקראת הפגישה.</>,
  },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-5">
          <Link to="/" className="font-heading text-xl">
            דורית גוב ארי
          </Link>
          <p className="text-sm text-muted-foreground mt-1">מתכננת פיננסית וסוכנת ביטוח</p>
        </div>
      </header>
      <main className="max-w-[720px] mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}

export default function Masleka({
  enabled = MASLEKA_ENABLED,
  submit = (token, code, idNumber) => services.masleka.submitCode(token, code, idNumber),
  screenshots,
}: MaslekaPageProps) {
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readTokenFromHash(window.location.hash),
  );
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);
  const [code, setCode] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [phase, setPhase] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return (
      <Shell>
        <h1 className="font-heading text-2xl md:text-3xl">השירות אינו זמין כרגע</h1>
        <p className="mt-4 text-muted-foreground">אפשר להשיב למייל שקיבלתם, ודורית תחזור אליכם.</p>
        <Link to="/" className="inline-block mt-6 underline text-accent">
          חזרה לאתר
        </Link>
      </Shell>
    );
  }

  if (phase === "done") {
    return (
      <Shell>
        <h1 className="font-heading text-2xl md:text-3xl">תודה — דורית תטפל בזה</h1>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <h1 className="font-heading text-2xl md:text-3xl">הקישור חסר או שגוי</h1>
        <p className="mt-4 text-muted-foreground">פתחו את הקישור מהמייל שקיבלתם, כפי שהוא.</p>
      </Shell>
    );
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const id = normalizeIsraeliId(idNumber);
    if (!id) {
      setError(FAILURE.bad_id);
      return;
    }
    const trimmed = code.trim();
    if (!isPlausibleCode(trimmed)) {
      setError(FAILURE.bad_code);
      return;
    }
    setPhase("sending");
    try {
      await submit(token, trimmed, id);
      setCode("");
      setIdNumber("");
      setPhase("done");
    } catch (e) {
      setPhase("form");
      setError(e instanceof MaslekaError ? FAILURE[e.reason] ?? GENERIC_FAILURE : GENERIC_FAILURE);
    }
  };

  return (
    <Shell>
      <h1 className="font-heading text-2xl md:text-3xl">מסירת קוד המסלקה</h1>
      <p className="mt-4 text-muted-foreground leading-relaxed">
        כדי שדורית תוכל להכין לפגישה תמונה מלאה של הפנסיה, הגמל וההשתלמות שלכם, היא צריכה את אישורכם במסלקה
        הפנסיונית. שלושה צעדים, כמה דקות:
      </p>
      <div className="mt-8">
        <MaslekaSteps steps={STEPS} screenshots={screenshots} />
      </div>
      <form onSubmit={onSubmit} noValidate aria-label="מסירת קוד המסלקה" className="mt-10 space-y-5 border border-border/60 bg-card p-5">
        <div>
          <label htmlFor="masleka-code" className="block text-sm font-medium">
            קוד ייפוי הכוח מאתר המסלקה
          </label>
          <input
            id="masleka-code"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-2 w-full border border-border bg-background px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="masleka-id" className="block text-sm font-medium">
            מספר תעודת זהות
          </label>
          <input
            id="masleka-id"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            className="mt-2 w-full border border-border bg-background px-3 py-2"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={phase === "sending"}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 disabled:opacity-60"
        >
          {phase === "sending" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          שליחה
        </button>
        <p className="text-xs text-muted-foreground leading-relaxed">
          הקוד ומספר הזהות נשמרים מוצפנים, משמשים רק להגשת הבקשה במסלקה בשמכם, ונמחקים מיד לאחר ההגשה — ולכל
          המאוחר כעבור 9 ימים.
        </p>
      </form>
    </Shell>
  );
}
```

In `src/App.jsx`: add `const Masleka = lazy(() => import('@/pages/Masleka'));` after the `Perspective` lazy import, and the route after `<Route path="/perspective" element={<Perspective />} />`:

```jsx
        <Route path="/masleka" element={<Masleka />} />
```

In `src/components/SeoRouteGuard.tsx`, add to `NO_INDEX_ROUTES` after the `/account` entry:

```ts
  { match: /^\/masleka\/?$/, title: "מסירת קוד המסלקה | דורית גוב ארי", description: "מסירת קוד ייפוי כוח למסלקה הפנסיונית." },
```

In `public/robots.txt`, after `Disallow: /oauth/`:

```
Disallow: /masleka
```

(Only in the `*` group: the AI groups below must keep no `Disallow: /…` line — `ai-surface.contract.test.ts` "allows them, and disallows none of them by accident". The page also carries `noindex`, and its link's token never reaches a crawler.)

Add to `tests/test-plan/02-std-component.md` before "## 5. Pass criteria" (raise the count by 10):

```markdown
### 4.15 `<Masleka />` — the client's clearinghouse page — `tests/component/masleka-page.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSK-001 | "says the service is unavailable when the switch is off, and offers no form" | Heading; no form; nothing sent |
| CMP-MSK-002 | "takes the link's token out of the address bar" | Hash empty, path `/masleka` |
| CMP-MSK-003 | "sends the code and the nine-digit ID with the link's token, then only thanks" | `submit(token, 'AB12-CD34', '000000018')`; thanks; values gone |
| CMP-MSK-004 | "refuses an ID that fails the check digit before sending" | Alert; not sent |
| CMP-MSK-005 | "refuses a code that cannot be one" | Alert; not sent |
| CMP-MSK-006 | "explains a link that is no longer valid" | "אינו בתוקף עוד" |
| CMP-MSK-007 | "asks for the link when there is no token" | Heading; no form |
| CMP-MSK-008 | "links to the clearinghouse in a new tab without a referrer" | `_blank`, `noopener noreferrer` |
| CMP-MSK-009 | "renders no screenshot slot when none is given, and the given one when it is" | 0 figures; then 1 |
| CMP-MSK-010 | "is marked noindex" | SeoRouteGuard writes `noindex` on `/masleka` |
```

Add to `tests/test-plan/11-std-seo.md`, as a new subsection immediately before its pass-criteria heading:

```markdown
### The clearinghouse page stays out of search

| Route | How it is kept out | Pinned by |
|---|---|---|
| `/masleka` | `noindex` from SeoRouteGuard; `Disallow: /masleka` in the `*` group of robots.txt; absent from the sitemap, prerender `ROUTES` and `llms.txt`; the link's token rides in the fragment | CMP-MSK-010; `ai-surface.contract.test.ts` "keeps the private routes out for everyone"; E2E-MSK-001 |
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/component/masleka-page.test.tsx tests/contract/ai-surface.contract.test.ts tests/unit/seo.dom.test.ts tests/security && npm run typecheck && npm run lint`
Expected: PASS; the security suite's new-tab and sink checks still pass; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/masleka/MaslekaSteps.tsx src/pages/Masleka.tsx src/App.jsx src/components/SeoRouteGuard.tsx public/robots.txt tests/contract/ai-surface.contract.test.ts tests/component/masleka-page.test.tsx tests/test-plan/02-std-component.md tests/test-plan/11-std-seo.md
git commit -m "masleka: the client's page — three steps, a checked ID, the token out of the address bar; dark by default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 16: `StaffRoute` — admin, or a member of the agency

**Files:**
- Create: `src/components/StaffRoute.tsx`
- Create: `tests/component/staff-route.test.tsx`
- Modify: `tests/test-plan/02-std-component.md`

**Interfaces:**
- Consumes: `useAuth()` (`user`, `isAuthenticated`, `isLoadingAuth`, `authChecked`, `authError`, `checkUserAuth`); `ProtectedRoute`; `services.masleka.myRole()`.
- Produces: `StaffRoute({ unauthenticatedElement: React.ReactElement; loadRole?: () => Promise<StaffRole | null> })` — renders `<Outlet />` for `user.role === 'admin'` (no RPC) or a non-null `loadRole()`; `<Navigate to="/" replace />` for null; an alert when the role cannot be read; `ProtectedRoute` when signed out.

- [ ] **Step 1: Write the failing test** — `tests/component/staff-route.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));

import StaffRoute from "@/components/StaffRoute";
import type { StaffRole } from "@/services/ports";

const signedIn = (role = "user") => ({
  user: { id: "u1", role },
  isAuthenticated: true,
  isLoadingAuth: false,
  authChecked: true,
  authError: null,
  checkUserAuth: vi.fn(),
});

function renderAt(loadRole: () => Promise<StaffRole | null>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/admin/masleka"]}>
        <Routes>
          <Route element={<StaffRoute unauthenticatedElement={<p>מסך הכניסה</p>} loadRole={loadRole} />}>
            <Route path="/admin/masleka" element={<p>לוח המסלקה</p>} />
          </Route>
          <Route path="/" element={<p>דף הבית</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("<StaffRoute />", () => {
  it("sends a signed-out visitor to sign in", () => {
    auth.value = {
      user: null, isAuthenticated: false, isLoadingAuth: false, authChecked: true,
      authError: { type: "auth_required", message: "x" }, checkUserAuth: vi.fn(),
    };
    const loadRole = vi.fn();
    renderAt(loadRole);
    expect(screen.getByText("מסך הכניסה")).toBeInTheDocument();
    expect(loadRole).not.toHaveBeenCalled();
  });

  it("admits the platform admin without asking for a membership", () => {
    auth.value = signedIn("admin");
    const loadRole = vi.fn();
    renderAt(loadRole);
    expect(screen.getByText("לוח המסלקה")).toBeInTheDocument();
    expect(loadRole).not.toHaveBeenCalled();
  });

  it("admits a member of the agency", async () => {
    auth.value = signedIn();
    renderAt(async () => "staff");
    expect(await screen.findByText("לוח המסלקה")).toBeInTheDocument();
  });

  it("turns away a signed-in user with no membership", async () => {
    auth.value = signedIn();
    renderAt(async () => null);
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("says so when the role cannot be read, rather than guessing either way", async () => {
    auth.value = signedIn();
    renderAt(async () => {
      throw new Error("down");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("לא הצלחנו לאמת את ההרשאה");
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("waits while sign-in is still being checked", () => {
    auth.value = { ...signedIn(), isLoadingAuth: true, authChecked: false };
    renderAt(async () => "staff");
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
    expect(screen.queryByText("דף הבית")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/component/staff-route.test.tsx`
Expected: FAIL — `@/components/StaffRoute` does not exist.

- [ ] **Step 3: Implement** — `src/components/StaffRoute.tsx`

```tsx
import React, { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/AuthContext";
import { services, type StaffRole } from "@/services";

/**
 * The clearinghouse board's gate: signed in, and either the platform admin
 * or a member of the agency (any `memberships` role in agency 1).
 *
 * Builds on ProtectedRoute exactly as AdminRoute does; the blog and the site
 * administration stay behind AdminRoute, admin-only. The role is asked of
 * the database on each visit (`my_staff_role`) and never cached across
 * mounts — but this only decides which screen to offer. Every action the
 * board takes is re-checked by the Edge Function that performs it, so a
 * membership removed mid-session fails on the next click.
 */
export interface StaffRouteProps {
  unauthenticatedElement: React.ReactElement;
  loadRole?: () => Promise<StaffRole | null>;
}

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

export default function StaffRoute({
  unauthenticatedElement,
  loadRole = () => services.masleka.myRole(),
}: StaffRouteProps) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) void checkUserAuth();
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  const signedIn = authChecked && !isLoadingAuth && !authError && isAuthenticated;
  const isAdmin = user?.role === "admin";
  const role = useQuery({
    queryKey: ["admin", "staff-role", user?.id ?? ""],
    queryFn: loadRole,
    enabled: signedIn && !isAdmin,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  if (isLoadingAuth || !authChecked) return <Spinner />;
  if (authError || !isAuthenticated) return <ProtectedRoute unauthenticatedElement={unauthenticatedElement} />;
  if (isAdmin) return <Outlet />;
  if (role.isPending) return <Spinner />;
  if (role.isError) {
    return (
      <p role="alert" dir="rtl" className="max-w-[720px] mx-auto px-4 py-16 text-center">
        לא הצלחנו לאמת את ההרשאה. רעננו את הדף.
      </p>
    );
  }
  if (!role.data) return <Navigate to="/" replace />;
  return <Outlet />;
}
```

Add to `tests/test-plan/02-std-component.md` after §4.15 (raise the count by 6):

```markdown
### 4.16 `<StaffRoute />` — the clearinghouse board's gate — `tests/component/staff-route.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-STF-001 | "sends a signed-out visitor to sign in" | `unauthenticatedElement`; no role lookup |
| CMP-STF-002 | "admits the platform admin without asking for a membership" | Outlet; no lookup |
| CMP-STF-003 | "admits a member of the agency" | Outlet |
| CMP-STF-004 | "turns away a signed-in user with no membership" | Redirect to `/` |
| CMP-STF-005 | "says so when the role cannot be read, rather than guessing either way" | Alert; no outlet |
| CMP-STF-006 | "waits while sign-in is still being checked" | Neither outlet nor redirect |
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/component/staff-route.test.tsx && npm run typecheck && npm run lint`
Expected: PASS (6); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/StaffRoute.tsx tests/component/staff-route.test.tsx tests/test-plan/02-std-component.md
git commit -m "masleka: StaffRoute admits the admin or an agency member; the blog stays admin-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 17: The staff board, `/admin/masleka`

**Files:**
- Create: `src/pages/MaslekaBoard.tsx`
- Modify: `src/App.jsx`
- Create: `tests/component/masleka-board.test.tsx`
- Modify: `tests/security/static-security.test.ts`
- Modify: `tests/test-plan/02-std-component.md`, `tests/test-plan/04-std-security.md`

**Interfaces:**
- Consumes: `MaslekaPort` (`list`, `create`, `relink`, `reveal`, `markSubmitted`), `MaslekaError`, `MaslekaRequest`, `MaslekaLink`, `MaslekaField`; `boardColumns`, `readinessLabel`, `deletionLabel`, `copyOrFallback`, `ClipboardLike`; `CLEARINGHOUSE_ADVISOR_URL`; `MASLEKA_ENABLED`; `StaffRoute`.
- Produces: `MaslekaBoard({ service?, now?, clipboard?, confirm? }: MaslekaBoardProps)`, `BOARD_KEY = ["admin", "masleka"]`, `failureText(e: unknown): string`; route `/admin/masleka` inside `<StaffRoute>`, registered only when `MASLEKA_ENABLED`.

- [ ] **Step 1: Write the failing test** — `tests/component/masleka-board.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

import MaslekaBoard, { type MaslekaBoardProps } from "@/pages/MaslekaBoard";
import { MaslekaError, type MaslekaPort, type MaslekaRequest } from "@/services/ports";

const NOW = new Date("2026-10-13T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (offset: number) => new Date(NOW.getTime() + offset).toISOString();
const LINK = `https://govari-fin.co.il/masleka#t=${"N".repeat(43)}`;
const LINK2 = `https://govari-fin.co.il/masleka#t=${"R".repeat(43)}`;

const row = (over: Partial<MaslekaRequest>): MaslekaRequest => ({
  id: "r", clientName: "לקוח", contactEmail: null, status: "invited", leadId: null, idLast4: null,
  createdAt: iso(-DAY), tokenExpiresAt: null, clientInvitedAt: null, codeReceivedAt: null,
  submittedAt: null, clearinghouseDeletesAt: null, completedAt: null, ...over,
});

const ROWS: MaslekaRequest[] = [
  row({ id: "r1", clientName: "אורי לוי", status: "invited", clientInvitedAt: iso(-2 * DAY) }),
  row({ id: "r2", clientName: "רונית מזרחי", status: "code_received", codeReceivedAt: iso(-HOUR), idLast4: "0018" }),
  row({ id: "r3", clientName: "יעל כהן", status: "submitted", submittedAt: iso(-2 * HOUR), clearinghouseDeletesAt: iso(5 * DAY) }),
  row({ id: "r4", clientName: "דן לוי", status: "submitted", submittedAt: iso(-6 * HOUR), clearinghouseDeletesAt: iso(DAY) }),
];

function service(over: Partial<MaslekaPort> = {}): MaslekaPort {
  return {
    submitCode: vi.fn(),
    myRole: vi.fn(async () => "staff" as const),
    list: vi.fn(async () => ROWS),
    create: vi.fn(async () => ({ requestId: "r9", link: LINK, invited: true })),
    relink: vi.fn(async () => ({ requestId: "r1", link: LINK2, invited: false })),
    reveal: vi.fn(async (_id: string, field: "id" | "code") => (field === "id" ? "000000018" : "AB12-CD34")),
    markSubmitted: vi.fn(async () => {}),
    ...over,
  };
}

function renderBoard(props: MaslekaBoardProps) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MaslekaBoard now={() => NOW} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const column = (name: string) => within(screen.getByRole("region", { name }));

describe("<MaslekaBoard /> — the columns", () => {
  it("lays the requests out by status, with the third column empty until PR B", async () => {
    renderBoard({ service: service(), clipboard: null });
    expect(await column("ממתין להגשה").findByText("רונית מזרחי")).toBeInTheDocument();
    expect(column("הוגש — ממתין להורדה").getByText("יעל כהן")).toBeInTheDocument();
    expect(column("הוגש — ממתין להורדה").getByText("דן לוי")).toBeInTheDocument();
    expect(column("הוזמנו — ממתינים לקוד").getByText("אורי לוי")).toBeInTheDocument();
    expect(column("הושלם").getByText("בקשות יופיעו כאן אחרי שקובצי המסלקה ייקלטו.")).toBeInTheDocument();
  });

  it("says when the files should be ready, and how long the clearinghouse keeps them", async () => {
    renderBoard({ service: service(), clipboard: null });
    const submitted = column("הוגש — ממתין להורדה");
    const yael = within((await submitted.findByText("יעל כהן")).closest("li")!);
    expect(yael.getByText("מוכן בעוד כ־3–4 שעות")).toBeInTheDocument();
    expect(yael.getByText("5 ימים עד מחיקה במסלקה")).toBeInTheDocument();
    const dan = within(submitted.getByText("דן לוי").closest("li")!);
    expect(dan.getByText("מוכן להורדה")).toBeInTheDocument();
    expect(dan.getByText("יום אחד עד מחיקה במסלקה")).toBeInTheDocument();
  });

  it("reports a list that failed to load", async () => {
    renderBoard({ service: service({ list: vi.fn(async () => Promise.reject(new MaslekaError("failed"))) }), clipboard: null });
    expect(await screen.findByText("לא הצלחנו לטעון את הבקשות. רעננו את הדף.")).toBeInTheDocument();
  });
});

describe("<MaslekaBoard /> — copying", () => {
  it("copies the ID to the clipboard, revealing it only on the click", async () => {
    const svc = service();
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: svc, clipboard });
    const waiting = column("ממתין להגשה");
    await waiting.findByText("רונית מזרחי");
    expect(svc.reveal).not.toHaveBeenCalled();
    await userEvent.click(waiting.getByRole("button", { name: "העתק ת״ז" }));
    expect(svc.reveal).toHaveBeenCalledWith("r2", "id");
    expect(clipboard.writeText).toHaveBeenCalledWith("000000018");
    expect(await waiting.findByRole("button", { name: "הועתק ✓" })).toBeInTheDocument();
  });

  it("falls back to a selected field when there is no clipboard", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק קוד" }));
    const field = await waiting.findByRole("textbox", { name: "הקוד של רונית מזרחי" });
    expect(field).toHaveValue("AB12-CD34");
    expect(field).toHaveAttribute("readonly");
    expect(waiting.getByText(/העתק ידנית/)).toBeInTheDocument();
  });

  it("falls back when the browser refuses the clipboard", async () => {
    const clipboard = { writeText: vi.fn(async () => Promise.reject(new DOMException("denied", "NotAllowedError"))) };
    renderBoard({ service: service(), clipboard });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByRole("textbox", { name: "מספר הזהות של רונית מזרחי" })).toHaveValue("000000018");
  });

  it("hides a manually-copied value when asked", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    await userEvent.click(await waiting.findByRole("button", { name: "הסתר" }));
    expect(waiting.queryByDisplayValue("000000018")).toBeNull();
  });
});

describe("<MaslekaBoard /> — acting", () => {
  it("wipes on הגשתי only after asking first", async () => {
    const svc = service();
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderBoard({ service: svc, clipboard: null, confirm });
    const button = await column("ממתין להגשה").findByRole("button", { name: "הגשתי" });
    await userEvent.click(button);
    expect(svc.markSubmitted).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(svc.markSubmitted).toHaveBeenCalledWith("r2");
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it("tells a staff member whose access was removed", async () => {
    renderBoard({
      service: service({ reveal: vi.fn(async () => Promise.reject(new MaslekaError("forbidden", "z1"))) }),
      clipboard: null,
    });
    await userEvent.click(await column("ממתין להגשה").findByRole("button", { name: "העתק ת״ז" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ייתכן שההרשאה הוסרה");
  });

  it("links to the clearinghouse portal in a new tab without a referrer", async () => {
    renderBoard({ service: service(), clipboard: null });
    const link = await column("ממתין להגשה").findByRole("link", { name: "פתח את המסלקה" });
    expect(link).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("creates a hand-made request and shows its link to copy", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.type(screen.getByLabelText("מייל (לא חובה)"), "moshe@example.com");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(svc.create).toHaveBeenCalledWith({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true });
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument();
    expect(screen.getByText(/הקישור נשלח במייל ללקוח/)).toBeInTheDocument();
  });

  it("issues a fresh link for an invited client", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    await userEvent.click(await column("הוזמנו — ממתינים לקוד").findByRole("button", { name: "קישור חדש" }));
    expect(svc.relink).toHaveBeenCalledWith("r1");
    expect(await screen.findByDisplayValue(LINK2)).toBeInTheDocument();
  });
});
```

Add to `tests/security/static-security.test.ts`, inside `describe("auth and token handling", …)` after "admin routes stay behind a gate…":

```ts
  it("keeps the clearinghouse board behind a gate that requires sign-in and a staff role, and only when switched on", () => {
    const app = read(join(REPO_ROOT, "src/App.jsx"));
    const gateStart = app.indexOf("<StaffRoute");
    expect(gateStart, "the clearinghouse pages must be wrapped in StaffRoute").toBeGreaterThan(-1);
    const gateBlock = app.slice(gateStart, app.indexOf("</Route>", gateStart));
    expect(gateBlock).toContain('path="/admin/masleka"');
    expect(app.slice(Math.max(0, gateStart - 80), gateStart)).toMatch(/MASLEKA_ENABLED \?/);

    const gate = read(join(REPO_ROOT, "src/components/StaffRoute.tsx"));
    expect(gate, "StaffRoute must fall back to the auth gate when signed out").toContain("<ProtectedRoute");
    expect(gate, "StaffRoute must turn away a user with no staff role").toMatch(/<Navigate to="\/" replace \/>/);
    expect(gate, "StaffRoute must ask the database, not the token").toContain("myRole()");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/component/masleka-board.test.tsx tests/security/static-security.test.ts`
Expected: FAIL — `@/pages/MaslekaBoard` does not exist; `<StaffRoute` is not in `App.jsx`.

- [ ] **Step 3: Implement** — `src/pages/MaslekaBoard.tsx`

```tsx
import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { CLEARINGHOUSE_ADVISOR_URL } from "@/config/masleka";
import {
  boardColumns,
  copyOrFallback,
  deletionLabel,
  readinessLabel,
  type ClipboardLike,
} from "@/lib/masleka";
import {
  MaslekaError,
  services,
  type MaslekaField,
  type MaslekaLink,
  type MaslekaPort,
  type MaslekaRequest,
} from "@/services";

/**
 * /admin/masleka — the staff's one screen for clearinghouse requests,
 * worked left to right: waiting to be submitted, submitted and waiting for
 * the download, completed (PR B fills that column).
 *
 * Nothing secret is on the page until a copy button is pressed: the value is
 * fetched then (and logged server-side), copied, and never kept in the
 * query cache. Where the clipboard is unavailable or refused, the value is
 * shown selected in a read-only field with "העתק ידנית", and can be hidden.
 */
export interface MaslekaBoardProps {
  service?: MaslekaPort;
  now?: () => Date;
  clipboard?: ClipboardLike | null;
  confirm?: (message: string) => boolean;
}

export const BOARD_KEY = ["admin", "masleka"] as const;

const defaultClipboard = (): ClipboardLike | null =>
  typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard : null;

const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "numeric",
        month: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export function failureText(error: unknown): string {
  if (error instanceof MaslekaError) {
    if (error.reason === "forbidden" || error.reason === "unauthorized") {
      return "אין לך הרשאה לפעולה הזו — ייתכן שההרשאה הוסרה. פנו לדורית.";
    }
    if (error.reason === "not_available") return "הבקשה כבר אינה ממתינה לפעולה הזו. רעננו את הלוח.";
    if (error.reason === "unavailable" || error.reason === "disabled") return "השירות אינו זמין כרגע.";
    return `הפעולה נכשלה. נסו שוב.${error.rid ? ` (קוד ${error.rid})` : ""}`;
  }
  return "הפעולה נכשלה. נסו שוב.";
}

const buttonClass =
  "inline-flex items-center gap-1 border border-border/60 px-3 py-1.5 text-sm hover:border-accent disabled:opacity-60";

function ManualCopy({ value, label, onClose }: { value: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [value]);
  return (
    <div className="mt-2 w-full">
      <input
        ref={ref}
        readOnly
        value={value}
        aria-label={label}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full border border-border bg-background px-2 py-1 font-mono text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">העתק ידנית: הערך מסומן — Ctrl+C או ⌘C.</p>
      <button type="button" onClick={onClose} className="mt-1 text-xs underline">
        הסתר
      </button>
    </div>
  );
}

function RevealButton({
  request,
  field,
  service,
  clipboard,
  onFailure,
}: {
  request: MaslekaRequest;
  field: MaslekaField;
  service: MaslekaPort;
  clipboard: ClipboardLike | null;
  onFailure: (e: unknown) => void;
}) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "copied" } | { kind: "manual"; value: string }
  >({ kind: "idle" });
  const label = field === "id" ? "העתק ת״ז" : "העתק קוד";
  const run = async () => {
    setState({ kind: "busy" });
    try {
      const value = await service.reveal(request.id, field);
      const how = await copyOrFallback(value, clipboard);
      setState(how === "copied" ? { kind: "copied" } : { kind: "manual", value });
    } catch (e) {
      setState({ kind: "idle" });
      onFailure(e);
    }
  };
  return (
    <div>
      <button type="button" onClick={run} disabled={state.kind === "busy"} className={buttonClass}>
        {state.kind === "busy" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
        {state.kind === "copied" ? "הועתק ✓" : label}
      </button>
      {state.kind === "manual" ? (
        <ManualCopy
          value={state.value}
          label={field === "id" ? `מספר הזהות של ${request.clientName}` : `הקוד של ${request.clientName}`}
          onClose={() => setState({ kind: "idle" })}
        />
      ) : null}
    </div>
  );
}

function LinkPanel({ link, clipboard }: { link: MaslekaLink; clipboard: ClipboardLike | null }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  return (
    <div className="mt-3 border border-border/60 bg-background p-3">
      <p className="text-sm">
        {link.invited
          ? "הקישור נשלח במייל ללקוח. אפשר גם להעתיק אותו:"
          : "הקישור מוצג פעם אחת בלבד — העתיקו ושלחו ללקוח:"}
      </p>
      <input
        readOnly
        value={link.link}
        dir="ltr"
        aria-label="הקישור ללקוח"
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 w-full border border-border bg-background px-2 py-1 font-mono text-xs"
      />
      <button type="button" onClick={async () => setCopied(await copyOrFallback(link.link, clipboard))} className={`${buttonClass} mt-2`}>
        {copied === "copied" ? "הועתק ✓" : "העתק קישור"}
      </button>
      {copied === "manual" ? (
        <p className="mt-1 text-xs text-muted-foreground">העתק ידנית: סמנו את הקישור והעתיקו (Ctrl+C או ⌘C).</p>
      ) : null}
    </div>
  );
}

function Column({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border border-border/60 bg-card p-4">
      <h2 id={id} className="font-heading text-lg mb-3">
        {title}
      </h2>
      {children.length ? <ul className="space-y-3">{children}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

function NewRequest({
  service,
  clipboard,
  onCreated,
  onFailure,
}: {
  service: MaslekaPort;
  clipboard: ClipboardLike | null;
  onCreated: () => Promise<unknown>;
  onFailure: (e: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaslekaLink | null>(null);
  const headingId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const clientName = name.trim();
    const contactEmail = email.trim();
    if (!clientName) return;
    setBusy(true);
    try {
      const link = await service.create({
        clientName,
        contactEmail: contactEmail || undefined,
        sendInvite: sendInvite && Boolean(contactEmail),
      });
      setResult(link);
      setName("");
      setEmail("");
      await onCreated();
    } catch (e) {
      onFailure(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="border border-border/60 bg-card p-4">
      <h2 id={headingId} className="font-heading text-lg">
        בקשה חדשה ביד
      </h2>
      <p className="text-sm text-muted-foreground">ללקוח שפנה בטלפון. הקישור יוצג כאן פעם אחת.</p>
      <form onSubmit={submit} aria-label="בקשה חדשה" className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
        <div>
          <label htmlFor="masleka-new-name" className="block text-sm">
            שם הלקוח
          </label>
          <input
            id="masleka-new-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border border-border bg-background px-2 py-1"
          />
        </div>
        <div>
          <label htmlFor="masleka-new-email" className="block text-sm">
            מייל (לא חובה)
          </label>
          <input
            id="masleka-new-email"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-border bg-background px-2 py-1"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
          לשלוח ללקוח את הקישור במייל
        </label>
        <button type="submit" disabled={busy} className={buttonClass}>
          צור בקשה
        </button>
      </form>
      {result ? <LinkPanel link={result} clipboard={clipboard} /> : null}
    </section>
  );
}

function InvitedRow({
  request,
  service,
  clipboard,
  onFailure,
}: {
  request: MaslekaRequest;
  service: MaslekaPort;
  clipboard: ClipboardLike | null;
  onFailure: (e: unknown) => void;
}) {
  const [link, setLink] = useState<MaslekaLink | null>(null);
  const [busy, setBusy] = useState(false);
  const relink = async () => {
    setBusy(true);
    try {
      setLink(await service.relink(request.id));
    } catch (e) {
      onFailure(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{request.clientName}</span>
        <span className="text-xs text-muted-foreground">
          {request.clientInvitedAt ? `הוזמן במייל ${when(request.clientInvitedAt)}` : `נוצר ${when(request.createdAt)}`}
        </span>
        <button type="button" onClick={relink} disabled={busy} className={buttonClass}>
          קישור חדש
        </button>
      </div>
      {link ? <LinkPanel link={link} clipboard={clipboard} /> : null}
    </li>
  );
}

export default function MaslekaBoard({
  service = services.masleka,
  now = () => new Date(),
  clipboard = defaultClipboard(),
  confirm = (message) => window.confirm(message),
}: MaslekaBoardProps) {
  const client = useQueryClient();
  const requests = useQuery({ queryKey: BOARD_KEY, queryFn: () => service.list(), refetchInterval: 60_000 });
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: BOARD_KEY });
  const report = (e: unknown) => setNotice(failureText(e));
  const submitted = useMutation({
    mutationFn: (id: string) => service.markSubmitted(id),
    onSuccess: () => {
      setNotice(null);
      return refresh();
    },
    onError: report,
  });

  const columns = boardColumns(requests.data ?? []);
  const at = now();

  const onSubmitted = (request: MaslekaRequest) => {
    if (!confirm(`להגיש עבור ${request.clientName}? הקוד ומספר הזהות יימחקו מהמערכת.`)) return;
    submitted.mutate(request.id);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-accent">Admin</p>
            <h1 className="font-heading text-2xl md:text-3xl mt-1">מסלקה</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/admin/masleka/guide" className="underline">
              מדריך: הרשמה כיועץ במסלקה
            </Link>
            <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-accent">
              חזרה לאתר <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        {notice ? (
          <p role="alert" className="border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {notice}
          </p>
        ) : null}

        <NewRequest service={service} clipboard={clipboard} onCreated={refresh} onFailure={report} />

        {requests.isError ? (
          <p role="alert" className="text-sm">
            לא הצלחנו לטעון את הבקשות. רעננו את הדף.
          </p>
        ) : null}
        {requests.isPending ? <Loader2 className="animate-spin" aria-label="טוען" /> : null}

        <Column title="הוזמנו — ממתינים לקוד" empty="אין לקוחות שממתינים לקוד.">
          {columns.invited.map((r) => (
            <InvitedRow key={r.id} request={r} service={service} clipboard={clipboard} onFailure={report} />
          ))}
        </Column>

        <div className="grid gap-6 md:grid-cols-3">
          <Column title="ממתין להגשה" empty="אין קודים שממתינים להגשה.">
            {columns.waiting.map((r) => (
              <li key={r.id} className="border border-border/60 p-3">
                <p className="font-medium">{r.clientName}</p>
                <p className="text-xs text-muted-foreground">
                  התקבל {when(r.codeReceivedAt)}
                  {r.idLast4 ? ` · ת״ז מסתיימת ב־${r.idLast4}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <RevealButton request={r} field="id" service={service} clipboard={clipboard} onFailure={report} />
                  <RevealButton request={r} field="code" service={service} clipboard={clipboard} onFailure={report} />
                  <a href={CLEARINGHOUSE_ADVISOR_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
                    פתח את המסלקה
                  </a>
                  <button
                    type="button"
                    onClick={() => onSubmitted(r)}
                    disabled={submitted.isPending}
                    className={`${buttonClass} border-primary`}
                  >
                    הגשתי
                  </button>
                </div>
              </li>
            ))}
          </Column>

          <Column title="הוגש — ממתין להורדה" empty="אין בקשות שהוגשו.">
            {columns.submitted.map((r) => (
              <li key={r.id} className="border border-border/60 p-3">
                <p className="font-medium">{r.clientName}</p>
                <p className="text-sm">{readinessLabel(r.submittedAt, at)}</p>
                <p className="text-xs text-muted-foreground">{deletionLabel(r.clearinghouseDeletesAt, at)}</p>
                <a href={CLEARINGHOUSE_ADVISOR_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline">
                  לפורטל המסלקה
                </a>
              </li>
            ))}
          </Column>

          <Column title="הושלם" empty="בקשות יופיעו כאן אחרי שקובצי המסלקה ייקלטו.">
            {columns.completed.map((r) => (
              <li key={r.id} className="border border-border/60 p-3">
                <p className="font-medium">{r.clientName}</p>
                <p className="text-xs text-muted-foreground">הושלם {when(r.completedAt)}</p>
              </li>
            ))}
          </Column>
        </div>
      </main>
    </div>
  );
}
```

In `src/App.jsx`:

(a) imports, next to `import AdminRoute from '@/components/AdminRoute';`:

```jsx
import StaffRoute from '@/components/StaffRoute';
import { MASLEKA_ENABLED } from '@/config/masleka';
```

(b) lazy page, after the `Masleka` lazy import:

```jsx
const MaslekaBoard = lazy(() => import('@/pages/MaslekaBoard'));
```

(c) after the `<Route element={<AdminRoute …/>}> … </Route>` block, before the `*` route:

```jsx
        {/* The clearinghouse board: the admin or an agency member (StaffRoute).
            Not registered at all until VITE_MASLEKA_ENABLED — a dark build
            answers 404 here. */}
        {MASLEKA_ENABLED ? (
          <Route element={<StaffRoute unauthenticatedElement={<LoginRedirect />} />}>
            <Route path="/admin/masleka" element={<MaslekaBoard />} />
          </Route>
        ) : null}
```

Add to `tests/test-plan/02-std-component.md` after §4.16 (raise the count by 12):

```markdown
### 4.17 `<MaslekaBoard />` — the staff board — `tests/component/masleka-board.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKB-001 | "lays the requests out by status, with the third column empty until PR B" | Each name in its region; empty-state text in "הושלם" |
| CMP-MSKB-002 | "says when the files should be ready, and how long the clearinghouse keeps them" | Readiness and deletion labels per card |
| CMP-MSKB-003 | "reports a list that failed to load" | Alert text |
| CMP-MSKB-004 | "copies the ID to the clipboard, revealing it only on the click" | No reveal before the click; `writeText('000000018')`; "הועתק ✓" |
| CMP-MSKB-005 | "falls back to a selected field when there is no clipboard" | Read-only field with the value; "העתק ידנית" |
| CMP-MSKB-006 | "falls back when the browser refuses the clipboard" | Read-only field with the value |
| CMP-MSKB-007 | "hides a manually-copied value when asked" | Value gone after "הסתר" |
| CMP-MSKB-008 | "wipes on הגשתי only after asking first" | Declined confirm → nothing; accepted → `markSubmitted('r2')` and a refetch |
| CMP-MSKB-009 | "tells a staff member whose access was removed" | Alert "ייתכן שההרשאה הוסרה" |
| CMP-MSKB-010 | "links to the clearinghouse portal in a new tab without a referrer" | `_blank`, `noopener noreferrer` |
| CMP-MSKB-011 | "creates a hand-made request and shows its link to copy" | `create` body; link shown; "נשלח במייל" |
| CMP-MSKB-012 | "issues a fresh link for an invited client" | `relink('r1')`; new link shown |
```

Add to `tests/test-plan/04-std-security.md`, as a new section immediately before "## 5. Deviations" (and raise the count in "## 6. Pass criteria" by 1):

```markdown
## 4c. The clearinghouse board's gate — `tests/security/static-security.test.ts`

| ID | Title | Expected result |
|---|---|---|
| SEC-STAFF-001 | "keeps the clearinghouse board behind a gate that requires sign-in and a staff role, and only when switched on" | `/admin/masleka` inside `<StaffRoute>` under `MASLEKA_ENABLED ?`; StaffRoute falls back to ProtectedRoute, redirects a non-member to `/`, asks `myRole()` |
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/component/masleka-board.test.tsx tests/security && npm run typecheck && npm run lint`
Expected: PASS (12 + the security suite including the new case); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MaslekaBoard.tsx src/App.jsx tests/component/masleka-board.test.tsx tests/security/static-security.test.ts tests/test-plan/02-std-component.md tests/test-plan/04-std-security.md
git commit -m "masleka: the staff board — copy on demand with a manual fallback, הגשתי after a confirm, hand-made requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 18: The advisor-registration guide, `/admin/masleka/guide`

**Files:**
- Create: `src/pages/MaslekaGuide.tsx`
- Modify: `src/App.jsx`
- Create: `tests/component/masleka-guide.test.tsx`
- Modify: `tests/security/static-security.test.ts`
- Modify: `tests/test-plan/02-std-component.md`

**Interfaces:**
- Consumes: `MaslekaSteps`, `StepScreens`; `CLEARINGHOUSE_ADVISOR_URL`; `LICENCE` (`src/config/compliance.ts`).
- Produces: `MaslekaGuide({ screenshots?: StepScreens })` at `/admin/masleka/guide`, inside the same `StaffRoute` block.

- [ ] **Step 1: Write the failing test** — `tests/component/masleka-guide.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import MaslekaGuide from "@/pages/MaslekaGuide";
import { LICENCE } from "@/config/compliance";

const renderGuide = (props: React.ComponentProps<typeof MaslekaGuide> = {}) =>
  render(
    <MemoryRouter>
      <MaslekaGuide {...props} />
    </MemoryRouter>,
  );

describe("<MaslekaGuide />", () => {
  it("walks through registering, submitting and downloading, in order", () => {
    renderGuide();
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "נכנסים לאתר המסלקה כבעלי רישיון",
      "נרשמים — ללא עלות",
      "מגישים בקשה לכל לקוח",
      "מורידים את הקבצים",
    ]);
  });

  it("names the licence the registration is made under", () => {
    renderGuide();
    expect(screen.getByText(new RegExp(LICENCE.number))).toBeInTheDocument();
  });

  it("links to the clearinghouse in a new tab without a referrer, and back to the board", () => {
    renderGuide();
    const out = screen.getByRole("link", { name: "לאתר המסלקה" });
    expect(out).toHaveAttribute("target", "_blank");
    expect(out.getAttribute("rel")).toMatch(/noopener/);
    expect(out.getAttribute("rel")).toMatch(/noreferrer/);
    expect(screen.getByRole("link", { name: /חזרה ללוח/ })).toHaveAttribute("href", "/admin/masleka");
  });

  it("shows no screenshot unless one is given", () => {
    const { unmount } = renderGuide();
    expect(screen.queryAllByRole("figure")).toHaveLength(0);
    unmount();
    renderGuide({ screenshots: { 3: <img alt="הגשת בקשה בפורטל" src="/x.png" /> } });
    expect(screen.getByAltText("הגשת בקשה בפורטל")).toBeInTheDocument();
  });
});
```

In `tests/security/static-security.test.ts`, in the case added in Task 17, after `expect(gateBlock).toContain('path="/admin/masleka"');` add:

```ts
    expect(gateBlock).toContain('path="/admin/masleka/guide"');
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/component/masleka-guide.test.tsx tests/security/static-security.test.ts`
Expected: FAIL — `@/pages/MaslekaGuide` does not exist; the guide route is not in the StaffRoute block.

- [ ] **Step 3: Implement** — `src/pages/MaslekaGuide.tsx`

```tsx
import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MaslekaSteps, { type MaslekaStep, type StepScreens } from "@/components/masleka/MaslekaSteps";
import { CLEARINGHOUSE_ADVISOR_URL } from "@/config/masleka";
import { LICENCE } from "@/config/compliance";

/**
 * A one-time guide for the staff: registering as a licensed advisor at the
 * clearinghouse (free), and the routine the board supports after that.
 * Numbered text with a link; the `screenshots` slot renders nothing until
 * the portal's screens are captured.
 */
export default function MaslekaGuide({ screenshots }: { screenshots?: StepScreens }) {
  const steps: MaslekaStep[] = [
    {
      title: "נכנסים לאתר המסלקה כבעלי רישיון",
      body: (
        <>
          באתר המסלקה הפנסיונית בוחרים בכניסה לבעלי רישיון / יועצים.{" "}
          <a href={CLEARINGHOUSE_ADVISOR_URL} target="_blank" rel="noopener noreferrer" className="underline text-accent">
            לאתר המסלקה
          </a>
        </>
      ),
    },
    {
      title: "נרשמים — ללא עלות",
      body: <>ההרשמה נעשית פעם אחת, על שם בעלת הרישיון — מספר רישיון {LICENCE.number}.</>,
    },
    {
      title: "מגישים בקשה לכל לקוח",
      body: (
        <>
          בלוח המסלקה לוחצים „העתק ת״ז” ו„העתק קוד”, מדביקים בבקשת „מידע מכל הגופים” בפורטל (₪14 לבקשה), ואז
          לוחצים „הגשתי” בלוח — הקוד ומספר הזהות נמחקים מהמערכת.
        </>
      ),
    },
    {
      title: "מורידים את הקבצים",
      body: (
        <>
          כ־3–4 שעות אחרי ההגשה הקבצים מוכנים בפורטל (וגם נשלחים לכתובת הרשומה במסלקה). המסלקה מוחקת אותם אחרי 7
          ימי עסקים; הלוח מזכיר ביום העסקים החמישי.
        </>
      ),
    },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl md:text-3xl">הרשמה כיועץ במסלקה — מדריך</h1>
          <Link to="/admin/masleka" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent">
            חזרה ללוח <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <main className="max-w-[900px] mx-auto px-4 sm:px-6 py-8">
        <MaslekaSteps steps={steps} screenshots={screenshots} />
      </main>
    </div>
  );
}
```

In `src/App.jsx`: add `const MaslekaGuide = lazy(() => import('@/pages/MaslekaGuide'));` after the `MaslekaBoard` lazy import, and inside the `StaffRoute` block, after the board route:

```jsx
            <Route path="/admin/masleka/guide" element={<MaslekaGuide />} />
```

Add to `tests/test-plan/02-std-component.md` after §4.17 (raise the count by 4):

```markdown
### 4.18 `<MaslekaGuide />` — registering as an advisor — `tests/component/masleka-guide.test.tsx`

| ID | Title | Expected result |
|---|---|---|
| CMP-MSKG-001 | "walks through registering, submitting and downloading, in order" | Four step headings in order |
| CMP-MSKG-002 | "names the licence the registration is made under" | `LICENCE.number` shown |
| CMP-MSKG-003 | "links to the clearinghouse in a new tab without a referrer, and back to the board" | `_blank` + `noopener noreferrer`; back link `/admin/masleka` |
| CMP-MSKG-004 | "shows no screenshot unless one is given" | 0 figures; then the given image |
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/component/masleka-guide.test.tsx tests/security && npm run typecheck && npm run lint`
Expected: PASS; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MaslekaGuide.tsx src/App.jsx tests/component/masleka-guide.test.tsx tests/security/static-security.test.ts tests/test-plan/02-std-component.md
git commit -m "masleka: the advisor-registration guide, numbered steps with an empty screenshots slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Task 19: Pin the dark launch, prove it in the browser, document the switches

**Files:**
- Create: `tests/contract/masleka-dark-launch.contract.test.ts`
- Create: `e2e/ui/masleka.spec.ts`
- Modify: `README.md` (new section after "### Lead functions on Supabase")
- Modify: `base44/agents/COMPLIANCE.md` (new section 10)
- Modify: `tests/test-plan/03-std-contract.md`, `tests/test-plan/06-std-ui-e2e.md`

**Interfaces:**
- Consumes: everything above, read as source; the default (dark) production build.
- Produces: the contract that the default is off everywhere, the e2e proof on the built site, and the operator's documentation.

- [ ] **Step 1: Write the failing tests**

`tests/contract/masleka-dark-launch.contract.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The clearinghouse pipeline ships dark: nothing may collect a code or an ID
 * number before the compliance review (spec, "Release gates" 1). Two switches,
 * MASLEKA_ENABLED on the Edge and VITE_MASLEKA_ENABLED in the build, both off
 * unless exactly "true", and nothing in this repository turns either on.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const FUNCTIONS = readdirSync(join(REPO_ROOT, "supabase/functions"))
  .filter((name) => name.startsWith("masleka-"))
  .sort();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the clearinghouse pipeline ships dark", () => {
  it("has the five functions to check", () => {
    expect(FUNCTIONS).toEqual(["masleka-code", "masleka-create", "masleka-remind", "masleka-reveal", "masleka-submitted"]);
  });

  it.each(FUNCTIONS)("%s refuses before it reads or writes anything while the switch is off", (name) => {
    const src = read(`supabase/functions/${name}/handler.ts`);
    const gate = src.indexOf("if (!maslekaEnabled())");
    expect(gate, `${name} has no switch`).toBeGreaterThan(-1);
    for (const later of ["req.json(", "staffCaller(", "selectRows(", "updateWhere(", "insertRow(", "createRequest(", "sendMail("]) {
      const at = src.indexOf(later);
      if (at > -1) expect(at, `${name}: ${later} comes before the switch`).toBeGreaterThan(gate);
    }
  });

  it("turns the Edge switch on only for exactly \"true\"", () => {
    expect(read("supabase/functions/_shared/masleka.ts")).toContain(
      "return (Deno.env.get('MASLEKA_ENABLED') || '').trim() === 'true';",
    );
  });

  it("lets submit-lead create a request only behind the same switch", () => {
    expect(read("supabase/functions/submit-lead/handler.ts")).toMatch(
      /if \(source === 'interview' && maslekaEnabled\(\) && wantsClearinghouse\(safeProfile\)\) \{\s*try \{\s*const created = await createRequest\(/,
    );
  });

  it("is off in a build that does not set VITE_MASLEKA_ENABLED", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "");
    expect((await import("@/config/masleka")).MASLEKA_ENABLED).toBe(false);
  });

  it("is turned on by nothing in the repository", () => {
    const files = [
      "vercel.json",
      "playwright.config.ts",
      "vitest.config.ts",
      "supabase/config.toml",
      "package.json",
      ...readdirSync(join(REPO_ROOT, ".github/workflows")).map((f) => `.github/workflows/${f}`),
    ];
    for (const file of files) {
      expect(read(file), file).not.toMatch(/MASLEKA_ENABLED\s*[:=]\s*["']?true/);
    }
  });

  it("registers the staff pages only when switched on, and the client page always (it then says unavailable)", () => {
    expect(read("src/App.jsx")).toMatch(/\{MASLEKA_ENABLED \? \(\s*<Route element=\{<StaffRoute/);
    expect(read("src/App.jsx")).toContain('<Route path="/masleka" element={<Masleka />} />');
    expect(read("src/pages/Masleka.tsx")).toContain("enabled = MASLEKA_ENABLED");
  });
});
```

`e2e/ui/masleka.spec.ts`:

```ts
import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The clearinghouse pipeline in the build CI makes — dark, as it ships.
 * The enabled flow is covered in-process (tests/component, tests/integration);
 * PR B's e2e works one request end to end once the switch can be on in a test build.
 */
test.describe("Clearinghouse — dark by default", () => {
  test("the client page says the service is unavailable, offers no form, and is not indexed", async ({ page }) => {
    const functionCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/functions/v1/")) functionCalls.push(r.url());
    });
    await test_step("open a client's link", async () => {
      await gotoApp(page, `/masleka#t=${"Ab3_-".repeat(8)}xyz`);
    });
    await test_step("the page is the unavailable notice, and nothing else", async () => {
      await expect(page.getByRole("heading", { name: "השירות אינו זמין כרגע" })).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    });
    await test_step("the token is gone from the address bar", async () => {
      await expect(page).toHaveURL(/\/masleka$/);
    });
    await test_step("the page is noindex and called no function", async () => {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      expect(functionCalls).toEqual([]);
    });
  });

  test("the staff board does not exist in a dark build", async ({ page }) => {
    await gotoApp(page, "/admin/masleka");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run them and watch them fail where expected**

Run: `npx vitest run tests/contract/masleka-dark-launch.contract.test.ts`
Expected: PASS already if Tasks 1–18 are in (this task pins what they built). To see it bite, temporarily change `=== 'true'` in `_shared/masleka.ts` to `!== 'false'` and rerun: Expected FAIL on "turns the Edge switch on only for exactly \"true\"" — then restore the line.

Run: `CI=1 npx playwright test e2e/ui/masleka.spec.ts --project=web-chromium`
Expected: PASS on a dark build. To see it bite, run once with `VITE_MASLEKA_ENABLED=true CI=1 npx playwright test e2e/ui/masleka.spec.ts --project=web-chromium` (the playwright `webServer` builds with the environment it is given): Expected FAIL on the unavailable heading (the page now asks for the link) and on the 404.

- [ ] **Step 3: Document**

Add to `README.md`, after the "### Lead functions on Supabase" section (before "## The platform limit that led there"):

````markdown
### The clearinghouse requests (dark until the compliance review)

`/masleka` collects a client's clearinghouse power-of-attorney code and ID
number; `/admin/masleka` is the staff board that submits them in the
clearinghouse portal (spec: `docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md`,
PR A). Both values are AES-GCM ciphertext made by the Edge Functions with
`MASLEKA_KEY`; they are wiped when a staff member presses **הגשתי**, and by
the hourly `masleka-housekeeping` job after 9 days at the latest.

**Two switches, both off by default** and both on only when exactly `true`:
`MASLEKA_ENABLED` (Supabase Edge Function secret) and `VITE_MASLEKA_ENABLED`
(Vercel build env). Off: `/masleka` says "השירות אינו זמין כרגע", every
`masleka-*` function answers 404 `disabled`, `submit-lead` sends today's
`POA_URL` mail and creates no request, and `/admin/masleka` is a 404.
`tests/contract/masleka-dark-launch.contract.test.ts` fails if either default
changes or anything in the repo turns them on. Do not turn them on before
Dorit's compliance adviser has signed off (`base44/agents/COMPLIANCE.md` §10).

**Secrets** (Supabase Edge Function secrets, set by hand):
`MASLEKA_KEY` — `openssl rand -base64 32` (exactly 32 bytes; losing it makes
waiting codes unreadable, nothing else); `MASLEKA_CRON_SECRET` —
`openssl rand -hex 32`. The hourly reminder call reads two Vault secrets:
`select vault.create_secret('https://hjowdyiwjjrqceumkvgt.supabase.co', 'masleka_functions_url');`
and `select vault.create_secret('<the same MASLEKA_CRON_SECRET>', 'masleka_cron_secret');`.
Until both exist, `masleka_call_remind()` does nothing.

**Staff.** The board admits the platform admin (`profiles.role = 'admin'`) and
anyone with a `memberships` row in agency 1; the blog and `/admin/leads` stay
admin-only. Adding a staff member is one statement, after they have signed in
once (so `auth.users` has them):

```sql
insert into public.memberships (user_id, agency_id, role)
select id, '00000000-0000-0000-0000-000000000001', 'staff'
  from auth.users where email = 'new.staff@example.com'
on conflict do nothing;
```

Removing them is the matching `delete`; every board action re-checks
membership, so it takes effect on their next click. Staff notices go to the
profile e-mail of every admin and member (`masleka_staff_emails()`), or to
`dorit@govari-fin.co.il` if none can be read — not to `dorit-mailer`'s
`MAIL_TO`, which a rendered message cannot address.

**Automatic invitations** come from `submit-lead`, so they need
`VITE_LEAD_FUNCTIONS=supabase` as well; until then, staff create requests by
hand on the board and copy the link. Business days are Sunday–Thursday;
holidays are not modelled, so a holiday week's day-5 warning arrives early,
never late.

**Release:** the migration `20261015000000_masleka_requests.sql` is applied to
production by hand (CI deploys functions only); run
`supabase/tests/masleka_check.sql` against a local `supabase start` first.
````

Add to `base44/agents/COMPLIANCE.md`, as a new section at the end:

```markdown
## 10. נקודה פתוחה: מסירת קוד המסלקה — ממתין לבדיקת היועצת (PR A)

הקוד נשלח כבוי (`MASLEKA_ENABLED` / `VITE_MASLEKA_ENABLED`), ולא יופעל לפני
אישור. מה שמוגש לבדיקה:

1. **נוסח הדף `/masleka`** — שלושת הצעדים, ההסבר מה נאסף ולמה, והשורה
   "הקוד ומספר הזהות נשמרים מוצפנים, משמשים רק להגשת הבקשה במסלקה בשמכם,
   ונמחקים מיד לאחר ההגשה — ולכל המאוחר כעבור 9 ימים."
2. **מה נשמר ולכמה זמן** — הקוד ומספר הזהות מוצפנים (AES-GCM, מפתח מחוץ
   למסד הנתונים) עד "הגשתי", ולא יותר מ-9 ימים; אחרי ההגשה נשארים רק שם
   הלקוח וארבע הספרות האחרונות של תעודת הזהות, לצורך התאמת הקובץ (PR B).
   כל חשיפה של ערך לאיש צוות נרשמת ביומן גישה.
3. **מי רואה** — מנהלת המערכת ואנשי הצוות הרשומים בסוכנות בלבד.
4. **המיילים** — ההזמנה ללקוח (והתזכורת היחידה אחרי שבוע), שמחליפים את
   הקישור לייפוי הכוח במייל אישור הראיון; ההודעות לצוות אינן נושאות את הקוד
   או את מספר הזהות.
5. **פער בנוסחים קיימים** — שאלון הצרכים והראיון אומרים היום "ייפוי כוח
   חתום — דורית תשלח לך אותו". עם הפעלת המסלול הנוסח צריך לומר שיישלח
   קישור למסירת קוד; השינוי ייעשה יחד עם האישור, לא לפניו.
6. **השמירה ל-24 חודשים** של התמונה המעובדת שייכת ל-PR B ותוגש איתו.
```

Add to `tests/test-plan/03-std-contract.md` after §4.8 (raise the count by 11 — the `it.each` contributes five):

```markdown
### 4.9 The clearinghouse ships dark — `masleka-dark-launch.contract.test.ts`

| ID | Title | Expected result |
|---|---|---|
| CTR-MSKD-001 | "has the five functions to check" | Exactly the five `masleka-*` directories |
| CTR-MSKD-002..006 | "%s refuses before it reads or writes anything while the switch is off" | `if (!maslekaEnabled())` precedes every read, write and mail |
| CTR-MSKD-007 | "turns the Edge switch on only for exactly \"true\"" | The literal comparison |
| CTR-MSKD-008 | "lets submit-lead create a request only behind the same switch" | `createRequest` inside the guarded branch |
| CTR-MSKD-009 | "is off in a build that does not set VITE_MASLEKA_ENABLED" | `false` |
| CTR-MSKD-010 | "is turned on by nothing in the repository" | No `MASLEKA_ENABLED=true` in Vercel, Playwright, Vitest, Supabase config, package.json or workflows |
| CTR-MSKD-011 | "registers the staff pages only when switched on, and the client page always (it then says unavailable)" | Guarded `StaffRoute` block; `/masleka` route; page default `enabled = MASLEKA_ENABLED` |
```

Add to `tests/test-plan/06-std-ui-e2e.md`, after §3.9:

```markdown
### 3.10 Clearinghouse, dark — `masleka.spec.ts`

| ID | Title | Expected result |
|---|---|---|
| E2E-MSK-001 | "the client page says the service is unavailable, offers no form, and is not indexed" | Unavailable heading; no form; URL ends `/masleka` (token stripped); `noindex`; no `/functions/v1/` request |
| E2E-MSK-002 | "the staff board does not exist in a dark build" | `/admin/masleka` renders the 404 page |
```

- [ ] **Step 4: Run the whole battery**

Run: `npm run lint && npm run typecheck && npm run test:vitest && deno check --no-config supabase/functions/*/index.ts && CI=1 npx playwright test e2e/ui/masleka.spec.ts e2e/ui/account.spec.ts`
Expected: all green. (Per the project's zsh note, read each command's exit status directly — `echo $?` after it — rather than through a pipe.)

- [ ] **Step 5: Commit**

```bash
git add tests/contract/masleka-dark-launch.contract.test.ts e2e/ui/masleka.spec.ts README.md base44/agents/COMPLIANCE.md tests/test-plan/03-std-contract.md tests/test-plan/06-std-ui-e2e.md
git commit -m "masleka: pin the dark launch in a contract and in e2e; document switches, secrets, staff SQL and the compliance review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ"
```

---

## Spec coverage

| PR A requirement (spec section) | Task |
|---|---|
| Staff are `memberships` in agency 1 (or admin); role checked server-side (Components → Roles) | 6 (`staff_role`, `my_staff_role`), 4 (`staffCaller`), 8–10 |
| The admin route guard admits members; blog and site admin stay admin-only (Roles) | 16, 17 (`/admin/masleka` only; `AdminRoute` untouched) |
| Adding a staff member is one documented SQL insert (Roles) | 19 (README) |
| `masleka_requests` with lead link, name, contact, token hash, statuses, ciphertexts, last-4, per-status timestamps; RLS members only, anon nothing (Data) | 6 |
| `masleka_access_log` (Data) | 6, 8 |
| Scheduled job: expire stale requests; wipe ciphertext older than 9 days whatever its status (Data) | 6 (hourly; snapshot purge is PR B) |
| AES-GCM, key only as `MASLEKA_KEY`; database never sees plaintext or key (Encryption) | 2, 7, 8 |
| Ciphertexts live until הגשתי and never more than 9 days (Encryption) | 6 (constraint + wipe), 9 |
| Lead answering "מעוניין/ת" → request `invited` + email with `/masleka` link replacing `POA_URL`; active with `VITE_LEAD_FUNCTIONS=supabase` (Flow 1; Edge → submit-lead) | 12 |
| Staff create a request by hand and copy the link (Flow 1) | 10, 17 |
| `/masleka`: three numbered steps, ID check digit before sending, thank-you only (Flow 2–3) | 1, 14, 15 |
| `masleka-code`: public, token + ID check, `allow_submission` limits, encrypts, notifies staff (Edge) | 7 |
| `masleka-reveal`: members only, decrypts, logs (Edge) | 8 |
| `masleka-submitted`: wipes ciphertext, keeps last-4 + name, records time (Edge) | 9 |
| `masleka-remind`: hourly via pg_cron/pg_net (Edge) | 6 (schedule + `masleka_call_remind`), 11 |
| Reminder "קוד מסלקה חדש לטיפול" on code | 5, 7 |
| Reminder "יש קבצים להורדה" 4 h after הגשתי | 5, 11 |
| Reminder "נמחק במסלקה בעוד יומיים" on business day 5 if no snapshot | 3, 5, 11 (status still `submitted` ⇒ no snapshot) |
| Client reminder after 7 days `invited`; expiry after 30 days | 11, 6 |
| Board: columns ממתין להגשה / הוגש — ממתין להורדה (/ הושלם empty until PR B); copy ID, copy code, open the portal, הגשתי; "ready in 3–4 h" → "ready"; days until deletion (Staff) | 14, 17 |
| One-time advisor-registration guide (Staff) | 18 |
| Screenshots: none available → optional, empty-by-default slot (controller decision) | 15 (`MaslekaSteps`), 18 |
| Testing — RLS: anon / non-member / member; (snapshot purge is PR B) | 6 (`masleka_check.sql`, schema contract) |
| Testing — Edge: bad token, bad check digit, floods; reveal rejects non-members and logs members; submitted leaves no ciphertext | 7, 8, 9 |
| Testing — Contract: no storage bucket for clearinghouse files; page and emails never echo ID or code | 6, 5, 7, 15 |
| Release gate 1 — compliance review before anything collects a code or an ID | Dark launch: 4, 7–13, 15, 17, 19; COMPLIANCE.md §10; post-merge checklist |
| Dark launch (controller decision): `MASLEKA_ENABLED` / `VITE_MASLEKA_ENABLED`, defaults off and pinned | 4, 7–11 (each "answers disabled…"), 12, 13, 15, 17, 19 |
| `/masleka` and `/admin/masleka` noindex, robots, not in sitemap/llms | 15 (and the existing `/admin/` rules) |

Out of PR A, seams left: `status = 'completed'` and `completed_at` exist and are read by the board's third column (Task 17) and dropped from reminders (Task 11), for PR B to set; `id_last4` + `client_name` survive the wipe for PR B's matching; the access log and `MaslekaPort` take new methods without changing the existing ones.

## Post-merge checklist

1. **Only on the user's request:** apply `supabase/migrations/20261015000000_masleka_requests.sql` to production (project `hjowdyiwjjrqceumkvgt`) by hand, after `supabase/tests/masleka_check.sql` passed on a local `supabase start`. Confirm `select jobname, schedule from cron.job where jobname like 'masleka-%';` lists `masleka-housekeeping` and `masleka-remind`.
2. Set the Edge secrets: `supabase secrets set --project-ref hjowdyiwjjrqceumkvgt MASLEKA_KEY="$(openssl rand -base64 32)" MASLEKA_CRON_SECRET="$(openssl rand -hex 32)"` — keep `MASLEKA_KEY` somewhere safe (a lost key makes waiting codes unreadable, nothing more).
3. In the production SQL editor, create the Vault secrets: `select vault.create_secret('https://hjowdyiwjjrqceumkvgt.supabase.co', 'masleka_functions_url');` and `select vault.create_secret('<the MASLEKA_CRON_SECRET value>', 'masleka_cron_secret');`.
4. Add staff memberships by SQL (README, "The clearinghouse requests"), one per staff member who has signed in once; confirm Dorit's own `owner` row exists (`select * from public.memberships;`).
5. Verify against swiftness.co.il (spec "To verify while building", item 1): whether the advisor portal needs the ID number besides the code, and the exact saver-registration and advisor-portal URLs; if they differ from `https://www.swiftness.co.il/`, change `CLEARINGHOUSE_SAVER_URL` / `CLEARINGHOUSE_ADVISOR_URL` (and the tests that pin them) in a follow-up PR.
6. Compliance review (spec "Release gates" 1, `base44/agents/COMPLIANCE.md` §10): the `/masleka` text, the storage and wipe rules, the mails, and the wizard/interview wording that still promises a signed mandate.
7. Only after sign-off: `supabase secrets set --project-ref hjowdyiwjjrqceumkvgt MASLEKA_ENABLED=true`, and `VITE_MASLEKA_ENABLED=true` on Vercel (production and preview), then redeploy. Smoke: a hand-made request to a staff member's own address, the client page with that link, a reveal (check `masleka_access_log`), הגשתי (check both ciphertext columns are null).
8. Automatic invitations additionally need `VITE_LEAD_FUNCTIONS=supabase` (README, "Lead functions on Supabase"). To go back: unset both `MASLEKA_*` switches and redeploy; the hourly wipe keeps running regardless.

