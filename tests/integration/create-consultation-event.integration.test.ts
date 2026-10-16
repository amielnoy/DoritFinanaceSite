import { describe, expect, it } from "vitest";
import { MAILER_URL, invokeFunction } from "../helpers/base44-function";

/**
 * Base44's createConsultationEvent, executed (review 2026-10-15, item 7).
 *
 * Nothing in the current build calls it; a stale client still can, and then
 * the event it books is the only trace of that visitor's interview — so it
 * keeps working, under a cap, and no longer hands a calendar provider's own
 * error text to the browser.
 */
const NAME = "createConsultationEvent";
const ENV = {
  MAILER_URL,
  MAILER_TOKEN: "test-only-token",
  SUPABASE_URL: "https://project-ref.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  CALENDAR_PROVIDERS: "outlook,google",
};
const lead = { name: "דנה כהן", phone: "0521234567", topic: "פנסיה", scheduledAt: "2026-10-20T10:00" };
const connections = { outlook: "outlook-token", googlecalendar: "google-token" };

describe("createConsultationEvent — kept for stale clients, under a cap", () => {
  it("still books, and asks the shared limiter once, for every caller together", async () => {
    const r = await invokeFunction(NAME, lead, { env: ENV, connections, rpc: { allow_submission: true } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    const limits = r.fetches.filter((f) => String(f.url).endsWith("/rest/v1/rpc/allow_submission"));
    expect(limits).toHaveLength(1);
    expect(limits[0].body).toMatchObject({ p_key: "consultation-event", p_window_seconds: 3600, p_max: 20 });
  });

  it("refuses past the cap with 429 and rid, booking nothing", async () => {
    const r = await invokeFunction(NAME, lead, { env: ENV, connections, rpc: { allow_submission: false } });
    expect(r.status).toBe(429);
    expect(r.json.rid).toEqual(expect.any(String));
    expect(r.fetches.some((f) => /graph\.microsoft|googleapis\.com\/calendar/.test(String(f.url)))).toBe(false);
  });

  it("never hands a calendar provider's own error text to the browser", async () => {
    const r = await invokeFunction(NAME, lead, {
      env: ENV,
      connections,
      rpc: { allow_submission: true },
      routes: [{ match: "graph.microsoft.com", status: 403, text: "AADSTS700016 internal tenant detail", json: { error: { message: "AADSTS700016" } } }],
    });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/AADSTS|tenant detail/);
    const events = r.json.events as Record<string, unknown>[];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e).not.toHaveProperty("details");
  });
});
