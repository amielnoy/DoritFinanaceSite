import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";
import { addBusinessDays } from "../../supabase/functions/_shared/business-days.ts";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const OTHER_AGENCY = "aaaaaaaa-0000-0000-0000-000000000002";
const ON = { MASLEKA_ENABLED: "true" };
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const STAFF = "aaaaaaaa-1111-4111-8111-000000000001";
const OUTSIDER = "aaaaaaaa-1111-4111-8111-000000000002";
const STAFF_TOKEN = "staff-session-token-0123456789";
const OUTSIDER_TOKEN = "outsider-session-token-012345";
const CLIENT = "רונית מזרחי";
const SEALED_CODE = "c2VhbGVkLWNvZGU=";
const SEALED_ID = "c2VhbGVkLWlk";

const waiting = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  agency_id: AGENCY_1,
  client_name: CLIENT,
  token_hash: "f".repeat(64),
  status: "code_received",
  code_ciphertext: SEALED_CODE,
  id_ciphertext: SEALED_ID,
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
      roles: { [STAFF]: "admin", [OUTSIDER]: null },
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

describe("masleka-submitted", () => {
  it("answers disabled while MASLEKA_ENABLED is unset, before reading the body", async () => {
    const r = await invokeEdge("masleka-submitted", { requestId: REQUEST_ID }, {
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
      masleka: { requests: [waiting()], sessions: { [STAFF_TOKEN]: STAFF }, roles: { [STAFF]: "admin" } },
    });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "disabled", rid: expect.any(String) });
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    expect(r.maslekaRequests[0].code_ciphertext).toBe(SEALED_CODE);
  });

  it("refuses a caller with no session, and an outsider", async () => {
    const anonymous = await run({ requestId: REQUEST_ID }, { token: null });
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toEqual({ error: "unauthorized", rid: expect.any(String) });
    const outsider = await run({ requestId: REQUEST_ID }, { token: OUTSIDER_TOKEN });
    expect(outsider.status).toBe(403);
    expect(outsider.json).toEqual({ error: "forbidden", rid: expect.any(String) });
    for (const r of [anonymous, outsider]) {
      expect(r.requestPatches).toHaveLength(0);
      expect(r.maslekaRequests[0]).toMatchObject({ status: "code_received", code_ciphertext: SEALED_CODE, id_ciphertext: SEALED_ID });
    }
  });

  it("wipes both values, marks the request submitted and records who and when", async () => {
    const r = await run({ requestId: REQUEST_ID });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, rid: expect.any(String) });
    const row = r.maslekaRequests[0];
    expect(row).toMatchObject({ status: "submitted", code_ciphertext: null, id_ciphertext: null, submitted_by: STAFF, id_last4: "0018" });
    expect(row.ciphertext_wiped_at).toBe(row.submitted_at);
    expect(Math.abs(Date.now() - new Date(String(row.submitted_at)).getTime())).toBeLessThan(60_000);
  });

  it("sets the clearinghouse's deletion date, business day 7, in the same write", async () => {
    const r = await run({ requestId: REQUEST_ID });
    const row = r.maslekaRequests[0];
    expect(row.clearinghouse_deletes_at).not.toBeNull();
    expect(row.clearinghouse_deletes_at).toBe(addBusinessDays(new Date(String(row.submitted_at)), 7).toISOString());
    expect(r.requestPatches[0].fields.clearinghouse_deletes_at).toBe(row.clearinghouse_deletes_at);
  });

  it("does it in one write that is conditional on the request still waiting", async () => {
    const r = await run({ requestId: REQUEST_ID });
    expect(r.requestPatches).toHaveLength(1);
    const query = new URLSearchParams(r.requestPatches[0].query);
    expect(query.get("id")).toBe(`eq.${REQUEST_ID}`);
    expect(query.get("status")).toBe("eq.code_received");
    expect(query.get("agency_id")).toBe(`eq.${AGENCY_1}`);
    expect(r.requestPatches[0].fields).toMatchObject({
      status: "submitted",
      code_ciphertext: null,
      id_ciphertext: null,
      submitted_at: expect.any(String),
      clearinghouse_deletes_at: expect.any(String),
    });
    expect(Object.keys(r.requestPatches[0].fields).sort()).toEqual([
      "ciphertext_wiped_at",
      "clearinghouse_deletes_at",
      "code_ciphertext",
      "id_ciphertext",
      "status",
      "submitted_at",
      "submitted_by",
    ]);
  });

  it("asks for the updated rows with an explicit select that leaves out the ciphertexts and the token hash", async () => {
    const r = await run({ requestId: REQUEST_ID });
    const patch = r.callsTo("masleka_requests").find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    const select = new URLSearchParams(r.requestPatches[0].query).get("select");
    expect(select).toBe("id");
    expect(JSON.stringify(patch!.headers ?? {})).toMatch(/return=representation/);
    for (const call of r.callsTo("masleka_requests")) {
      expect(call.url).not.toMatch(/ciphertext|token_hash|select=\*/);
    }
  });

  it("does not call a second click done: the request is already submitted", async () => {
    const first = await run({ requestId: REQUEST_ID });
    const second = await run({ requestId: REQUEST_ID }, { fake: { requests: first.maslekaRequests } });
    expect(second.status).toBe(409);
    expect(second.json).toEqual({ error: "already_submitted", rid: expect.any(String) });
    expect(second.json).not.toHaveProperty("ok");
    expect(second.maslekaRequests[0].submitted_at).toBe(first.maslekaRequests[0].submitted_at);
    expect(second.maslekaRequests[0].clearinghouse_deletes_at).toBe(first.maslekaRequests[0].clearinghouse_deletes_at);
  });

  it("loses a race gracefully: a concurrent הגשתי that landed first is a refusal, not 'done'", async () => {
    const r = await run({ requestId: REQUEST_ID }, {
      fake: { raceBeforePatch: { status: "submitted", code_ciphertext: null, id_ciphertext: null } },
    });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "already_submitted", rid: expect.any(String) });
    expect(r.json).not.toHaveProperty("ok");
  });

  it("a failed wipe is reported as a failure, not as done", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { failRequestWrite: true } });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "failed", rid: expect.any(String) });
    expect(r.json).not.toHaveProperty("ok");
    expect(r.maslekaRequests[0]).toMatchObject({ status: "code_received", code_ciphertext: SEALED_CODE, id_ciphertext: SEALED_ID });
  });

  it("refuses a request that is not waiting with a code, and changes nothing", async () => {
    for (const status of ["invited", "completed", "expired", "cancelled"]) {
      const r = await run({ requestId: REQUEST_ID }, {
        fake: { requests: [waiting({ status, code_ciphertext: null, id_ciphertext: null })] },
      });
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ error: "not_available", rid: expect.any(String) });
      expect(r.json).not.toHaveProperty("ok");
      expect(r.maslekaRequests[0].status).toBe(status);
      expect(r.maslekaRequests[0].submitted_at).toBeUndefined();
    }
  });

  it("does not find a request that is not there, or not the agency's, and leaves the other agency's values alone", async () => {
    // Not there: the database's access check refuses it first (can_work_request
    // is false), without saying whether it exists.
    const missing = await run({ requestId: "99999999-9999-4999-8999-999999999999" });
    expect(missing.status).toBe(403);
    expect(missing.json).toEqual({ error: "forbidden", rid: expect.any(String) });
    expect(missing.requestPatches).toHaveLength(0);
    const other = await run({ requestId: REQUEST_ID, agencyId: OTHER_AGENCY, agency_id: OTHER_AGENCY }, {
      fake: { requests: [waiting({ agency_id: OTHER_AGENCY })] },
    });
    expect(other.status).toBe(404);
    expect(other.maslekaRequests[0]).toMatchObject({ status: "code_received", code_ciphertext: SEALED_CODE, id_ciphertext: SEALED_ID });
  });

  it("scopes the write to the agency, whatever the body says", async () => {
    const r = await run({ requestId: REQUEST_ID, agencyId: OTHER_AGENCY, agency_id: OTHER_AGENCY, submitted_by: OUTSIDER, status: "completed" });
    expect(r.status).toBe(200);
    expect(new URLSearchParams(r.requestPatches[0].query).get("agency_id")).toBe(`eq.${AGENCY_1}`);
    expect(r.maslekaRequests[0]).toMatchObject({ status: "submitted", submitted_by: STAFF });
  });

  it("refuses an id that is not one, before touching the table", async () => {
    for (const body of [
      { requestId: "x" },
      { requestId: "1 or 1=1" },
      { requestId: `${REQUEST_ID}&status=eq.submitted` },
      { requestId: 7 },
      {},
    ]) {
      const r = await run(body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: "invalid", rid: expect.any(String) });
      expect(r.callsTo("masleka_requests")).toHaveLength(0);
    }
    expect((await run(undefined, { rawBody: "not json" })).json).toMatchObject({ error: "invalid" });
  });

  it("lowercases the id once it is validated, so the filter and the answer agree", async () => {
    const r = await run({ requestId: REQUEST_ID.toUpperCase() });
    expect(r.status).toBe(200);
    expect(new URLSearchParams(r.requestPatches[0].query).get("id")).toBe(`eq.${REQUEST_ID}`);
    expect(r.maslekaRequests[0].status).toBe("submitted");
  });

  it("never writes a ciphertext, a name or the session token to a log line", async () => {
    const lines = captureLogs();
    await run({ requestId: REQUEST_ID });
    await run({ requestId: REQUEST_ID }, { fake: { failRequestWrite: true } });
    await run({ requestId: REQUEST_ID }, { token: OUTSIDER_TOKEN });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain("rid");
      for (const secret of [SEALED_CODE, SEALED_ID, CLIENT, STAFF_TOKEN, OUTSIDER_TOKEN, "0018"]) {
        expect(line).not.toContain(secret);
      }
    }
  });

  it("answers the browser's preflight and does nothing else", async () => {
    const r = await run(undefined, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
    expect(r.fetches).toHaveLength(0);
  });
});
