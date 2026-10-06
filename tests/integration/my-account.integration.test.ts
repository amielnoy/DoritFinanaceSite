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
    expect(typeof r.json.rid).toBe("string");
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("refuses an unverified address", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: { ...verified, is_verified: false } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("כתובת המייל בחשבון עדיין לא אומתה.");
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("refuses a disabled account", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: { ...verified, disabled: true } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("החשבון אינו פעיל.");
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("answers 500, not 'signed out', when Base44 itself fails", async () => {
    const outage = Object.assign(new Error("upstream unavailable"), { status: 503 });
    const r = await invokeFunction("myAccount", {}, { env, user: outage });
    expect(r.status).toBe(500);
    expect(typeof r.json.rid).toBe("string");
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("still reads a 401 off an axios-shaped auth failure as signed out", async () => {
    const axiosish = Object.assign(new Error("x"), { response: { status: 401 } });
    const r = await invokeFunction("myAccount", {}, { env, user: axiosish });
    expect(r.status).toBe(401);
  });

  it("answers with the rid and no error detail when Supabase fails", async () => {
    const r = await invokeFunction("myAccount", {}, { env, user: verified, rpc: { enquiries_for: [] }, fetchStatus: 500 });
    expect(r.status).toBe(500);
    expect(typeof r.json.rid).toBe("string");
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    expect(String(r.json.error)).not.toMatch(/stub\.supabase|service-key|500/);
  });

  it("does not answer when Supabase is not configured", async () => {
    const r = await invokeFunction("myAccount", {}, { env: {}, user: verified });
    expect(r.status).toBe(500);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    expect(r.callsTo("/rest/v1/rpc/")).toHaveLength(0);
  });

  it("passes on no column outside the visitor's list, even if the SQL ever did", async () => {
    const leaky = { ...row, phone: "050-1", status: "new", escalation_reason: "x" };
    const r = await invokeFunction("myAccount", {}, { env, user: verified, rpc: { enquiries_for: [leaky] } });
    const [out] = r.json.enquiries as Record<string, unknown>[];
    expect(Object.keys(out).sort()).toEqual(Object.keys(row).sort());
  });
});
