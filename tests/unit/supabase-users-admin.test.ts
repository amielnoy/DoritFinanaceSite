import { describe, expect, it, vi } from "vitest";
import { SupabaseUsersAdminService } from "@/services/supabase/SupabaseUsersAdminService";
import type { SupabaseQuery, SupabaseTableClient } from "@/services/supabase/SupabaseTableClient";

/* The users screen's port: the organizations an invitation offers, and the invitation through the invite-user function. */

const tables = (rows: Record<string, Record<string, unknown>[]>): SupabaseTableClient => ({
  from: (table: string) => ({
    select: () => {
      const q: SupabaseQuery = {
        eq: () => q, or: () => q, not: () => q, order: () => q, limit: () => q,
        then: (f, r) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(f, r),
      };
      return q;
    },
  }),
});

type Invoke = (name: string, options: { body: Record<string, unknown>; headers?: Record<string, string> }) => Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
const functions = (invoke: Invoke) => ({ functions: { invoke: vi.fn(invoke) } });

describe("SupabaseUsersAdminService.organizations", () => {
  it("lists every organization by name, members or not", async () => {
    const svc = new SupabaseUsersAdminService(tables({ agencies: [{ id: "b", name: "בית" }, { id: "a", name: "אלף" }] }));
    expect(await svc.organizations()).toEqual([{ id: "a", name: "אלף" }, { id: "b", name: "בית" }]);
  });
});

describe("SupabaseUsersAdminService.invite", () => {
  const input = { email: "new@example.com", orgId: "11111111-2222-4333-8444-555555555555", role: "agent" as const };

  it("asks invite-user with the admin's session, and says whether an account was made and the mail went", async () => {
    const fn = functions(async () => ({ data: { ok: true, userId: "u1", created: true, mailed: true, rid: "r" }, error: null }));
    const svc = new SupabaseUsersAdminService(tables({}), fn, async () => "session-token");
    expect(await svc.invite(input)).toEqual({ created: true, mailed: true });
    expect(fn.functions.invoke).toHaveBeenCalledWith("invite-user", { body: input, headers: { Authorization: "Bearer session-token" } });
  });

  it("refuses without a session, before any request", async () => {
    const fn = functions(async () => ({ data: {}, error: null }));
    const svc = new SupabaseUsersAdminService(tables({}), fn, async () => null);
    await expect(svc.invite(input)).rejects.toThrow("נדרשת התחברות.");
    expect(fn.functions.invoke).not.toHaveBeenCalled();
  });

  it("reports the function's own refusal, in its words", async () => {
    const fn = functions(async () => ({ data: null, error: { message: "non-2xx", context: new Response(JSON.stringify({ error: "התפקיד אינו מוכר." }), { status: 400 }) } }));
    const svc = new SupabaseUsersAdminService(tables({}), fn, async () => "t");
    await expect(svc.invite(input)).rejects.toThrow("התפקיד אינו מוכר.");
  });
});
