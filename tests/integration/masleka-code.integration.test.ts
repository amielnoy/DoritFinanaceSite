import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const IP = "203.0.113.7";

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
const STAFF = ["dorit@govari-fin.co.il", "staff@example.com"];

function run(b: unknown, o: EdgeOptions & { fake?: MaslekaFake } = {}) {
  const { fake, ...rest } = o;
  return invokeEdge("masleka-code", b, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: { "x-forwarded-for": IP, ...(rest.headers ?? {}) },
    masleka: { requests: [invited()], staffEmails: ["dorit@govari-fin.co.il", "staff@example.com"], ...fake },
  });
}

/** A stored value opened as the board will open it: with its own row and field as the context. */
const open = async (value: unknown, field: "code" | "id", requestId = REQUEST_ID) =>
  unseal(await importSealKey(KEY), String(value), `${requestId}:${field}`);

/** Every line the function wrote, at any level. */
function captureLogs(): string[] {
  const lines: string[] = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  }
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("masleka-code — dark by default", () => {
  it("answers disabled and touches nothing while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-code", body, { masleka: { requests: [invited()] } });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "disabled", rid: expect.any(String) });
    expect(r.fetches).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
    expect(r.maslekaRequests[0].status).toBe("invited");
  });

  it("stays dark for anything but exactly true, before reading the body", async () => {
    // A non-JSON body would be `link_invalid` once the body is read; `disabled`
    // here shows the switch is asked first.
    for (const value of ["TRUE", "1", "yes", "true1"]) {
      const r = await run(undefined, { envPatch: { MASLEKA_ENABLED: value }, rawBody: "not json" });
      expect(r.status, value).toBe(404);
      expect(r.json, value).toMatchObject({ error: "disabled" });
      expect(r.fetches, value).toHaveLength(0);
    }
  });
});

describe("masleka-code — the code arrives", () => {
  it("stores both values sealed and moves the request to code_received", async () => {
    const r = await run(body);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json)).toEqual(["ok", "rid"]);
    const row = r.maslekaRequests[0];
    expect(row.status).toBe("code_received");
    expect(row.id_last4).toBe("0018");
    expect(row.code_received_at).toEqual(expect.any(String));
    expect(await open(row.code_ciphertext, "code")).toBe("AB12-CD34");
    expect(await open(row.id_ciphertext, "id")).toBe("000000018");
  });

  it("binds each sealed value to its request and its field", async () => {
    // Ruling 10: a ciphertext moved to the other column, or to another row,
    // no longer opens.
    const r = await run(body);
    const row = r.maslekaRequests[0];
    await expect(open(row.code_ciphertext, "id")).rejects.toThrow("sealed_invalid");
    await expect(open(row.id_ciphertext, "code")).rejects.toThrow("sealed_invalid");
    await expect(open(row.code_ciphertext, "code", "22222222-2222-4222-8222-222222222222")).rejects.toThrow(
      "sealed_invalid",
    );
  });

  it("pads a short ID before sealing it", async () => {
    const r = await run({ ...body, idNumber: "00018" });
    expect(await open(r.maslekaRequests[0].id_ciphertext, "id")).toBe("000000018");
  });

  it("accepts only through one conditional update that names its columns and carries nothing the caller typed", async () => {
    const r = await run(body);
    expect(r.requestPatches).toHaveLength(1);
    for (const call of [...r.callsTo("/rest/v1/masleka_requests?")]) {
      const q = new URLSearchParams(call.url.split("?")[1]);
      expect(q.get("token_hash"), call.method).toBe(`eq.${sha(TOKEN)}`);
      expect(q.get("status"), call.method).toBe("eq.invited");
      expect(q.get("token_expires_at"), call.method).toMatch(/^gt\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const select = (q.get("select") ?? "").split(",");
      expect(select.length, call.method).toBeGreaterThan(0);
      expect(select, call.method).not.toContain("*");
      for (const hidden of ["code_ciphertext", "id_ciphertext", "token_hash"]) {
        expect(select, `${call.method} selects ${hidden}`).not.toContain(hidden);
      }
      for (const typed of [TOKEN, "AB12-CD34", "000000018"]) {
        expect(call.url, call.method).not.toContain(typed);
      }
    }
    const patch = new URLSearchParams(r.requestPatches[0].query);
    expect([...patch.keys()].sort()).toEqual(["id", "select", "status", "token_expires_at", "token_hash"]);
    expect(patch.get("id")).toBe(`eq.${REQUEST_ID}`);
  });

  it("never echoes the code or the ID — not in the answer, not in any mail", async () => {
    const r = await run(body);
    const everything = JSON.stringify(r.json) + r.emails.map((e) => `${e.subject}${e.html}${e.text}`).join("");
    expect(everything).not.toContain("AB12-CD34");
    expect(everything).not.toContain("000000018");
  });

  it("never writes the code, the ID, the token or the address to a log line", async () => {
    const lines = captureLogs();
    for (const b of [body, { ...body, idNumber: "000000019" }, { ...body, code: "<b>" }]) await run(b);
    await run(body, { fake: { failRequestWrite: true } });
    const all = lines.join("\n");
    expect(all).toContain("masleka.code_received");
    for (const secret of ["AB12-CD34", "000000018", "000000019", TOKEN, sha(TOKEN), IP, "רונית"]) {
      expect(all).not.toContain(secret);
    }
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

  it("still accepts the code when a notice cannot be delivered", async () => {
    const r = await run(body, { failEmailTo: ["staff@example.com"] });
    expect(r.status).toBe(200);
    expect(r.maslekaRequests[0].status).toBe("code_received");
    expect(r.emails.map((e) => e.to)).toEqual(["dorit@govari-fin.co.il"]);
  });
});

describe("masleka-code — links that no longer admit", () => {
  it("a second submission of the same link is refused and changes nothing", async () => {
    const first = await run(body);
    const second = await run({ ...body, code: "ZZ99-ZZ99" }, { fake: { requests: first.maslekaRequests } });
    expect(second.status).toBe(404);
    expect(second.json).toMatchObject({ error: "link_invalid" });
    expect(second.maslekaRequests[0]).toEqual(first.maslekaRequests[0]);
    expect(await open(second.maslekaRequests[0].code_ciphertext, "code")).toBe("AB12-CD34");
    expect(second.emails).toHaveLength(0);
  });

  it("loses the race to a submission that lands between its read and its update", async () => {
    // Two tabs, one click each: both read the request as invited, and the
    // conditional update is what lets only one of them through.
    const winner = { status: "code_received", code_ciphertext: "first", id_ciphertext: "first", code_received_at: PAST };
    const r = await run(body, { fake: { raceBeforePatch: winner } });
    expect(r.requestPatches).toHaveLength(1);
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "link_invalid" });
    expect(r.maslekaRequests[0]).toMatchObject(winner);
    expect(r.emails).toHaveLength(0);
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

  it("refuses the old token once the reminder has rotated the link", async () => {
    const r = await run(body, { fake: { requests: [invited({ token_hash: sha("N".repeat(43)) })] } });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "link_invalid" });
    expect(r.maslekaRequests[0]).toEqual(invited({ token_hash: sha("N".repeat(43)) }));
  });

  it("answers expired, used, rotated and unknown links in exactly the same words", async () => {
    // Nothing in the answer tells a guesser which kind of dead link they hold.
    const answers = await Promise.all([
      run(body, { fake: { requests: [invited({ token_expires_at: PAST })] } }),
      run(body, { fake: { requests: [invited({ status: "code_received", code_received_at: PAST })] } }),
      run(body, { fake: { requests: [invited({ status: "submitted" })] } }),
      run(body, { fake: { requests: [invited({ status: "expired" })] } }),
      run(body, { fake: { requests: [invited({ token_hash: sha("N".repeat(43)) })] } }),
      run({ ...body, token: "Z".repeat(43) }),
      run({ ...body, token: "short" }),
    ]);
    for (const r of answers) {
      expect(r.status).toBe(404);
      expect({ ...r.json, rid: "x" }).toEqual({ error: "link_invalid", rid: "x" });
      expect(r.requestPatches).toHaveLength(0);
      expect(r.emails).toHaveLength(0);
    }
  });

  it("refuses a malformed token without asking the database", async () => {
    const r = await run({ ...body, token: "short" });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "link_invalid" });
    expect(r.callsTo("/rest/v1/masleka_requests")).toHaveLength(0);
  });
});

describe("masleka-code — bad input and floods", () => {
  it("refuses an ID that fails the check digit, before storing anything", async () => {
    const r = await run({ ...body, idNumber: "000000019" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "bad_id" });
    expect(r.callsTo("/rest/v1/masleka_requests")).toHaveLength(0);
  });

  it("refuses a code that cannot be one", async () => {
    const r = await run({ ...body, code: "<b>" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "bad_code" });
    expect(r.callsTo("/rest/v1/masleka_requests")).toHaveLength(0);
  });

  it("answers a non-JSON body as a bad link", async () => {
    const r = await run(undefined, { rawBody: "not json" });
    expect(r.json).toMatchObject({ error: "link_invalid" });
  });

  it("counts every call against its address and its link, never by the raw values", async () => {
    const r = await run(body);
    const limits = r.callsTo("/rest/v1/rpc/allow_submission").map((c) => c.body as Record<string, unknown>);
    expect(limits).toEqual([
      { p_key: `masleka-ip:${sha(IP)}`, p_window_seconds: 3600, p_max: 10 },
      { p_key: `masleka-link:${sha(TOKEN)}`, p_window_seconds: 3600, p_max: 5 },
    ]);
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
    expect(r.json).toMatchObject({ error: "rate_limited" });
    expect(r.requestPatches).toHaveLength(0);
  });
});

describe("masleka-code — when something is missing or down", () => {
  it("stores nothing when there is no key to seal with, or the key is not 32 bytes", async () => {
    // Ruling 10: no key is a refusal, never "store it in the clear".
    for (const MASLEKA_KEY of [null, Buffer.alloc(16, 7).toString("base64"), "!!!"]) {
      const r = await run(body, { envPatch: { MASLEKA_KEY } });
      expect(r.status, String(MASLEKA_KEY)).toBe(503);
      expect(r.json, String(MASLEKA_KEY)).toMatchObject({ error: "unavailable", rid: expect.any(String) });
      expect(r.callsTo("/rest/v1/masleka_requests"), String(MASLEKA_KEY)).toHaveLength(0);
      expect(r.maslekaRequests[0], String(MASLEKA_KEY)).toEqual(invited());
      // Nothing was stored, so staff are told (decision 2026-10-14): the cause, never a value.
      expect(r.emails.map((e) => e.to).sort(), String(MASLEKA_KEY)).toEqual(STAFF);
      expect(r.emails[0].subject, String(MASLEKA_KEY)).toBe("מסירת קוד מסלקה נכשלה");
      expect(r.emails[0].text, String(MASLEKA_KEY)).toContain("MASLEKA_KEY");
    }
  });

  it("reports a refused write as not saved, with its rid and nothing else", async () => {
    const r = await run(body, { fake: { failRequestWrite: true } });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "not_saved", rid: expect.any(String) });
    expect(r.maslekaRequests[0]).toEqual(invited());
  });

  it("answers the browser's preflight and does nothing else", async () => {
    const r = await run(undefined, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.fetches).toHaveLength(0);
  });
});

describe("masleka-code — when the code does not go through (decision 2026-10-14)", () => {
  /** The table's own reads answer 500, as a database outage would. */
  const failReads: EdgeOptions["upstream"] = (call) =>
    call.method === "GET" && call.url.includes("/rest/v1/masleka_requests?")
      ? new Response('{"message":"simulated"}', { status: 500 })
      : undefined;
  /** The accepting PATCH never answers: the connection drops, and nobody knows whether it landed. */
  const dropPatch: EdgeOptions["upstream"] = (call) => {
    if (call.method === "PATCH" && call.url.includes("/rest/v1/masleka_requests?")) throw new TypeError("network");
    return undefined;
  };
  const alerts = (r: { emails: { subject: string }[] }) => r.emails.filter((e) => e.subject.startsWith("מסירת קוד מסלקה נכשלה"));

  it("answers not_saved when the link cannot be read, and tells every staff member once", async () => {
    const r = await run(body, { upstream: failReads });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "not_saved", rid: r.json.rid });
    expect(alerts(r).map((e) => e.to).sort()).toEqual(STAFF);
    expect(alerts(r)[0].subject).toBe("מסירת קוד מסלקה נכשלה");
    expect(r.requestPatches).toHaveLength(0);
  });

  it("names the client in the alert when the link was read before the write was refused", async () => {
    const r = await run(body, { fake: { failRequestWrite: true } });
    expect(r.json).toMatchObject({ error: "not_saved" });
    expect(r.mailTo("staff@example.com").subject).toBe("מסירת קוד מסלקה נכשלה — רונית מזרחי");
    expect(r.mailTo("staff@example.com").text).toContain("התבקש לנסות שוב");
    expect(r.mailTo("staff@example.com").text).toContain(String(r.json.rid));
  });

  it("answers failed, never not_saved, when the write was cut off and may have landed", async () => {
    const r = await run(body, { upstream: dropPatch });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "failed", rid: r.json.rid });
    expect(alerts(r).map((e) => e.to).sort()).toEqual(STAFF);
    expect(r.mailTo("staff@example.com").text).toContain("לא ברור אם הקוד נשמר");
  });

  it("puts no code, ID, token or link in an alert", async () => {
    for (const o of [{ upstream: failReads }, { upstream: dropPatch }, { fake: { failRequestWrite: true } }, { envPatch: { MASLEKA_KEY: null } }]) {
      const r = await run(body, o as EdgeOptions & { fake?: MaslekaFake });
      expect(alerts(r).length).toBeGreaterThan(0);
      for (const e of r.emails) {
        const all = `${e.subject}${e.html}${e.text}`;
        for (const secret of ["AB12-CD34", "000000018", TOKEN, sha(TOKEN), "masleka#t="]) expect(all).not.toContain(secret);
      }
    }
  });

  it("alerts at most once an hour per link, and at most five times an hour in all", async () => {
    const r = await run(body, { fake: { failRequestWrite: true } });
    const limits = r.callsTo("/rest/v1/rpc/allow_submission").map((c) => c.body as Record<string, unknown>);
    expect(limits).toEqual(
      expect.arrayContaining([
        { p_key: `masleka-alert:${sha(TOKEN)}`, p_window_seconds: 3600, p_max: 1 },
        { p_key: "masleka-alerts", p_window_seconds: 3600, p_max: 5 },
      ]),
    );
  });

  it("sends no alert for a retry inside the hour, and still tells the client it did not go through", async () => {
    for (const prefix of ["masleka-alert:", "masleka-alerts"]) {
      const r = await run(body, { fake: { failRequestWrite: true }, overLimit: [prefix] });
      expect(r.json, prefix).toMatchObject({ error: "not_saved" });
      expect(r.emails, prefix).toHaveLength(0);
    }
  });

  it("still answers not_saved when no alert can be delivered", async () => {
    const r = await run(body, { fake: { failRequestWrite: true }, failEmailTo: STAFF });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "not_saved" });
  });

  it("raises no alert for what the client got wrong: a bad link, ID or code, or too many tries", async () => {
    const cases = await Promise.all([
      run({ ...body, token: "Z".repeat(43) }),
      run({ ...body, idNumber: "000000019" }),
      run({ ...body, code: "<b>" }),
      run(body, { overLimit: ["masleka-link:"] }),
    ]);
    for (const r of cases) {
      expect(r.emails).toHaveLength(0);
      expect(r.callsTo("allow_submission").map((c) => String((c.body as Record<string, unknown>).p_key))).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^masleka-alert/)]),
      );
    }
  });
});
