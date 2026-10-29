import { describe, expect, it } from "vitest";
import { invokeEdge, SUPABASE_URL, type EdgeOptions, type FetchCall } from "../helpers/edge-function";
import { assignmentMail } from "../../supabase/functions/assign-lead/handler";
import { SECRET_JS } from "../helpers/staff-lead-secret";

/**
 * "הוספת פנייה" (supabase/functions/create-lead): the session and the agency
 * role, the lead written by create_staff_lead under the caller's own token,
 * and the side effects (sheet row, assignment mail, ops notice, privacy mail)
 * that never undo the lead.
 */
const USER = "user-session-token-0123456789";
const ADMIN = "admin-session-token-0123456789";
const OUTSIDER = "outsider-session-token-0123456789";
const OPERATOR = "operator-session-token-0123456789";
const ORG = "11111111-2222-4333-8444-555555555555";
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const NEW_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ID = "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ASSIGNEE = "77777777-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type Row = Record<string, unknown>;

function fakeSupabase(seed: { rpc?: Row | { status: number; body: Row }; failAdminsRead?: boolean; agencyCap?: number; noticeLimiterDown?: boolean } = {}) {
  const sessions: Record<string, string> = {
    [USER]: "user-member", [ADMIN]: "user-admin", [OUTSIDER]: "user-outsider", [OPERATOR]: "user-operator",
  };
  const roles: Record<string, string> = { "user-member": "user", "user-admin": "admin", [ASSIGNEE]: "user", "user-owner": "owner" };
  const profiles: Record<string, string> = {
    "user-member": "member@example.com",
    "user-admin": "admin@example.com",
    "user-owner": "owner@example.com",
    [ASSIGNEE]: "assignee@example.com",
  };
  const limiterKeys: string[] = [];
  // The notice limiter as the database keeps it: one per address, `agencyCap` (30) per agency.
  const counts = new Map<string, number>();
  const rpcCalls: { token: string; body: Row }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const upstream = (call: FetchCall): Response | undefined => {
    if (!call.url.startsWith(SUPABASE_URL)) return undefined;
    const url = new URL(call.url);
    const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
    if (url.pathname === "/auth/v1/user") return sessions[token] ? json({ id: sessions[token] }) : json({ code: 403, error_code: "bad_jwt" }, 403);
    if (url.pathname === "/rest/v1/profiles") {
      const id = url.searchParams.get("id") ?? "";
      if (id.startsWith("eq.")) {
        const who = id.slice(3);
        return json([{ id: who, role: who === "user-operator" ? "admin" : "user", email: profiles[who] ?? null }]);
      }
      const ids = id.replace(/^in\.\(|\)$/g, "").split(",");
      return json(ids.map((i) => ({ id: i, email: profiles[i] ?? null })));
    }
    if (url.pathname === "/rest/v1/memberships") {
      if (seed.failAdminsRead) return json({}, 500);
      return json([{ user_id: "user-admin" }, { user_id: "user-owner" }]);
    }
    if (url.pathname === "/rest/v1/rpc/allow_submission" && String((call.body as Row).p_key).startsWith("staff-notice-")) {
      limiterKeys.push(String((call.body as Row).p_key));
      if (seed.noticeLimiterDown) return json({ message: "down" }, 503);
      const key = String((call.body as Row).p_key);
      const cap = key.startsWith("staff-notice-agency:") ? (seed.agencyCap ?? 30) : 1;
      const n = counts.get(key) ?? 0;
      if (n >= cap) return json(false);
      counts.set(key, n + 1);
      return json(true);
    }
    if (url.pathname === "/rest/v1/rpc/staff_role") {
      return json(roles[(call.body as { p_user_id: string }).p_user_id] ?? null);
    }
    if (url.pathname === "/rest/v1/rpc/create_staff_lead") {
      rpcCalls.push({ token, body: call.body as Row });
      const answer = seed.rpc ?? { lead_id: NEW_ID, duplicate: null };
      if ("status" in answer && "body" in answer) return json(answer.body, answer.status as number);
      return json([answer]);
    }
    return undefined;
  };
  return { upstream, rpcCalls, limiterKeys };
}

const good = { agencyId: AGENCY_1, name: "ישראל ישראלי", phone: "050-123 4567", email: "client@example.com", topic: "פנסיה", notes: "שיחה ראשונה", intake: "phone", status: "contacted", notice: "verbal" };

const create = (body: unknown, token: string | null, s: ReturnType<typeof fakeSupabase>, extra: EdgeOptions = {}) =>
  invokeEdge("create-lead", body, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), upstream: s.upstream, ...extra });

describe("create-lead — who may, and what it checks", () => {
  it("refuses a caller with no session and a non-member, without calling the RPC", async () => {
    const s = fakeSupabase();
    expect((await create(good, null, s)).status).toBe(401);
    const r = await create(good, OUTSIDER, s);
    expect(r.status).toBe(403);
    expect(r.json).toHaveProperty("rid");
    expect(s.rpcCalls).toEqual([]);
  });

  it.each([
    ["a missing name", { ...good, name: "  " }],
    ["a bad email", { ...good, email: "nope" }],
    ["a name too long", { ...good, name: "א".repeat(81) }],
    ["notice by email with no email", { ...good, email: undefined, notice: "email" }],
    ["an unknown intake", { ...good, intake: "carrier-pigeon" }],
    ["an unknown status", { ...good, status: "closed" }],
    ["an unknown notice", { ...good, notice: "fax" }],
  ])("refuses %s with 400 and no RPC call", async (_label, body) => {
    const s = fakeSupabase();
    const r = await create(body, USER, s);
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/[א-ת]/);
    expect(r.json).toHaveProperty("rid");
    expect(s.rpcCalls).toEqual([]);
  });

  it("refuses a phone that is not one with 422, like the RPC's bad_phone, and no RPC call", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, phone: "123" }, USER, s);
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("מספר הטלפון אינו תקין.");
    expect(s.rpcCalls).toEqual([]);
  });

  it("answers 429 when the limiter refuses, and writes nothing", async () => {
    const s = fakeSupabase();
    const r = await create(good, USER, s, { overLimit: ["staff-lead:"] });
    expect(r.status).toBe(429);
    expect(r.json).toHaveProperty("rid");
    expect(s.rpcCalls).toEqual([]);
  });

  it("refuses any agency but agency 1 with 403 agency_not_enabled, before the session, the RPC or any side effect", async () => {
    const s = fakeSupabase();
    for (const token of [ADMIN, null]) {
      const r = await create({ ...good, agencyId: ORG, notice: "email" }, token, s);
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("הוספת פנייה פתוחה בסוכנות הזו רק כשיהיה לה נוסח יידוע משלה.");
      expect(r.json).toHaveProperty("rid");
      expect(r.sheetRows).toEqual([]);
      expect(r.emails).toEqual([]);
      expect(r.callsTo("/auth/v1/user")).toEqual([]);
    }
    expect(s.rpcCalls).toEqual([]);
    expect(s.limiterKeys).toEqual([]);
  });

  it.each([
    ["forbidden", 403, "42501"],
    ["bad_status", 400, "22023"],
    ["assignee_not_member", 400, "22023"],
    // The RPC's own controls, for a call that skips this function.
    ["rate_limited", 429, "P0001"],
    ["bad_phone", 422, "22023"],
    ["field_invalid", 422, "22023"],
    ["agency_not_enabled", 403, "42501"],
  ])("maps the RPC's %s to %i in Hebrew, never its text", async (reason, status, code) => {
    const s = fakeSupabase({ rpc: { status: status === 403 ? 403 : 400, body: { code, message: reason, details: "secret row" } } });
    const r = await create(good, USER, s);
    expect(r.status).toBe(status);
    expect(JSON.stringify(r.json)).not.toContain(reason);
    expect(JSON.stringify(r.json)).not.toContain("secret");
    expect(String(r.json.error)).toMatch(/[א-ת]/);
    expect(r.json).toHaveProperty("rid");
  });
});

describe("create-lead — the write", () => {
  it("calls the RPC with the caller's own token, the phone normalised, and notes and topic redacted", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, notes: "ת.ז. 123456782 בשיחה", topic: "כרטיס 123456782" }, USER, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ leadId: NEW_ID, duplicate: null, noticeSent: null });
    expect(r.json).toHaveProperty("rid");
    expect(s.rpcCalls).toHaveLength(1);
    expect(s.rpcCalls[0].token).toBe(USER);
    expect(s.rpcCalls[0].body).toMatchObject({ p_agency_id: AGENCY_1, p_phone: "0501234567", p_intake: "phone", p_status: "contacted", p_notice: "verbal" });
    expect(JSON.stringify(s.rpcCalls[0].body)).not.toContain("123456782");
    // staff text is notes, never summary or message
    expect(JSON.stringify(s.rpcCalls[0].body)).not.toMatch(/summary|message/);
  });

  it.each([
    ["referrer", "referrer", "א".repeat(112) + "123456", 120],
    ["topic", "topic", "ב".repeat(194) + "123456", 200],
  ])("fits a %s that redaction lengthens under its cap, with nothing left to find", async (_label, field, value, cap) => {
    expect(value.length).toBeLessThanOrEqual(cap);
    const s = fakeSupabase();
    const r = await create({ ...good, [field]: value }, USER, s);
    expect(r.status).toBe(200);
    const sent = String((s.rpcCalls[0].body as Record<string, unknown>)[field === "topic" ? "p_topic" : "p_referrer"]);
    expect(sent.length).toBeLessThanOrEqual(cap);
    expect(sent).toContain("[הושמט");
    expect(SECRET_JS.test(sent)).toBe(false);
  });

  it("answers 409 for a visible duplicate, with that lead's id, and does no side effect", async () => {
    const s = fakeSupabase({ rpc: { lead_id: OTHER_ID, duplicate: "visible" } });
    const r = await create(good, USER, s);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ duplicate: "visible", leadId: OTHER_ID });
    expect(r.json).toHaveProperty("rid");
    expect(r.sheetRows).toEqual([]);
    expect(r.emails).toEqual([]);
  });

  it("answers 200 for a hidden duplicate, flags it in the ops notice, and carries no other lead's id", async () => {
    const s = fakeSupabase({ rpc: { lead_id: NEW_ID, duplicate: "hidden" } });
    const r = await create(good, USER, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ duplicate: "hidden", leadId: NEW_ID });
    const ops = r.emails.filter((e) => e.to === "admin@example.com");
    expect(ops).toHaveLength(1);
    expect(ops[0].subject).toContain("כפילות אפשרית");
    const everything = JSON.stringify([r.json, r.emails, r.sheetRows]);
    expect(everything).not.toContain(OTHER_ID);
    expect(everything).toContain(NEW_ID);
  });

  it("tells the agency's admins and owners with the topic and the link, never the name, phone or email", async () => {
    const s = fakeSupabase();
    const r = await create(good, USER, s);
    expect(r.status).toBe(200);
    const ops = r.emails.filter((e) => ["admin@example.com", "owner@example.com"].includes(e.to));
    expect(ops.map((e) => e.to).sort()).toEqual(["admin@example.com", "owner@example.com"]);
    for (const mail of ops) {
      const all = `${mail.subject}\n${mail.text}\n${mail.html}`;
      expect(all).toContain("פנסיה");
      expect(all).toContain("https://govari-fin.co.il/admin/leads");
      expect(all).toContain("member@example.com");
      expect(all).not.toContain("ישראל ישראלי");
      expect(all).not.toContain("0501234567");
      expect(all).not.toContain("050-123 4567");
      expect(all).not.toContain("client@example.com");
    }
  });

  it("writes a sheet row of type staff_lead, sourced 'staff', with an Israel-time timestamp", async () => {
    const s = fakeSupabase();
    const r = await create(good, USER, s);
    expect(r.sheetRows).toHaveLength(1);
    const row = r.sheetRows[0].row;
    expect(String(row[0])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row[1]).toBe("staff_lead");
    expect(row[2]).toBe("staff");
    expect(row[10]).toBe(NEW_ID);
  });

  it("keeps the lead and warns when the sheet fails", async () => {
    const s = fakeSupabase();
    const r = await create(good, USER, s, { failGoogle: "sheets" });
    expect(r.status).toBe(200);
    expect(r.json.leadId).toBe(NEW_ID);
    expect(r.json.warnings).toContain("sheet_append_failed");
  });
});

describe("create-lead — the people told", () => {
  it("mails an assignee the assignment, when an Admin assigns to another member", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, assignee: ASSIGNEE }, ADMIN, s);
    expect(r.status).toBe(200);
    expect(s.rpcCalls[0].body.p_assignee).toBe(ASSIGNEE);
    const mail = r.emails.find((e) => e.to === "assignee@example.com");
    expect(mail?.subject).toBe(assignmentMail(NEW_ID).subject);
    expect(mail?.text).toBe(assignmentMail(NEW_ID).text);
  });

  it("assigns an Admin's lead to the Admin when no assignee is sent ('אני'), and mails no one", async () => {
    const s = fakeSupabase();
    const r = await create(good, ADMIN, s);
    expect(r.status).toBe(200);
    expect(s.rpcCalls[0].body.p_assignee).toBe("user-admin");
    expect(r.emails.some((e) => e.subject === assignmentMail(NEW_ID).subject)).toBe(false);
  });

  it("leaves an Admin's lead in the queue for 'none' ('ללא שיוך')", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, assignee: "none" }, ADMIN, s);
    expect(r.status).toBe(200);
    expect(s.rpcCalls[0].body.p_assignee).toBeNull();
    expect(r.emails.some((e) => e.subject === assignmentMail(NEW_ID).subject)).toBe(false);
  });

  it("assigns nobody by default when the caller is the operator and not a member", async () => {
    const s = fakeSupabase();
    const r = await create(good, OPERATOR, s);
    expect(r.status).toBe(200);
    expect(s.rpcCalls[0].body.p_assignee).toBeNull();
  });

  it("sends a User no assignment mail, and passes no assignee on", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, assignee: ASSIGNEE }, USER, s);
    expect(r.emails.find((e) => e.to === "assignee@example.com")).toBeUndefined();
    expect(s.rpcCalls[0].body.p_assignee).toBeNull();
  });

  it("sends the privacy notice when the member chose email, and says so", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, notice: "email" }, USER, s);
    expect(r.json.noticeSent).toBe(true);
    expect(r.emails.some((e) => e.to === "client@example.com" && /פרטיות/.test(e.subject))).toBe(true);
  });

  it("answers noticeSent false, with the lead, when the mailer fails", async () => {
    const s = fakeSupabase();
    const r = await create({ ...good, notice: "email" }, USER, s, { failEmailTo: ["client@example.com"] });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ leadId: NEW_ID, noticeSent: false });
    expect(r.json).toHaveProperty("rid");
  });

  it("sends one privacy notice per address, and never puts the address in a limiter key", async () => {
    const s = fakeSupabase();
    const first = await create({ ...good, notice: "email" }, USER, s);
    expect(first.json.noticeSent).toBe(true);
    const second = await create({ ...good, notice: "email" }, USER, s);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ leadId: NEW_ID, noticeSent: false });
    expect(second.json.warnings).toContain("notice_rate_limited");
    expect(second.emails.some((e) => e.to === "client@example.com")).toBe(false);
    expect(s.limiterKeys.length).toBeGreaterThan(0);
    expect(s.limiterKeys.join(" ")).not.toContain("client@example.com");
    expect(s.limiterKeys.some((k) => k.startsWith(`staff-notice-agency:${AGENCY_1}`))).toBe(true);
  });

  it("checks the agency's cap first, so a refused one leaves the address's slot unused", async () => {
    const s = fakeSupabase({ agencyCap: 0 });
    const r = await create({ ...good, notice: "email" }, USER, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ leadId: NEW_ID, noticeSent: false });
    expect(r.json.warnings).toContain("notice_rate_limited");
    expect(s.limiterKeys.some((k) => k.startsWith("staff-notice-agency:"))).toBe(true);
    expect(s.limiterKeys.some((k) => k.startsWith("staff-notice-addr:"))).toBe(false);
  });

  it("sends no notice when the limiter cannot answer, and still saves the lead", async () => {
    // Mail to a typed address fails closed (_shared/guard.ts limitCheck).
    const s = fakeSupabase({ noticeLimiterDown: true });
    const r = await create({ ...good, notice: "email" }, USER, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ leadId: NEW_ID, noticeSent: false });
    expect(r.json.warnings).toContain("notice_rate_limited");
    expect(r.emails.some((e) => e.to === "client@example.com")).toBe(false);
  });

  it("passes an ID typed in the referrer through redact", async () => {
    const s = fakeSupabase();
    await create({ ...good, referrer: "דרך 123456782" }, USER, s);
    expect(JSON.stringify(s.rpcCalls[0].body)).not.toContain("123456782");
  });

  it("still answers when the admins cannot be read", async () => {
    const s = fakeSupabase({ failAdminsRead: true });
    const r = await create(good, USER, s);
    expect(r.status).toBe(200);
    expect(r.json.leadId).toBe(NEW_ID);
  });
});

describe("create-lead — a client (kind 'client', behind STAFF_CLIENTS)", () => {
  const on = { envPatch: { STAFF_CLIENTS: "true" } };
  const client = { ...good, kind: "client", status: undefined, topic: undefined, intake: "existing_client", notice: "agreement", clientSince: "2019-03", products: ["pension", "health"] };

  it("refuses a client with 400 and no RPC call when the server's switch is off", async () => {
    const s = fakeSupabase();
    const r = await create(client, USER, s);
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/[א-ת]/);
    expect(r.json).toHaveProperty("rid");
    expect(s.rpcCalls).toEqual([]);
  });

  it("sends the RPC a client: p_as_client, the month as its first day, the products, status client", async () => {
    const s = fakeSupabase();
    const r = await create(client, USER, s, on);
    expect(r.status).toBe(200);
    expect(s.rpcCalls[0].body).toMatchObject({
      p_as_client: true, p_client_since: "2019-03-01", p_products: ["pension", "health"], p_status: "client", p_notice: "agreement",
    });
  });

  it("sends none of the client arguments for a lead, so the old call is unchanged", async () => {
    const s = fakeSupabase();
    await create(good, USER, s, on);
    for (const key of ["p_as_client", "p_client_since", "p_products"]) expect(s.rpcCalls[0].body).not.toHaveProperty(key);
  });

  it.each([
    ["agreement on a lead", { ...good, notice: "agreement" }],
    ["a month that is not one", { ...client, clientSince: "2019-13" }],
    ["a date, not a month", { ...client, clientSince: "2019-03-01" }],
    ["no products", { ...client, products: [] }],
    ["an unknown product", { ...client, products: ["pension", "crypto"] }],
    ["products that are not a list", { ...client, products: "pension" }],
    ["an unknown kind", { ...client, kind: "household" }],
  ])("refuses %s with 400 and no RPC call", async (_label, body) => {
    const s = fakeSupabase();
    const r = await create(body, USER, s, on);
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/[א-ת]/);
    expect(s.rpcCalls).toEqual([]);
  });

  it.each([["bad_since"], ["bad_products"]])("maps the RPC's %s to a Hebrew 400", async (reason) => {
    const s = fakeSupabase({ rpc: { status: 400, body: { code: "22023", message: reason } } });
    const r = await create(client, USER, s, on);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).not.toContain(reason);
    expect(String(r.json.error)).toMatch(/[א-ת]/);
  });

  it("mails the client notice, not the enquiry one, when told by email", async () => {
    const s = fakeSupabase();
    const r = await create({ ...client, notice: "email" }, USER, s, on);
    expect(r.json.noticeSent).toBe(true);
    const mail = r.emails.find((e) => e.to === "client@example.com");
    expect(mail?.text).toContain("הסכם ההתקשרות");
    expect(mail?.text).not.toContain("24 חודשים");
  });

  it("sends nothing to the client when told in the agreement", async () => {
    const s = fakeSupabase();
    const r = await create(client, USER, s, on);
    expect(r.json.noticeSent).toBeNull();
    expect(r.emails.some((e) => e.to === "client@example.com")).toBe(false);
  });

  it("tells the admins a client was added, with the product lines, never the name, phone or email", async () => {
    const s = fakeSupabase();
    const r = await create(client, USER, s, on);
    const ops = r.emails.filter((e) => e.to === "admin@example.com");
    expect(ops).toHaveLength(1);
    const all = `${ops[0].subject}\n${ops[0].text}\n${ops[0].html}`;
    expect(ops[0].subject).toContain("הוסיף/ה לקוח/ה");
    expect(all).toContain("פנסיה, בריאות וסיעוד");
    for (const secret of ["ישראל ישראלי", "0501234567", "client@example.com"]) expect(all).not.toContain(secret);
  });

  it("writes the sheet row with the summary cell starting 'לקוח/ה ·', and no new column", async () => {
    const s = fakeSupabase();
    const r = await create(client, USER, s, on);
    const row = r.sheetRows[0].row;
    expect(row).toHaveLength(19);
    expect(row[1]).toBe("staff_lead");
    expect(row[2]).toBe("staff");
    expect(String(row[12])).toBe("לקוח/ה · פנסיה, בריאות וסיעוד");
  });

  it("answers what can come next: the invite when there is an email, the clearinghouse when it is on", async () => {
    const s = fakeSupabase();
    const withEmail = await create(client, USER, s, on);
    expect(withEmail.json.next).toEqual({ invite: true, masleka: false });
    const noEmail = await create({ ...client, email: undefined, phone: "050-765 4321" }, USER, fakeSupabase(), {
      envPatch: { STAFF_CLIENTS: "true", MASLEKA_ENABLED: "true" },
    });
    expect(noEmail.json.next).toEqual({ invite: false, masleka: true });
    const lead = await create(good, USER, fakeSupabase(), on);
    expect(lead.json).not.toHaveProperty("next");
  });

  it("still answers 409 for a visible duplicate, with that lead's id", async () => {
    const s = fakeSupabase({ rpc: { lead_id: OTHER_ID, duplicate: "visible" } });
    const r = await create(client, USER, s, on);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ duplicate: "visible", leadId: OTHER_ID });
  });
});
