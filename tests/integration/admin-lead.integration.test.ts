import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * The admin's two writes to a lead — change its status, delete it.
 *
 * Supabase holds the copy the visitor's personal area reads, so a write that
 * reached only Base44 left every status at "new" there and kept a deleted
 * enquiry on show. The function writes Supabase first and Base44 second, and
 * answers only with a rid, never an internal message.
 */
const SUPABASE = "https://stub.supabase.co";
const env = { SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key" };
const admin = { id: "a1", email: "dorit@example.com", role: "admin" };
const leadUrl = `${SUPABASE}/rest/v1/leads?base44_id=eq.lead-1`;
const status = { action: "status", id: "lead-1", status: "contacted" };
const del = { action: "delete", id: "lead-1" };

const nothingWritten = (r: Awaited<ReturnType<typeof invokeFunction>>) => {
  expect(r.fetches).toHaveLength(0);
  expect(r.leadUpdates).toHaveLength(0);
  expect(r.leadDeletes).toHaveLength(0);
};

describe("adminLead — who may call it", () => {
  it("refuses nobody signed in with 401 and writes nothing", async () => {
    const r = await invokeFunction("adminLead", status, { env, user: null });
    expect(r.status).toBe(401);
    expect(typeof r.json.rid).toBe("string");
    nothingWritten(r);
  });

  it("reads a 403 from the SDK as signed out too", async () => {
    const forbidden = Object.assign(new Error("x"), { response: { status: 403 } });
    const r = await invokeFunction("adminLead", status, { env, user: forbidden });
    expect(r.status).toBe(401);
  });

  it("answers 500, not 'signed out', when Base44 itself fails", async () => {
    const outage = Object.assign(new Error("upstream unavailable"), { status: 503 });
    const r = await invokeFunction("adminLead", status, { env, user: outage });
    expect(r.status).toBe(500);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    nothingWritten(r);
  });

  it("refuses a signed-in user who is not an admin with 403 and writes nothing", async () => {
    for (const user of [{ ...admin, role: "user" }, { id: "u", email: "x@example.com" }]) {
      const r = await invokeFunction("adminLead", del, { env, user });
      expect(r.status).toBe(403);
      expect(typeof r.json.rid).toBe("string");
      nothingWritten(r);
    }
  });
});

describe("adminLead — what it accepts", () => {
  const bad: [string, unknown][] = [
    ["an unknown action", { action: "purge", id: "lead-1" }],
    ["no action", { id: "lead-1", status: "new" }],
    ["a status outside the enum", { action: "status", id: "lead-1", status: "won" }],
    ["a missing status", { action: "status", id: "lead-1" }],
    ["a non-string status", { action: "status", id: "lead-1", status: 1 }],
    ["a missing id", { action: "delete" }],
    ["an empty id", { action: "delete", id: "" }],
    ["a blank id", { action: "delete", id: "   " }],
    ["a numeric id", { action: "delete", id: 7 }],
    ["an over-long id", { action: "delete", id: "x".repeat(200) }],
    ["an id that would widen the Supabase filter", { action: "delete", id: "a&status=eq.new" }],
  ];
  it.each(bad)("rejects %s with 400 and writes nothing", async (_label, body) => {
    const r = await invokeFunction("adminLead", body, { env, user: admin });
    expect(r.status).toBe(400);
    expect(typeof r.json.rid).toBe("string");
    nothingWritten(r);
  });

  it.each(["new", "contacted", "closed", "escalated", "partial"])("accepts the status %s", async (s) => {
    const r = await invokeFunction("adminLead", { action: "status", id: "lead-1", status: s }, { env, user: admin });
    expect(r.status).toBe(200);
  });
});

describe("adminLead — status", () => {
  it("patches the Supabase copy on base44_id, then updates Base44", async () => {
    const r = await invokeFunction("adminLead", status, { env, user: admin });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(typeof r.json.rid).toBe("string");
    const [call] = r.callsTo("/rest/v1/leads");
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(leadUrl);
    expect(call.body).toEqual({ status: "contacted" });
    expect(call.headers.Authorization).toBe("Bearer test-only-service-key");
    expect(r.leadUpdates).toEqual([{ id: "lead-1", fields: { status: "contacted" } }]);
  });

  it("writes Supabase before Base44", async () => {
    const r = await invokeFunction("adminLead", status, { env, user: admin });
    expect(r.sequence).toEqual([`fetch PATCH ${leadUrl}`, "Lead.update lead-1"]);
  });
});

describe("adminLead — delete", () => {
  it("deletes the Supabase copy on base44_id, then deletes in Base44", async () => {
    const r = await invokeFunction("adminLead", del, { env, user: admin });
    expect(r.status).toBe(200);
    const [call] = r.callsTo("/rest/v1/leads");
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(leadUrl);
    expect(r.leadDeletes).toEqual(["lead-1"]);
    expect(r.sequence).toEqual([`fetch DELETE ${leadUrl}`, "Lead.delete lead-1"]);
  });
});

describe("adminLead — a retried delete", () => {
  it("succeeds when Base44 already deleted the lead (a lost response, then a retry)", async () => {
    const r = await invokeFunction("adminLead", del, { env, user: admin, leadAlreadyDeleted: true });
    expect(r.status).toBe(200);
    expect(r.sequence).toEqual([`fetch DELETE ${leadUrl}`, "Lead.delete lead-1 (404)"]);
  });
});

describe("adminLead — when something fails", () => {
  it.each([status, del])("answers 502 with the rid and leaves Base44 alone when Supabase refuses (%o)", async (body) => {
    const r = await invokeFunction("adminLead", body, { env, user: admin, fetchStatus: 500 });
    expect(r.status).toBe(502);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    expect(String(r.json.error)).not.toMatch(/stub\.supabase|service-key|500/);
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leadDeletes).toHaveLength(0);
  });

  it("answers 502 with the rid when Supabase cannot be reached", async () => {
    const r = await invokeFunction("adminLead", del, { env, user: admin, failFetch: true });
    expect(r.status).toBe(502);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    expect(r.leadDeletes).toHaveLength(0);
  });

  it("answers 502, not an internal message, when Base44 refuses after Supabase succeeded", async () => {
    const r = await invokeFunction("adminLead", status, { env, user: admin, failLeadWrite: true });
    expect(r.status).toBe(502);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    expect(String(r.json.error)).not.toMatch(/simulated|outage/);
  });

  it.each([status, del])("still writes Base44 when Supabase is not configured (%o)", async (body) => {
    const r = await invokeFunction("adminLead", body, { env: {}, user: admin });
    expect(r.status).toBe(200);
    expect(r.callsTo("/rest/v1/")).toHaveLength(0);
    expect(r.leadUpdates.length + r.leadDeletes.length).toBe(1);
  });

  it("never returns more than the rid and a fixed message on any failure", async () => {
    const cases = [
      await invokeFunction("adminLead", status, { env, user: null }),
      await invokeFunction("adminLead", status, { env, user: { ...admin, role: "user" } }),
      await invokeFunction("adminLead", { action: "x" }, { env, user: admin }),
      await invokeFunction("adminLead", status, { env, user: admin, fetchStatus: 500 }),
    ];
    for (const r of cases) expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
  });
});
