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
import { authUser, updateWhere } from "../../supabase/functions/_shared/rest.ts";
import { staffCaller, staffRecipients } from "../../supabase/functions/_shared/staff.ts";

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

describe("staffCaller", () => {
  const request = (auth?: string) =>
    new Request("https://edge.test/x", { method: "POST", headers: auth ? { authorization: auth } : {} });

  function server(role: unknown) {
    withEnv(BASE_ENV);
    return withFetch((url) => {
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (url.endsWith("/rpc/staff_role")) return new Response(JSON.stringify(role), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
  }

  it("is anonymous without a bearer token, and asks nobody", async () => {
    const calls = server("staff");
    expect(await staffCaller(request())).toEqual({ kind: "anonymous" });
    expect(calls).toHaveLength(0);
  });

  it("is an outsider when the database knows no role for the user", async () => {
    server(null);
    expect(await staffCaller(request("Bearer user-token-0123456789"))).toEqual({ kind: "outsider", userId: "u1" });
  });

  it("is an outsider for a role it does not recognise", async () => {
    server("superuser");
    expect(await staffCaller(request("Bearer user-token-0123456789"))).toEqual({ kind: "outsider", userId: "u1" });
  });

  it("is staff with the role the database gives", async () => {
    server("staff");
    expect(await staffCaller(request("Bearer user-token-0123456789"))).toEqual({ kind: "staff", userId: "u1", role: "staff" });
  });
});

describe("staffRecipients", () => {
  it("mails each staff address once, in lower case, and skips what is not an address", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response(JSON.stringify(["Staff@Example.com", "staff@example.com", "not-an-address"]), { status: 200 }));
    expect(await staffRecipients(vi.fn(), "rid1")).toEqual(["staff@example.com"]);
  });

  it("falls back to Dorit's mailbox when nobody can be read", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("{}", { status: 500 }));
    const log = vi.fn();
    expect(await staffRecipients(log, "rid1")).toEqual(["dorit@govari-fin.co.il"]);
    expect(log).toHaveBeenCalledWith("warn", "staff.lookup_failed", expect.objectContaining({ rid: "rid1" }));
  });

  it("falls back to Dorit's mailbox when the staff list is empty", async () => {
    withEnv(BASE_ENV);
    withFetch(() => new Response("[]", { status: 200 }));
    const log = vi.fn();
    expect(await staffRecipients(log, "rid1")).toEqual(["dorit@govari-fin.co.il"]);
    expect(log).toHaveBeenCalledWith("warn", "staff.none", { rid: "rid1" });
  });
});
