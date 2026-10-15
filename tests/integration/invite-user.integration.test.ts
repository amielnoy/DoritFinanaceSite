import { describe, expect, it } from "vitest";
import type { FetchCall } from "../helpers/base44-function";
import { invokeEdge, SUPABASE_URL, type EdgeOptions } from "../helpers/edge-function";

/**
 * "הוספת משתמש" (supabase/functions/invite-user): the session and the agency
 * role, the account found or made, the membership through set_member_role
 * under the caller's session, and the invitation mailed through dorit-mailer —
 * Supabase Auth's own invite mail never.
 *
 * ADMIN is the platform operator (profiles.role = 'admin'); AGENCY_ADMIN and
 * OWNER hold those roles in ORG; MEMBER is signed in with no role there.
 */
// Session tokens as long as real ones: _shared/staff.ts's bearer() wants 20+ characters.
const ADMIN = "admin-session-token-0123456789";
const MEMBER = "member-session-token-0123456789";
const AGENCY_ADMIN = "agency-admin-session-token-0123456789";
const OWNER = "owner-session-token-0123456789";
const ORG = "11111111-2222-4333-8444-555555555555";

type Row = Record<string, unknown>;

function fakeSupabase(seed: { profiles?: Row[]; authUsers?: Row[]; agencies?: Row[]; authCreate?: { status: number; body: unknown }; failLookup?: boolean; refuse?: string } = {}) {
  const profiles: Row[] = [
    { id: "user-admin", email: "dorit@example.com", role: "admin" },
    { id: "user-member", email: "m@example.com", role: "user" },
    { id: "user-agency-admin", email: "office@example.com", role: "user" },
    { id: "user-owner", email: "owner@example.com", role: "user" },
    ...(seed.profiles ?? []),
  ];
  /** Each person's role in ORG, as staff_role answers it. */
  const roles: Record<string, string> = { "user-agency-admin": "admin", "user-owner": "owner" };
  const sessions: Record<string, string> = { [ADMIN]: "user-admin", [MEMBER]: "user-member", [AGENCY_ADMIN]: "user-agency-admin", [OWNER]: "user-owner" };
  const rpcCalls: { token: string; body: Row }[] = [];
  const authUsers = seed.authUsers ?? profiles.map((p) => ({ id: p.id, email: p.email }));
  const agencies: Row[] = seed.agencies ?? [{ id: ORG, name: "סוכנות הדוגמה" }];
  const memberships: Row[] = [];
  const created: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const eq = (query: URLSearchParams, col: string) => query.get(col)?.replace(/^eq\./, "");

  const upstream = (call: FetchCall): Response | undefined => {
    if (!call.url.startsWith(SUPABASE_URL)) return undefined;
    const url = new URL(call.url);
    if (url.pathname === "/auth/v1/user") {
      const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
      if (sessions[token]) return json({ id: sessions[token] });
      return json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, 403);
    }
    if (url.pathname === "/auth/v1/admin/users" && call.method === "POST") {
      if (seed.authCreate) return json(seed.authCreate.body, seed.authCreate.status);
      const email = (call.body as { email: string }).email;
      created.push(email);
      const id = `user-new-${created.length}`;
      profiles.push({ id, email, role: "user" }); // the profile trigger
      authUsers.push({ id, email });
      return json({ id, email });
    }
    if (url.pathname === "/rest/v1/rpc/invitee_for") {
      if (seed.failLookup) return json({}, 503);
      const email = (call.body as { p_email: string }).p_email;
      const user = authUsers.find((u) => String(u.email).toLowerCase() === email && profiles.some((p) => p.id === u.id));
      return json(user?.id ?? null);
    }
    if (url.pathname === "/rest/v1/profiles") {
      const id = eq(url.searchParams, "id");
      const email = eq(url.searchParams, "email");
      return json(profiles.filter((p) => (id ? p.id === id : true) && (email ? p.email === email : true)));
    }
    if (url.pathname === "/rest/v1/rpc/staff_role") {
      // Service role only: the caller's own token is never what asks.
      if (call.headers.Authorization !== "Bearer service-role-test") return json({ code: "42501" }, 403);
      return json(roles[(call.body as { p_user_id: string }).p_user_id] ?? null);
    }
    if (url.pathname === "/rest/v1/agencies") {
      // RLS: the agency's members and the operator read it, under their own session.
      const who = sessions[String(call.headers.Authorization ?? "").replace(/^Bearer /, "")];
      if (who !== "user-admin" && !roles[who]) return json([]);
      return json(agencies.filter((a) => a.id === eq(url.searchParams, "id")));
    }
    if (url.pathname === "/rest/v1/rpc/set_member_role") {
      const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
      rpcCalls.push({ token, body: call.body as Row });
      if (seed.refuse) return json({ code: "P0001", message: seed.refuse, details: null, hint: null }, 400);
      if (!sessions[token]) return json({ code: "42501", message: "not_signed_in" }, 403);
      const { p_agency_id, p_user_id, p_role } = call.body as Row;
      const at = memberships.findIndex((m) => m.user_id === p_user_id && m.agency_id === p_agency_id);
      const row = { user_id: p_user_id, agency_id: p_agency_id, role: p_role };
      if (at >= 0) memberships[at] = row;
      else memberships.push(row);
      return new Response("null", { status: 200 });
    }
    return undefined;
  };
  return { upstream, memberships, created, rpcCalls };
}

const invite = (body: unknown, token: string | null, s: ReturnType<typeof fakeSupabase>, extra: EdgeOptions = {}) =>
  invokeEdge("invite-user", body, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), upstream: s.upstream, ...extra });

const newcomer = { email: "New.Person@Example.com", orgId: ORG, role: "user" };

describe("invite-user — who may", () => {
  it("refuses a caller with no session, and one who is not an admin", async () => {
    const s = fakeSupabase();
    expect((await invite(newcomer, null, s)).status).toBe(401);
    expect((await invite(newcomer, MEMBER, s)).status).toBe(403);
    expect(s.memberships).toEqual([]);
    expect(s.created).toEqual([]);
  });
});

describe("invite-user — the agency's own Admins and Owners (agency roles)", () => {
  it("lets an agency Admin add a User, through set_member_role under the Admin's own session", async () => {
    const s = fakeSupabase();
    const r = await invite(newcomer, AGENCY_ADMIN, s);
    expect(r.status).toBe(200);
    expect(s.memberships).toEqual([{ user_id: "user-new-1", agency_id: ORG, role: "user" }]);
    expect(s.rpcCalls).toEqual([{ token: AGENCY_ADMIN, body: { p_agency_id: ORG, p_user_id: "user-new-1", p_role: "user" } }]);
  });

  it("refuses an agency Admin who would add an Admin or an Owner, before any account is made", async () => {
    for (const role of ["admin", "owner"]) {
      const s = fakeSupabase();
      const r = await invite({ ...newcomer, role }, AGENCY_ADMIN, s);
      expect(r.status).toBe(403);
      expect(s.created).toEqual([]);
      expect(s.memberships).toEqual([]);
    }
  });

  it("lets the Owner add an Admin", async () => {
    const s = fakeSupabase();
    const r = await invite({ ...newcomer, role: "admin" }, OWNER, s);
    expect(r.status).toBe(200);
    expect(s.memberships).toEqual([{ user_id: "user-new-1", agency_id: ORG, role: "admin" }]);
  });

  it("names the role in Hebrew in the invitation", async () => {
    const s = fakeSupabase();
    const r = await invite({ ...newcomer, role: "admin" }, OWNER, s);
    expect(r.emails[0].text).toContain("מנהל/ת");
  });

  it("answers the database's refusals as the person can read them, never as a failure", async () => {
    const refused = await invite(newcomer, OWNER, fakeSupabase({ refuse: "forbidden" }));
    expect(refused.status).toBe(403);
    expect(refused.emails).toEqual([]);
    const lastOwner = await invite(newcomer, OWNER, fakeSupabase({ refuse: "last_owner" }));
    expect(lastOwner.status).toBe(409);
    expect(String(lastOwner.json.error)).toMatch(/בעלים/);
    expect(lastOwner.json).toHaveProperty("rid");
  });
});

describe("invite-user — what it checks", () => {
  it.each([
    ["an address that is not one", { ...newcomer, email: "not-an-address" }, /דוא״ל/],
    ["a role it does not know (the old agent)", { ...newcomer, role: "agent" }, /התפקיד/],
    ["an organization id that is not one", { ...newcomer, orgId: "1 or 1=1" }, /הארגון/],
    ["an organization that does not exist", { ...newcomer, orgId: "99999999-2222-4333-8444-555555555555" }, /הארגון/],
  ])("refuses %s, and changes nothing", async (_label, body, message) => {
    const s = fakeSupabase();
    const r = await invite(body, ADMIN, s);
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(message);
    expect(s.memberships).toEqual([]);
    expect(s.created).toEqual([]);
  });
});

describe("invite-user — the newcomer", () => {
  it("makes an account for an address never seen, adds the membership, and mails the invitation", async () => {
    const s = fakeSupabase();
    const r = await invite(newcomer, ADMIN, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, created: true, mailed: true, userId: "user-new-1" });
    // Lower-cased, as Auth stores it and the profile lookup compares it.
    expect(s.created).toEqual(["new.person@example.com"]);
    const create = r.callsTo("/auth/v1/admin/users")[0];
    expect(create.body).toEqual({ email: "new.person@example.com", email_confirm: true });
    expect(s.memberships).toEqual([{ user_id: "user-new-1", agency_id: ORG, role: "user" }]);

    const mail = r.mailTo("new.person@example.com");
    expect(mail.subject).toBe("הוזמנת לממשק הניהול — דורית גוב ארי");
    expect(mail.text).toContain("סוכנות הדוגמה");
    expect(mail.text).toContain("משתמש/ת");
    expect(mail.html).toContain('href="https://govari-fin.co.il/login?returnTo=/admin/masleka"');
    // Supabase Auth's own invite mail is never asked for.
    expect(r.callsTo("/auth/v1/invite")).toEqual([]);
  });

  it("adds an existing account without making another, and changes the role of a member already there", async () => {
    const s = fakeSupabase();
    await invite({ ...newcomer, email: "m@example.com", role: "user" }, ADMIN, s);
    const r = await invite({ ...newcomer, email: "m@example.com", role: "owner" }, ADMIN, s);
    expect(r.json).toMatchObject({ ok: true, created: false, userId: "user-member" });
    expect(s.created).toEqual([]);
    expect(s.memberships).toEqual([{ user_id: "user-member", agency_id: ORG, role: "owner" }]);
    // Never a direct write: memberships change only through the function.
    expect(r.callsTo("/rest/v1/memberships")).toEqual([]);
  });

  it("uses the verified admin session for tenant tables while keeping Auth and identity lookup server-side", async () => {
    const s = fakeSupabase();
    const r = await invite(newcomer, ADMIN, s);
    expect(r.status).toBe(200);
    expect(r.callsTo('/rest/v1/agencies')[0].headers.Authorization).toBe(`Bearer ${ADMIN}`);
    expect(r.callsTo('/rest/v1/rpc/set_member_role')[0].headers.Authorization).toBe(`Bearer ${ADMIN}`);
    expect(r.callsTo('/rest/v1/rpc/invitee_for')[0].headers.Authorization).not.toBe(`Bearer ${ADMIN}`);
    expect(r.callsTo('/auth/v1/admin/users')[0].headers.Authorization).not.toBe(`Bearer ${ADMIN}`);
  });

  it("keeps the membership and says so when the invitation mail does not go", async () => {
    const s = fakeSupabase();
    const r = await invite(newcomer, ADMIN, s, { failEmailTo: ["new.person@example.com"] });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mailed: false });
    expect((r.json.warnings as string[])[0]).toMatch(/^invite_email_failed/);
    expect(s.memberships).toHaveLength(1);
  });

  it("refuses an address Auth holds but no profile does, rather than guess at an account", async () => {
    const s = fakeSupabase({ authCreate: { status: 422, body: { error_code: "email_exists" } } });
    const r = await invite(newcomer, ADMIN, s);
    expect(r.status).toBe(409);
    expect(s.memberships).toEqual([]);
  });

  it("invites the current Auth owner when another profile still carries their address", async () => {
    const s = fakeSupabase({
      profiles: [{ id: "former-owner", email: "new.person@example.com" }, { id: "current-owner", email: "older-copy@example.com" }],
      authUsers: [{ id: "former-owner", email: "moved@example.com" }, { id: "current-owner", email: "new.person@example.com" }],
    });
    const r = await invite(newcomer, ADMIN, s);
    expect(r.status).toBe(200);
    expect(s.created).toEqual([]);
    expect(s.memberships).toEqual([{ user_id: "current-owner", agency_id: ORG, role: "user" }]);
    expect(r.mailTo("new.person@example.com")).toBeDefined();
  });

  it("never grants a former Auth owner access when the old address is now unused", async () => {
    const s = fakeSupabase({
      profiles: [{ id: "former-owner", email: "new.person@example.com" }],
      authUsers: [{ id: "former-owner", email: "moved@example.com" }],
    });
    const r = await invite(newcomer, ADMIN, s);
    expect(r.status).toBe(200);
    expect(s.memberships[0].user_id).toBe("user-new-1");
    expect(s.created).toEqual(["new.person@example.com"]);
  });

  it("fails closed when the authoritative address lookup is unavailable", async () => {
    const s = fakeSupabase({ failLookup: true });
    const r = await invite(newcomer, ADMIN, s);
    expect(r.status).toBe(500);
    expect(s.memberships).toEqual([]);
    expect(s.created).toEqual([]);
    expect(r.emails).toEqual([]);
  });
});
