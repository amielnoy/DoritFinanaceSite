import { describe, expect, it } from "vitest";
import type { FetchCall } from "../helpers/base44-function";
import { invokeEdge, SUPABASE_URL, type EdgeOptions } from "../helpers/edge-function";

/**
 * "הוספת משתמש" (supabase/functions/invite-user): the admin gate, the account
 * found or made, the membership upserted, and the invitation mailed through
 * dorit-mailer — Supabase Auth's own invite mail never.
 */
const ADMIN = "admin-token";
const MEMBER = "member-token";
const ORG = "11111111-2222-4333-8444-555555555555";

type Row = Record<string, unknown>;

function fakeSupabase(seed: { profiles?: Row[]; agencies?: Row[]; authCreate?: { status: number; body: unknown } } = {}) {
  const profiles: Row[] = [{ id: "user-admin", email: "dorit@example.com", role: "admin" }, { id: "user-member", email: "m@example.com", role: "user" }, ...(seed.profiles ?? [])];
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
      if (token === ADMIN) return json({ id: "user-admin" });
      if (token === MEMBER) return json({ id: "user-member" });
      return json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, 403);
    }
    if (url.pathname === "/auth/v1/admin/users" && call.method === "POST") {
      if (seed.authCreate) return json(seed.authCreate.body, seed.authCreate.status);
      const email = (call.body as { email: string }).email;
      created.push(email);
      const id = `user-new-${created.length}`;
      profiles.push({ id, email, role: "user" }); // the profile trigger
      return json({ id, email });
    }
    if (url.pathname === "/rest/v1/profiles") {
      const id = eq(url.searchParams, "id");
      const email = eq(url.searchParams, "email");
      return json(profiles.filter((p) => (id ? p.id === id : true) && (email ? p.email === email : true)));
    }
    if (url.pathname === "/rest/v1/agencies") return json(agencies.filter((a) => a.id === eq(url.searchParams, "id")));
    if (url.pathname === "/rest/v1/memberships" && call.method === "POST") {
      const row = call.body as Row;
      const at = memberships.findIndex((m) => m.user_id === row.user_id && m.agency_id === row.agency_id);
      if (at >= 0) memberships[at] = { ...memberships[at], ...row };
      else memberships.push({ ...row });
      return new Response(null, { status: 201 });
    }
    return undefined;
  };
  return { upstream, memberships, created };
}

const invite = (body: unknown, token: string | null, s: ReturnType<typeof fakeSupabase>, extra: EdgeOptions = {}) =>
  invokeEdge("invite-user", body, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), upstream: s.upstream, ...extra });

const newcomer = { email: "New.Person@Example.com", orgId: ORG, role: "agent" };

describe("invite-user — who may", () => {
  it("refuses a caller with no session, and one who is not an admin", async () => {
    const s = fakeSupabase();
    expect((await invite(newcomer, null, s)).status).toBe(401);
    expect((await invite(newcomer, MEMBER, s)).status).toBe(403);
    expect(s.memberships).toEqual([]);
    expect(s.created).toEqual([]);
  });
});

describe("invite-user — what it checks", () => {
  it.each([
    ["an address that is not one", { ...newcomer, email: "not-an-address" }, /דוא״ל/],
    ["a role it does not know", { ...newcomer, role: "admin" }, /התפקיד/],
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
    expect(s.memberships).toEqual([{ user_id: "user-new-1", agency_id: ORG, role: "agent" }]);

    const mail = r.mailTo("new.person@example.com");
    expect(mail.subject).toBe("הוזמנת לממשק הניהול — דורית גוב ארי");
    expect(mail.text).toContain("סוכנות הדוגמה");
    expect(mail.text).toContain("סוכן/ת");
    expect(mail.html).toContain('href="https://govari-fin.co.il/login?returnTo=/admin/masleka"');
    // Supabase Auth's own invite mail is never asked for.
    expect(r.callsTo("/auth/v1/invite")).toEqual([]);
  });

  it("adds an existing account without making another, and changes the role of a member already there", async () => {
    const s = fakeSupabase();
    await invite({ ...newcomer, email: "m@example.com", role: "staff" }, ADMIN, s);
    const r = await invite({ ...newcomer, email: "m@example.com", role: "owner" }, ADMIN, s);
    expect(r.json).toMatchObject({ ok: true, created: false, userId: "user-member" });
    expect(s.created).toEqual([]);
    expect(s.memberships).toEqual([{ user_id: "user-member", agency_id: ORG, role: "owner" }]);
    expect(r.callsTo("/rest/v1/memberships")[0].url).toContain("on_conflict=user_id,agency_id");
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
});
