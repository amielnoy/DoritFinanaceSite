import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const ON = { MASLEKA_ENABLED: "true" };
const STAFF = "aaaaaaaa-1111-4111-8111-000000000001";
const OUTSIDER = "aaaaaaaa-1111-4111-8111-000000000002";
const STAFF_TOKEN = "staff-session-token-0123456789";
const OUTSIDER_TOKEN = "outsider-session-token-012345";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NAME = "משה כהן";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const tokenOf = (link: unknown) => String(link).split("#t=")[1];

/** Every line the function wrote, at any level. */
function captureLogs(): string[] {
  const lines: string[] = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  }
  return lines;
}

afterEach(() => vi.restoreAllMocks());

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
    // An outsider cannot rotate a link either.
    const rotate = await run({ requestId: REQUEST_ID }, { token: OUTSIDER_TOKEN, fake: { requests: [{ id: REQUEST_ID, agency_id: AGENCY_1, status: "invited", token_hash: "a".repeat(64) }] } });
    expect(rotate.status).toBe(403);
    expect(rotate.maslekaRequests[0].token_hash).toBe("a".repeat(64));
  });

  it("lets a User start a request by hand, as theirs, and fresh-link only their own (agency roles)", async () => {
    const USER = "aaaaaaaa-1111-4111-8111-000000000003";
    const USER_TOKEN = "user-session-token-0123456789";
    const asUser = { token: USER_TOKEN, fake: { sessions: { [USER_TOKEN]: USER }, roles: { [USER]: "user" } } };
    const made = await run({ clientName: "משה כהן" }, asUser);
    expect(made.status).toBe(200);
    expect(made.maslekaRequests[0]).toMatchObject({ created_by: USER, lead_id: null });
    const someoneElses = { id: REQUEST_ID, agency_id: AGENCY_1, status: "invited", token_hash: "a".repeat(64), lead_id: null, created_by: STAFF };
    const refused = await run({ requestId: REQUEST_ID }, { ...asUser, fake: { ...asUser.fake, requests: [someoneElses] } });
    expect(refused.status).toBe(403);
    expect(refused.maslekaRequests[0].token_hash).toBe("a".repeat(64));
    const own = await run({ requestId: REQUEST_ID }, { ...asUser, fake: { ...asUser.fake, requests: [{ ...someoneElses, created_by: USER }] } });
    expect(own.status).toBe(200);
  });

  it("answers disabled before reading the body or calling anything", async () => {
    const r = await invokeEdge("masleka-create", undefined, {
      rawBody: "{not json",
      headers: { authorization: `Bearer ${STAFF_TOKEN}` },
      masleka: { sessions: { [STAFF_TOKEN]: STAFF }, roles: { [STAFF]: "owner" } },
    });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "disabled", rid: expect.any(String) });
    expect(r.fetches).toHaveLength(0);
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

describe("masleka-create — what comes from the server", () => {
  it("takes the agency and the creator from the server, never the body", async () => {
    const r = await run({ clientName: "משה כהן", agency_id: "aaaaaaaa-0000-0000-0000-000000000002", created_by: OUTSIDER, status: "completed", lead_id: REQUEST_ID, token_hash: "b".repeat(64) });
    expect(r.status).toBe(200);
    expect(r.maslekaRequests[0]).toMatchObject({ agency_id: AGENCY_1, created_by: STAFF, lead_id: null, status: "invited" });
    expect(r.maslekaRequests[0].token_hash).toBe(sha(tokenOf(r.json.link)));
  });

  it("mails the invitation with a clickable https button to the link, as the client's role", async () => {
    const r = await run({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true });
    const link = String(r.json.link);
    expect(link).toMatch(/^https:\/\/govari-fin\.co\.il\/masleka#t=[A-Za-z0-9_-]{43}$/);
    expect(r.mailTo("moshe@example.com").html).toContain(`href="${link}"`);
    expect(r.emails).toHaveLength(1);
  });

  it("keeps the name and address within their limits", async () => {
    expect((await run({ clientName: "א".repeat(80) })).status).toBe(200);
    expect((await run({ clientName: 5 })).json).toMatchObject({ error: "invalid_name" });
    expect((await run({ clientName: ["משה"] })).json).toMatchObject({ error: "invalid_name" });
    const long = await run({ clientName: "משה כהן", contactEmail: `${"a".repeat(250)}@example.com` });
    expect(long.json).toMatchObject({ error: "invalid_email" });
    expect(long.maslekaRequests).toHaveLength(0);
    expect((await run({ clientName: "משה כהן", contactEmail: 7 })).json).toMatchObject({ error: "invalid_email" });
  });

  it("answers 500 without a link when the request cannot be stored", async () => {
    const r = await run({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true }, { fake: { failRequestWrite: true } });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "failed", rid: expect.any(String) });
    expect(r.json).not.toHaveProperty("ok");
    expect(r.json).not.toHaveProperty("link");
    expect(r.emails).toHaveLength(0);
  });

  it("never writes the link, the token, the name or the address to a log line", async () => {
    const lines = captureLogs();
    const a = await run({ clientName: NAME, contactEmail: "moshe@example.com", sendInvite: true });
    const b = await run({ clientName: NAME, contactEmail: "moshe@example.com", sendInvite: true }, { failEmailTo: ["moshe@example.com"] });
    const c = await run({ requestId: REQUEST_ID }, { fake: { requests: [{ id: REQUEST_ID, agency_id: AGENCY_1, status: "invited", token_hash: "a".repeat(64), client_name: NAME }] } });
    await run({ clientName: NAME }, { token: OUTSIDER_TOKEN });
    await run({ clientName: NAME }, { fake: { failRequestWrite: true } });
    expect(lines.length).toBeGreaterThan(0);
    const secrets = [a, b, c].flatMap((r) => [String(r.json.link), tokenOf(r.json.link)]);
    for (const line of lines) {
      expect(line).toContain("rid");
      for (const secret of [...secrets, NAME, "moshe@example.com", STAFF_TOKEN, OUTSIDER_TOKEN]) {
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

  it("writes one conditional update scoped to the agency, naming the columns it gets back", async () => {
    const r = await run({ requestId: REQUEST_ID.toUpperCase(), agency_id: "aaaaaaaa-0000-0000-0000-000000000002" }, { fake: { requests: [invited()] } });
    expect(r.status).toBe(200);
    expect(r.requestPatches).toHaveLength(1);
    const { query, fields } = r.requestPatches[0];
    expect(query).toContain(`id=eq.${REQUEST_ID}`);
    expect(query).toContain(`agency_id=eq.${AGENCY_1}`);
    expect(query).toContain("status=eq.invited");
    expect(query).toContain("select=id");
    expect(query).not.toMatch(/ciphertext|token_hash|select=\*/);
    expect(Object.keys(fields).sort()).toEqual(["client_reminded_at", "token_expires_at", "token_hash"]);
    const patch = r.callsTo("/rest/v1/masleka_requests?").find((f) => f.method === "PATCH");
    expect(JSON.stringify(patch?.headers)).toContain("return=representation");
    expect(r.json.requestId).toBe(REQUEST_ID);
  });

  it("makes the old link stop working: the stored hash no longer matches it", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited({ token_hash: sha("old-token") })] } });
    expect(r.maslekaRequests[0].token_hash).not.toBe(sha("old-token"));
    expect(r.maslekaRequests[0].token_hash).toBe(sha(tokenOf(r.json.link)));
  });

  it("extends the expiry, never shortens it: thirty days from now whatever was left", async () => {
    const soon = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited({ token_expires_at: new Date(Date.now() + 86_400_000).toISOString() })] } });
    expect(Date.parse(String(soon.maslekaRequests[0].token_expires_at))).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const lapsed = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited({ token_expires_at: "2026-01-01T00:00:00.000Z" })] } });
    expect(Date.parse(String(lapsed.maslekaRequests[0].token_expires_at))).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("does not touch another agency's request, or one that is not there", async () => {
    const other = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited({ agency_id: "aaaaaaaa-0000-0000-0000-000000000002" })] } });
    expect(other.status).toBe(409);
    expect(other.maslekaRequests[0].token_hash).toBe("a".repeat(64));
    // One that is not there: the database's access check refuses it first
    // (can_work_request is false), without saying whether it exists.
    const missing = await run({ requestId: REQUEST_ID });
    expect(missing.status).toBe(403);
    expect(missing.json).toEqual({ error: "forbidden", rid: expect.any(String) });
    expect(missing.requestPatches).toHaveLength(0);
  });

  it("answers 500 and no link when the update fails", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited()], failRequestWrite: true } });
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "failed" });
    expect(r.json).not.toHaveProperty("link");
  });

  it("refuses a request that is no longer waiting for a code", async () => {
    const r = await run({ requestId: REQUEST_ID }, { fake: { requests: [invited({ status: "code_received" })] } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "not_available" });
    expect(r.maslekaRequests[0].token_hash).toBe("a".repeat(64));
  });

  it("refuses an id that is not one", async () => {
    for (const bad of ["x", "11111111-1111-4111-8111-111111111111&status=neq.x", 7, null, ["a"]]) {
      const r = await run({ requestId: bad });
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: "invalid" });
      expect(r.callsTo("/rest/v1/masleka_requests")).toHaveLength(0);
    }
  });
});
