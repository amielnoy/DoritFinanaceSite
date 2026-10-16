import { describe, expect, it } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";

/**
 * The agency-roles functions (docs/superpowers/specs/2026-10-15-agency-roles-design.md),
 * run in-process: member-admin, assign-lead and claim-document-link. The
 * database's own rules are proved by supabase/tests/agency_roles_check.sql;
 * these check that each function asks it as the caller, and answers what it says.
 *
 * In agency 1: OWNER, ADMIN (an agency Admin) and two Users; OPERATOR runs the
 * platform with no membership; OUTSIDER is signed in with no role.
 */
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000002";
const USER = "aaaaaaaa-0000-4000-8000-000000000003";
const OTHER_USER = "aaaaaaaa-0000-4000-8000-000000000004";
const OPERATOR = "aaaaaaaa-0000-4000-8000-000000000005";
const OUTSIDER = "aaaaaaaa-0000-4000-8000-000000000006";
const token = (who: string) => `session-token-for-${who}`;
const LEAD = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHERS_LEAD = "bbbbbbbb-0000-4000-8000-000000000002";
const DOC = `${AGENCY_1}/11111111-2222-4333-8444-555555555555-receipt.pdf`;

const people: MaslekaFake = {
  sessions: Object.fromEntries([OWNER, ADMIN, USER, OTHER_USER, OPERATOR, OUTSIDER].map((u) => [token(u), u])),
  roles: { [OWNER]: "owner", [ADMIN]: "admin", [USER]: "user", [OTHER_USER]: "user" },
  operators: [OPERATOR],
  emails: { [USER]: "user@example.com", [OTHER_USER]: "other@example.com", [ADMIN]: "admin@example.com" },
  assigned: { [LEAD]: USER, [OTHERS_LEAD]: OTHER_USER },
  members: [OWNER, ADMIN, USER, OTHER_USER],
};
const leads = [
  { id: LEAD, agency_id: AGENCY_1, name: "רונית מזרחי", phone: "0521234567", message: `תיאור | מסמכים: storage:claim-documents/${DOC}` },
  { id: OTHERS_LEAD, agency_id: AGENCY_1, name: "דן לוי", phone: "0539876543", message: "בלי מסמכים" },
];

function as(who: string | null, fn: string, body: unknown, o: EdgeOptions & { fake?: MaslekaFake } = {}) {
  const { fake, ...rest } = o;
  return invokeEdge(fn, body, {
    existingLeads: leads,
    ...rest,
    headers: who ? { authorization: `Bearer ${token(who)}` } : {},
    masleka: { ...people, ...fake },
  });
}

describe("member-admin — the database decides, under the caller's session", () => {
  it("refuses a caller with no session, and changes nothing", async () => {
    const r = await as(null, "member-admin", { op: "setRole", agencyId: AGENCY_1, userId: USER, role: "admin" });
    expect(r.status).toBe(401);
    expect(r.memberCalls).toEqual([]);
  });

  it("sets a role through set_member_role, as the caller", async () => {
    const r = await as(OWNER, "member-admin", { op: "setRole", agencyId: AGENCY_1, userId: USER, role: "admin" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, warnings: [], rid: expect.any(String) });
    expect(r.memberCalls).toEqual([{ fn: "set_member_role", args: { p_agency_id: AGENCY_1, p_user_id: USER, p_role: "admin" }, as: OWNER }]);
  });

  it("removes a member, and lets anyone leave by their own id", async () => {
    const removed = await as(ADMIN, "member-admin", { op: "remove", agencyId: AGENCY_1, userId: USER });
    expect(removed.memberCalls).toEqual([{ fn: "remove_member", args: { p_agency_id: AGENCY_1, p_user_id: USER }, as: ADMIN }]);
    // "leave" ignores any userId in the body: it is always the caller.
    const left = await as(USER, "member-admin", { op: "leave", agencyId: AGENCY_1, userId: OTHER_USER });
    expect(left.status).toBe(200);
    expect(left.memberCalls).toEqual([{ fn: "remove_member", args: { p_agency_id: AGENCY_1, p_user_id: USER }, as: USER }]);
  });

  it("hands over ownership in order: the new Owner first, then the caller steps down", async () => {
    const r = await as(OWNER, "member-admin", { op: "transferOwnership", agencyId: AGENCY_1, userId: ADMIN });
    expect(r.status).toBe(200);
    expect(r.memberCalls.map((c) => [c.args.p_user_id, c.args.p_role])).toEqual([[ADMIN, "owner"], [OWNER, "admin"]]);
  });

  it.each([
    ["forbidden", 403],
    ["last_owner", 409],
    ["not_found", 404],
  ])("answers the database's %s with %s and a message a person reads, never its text", async (reason, status) => {
    const r = await as(ADMIN, "member-admin", { op: "setRole", agencyId: AGENCY_1, userId: OWNER, role: "user" }, { fake: { refuse: reason } });
    expect(r.status).toBe(status);
    expect(r.json.rid).toEqual(expect.any(String));
    expect(String(r.json.error)).not.toContain(reason);
  });

  it("refuses an unknown role or op, or an id that is not one, before asking anything", async () => {
    for (const body of [
      { op: "setRole", agencyId: AGENCY_1, userId: USER, role: "agent" },
      { op: "dropTable", agencyId: AGENCY_1, userId: USER },
      { op: "remove", agencyId: "1 or 1=1", userId: USER },
      { op: "remove", agencyId: AGENCY_1, userId: "x" },
    ]) {
      const r = await as(OWNER, "member-admin", body);
      expect(r.status).toBe(400);
      expect(r.memberCalls).toEqual([]);
    }
  });
});

describe("assign-lead — Admin+ assign, and the assignee is told without the client's details", () => {
  it("assigns as the caller, and mails the assignee a link to the lead and nothing about the client", async () => {
    const r = await as(ADMIN, "assign-lead", { leadId: OTHERS_LEAD, userId: USER });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mailed: true });
    expect(r.leadUpdates).toEqual([{ id: OTHERS_LEAD, fields: { assigned_user_id: USER } }]);
    const patch = r.fetches.find((f) => f.method === "PATCH" && f.url.includes("/rest/v1/leads?"))!;
    expect(patch.headers.Authorization).toBe(`Bearer ${token(ADMIN)}`);
    const mail = r.mailTo("user@example.com");
    expect(mail.subject).toBe("שויכה אלייך פנייה חדשה");
    expect(mail.text).toContain(`https://govari-fin.co.il/admin/leads?lead=${OTHERS_LEAD}`);
    for (const detail of ["דן לוי", "0539876543"]) {
      expect(mail.text).not.toContain(detail);
      expect(mail.html).not.toContain(detail);
    }
  });

  it("refuses a User, and the operator assigns without a membership", async () => {
    const user = await as(USER, "assign-lead", { leadId: LEAD, userId: OTHER_USER });
    expect(user.status).toBe(403);
    expect(user.leadUpdates).toEqual([]);
    expect(user.emails).toEqual([]);
    expect((await as(OPERATOR, "assign-lead", { leadId: LEAD, userId: OTHER_USER })).status).toBe(200);
  });

  it("puts a lead back in the queue, and tells nobody", async () => {
    const r = await as(ADMIN, "assign-lead", { leadId: LEAD, userId: null });
    expect(r.status).toBe(200);
    expect(r.leadUpdates).toEqual([{ id: LEAD, fields: { assigned_user_id: null } }]);
    expect(r.emails).toEqual([]);
  });

  it("answers the trigger's refusal of someone outside the agency, and mails nobody", async () => {
    const r = await as(ADMIN, "assign-lead", { leadId: LEAD, userId: OUTSIDER });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/חבר\/ה בארגון/);
    expect(r.emails).toEqual([]);
  });

  it("does not mail an Admin who takes a lead themselves", async () => {
    const r = await as(ADMIN, "assign-lead", { leadId: LEAD, userId: ADMIN });
    expect(r.status).toBe(200);
    expect(r.emails).toEqual([]);
  });

  it("answers 404 for a lead that is not there, and 400 for an id that is not one", async () => {
    expect((await as(ADMIN, "assign-lead", { leadId: "bbbbbbbb-0000-4000-8000-00000000ffff", userId: USER })).status).toBe(404);
    expect((await as(ADMIN, "assign-lead", { leadId: "x", userId: USER })).status).toBe(400);
  });
});

describe("claim-document-link — only the lead's own documents, for whoever may see the lead", () => {
  it("signs a short link for the assignee, never cached", async () => {
    const r = await as(USER, "claim-document-link", { leadId: LEAD, path: DOC });
    expect(r.status).toBe(200);
    expect(String(r.json.url)).toContain("/storage/v1/object/sign/claim-documents/");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.callsTo("/rpc/can_see_lead")[0].headers.Authorization).toBe(`Bearer ${token(USER)}`);
  });

  it("refuses another User, and signs nothing", async () => {
    const r = await as(OTHER_USER, "claim-document-link", { leadId: LEAD, path: DOC });
    expect(r.status).toBe(403);
    expect(r.callsTo("/storage/v1/object/sign/")).toEqual([]);
  });

  it("refuses a document that is not on that lead, even for an Admin", async () => {
    const r = await as(ADMIN, "claim-document-link", { leadId: OTHERS_LEAD, path: DOC });
    expect(r.status).toBe(404);
    expect(r.callsTo("/storage/v1/object/sign/")).toEqual([]);
  });

  it("refuses a path that is not an object name, before asking anything", async () => {
    for (const path of ["../other/secret.pdf", "a/../b", "", "x".repeat(301)]) {
      const r = await as(ADMIN, "claim-document-link", { leadId: LEAD, path });
      expect(r.status).toBe(400);
      expect(r.callsTo("/rpc/can_see_lead")).toEqual([]);
    }
  });
});
