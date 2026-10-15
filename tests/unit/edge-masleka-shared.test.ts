import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENCY_1,
  createRequest,
  firstInWindow,
  isToken,
  maslekaEnabled,
  maslekaLink,
  newToken,
  normalizeCode,
  normalizePhone,
  sameAddress,
  tokenExpiry,
} from "../../supabase/functions/_shared/masleka.ts";
import { authUser, callRpc, refusalReason, updateRows, updateWhere } from "../../supabase/functions/_shared/rest.ts";
import {
  meets, requireAgencyRole, requireLeadAccess, requireRequestAccess, sessionCaller, staffRecipients,
} from "../../supabase/functions/_shared/staff.ts";

const SUPABASE_URL = "https://project-ref.supabase.test";
const BASE_ENV = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "service-role-test" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const withEnv = (env: Record<string, string>) =>
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });

type Call = { url: string; init: RequestInit };
function withFetch(answer: (url: string, init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return answer(String(url), init);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("the switch", () => {
  it("is off unless MASLEKA_ENABLED is exactly true", () => {
    withEnv({});
    expect(maslekaEnabled()).toBe(false);
    withEnv({ MASLEKA_ENABLED: "TRUE" });
    expect(maslekaEnabled()).toBe(false);
    withEnv({ MASLEKA_ENABLED: "1" });
    expect(maslekaEnabled()).toBe(false);
    withEnv({ MASLEKA_ENABLED: " true " });
    expect(maslekaEnabled()).toBe(true);
  });
});

describe("tokens and links", () => {
  it("makes 43-character base64url tokens, never the same twice", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("recognises nothing else as a token", () => {
    expect(isToken("A".repeat(42))).toBe(false);
    expect(isToken("A".repeat(42) + "+")).toBe(false);
    expect(isToken(42)).toBe(false);
  });

  it("puts the token in the fragment of the agency's own page", () => {
    expect(maslekaLink("T".repeat(43))).toBe(`https://govari-fin.co.il/masleka#t=${"T".repeat(43)}`);
  });

  it("expires a token thirty days after it is issued", () => {
    expect(tokenExpiry(new Date("2026-10-13T00:00:00Z"))).toBe("2026-11-12T00:00:00.000Z");
  });

  it("accepts a code as pasted, and nothing that cannot be one", () => {
    expect(normalizeCode("  AB12-cd34 ")).toBe("AB12-cd34");
    expect(normalizeCode("abc")).toBeNull();
    expect(normalizeCode("<script>")).toBeNull();
    expect(normalizeCode("A".repeat(65))).toBeNull();
    expect(normalizeCode(1234)).toBeNull();
  });
});

describe("who the same contact is (decision 2026-10-14)", () => {
  it("reads a phone as its local digits, however it was typed", () => {
    for (const typed of ["0541112233", "054-111-2233", "054 111 2233", "+972-54-111-2233", "972541112233", "+972 (54) 111 2233"]) {
      expect(normalizePhone(typed), typed).toBe("0541112233");
    }
    expect(normalizePhone("03-1234567")).toBe("031234567");
  });

  it("reads nothing too short, or not a string, as a phone", () => {
    for (const value of ["", "12345678", "abc", null, undefined, 541112233]) expect(normalizePhone(value), String(value)).toBe("");
  });

  it("matches two addresses only when both are addresses, ignoring case and spaces at the ends", () => {
    expect(sameAddress(" URI@Example.com ", "uri@example.com")).toBe(true);
    expect(sameAddress("uri@example.com", "uri2@example.com")).toBe(false);
    for (const [a, b] of [["", ""], [null, null], ["x", "x"], ["uri@example.com", null]] as const) {
      expect(sameAddress(a, b), `${a} ${b}`).toBe(false);
    }
  });
});

describe("the alert throttle's first layer", () => {
  it("lets the first alert for a key through and holds the rest for the window", () => {
    const memo = new Map<string, number>();
    expect(firstInWindow(memo, "k", 0, 1000)).toBe(true);
    expect(firstInWindow(memo, "k", 999, 1000)).toBe(false);
    expect(firstInWindow(memo, "other", 999, 1000)).toBe(true);
    expect(firstInWindow(memo, "k", 1000, 1000)).toBe(true);
  });

  it("forgets keys whose window has passed", () => {
    const memo = new Map<string, number>([["old", 0]]);
    firstInWindow(memo, "new", 5000, 1000);
    expect([...memo.keys()]).toEqual(["new"]);
  });
});

describe("createRequest", () => {
  it("stores the token's hash, never the token, and returns the one link to it", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch((_u, init) => {
      const row = { id: "11111111-1111-4111-8111-111111111111", ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify([row]), { status: 201 });
    });
    const { id, link } = await createRequest({
      clientName: "רונית מזרחי",
      contactEmail: "ronit@example.com",
      leadId: null,
      createdBy: null,
    });
    const token = link.split("#t=")[1];
    const sent = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/masleka_requests`);
    expect(id).toBe("11111111-1111-4111-8111-111111111111");
    expect(sent).toMatchObject({ agency_id: AGENCY_1, client_name: "רונית מזרחי", token_hash: sha(token) });
    expect(String(calls[0].init.body)).not.toContain(token);
  });
});

describe("updateWhere", () => {
  it("patches the rows the query matches and returns them", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response(JSON.stringify([{ id: "x" }]), { status: 200 }));
    const rows = await updateWhere("masleka_requests", "id=eq.x&status=eq.invited&select=id", { status: "expired" });
    expect(rows).toEqual([{ id: "x" }]);
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/masleka_requests?id=eq.x&status=eq.invited&select=id`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.stringify(calls[0].init.headers)).toContain("return=representation");
  });

  it("reports a refusal by status and code only", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response(JSON.stringify({ code: "23514", message: "Failing row contains (secret)" }), { status: 400 }));
    await expect(updateWhere("masleka_requests", "id=eq.x", {})).rejects.toThrow(/^update_http_400:23514$/);
  });

  it("refuses to patch without a filter, and sends nothing", async () => {
    // A PATCH with no condition changes every row in the table.
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response("[]", { status: 200 }));
    for (const query of ["", "select=id", "select=id&order=created_at.desc&limit=1", "status=", "status=eq.", "status=invited"]) {
      await expect(updateWhere("masleka_requests", query, { status: "expired" }), query).rejects.toThrow(
        /^update_without_filter$/,
      );
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a success whose body is not a list of rows", async () => {
    // "Nothing matched" must mean an empty list from PostgREST, not a body
    // this code could not read.
    withEnv(BASE_ENV);
    for (const body of ["{}", "null", "not json", ""]) {
      withFetch(() => new Response(body, { status: 200 }));
      await expect(updateWhere("masleka_requests", "id=eq.x&select=id", { status: "expired" }), body).rejects.toThrow(
        /^update_bad_body$/,
      );
    }
  });
});

describe("authUser", () => {
  it("answers who the token belongs to, asking the auth server with the service key", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response(JSON.stringify({ id: "u1", email: "x@example.com" }), { status: 200 }));
    expect(await authUser("user-token-0123456789")).toEqual({ id: "u1" });
    expect(calls[0].url).toBe(`${SUPABASE_URL}/auth/v1/user`);
    expect(calls[0].init.headers).toMatchObject({ apikey: "service-role-test", Authorization: "Bearer user-token-0123456789" });
  });

  it("answers nobody for a token the auth server refuses", async () => {
    withEnv(BASE_ENV);
    // Supabase Auth's own refusal carries an error_code.
    withFetch(() => new Response('{"code":403,"error_code":"bad_jwt","msg":"invalid JWT"}', { status: 403 }));
    expect(await authUser("stale-token-0123456789")).toBeNull();
  });

  it("throws on a 401 that is not Auth's refusal (a revoked service key), rather than calling it signed out", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response('{"message":"Invalid API key"}', { status: 401 }));
    await expect(authUser("user-token-0123456789")).rejects.toThrow("not_an_auth_refusal");
  });

  it("throws when the auth server is down, rather than calling it a refusal", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("{}", { status: 503 }));
    await expect(authUser("user-token-0123456789")).rejects.toThrow("auth_http_503");
  });
});

describe("the agency-role gates", () => {
  const TOKEN = "user-token-0123456789";
  const request = (auth?: string) =>
    new Request("https://edge.test/x", { method: "POST", headers: auth ? { authorization: auth } : {} });
  const A1 = "00000000-0000-0000-0000-000000000001";

  /** Auth names u1; profiles says whether u1 runs the platform; the RPCs answer as given. */
  function server({ role = null as unknown, operator = false, allowed = false as unknown } = {}) {
    withEnv(BASE_ENV);
    return withFetch((url) => {
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (url.includes("/rest/v1/profiles?")) return new Response(JSON.stringify([{ role: operator ? "admin" : "user" }]), { status: 200 });
      if (url.endsWith("/rpc/staff_role")) return new Response(JSON.stringify(role), { status: 200 });
      if (url.endsWith("/rpc/can_see_lead") || url.endsWith("/rpc/can_work_request")) {
        return new Response(JSON.stringify(allowed), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
  }

  it("ranks owner over admin over user", () => {
    expect(meets("owner", "admin")).toBe(true);
    expect(meets("admin", "admin")).toBe(true);
    expect(meets("user", "admin")).toBe(false);
    expect(meets(null, "user")).toBe(false);
  });

  it("asks nobody without a bearer token, and answers 401", async () => {
    const calls = server();
    expect(await sessionCaller(request(), "r", vi.fn())).toMatchObject({ ok: false, status: 401 });
    expect(calls).toHaveLength(0);
  });

  it("names the operator from profiles.role, never from the token", async () => {
    server({ operator: true });
    expect(await sessionCaller(request(`Bearer ${TOKEN}`), "r", vi.fn())).toEqual({ ok: true, userId: "u1", token: TOKEN, isOperator: true });
  });

  it("passes a role at or above the minimum, in that agency, and refuses one below with 403", async () => {
    const calls = server({ role: "admin" });
    expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), A1, "admin", "r", vi.fn())).toMatchObject({ ok: true, role: "admin" });
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/rpc/staff_role"))!.init.body))).toEqual({ p_user_id: "u1", p_agency_id: A1 });
    server({ role: "user" });
    expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), A1, "admin", "r", vi.fn())).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a role the database does not name, and the old agent/staff, as no role", async () => {
    for (const role of ["staff", "agent", "superuser", null]) {
      server({ role });
      expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), A1, "user", "r", vi.fn())).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("lets the operator through with no membership, and only the operator onto a shared-library row", async () => {
    server({ operator: true });
    expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), A1, "owner", "r", vi.fn())).toMatchObject({ ok: true, role: null, isOperator: true });
    expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), null, "admin", "r", vi.fn())).toMatchObject({ ok: true });
    server({ role: "owner" });
    expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), null, "user", "r", vi.fn())).toMatchObject({ ok: false, status: 403 });
  });

  it("answers 500, not 403, when the role cannot be read", async () => {
    withEnv(BASE_ENV);
    withFetch((url) => {
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (url.includes("/rest/v1/profiles?")) return new Response("[]", { status: 200 });
      return new Response("{}", { status: 503 });
    });
    expect(await requireAgencyRole(request(`Bearer ${TOKEN}`), A1, "user", "r", vi.fn())).toMatchObject({ ok: false, status: 500 });
  });

  it("asks can_see_lead and can_work_request as the caller, with their own token", async () => {
    const calls = server({ allowed: true });
    expect(await requireLeadAccess(request(`Bearer ${TOKEN}`), "lead-1", "r", vi.fn())).toMatchObject({ ok: true, userId: "u1" });
    expect(await requireRequestAccess(request(`Bearer ${TOKEN}`), "req-1", "r", vi.fn())).toMatchObject({ ok: true });
    for (const c of calls.filter((x) => x.url.includes("/rpc/can_"))) {
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/rpc/can_see_lead"))!.init.body))).toEqual({ p_lead_id: "lead-1" });
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/rpc/can_work_request"))!.init.body))).toEqual({ p_request_id: "req-1" });
  });

  it("refuses with 403 when the database says no — and anything but a plain true is no", async () => {
    for (const allowed of [false, null, "true", 1]) {
      server({ allowed });
      expect(await requireLeadAccess(request(`Bearer ${TOKEN}`), "lead-1", "r", vi.fn())).toMatchObject({ ok: false, status: 403 });
    }
  });
});

describe("rest.ts as the caller", () => {
  it("sends the caller's token on Authorization, and keeps the service key on apikey", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response("true", { status: 200 }));
    await callRpc("can_see_lead", { p_lead_id: "x" }, "caller-token");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer caller-token");
    expect(headers.apikey).toBe("service-role-test");
  });

  it("names a function's own reason, and never Postgres's prose", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response(JSON.stringify({ code: "23514", message: "last_owner" }), { status: 400 }));
    const own = await callRpc("set_member_role", {}, "t").catch((e) => e);
    expect(String(own.message)).toBe("rpc_http_400:23514:last_owner");
    expect(refusalReason(own)).toBe("last_owner");
    withFetch(() => new Response(JSON.stringify({ code: "23505", message: 'duplicate key value violates "x" (Failing row contains (Dana))' }), { status: 409 }));
    const prose = await updateRows("leads", "id=eq.x", {}, "t").catch((e) => e);
    expect(String(prose.message)).toBe("update_http_409:23505");
    expect(refusalReason(prose)).toBe("");
  });
});

describe("staffRecipients", () => {
  const REQUEST = "cccccccc-0000-0000-0000-000000000001";

  it("asks for the request's own people, and mails each address once, in lower case, skipping what is not one", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response(JSON.stringify(["Staff@Example.com", "staff@example.com", "not-an-address"]), { status: 200 }));
    expect(await staffRecipients(vi.fn(), "rid1", REQUEST)).toEqual(["staff@example.com"]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_request_id: REQUEST });
  });

  it("falls back to Dorit's mailbox when nobody can be read", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("{}", { status: 500 }));
    const log = vi.fn();
    expect(await staffRecipients(log, "rid1", REQUEST)).toEqual(["dorit@govari-fin.co.il"]);
    expect(log).toHaveBeenCalledWith("warn", "staff.lookup_failed", expect.objectContaining({ rid: "rid1" }));
  });

  it("falls back to Dorit's mailbox when the request has nobody", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("[]", { status: 200 }));
    const log = vi.fn();
    expect(await staffRecipients(log, "rid1", REQUEST)).toEqual(["dorit@govari-fin.co.il"]);
    expect(log).toHaveBeenCalledWith("warn", "staff.none", { rid: "rid1", requestId: REQUEST });
  });

  it("asks for the agency's Admins and Owners while the request is not yet known", async () => {
    withEnv(BASE_ENV);
    const calls = withFetch(() => new Response(JSON.stringify(["owner@example.com"]), { status: 200 }));
    expect(await staffRecipients(vi.fn(), "rid1", null)).toEqual(["owner@example.com"]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_request_id: null });
  });
});
