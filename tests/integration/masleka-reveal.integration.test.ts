import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";
import { importSealKey, seal } from "../../supabase/functions/_shared/seal.ts";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const OTHER_AGENCY = "aaaaaaaa-0000-0000-0000-000000000002";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ON = { MASLEKA_ENABLED: "true", MASLEKA_KEY: KEY };
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST = "11111111-1111-4111-8111-222222222222";
const STAFF = "aaaaaaaa-1111-4111-8111-000000000001";
const OUTSIDER = "aaaaaaaa-1111-4111-8111-000000000002";
const STAFF_TOKEN = "staff-session-token-0123456789";
const OUTSIDER_TOKEN = "outsider-session-token-012345";
const CODE = "AB12-CD34";
const ID_NUMBER = "000000018";

let sealedCode = "";
let sealedId = "";
let otherRowsId = "";
beforeAll(async () => {
  const key = await importSealKey(KEY);
  sealedCode = await seal(key, CODE, `${REQUEST_ID}:code`);
  sealedId = await seal(key, ID_NUMBER, `${REQUEST_ID}:id`);
  otherRowsId = await seal(key, ID_NUMBER, `${OTHER_REQUEST}:id`);
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

/** Every line the function wrote, at any level. */
function captureLogs(): string[] {
  const lines: string[] = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  }
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("masleka-reveal — who may", () => {
  it("answers disabled while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-reveal", { requestId: REQUEST_ID, field: "id" }, {
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
      masleka: { requests: [waiting()], sessions: { [STAFF_TOKEN]: STAFF }, roles: { [STAFF]: "staff" } },
    });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "disabled", rid: expect.any(String) });
    expect(r.fetches).toHaveLength(0);
  });

  it("stays dark for anything but exactly true, before reading the body", async () => {
    // A non-JSON body would be `invalid` once read; `disabled` shows the switch is asked first.
    for (const value of ["TRUE", "1", "yes", "true1"]) {
      const r = await run(undefined, { envPatch: { MASLEKA_ENABLED: value }, rawBody: "not json" });
      expect(r.status).toBe(404);
      expect(r.json).toMatchObject({ error: "disabled" });
      expect(r.fetches).toHaveLength(0);
    }
  });

  it("refuses a caller with no session", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { token: null });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: "unauthorized", rid: expect.any(String) });
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    expect(r.accessLog).toHaveLength(0);
  });

  it("refuses a session the auth server does not recognise", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { token: "forged-session-token-0123456" });
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ error: "unauthorized" });
    expect(r.callsTo("staff_role")).toHaveLength(0);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
  });

  it("refuses a signed-in user who is not staff, and logs no access", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { token: OUTSIDER_TOKEN });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden", rid: expect.any(String) });
    expect(r.accessLog).toHaveLength(0);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
  });

  it("a membership removed between two calls is refused on the second", async () => {
    const first = await run({ requestId: REQUEST_ID, field: "id" });
    expect(first.status).toBe(200);
    const second = await run({ requestId: REQUEST_ID, field: "id" }, { fake: { roles: { [STAFF]: null } } });
    expect(second.status).toBe(403);
    expect(second.json).not.toHaveProperty("value");
    expect(second.accessLog).toHaveLength(0);
  });

  it("asks the auth server and staff_role about the caller on every call", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "code" });
    expect(r.status).toBe(200);
    const auth = r.callsTo("/auth/v1/user");
    expect(auth).toHaveLength(1);
    expect(auth[0].headers.Authorization).toBe(`Bearer ${STAFF_TOKEN}`);
    const role = r.callsTo("/rpc/staff_role");
    expect(role).toHaveLength(1);
    expect(role[0].body).toEqual({ p_user_id: STAFF });
  });
});

describe("masleka-reveal — what a member gets", () => {
  it("decrypts the ID for a member, never cached, and logs who asked", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, value: ID_NUMBER, rid: expect.any(String) });
    expect(Object.keys(r.json)).toEqual(["ok", "value", "rid"]);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.accessLog).toEqual([
      expect.objectContaining({ agency_id: AGENCY_1, request_id: REQUEST_ID, user_id: STAFF, field: "id" }),
    ]);
    // Who, which request, which field, when — and nothing else (`id`, `at` are the table's own).
    expect(Object.keys(r.accessLog[0]).sort()).toEqual(["agency_id", "at", "field", "id", "request_id", "user_id"]);
  });

  it("decrypts the code", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "code" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, value: CODE });
    expect(r.accessLog).toHaveLength(1);
    expect(r.accessLog[0]).toMatchObject({ field: "code", request_id: REQUEST_ID });
  });

  it("opens each value only with its own request and field as the context", async () => {
    // The code's ciphertext moved into the ID's column, and an ID sealed for another row.
    for (const id_ciphertext of [sealedCode, otherRowsId]) {
      const r = await run({ requestId: REQUEST_ID, field: "id" }, { fake: { requests: [waiting({ id_ciphertext })] } });
      expect(r.status).toBe(500);
      expect(r.json).toEqual({ error: "failed", rid: expect.any(String) });
    }
  });

  it("has nothing to give unless the request is waiting with its code", async () => {
    for (const status of ["invited", "submitted", "completed", "expired", "cancelled"]) {
      const r = await run({ requestId: REQUEST_ID, field: "id" }, {
        fake: { requests: [waiting({ status, code_ciphertext: null, id_ciphertext: null })] },
      });
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ error: "not_available", rid: expect.any(String) });
      expect(r.accessLog).toHaveLength(0);
    }
  });

  it("does not find another agency's request", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, {
      fake: { requests: [waiting({ agency_id: OTHER_AGENCY })] },
    });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "not_found", rid: expect.any(String) });
    expect(r.accessLog).toHaveLength(0);
  });

  it("refuses a field it does not hold, or an id that is not one", async () => {
    for (const body of [
      { requestId: REQUEST_ID, field: "phone" },
      { requestId: "1 or 1=1", field: "id" },
      { requestId: `${REQUEST_ID}&status=eq.submitted`, field: "id" },
      { field: "id" },
    ]) {
      const r = await run(body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: "invalid", rid: expect.any(String) });
      expect(r.callsTo("masleka_requests")).toHaveLength(0);
    }
    expect((await run(undefined, { rawBody: "not json" })).json).toMatchObject({ error: "invalid" });
  });

  it("logs the agency the request belongs to and the caller the auth server named, whatever the body says", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id", agencyId: OTHER_AGENCY, agency_id: OTHER_AGENCY, userId: OUTSIDER });
    expect(r.status).toBe(200);
    expect(r.accessLog).toHaveLength(1);
    expect(r.accessLog[0]).toMatchObject({ agency_id: AGENCY_1, user_id: STAFF });
  });

  it("reads the request once, by its checked id and agency, naming its columns, and never changes it", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" });
    const calls = r.callsTo("masleka_requests");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    const q = new URLSearchParams(calls[0].url.split("?")[1]);
    expect(q.get("id")).toBe(`eq.${REQUEST_ID}`);
    expect(q.get("agency_id")).toBe(`eq.${AGENCY_1}`);
    const select = (q.get("select") ?? "").split(",");
    expect(select).not.toContain("*");
    expect(select).not.toContain("token_hash");
    expect(select.length).toBeGreaterThan(0);
    expect(r.requestPatches).toHaveLength(0);
  });
});

describe("masleka-reveal — failing closed", () => {
  it("reveals nothing when the access log cannot be written", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, { fake: { failAccessLog: true } });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "failed", rid: expect.any(String) });
    expect(JSON.stringify(r.json)).not.toContain(ID_NUMBER);
  });

  it("reveals nothing from a value that fails its tag, and the attempt stays logged", async () => {
    const r = await run({ requestId: REQUEST_ID, field: "id" }, {
      fake: { requests: [waiting({ id_ciphertext: Buffer.alloc(40, 1).toString("base64") })] },
    });
    expect(r.status).toBe(500);
    expect(r.json).not.toHaveProperty("value");
    // Logged before decrypting: the attempt is on record even though nothing was revealed.
    expect(r.accessLog).toHaveLength(1);
  });

  it("reveals nothing without the key, or with one that is not 32 bytes", async () => {
    for (const MASLEKA_KEY of [null, Buffer.alloc(16, 7).toString("base64"), "not base64 !!"]) {
      const r = await run({ requestId: REQUEST_ID, field: "id" }, { envPatch: { MASLEKA_KEY } });
      expect(r.status).toBe(503);
      expect(r.json).toEqual({ error: "unavailable", rid: expect.any(String) });
      expect(r.callsTo("masleka_requests")).toHaveLength(0);
      expect(r.accessLog).toHaveLength(0);
    }
  });

  it("never writes a revealed value or the session token to a log line", async () => {
    const lines = captureLogs();
    await run({ requestId: REQUEST_ID, field: "id" });
    await run({ requestId: REQUEST_ID, field: "code" });
    await run({ requestId: REQUEST_ID, field: "id" }, { fake: { failAccessLog: true } });
    await run({ requestId: REQUEST_ID, field: "id" }, { fake: { requests: [waiting({ id_ciphertext: sealedCode })] } });
    await run({ requestId: REQUEST_ID, field: "id" }, { token: OUTSIDER_TOKEN });
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join("\n");
    for (const secret of [ID_NUMBER, CODE, STAFF_TOKEN, OUTSIDER_TOKEN, sealedCode, sealedId, "רונית"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("answers the browser's preflight and does nothing else", async () => {
    const r = await run(undefined, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
    expect(r.fetches).toHaveLength(0);
  });
});
