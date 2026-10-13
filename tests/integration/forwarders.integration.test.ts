import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * The three tools the Base44 chat agents can call. They do no work of their own
 * any more: each passes the request to the Supabase Edge Function that does.
 */

const env = { SUPABASE_URL: "https://stub.supabase.co", MAILER_URL: "x", MAILER_TOKEN: "x" };
const FORWARDERS = [
  ["submitLead", "submit-lead"],
  ["escalateToHuman", "escalate-to-human"],
  ["logSupportChat", "log-support-chat"],
] as const;

describe.each(FORWARDERS)("Base44 %s forwards to Edge %s", (fn, edge) => {
  it("posts the body and the user-agent, and returns the Edge answer unchanged", async () => {
    const r = await invokeFunction(fn, { name: "דנה", phone: "0501234567" }, {
      env,
      headers: { "user-agent": "Mozilla/5.0 (iPhone)" },
      fetchResponses: { [`/functions/v1/${edge}`]: { status: 400, body: { error: "נדרשים שם וטלפון", rid: "e1" } } },
    });
    const call = r.callsTo(`/functions/v1/${edge}`)[0];
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ name: "דנה", phone: "0501234567" });
    expect(call.headers["user-agent"]).toBe("Mozilla/5.0 (iPhone)");
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "נדרשים שם וטלפון", rid: "e1" });
  });

  it("answers in JSON, not a crash, when Edge cannot be reached", async () => {
    const r = await invokeFunction(fn, { name: "דנה", phone: "0501234567" }, { env, failFetch: true });
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: expect.any(String) });
  });

  it("answers 503 in JSON when it has no Supabase URL", async () => {
    const r = await invokeFunction(fn, { name: "דנה" }, { env: { MAILER_URL: "x", MAILER_TOKEN: "x" } });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: expect.any(String) });
  });
});
