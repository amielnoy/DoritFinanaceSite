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

  it("tells a send that stored nothing apart from a failure: not_saved is its own reason", async () => {
    const { service } = fake({ invoke: async () => failure(500, { error: "not_saved", rid: "n1" }) });
    await expect(service.submitCode("T".repeat(43), "AB12", "000000018")).rejects.toMatchObject({ reason: "not_saved", rid: "n1" });
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

  it("tells a second הגשתי apart from a failure: already_submitted is its own reason", async () => {
    const { service } = fake({ invoke: async () => failure(409, { error: "already_submitted", rid: "w" }) });
    await expect(service.markSubmitted("r1")).rejects.toMatchObject({ reason: "already_submitted", rid: "w" });
  });

  it("maps 409 not_available, 404 disabled, 429 and 503 unavailable to their own reasons", async () => {
    const cases: [number, string][] = [[409, "not_available"], [404, "disabled"], [429, "rate_limited"], [503, "unavailable"]];
    for (const [status, error] of cases) {
      const { service } = fake({ invoke: async () => failure(status, { error, rid: "k" }) });
      await expect(service.reveal("r1", "code")).rejects.toMatchObject({ reason: error, rid: "k" });
    }
  });

  it("falls back to the status when a gateway answers without our body", async () => {
    const cases: [number, string][] = [[401, "unauthorized"], [403, "forbidden"], [429, "rate_limited"], [503, "unavailable"], [500, "failed"]];
    for (const [status, reason] of cases) {
      const { service } = fake({
        invoke: async () => ({ data: null, error: { message: "x", context: new Response("<html>", { status }) } }),
      });
      await expect(service.markSubmitted("r1")).rejects.toMatchObject({ reason });
    }
  });

  it("never lets the revealed value reach storage or the console", async () => {
    const secret = "AB12-SECRET-CODE";
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const ok = fake({ invoke: async () => ({ data: { ok: true, value: secret, rid: "q" }, error: null }) });
      expect(await ok.service.reveal("r1", "code")).toBe(secret);
      const bad = fake({ invoke: async () => failure(403, { error: "forbidden", value: secret, rid: "q" }) });
      await bad.service.reveal("r1", "code").catch(() => {});
      expect(storage.setItem).not.toHaveBeenCalled();
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    } finally {
      spies.forEach((s) => s.mockRestore());
      vi.unstubAllGlobals();
    }
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
