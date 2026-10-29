import { describe, expect, it } from "vitest";
import { invokeEdge, SUPABASE_URL, type EdgeOptions, type FetchCall } from "../helpers/edge-function";

/**
 * "שליחת הזמנה לאזור האישי" (supabase/functions/invite-client): the switch,
 * the session, the lead read under the caller's own token, twice a year per
 * lead, the mail and its sheet row — and no account made for anyone.
 */
const USER = "user-session-token-0123456789";
const OUTSIDER = "outsider-session-token-0123456789";
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const ORG = "11111111-2222-4333-8444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEAD = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NO_EMAIL = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const HIDDEN = "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type Row = Record<string, unknown>;

function fakeSupabase(opts: { limiterDown?: boolean } = {}) {
  const sessions: Record<string, string> = { [USER]: "user-member", [OUTSIDER]: "user-outsider" };
  // What row-level security lets USER see; HIDDEN exists but is someone else's.
  const visible: Record<string, Row> = {
    [CLIENT]: { id: CLIENT, name: "רחל לוי", email: "Rachel@Example.com", status: "client", agency_id: AGENCY_1 },
    [LEAD]: { id: LEAD, name: "דן", email: "dan@example.com", status: "contacted", agency_id: AGENCY_1 },
    [NO_EMAIL]: { id: NO_EMAIL, name: "גל", email: null, status: "client", agency_id: AGENCY_1 },
  };
  const counts = new Map<string, number>();
  const leadReads: { token: string; query: string }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const upstream = (call: FetchCall): Response | undefined => {
    if (!call.url.startsWith(SUPABASE_URL)) return undefined;
    const url = new URL(call.url);
    const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
    if (url.pathname === "/auth/v1/user") return sessions[token] ? json({ id: sessions[token] }) : json({ code: 403 }, 403);
    if (url.pathname === "/rest/v1/profiles") return json([{ id: "user-member", role: "user", email: "member@example.com" }]);
    if (url.pathname === "/rest/v1/rpc/staff_role") {
      return json((call.body as { p_user_id: string }).p_user_id === "user-member" ? "user" : null);
    }
    if (url.pathname === "/rest/v1/leads") {
      leadReads.push({ token, query: url.search });
      const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
      return json(token === USER && visible[id] ? [visible[id]] : []);
    }
    if (url.pathname === "/rest/v1/rpc/allow_submission") {
      if (opts.limiterDown) return json({ message: "down" }, 503);
      const key = String((call.body as Row).p_key);
      const max = Number((call.body as Row).p_max ?? 1);
      const n = counts.get(key) ?? 0;
      if (n >= max) return json(false);
      counts.set(key, n + 1);
      return json(true);
    }
    return undefined;
  };
  return { upstream, leadReads, counts };
}

const on: EdgeOptions = { envPatch: { STAFF_CLIENTS: "true" } };
const invite = (body: unknown, token: string | null, s: ReturnType<typeof fakeSupabase>, extra: EdgeOptions = on) =>
  invokeEdge("invite-client", body, { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), upstream: s.upstream, ...extra });

describe("invite-client — who may, and to whom", () => {
  it("is off without STAFF_CLIENTS, and outside agency 1, before any session or read", async () => {
    const s = fakeSupabase();
    for (const [body, extra] of [
      [{ agencyId: AGENCY_1, leadId: CLIENT }, {}],
      [{ agencyId: ORG, leadId: CLIENT }, on],
    ] as const) {
      const r = await invite(body, USER, s, extra);
      expect(r.status).toBe(403);
      expect(r.json).toHaveProperty("rid");
      expect(r.callsTo("/auth/v1/user")).toEqual([]);
      expect(r.emails).toEqual([]);
    }
    expect(s.leadReads).toEqual([]);
  });

  it("refuses no session, a non-member, and a bad id", async () => {
    const s = fakeSupabase();
    expect((await invite({ agencyId: AGENCY_1, leadId: CLIENT }, null, s)).status).toBe(401);
    expect((await invite({ agencyId: AGENCY_1, leadId: CLIENT }, OUTSIDER, s)).status).toBe(403);
    expect((await invite({ agencyId: AGENCY_1, leadId: "nope" }, USER, s)).status).toBe(400);
    expect(s.leadReads).toEqual([]);
  });

  it("reads the lead with the caller's own token, and a lead they cannot see is 404 with no mail", async () => {
    const s = fakeSupabase();
    const r = await invite({ agencyId: AGENCY_1, leadId: HIDDEN }, USER, s);
    expect(r.status).toBe(404);
    expect(r.emails).toEqual([]);
    expect(s.leadReads).toHaveLength(1);
    expect(s.leadReads[0].token).toBe(USER);
    expect(s.leadReads[0].query).toContain(`id=eq.${HIDDEN}`);
  });

  it("refuses a lead that is not a client, and a client with no email, with 400", async () => {
    const s = fakeSupabase();
    for (const leadId of [LEAD, NO_EMAIL]) {
      const r = await invite({ agencyId: AGENCY_1, leadId }, USER, s);
      expect(r.status).toBe(400);
      expect(String(r.json.error)).toMatch(/[א-ת]/);
      expect(r.emails).toEqual([]);
    }
  });
});

describe("invite-client — the mail", () => {
  it("mails the client the sign-in link, with the first name only", async () => {
    const s = fakeSupabase();
    const r = await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ sent: true });
    expect(r.emails).toHaveLength(1);
    const mail = r.emails[0];
    expect(mail.to).toBe("rachel@example.com");
    expect(mail.text).toContain("https://govari-fin.co.il/login?returnTo=/account");
    expect(mail.text).toContain("שלום רחל,");
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain("לוי");
  });

  it("writes the invite to the event sheet as client_invite, with the lead id and no name or address", async () => {
    const s = fakeSupabase();
    const r = await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s);
    expect(r.sheetRows).toHaveLength(1);
    const row = r.sheetRows[0].row;
    expect(row).toHaveLength(19);
    expect(row[1]).toBe("client_invite");
    expect(row[10]).toBe(CLIENT);
    expect(JSON.stringify(row)).not.toMatch(/רחל|rachel/i);
  });

  it("sends twice a lead at most: the third is 409 and mails nothing", async () => {
    const s = fakeSupabase();
    expect((await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s)).status).toBe(200);
    expect((await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s)).status).toBe(200);
    const third = await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s);
    expect(third.status).toBe(409);
    expect(third.emails).toEqual([]);
    expect([...s.counts.keys()]).toEqual([`client-invite:${CLIENT}`]);
  });

  it("answers 503 and mails nothing when the limiter cannot answer: never unlimited", async () => {
    const r = await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, fakeSupabase({ limiterDown: true }));
    expect(r.status).toBe(503);
    expect(String(r.json.error)).toMatch(/[א-ת]/);
    expect(r.emails).toEqual([]);
    expect(r.sheetRows).toEqual([]);
  });

  it("answers 502, not sent, when the mailer fails", async () => {
    const s = fakeSupabase();
    const r = await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s, { ...on, failEmailTo: ["rachel@example.com"] });
    expect(r.status).toBe(502);
    expect(r.json).not.toHaveProperty("sent");
    expect(r.sheetRows).toEqual([]);
  });

  it("keeps the invite and warns when the sheet fails", async () => {
    const s = fakeSupabase();
    const r = await invite({ agencyId: AGENCY_1, leadId: CLIENT }, USER, s, { ...on, failGoogle: "sheets" });
    expect(r.status).toBe(200);
    expect(r.json.warnings).toContain("sheet_append_failed");
  });
});
