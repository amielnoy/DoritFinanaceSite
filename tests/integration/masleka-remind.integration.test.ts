import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, type EdgeOptions, type MaslekaFake } from "../helpers/edge-function";

const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const SECRET = "cron-secret-for-tests-0123456789";
const ON = { MASLEKA_ENABLED: "true", MASLEKA_CRON_SECRET: SECRET, MASLEKA_KEY: Buffer.alloc(32, 7).toString("base64") };
const STAFF_EMAILS = ["dorit@govari-fin.co.il", "staff@example.com"];
// Sunday, 13:00 in Israel.
const NOW = new Date("2026-10-18T10:00:00Z");
const OLD_TOKEN = "Old_-".repeat(8) + "tok";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const req = (id: string, over: Record<string, unknown>) => ({
  id,
  agency_id: AGENCY_1,
  client_name: "לקוח",
  contact_email: null,
  status: "submitted",
  token_hash: sha(id),
  token_expires_at: "2099-01-01T00:00:00.000Z",
  code_ciphertext: null,
  id_ciphertext: null,
  submitted_at: null,
  ready_reminded_at: null,
  deadline_reminded_at: null,
  client_invited_at: null,
  client_reminded_at: null,
  ...over,
});

const ROWS = () => [
  req("11111111-0000-4000-8000-000000000001", { client_name: "רונית מזרחי", submitted_at: "2026-10-18T05:00:00.000Z" }),
  req("11111111-0000-4000-8000-000000000002", { client_name: "יעל כהן", submitted_at: "2026-10-18T08:00:00.000Z" }),
  req("11111111-0000-4000-8000-000000000003", {
    client_name: "דן לוי",
    submitted_at: "2026-10-11T09:00:00.000Z",
    ready_reminded_at: "2026-10-11T13:00:00.000Z",
  }),
  req("11111111-0000-4000-8000-000000000004", { client_name: "הושלם", status: "completed", submitted_at: "2026-10-01T09:00:00.000Z" }),
  req("22222222-0000-4000-8000-000000000001", {
    client_name: "אורי לוי",
    status: "invited",
    contact_email: "uri@example.com",
    token_hash: sha(OLD_TOKEN),
    client_invited_at: "2026-10-10T10:00:00.000Z",
  }),
  req("22222222-0000-4000-8000-000000000002", {
    status: "invited",
    contact_email: "recent@example.com",
    client_invited_at: "2026-10-13T10:00:00.000Z",
  }),
  req("22222222-0000-4000-8000-000000000003", {
    status: "invited",
    contact_email: "reminded@example.com",
    client_invited_at: "2026-10-01T10:00:00.000Z",
    client_reminded_at: "2026-10-08T10:00:00.000Z",
  }),
  req("22222222-0000-4000-8000-000000000004", { status: "invited", contact_email: "byhand@example.com" }),
  req("22222222-0000-4000-8000-000000000005", { status: "invited", client_invited_at: "2026-10-01T10:00:00.000Z" }),
];

function run(o: EdgeOptions & { fake?: MaslekaFake; secret?: string | null } = {}) {
  const { fake, secret = SECRET, ...rest } = o;
  return invokeEdge("masleka-remind", {}, {
    ...rest,
    envPatch: { ...ON, ...(rest.envPatch ?? {}) },
    headers: secret ? { "x-masleka-cron": secret } : {},
    masleka: { requests: ROWS(), staffEmails: STAFF_EMAILS, ...fake },
  });
}
const byId = (rows: Record<string, unknown>[], id: string) => rows.find((r) => r.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("masleka-remind — who may call it", () => {
  it("answers disabled while MASLEKA_ENABLED is unset", async () => {
    const r = await invokeEdge("masleka-remind", {}, { headers: { "x-masleka-cron": SECRET } });
    expect(r.status).toBe(404);
  });

  it("refuses everything when no secret is configured", async () => {
    const r = await run({ envPatch: { MASLEKA_CRON_SECRET: null } });
    expect(r.status).toBe(503);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
  });

  it("refuses everything when the secret is shorter than 32 characters", async () => {
    const short = "s".repeat(31);
    const r = await run({ envPatch: { MASLEKA_CRON_SECRET: short }, secret: short });
    expect(r.status).toBe(503);
    expect(r.emails).toHaveLength(0);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    expect(r.callsTo("masleka_staff_emails")).toHaveLength(0);
  });

  it("refuses a caller without the secret, or with another", async () => {
    expect((await run({ secret: null })).status).toBe(401);
    const wrong = await run({ secret: "cron-secret-for-tests-0123456780" });
    expect(wrong.status).toBe(401);
    expect(wrong.callsTo("masleka_requests")).toHaveLength(0);
    expect(wrong.emails).toHaveLength(0);
    // a prefix, and a longer string that starts with the secret, are not the secret
    expect((await run({ secret: SECRET.slice(0, 31) })).status).toBe(401);
    expect((await run({ secret: `${SECRET}x` })).status).toBe(401);
  });

  it("does nothing at all while the switch is off, even for the right secret", async () => {
    const r = await invokeEdge("masleka-remind", {}, {
      envPatch: { MASLEKA_CRON_SECRET: SECRET },
      headers: { "x-masleka-cron": SECRET },
      masleka: { requests: ROWS(), staffEmails: STAFF_EMAILS },
    });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "disabled" });
    expect(r.fetches).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });
});

describe("masleka-remind — the staff", () => {
  it("tells staff the files are ready four hours after הגשתי", async () => {
    const r = await run();
    const ready = r.emails.filter((e) => e.subject.startsWith("יש קבצים להורדה"));
    expect(ready.map((e) => e.to).sort()).toEqual(STAFF_EMAILS);
    expect(ready[0].subject).toBe("יש קבצים להורדה מהמסלקה — רונית מזרחי");
    expect(ready[0].text).not.toContain("יעל כהן");
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000001").ready_reminded_at).toBe(NOW.toISOString());
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000002").ready_reminded_at).toBeNull();
  });

  it("sends one digest when several are ready", async () => {
    const rows: Record<string, unknown>[] = ROWS();
    rows[1].submitted_at = "2026-10-18T04:00:00.000Z";
    const r = await run({ fake: { requests: rows } });
    const ready = r.emails.filter((e) => e.subject.startsWith("יש קבצים להורדה"));
    expect(ready).toHaveLength(STAFF_EMAILS.length);
    expect(ready[0].subject).toBe("יש קבצים להורדה מהמסלקה — 2 לקוחות");
  });

  it("tells staff on business day 5 that the clearinghouse deletes in two days", async () => {
    const r = await run();
    const deadline = r.emails.filter((e) => e.subject.startsWith("נמחק במסלקה"));
    expect(deadline.map((e) => e.to).sort()).toEqual(STAFF_EMAILS);
    expect(deadline[0].subject).toBe("נמחק במסלקה בעוד יומיים — דן לוי");
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000003").deadline_reminded_at).toBe(NOW.toISOString());
  });

  it("does not warn before business day 5", async () => {
    vi.setSystemTime(new Date("2026-10-18T08:00:00Z"));
    const r = await run();
    expect(r.emails.filter((e) => e.subject.startsWith("נמחק במסלקה"))).toHaveLength(0);
  });

  it("ignores requests PR B has completed", async () => {
    const r = await run();
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000004")).toMatchObject({
      ready_reminded_at: null,
      deadline_reminded_at: null,
    });
  });

  it("claims each staff notice in one conditional update that checks it was never sent", async () => {
    const r = await run();
    const claims = r.requestPatches.filter((p) => /ready_reminded_at|deadline_reminded_at/.test(JSON.stringify(p.fields)));
    expect(claims).toHaveLength(2);
    const ready = claims.find((p) => "ready_reminded_at" in p.fields)!;
    expect(ready.query).toContain("ready_reminded_at=is.null");
    expect(ready.query).toContain("status=eq.submitted");
    const deadline = claims.find((p) => "deadline_reminded_at" in p.fields)!;
    expect(deadline.query).toContain("deadline_reminded_at=is.null");
    expect(deadline.query).toContain("status=eq.submitted");
  });

  it("sends nothing when another run has already claimed the notice", async () => {
    const r = await run({ fake: { raceBeforePatch: { ready_reminded_at: "2026-10-18T10:00:00.000Z", deadline_reminded_at: "2026-10-18T10:00:00.000Z" } } });
    expect(r.emails.filter((e) => /^(יש קבצים|נמחק)/.test(e.subject))).toHaveLength(0);
    expect(r.json).toMatchObject({ ok: true, ready: 0, deadline: 0 });
  });

  it("gives the claim back when no staff address could be mailed, so the next run tries again", async () => {
    const r = await run({ failEmailTo: STAFF_EMAILS });
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000001").ready_reminded_at).toBeNull();
    expect(byId(r.maslekaRequests, "11111111-0000-4000-8000-000000000003").deadline_reminded_at).toBeNull();
    expect(r.json.warnings).toEqual(expect.arrayContaining(["ready_not_sent", "deadline_not_sent"]));
  });

  it("takes business day 5 from the business calendar: a Thursday submission is due the next Thursday", async () => {
    // Thursday 2026-10-08 09:00Z; five business days on (Sun-Thu) is Thursday 2026-10-15.
    const rows = ROWS();
    rows[2].submitted_at = "2026-10-08T09:00:00.000Z";
    rows[2].ready_reminded_at = "2026-10-08T13:00:00.000Z";
    vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
    expect((await run({ fake: { requests: rows } })).emails.filter((e) => e.subject.startsWith("נמחק"))).toHaveLength(0);
    vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
    expect((await run({ fake: { requests: rows } })).emails.filter((e) => e.subject.startsWith("נמחק")).length).toBeGreaterThan(0);
  });

  it("never carries a code, an ID or ciphertext in a mail, and never asks for the ciphertext columns", async () => {
    const rows = ROWS();
    rows[0].code_ciphertext = "CODE-CIPHERTEXT-MARK";
    rows[0].id_ciphertext = "ID-CIPHERTEXT-MARK";
    const r = await run({ fake: { requests: rows } });
    for (const e of r.emails) expect(`${e.subject}${e.text}${e.html}`).not.toMatch(/CIPHERTEXT-MARK/);
    for (const f of r.callsTo("masleka_requests")) expect(f.url).not.toContain("ciphertext");
  });

  it("never repeats a reminder", async () => {
    const first = await run();
    const second = await run({ fake: { requests: first.maslekaRequests } });
    expect(second.emails).toHaveLength(0);
    expect(second.json).toMatchObject({ ok: true, ready: 0, deadline: 0, clients: 0 });
  });
});

describe("masleka-remind — the client", () => {
  it("reminds a client once, a week after the invitation, with a new link", async () => {
    const r = await run();
    const mail = r.mailTo("uri@example.com");
    expect(mail.subject).toBe("תזכורת: מסירת קוד המסלקה · דורית גוב ארי");
    const token = mail.text!.match(/masleka#t=([A-Za-z0-9_-]{43})/)![1];
    const row = byId(r.maslekaRequests, "22222222-0000-4000-8000-000000000001");
    expect(row.token_hash).toBe(sha(token));
    expect(row.token_hash).not.toBe(sha(OLD_TOKEN));
    expect(row.client_reminded_at).toBe(NOW.toISOString());
    // The rotation keeps the original expiry: the reminder shortens nothing and extends nothing.
    expect(row.token_expires_at).toBe("2099-01-01T00:00:00.000Z");
    for (const other of ["recent@example.com", "reminded@example.com", "byhand@example.com"]) {
      expect(r.emails.some((e) => e.to === other), other).toBe(false);
    }
  });

  it("the old link stops working once the reminder has rotated it", async () => {
    const reminded = await run();
    const fresh = reminded.mailTo("uri@example.com").text!.match(/masleka#t=([A-Za-z0-9_-]{43})/)![1];
    const code = { code: "AB12-CD34", idNumber: "000000018" };
    const asClient = (token: string) =>
      invokeEdge("masleka-code", { ...code, token }, {
        envPatch: ON,
        headers: { "x-forwarded-for": "203.0.113.7" },
        masleka: { requests: reminded.maslekaRequests.map((x) => ({ ...x })), staffEmails: STAFF_EMAILS },
      });
    expect((await asClient(OLD_TOKEN)).json).toMatchObject({ error: "link_invalid" });
    expect((await asClient(fresh)).json).toMatchObject({ ok: true });
  });

  it("puts the reminder back when the client's mail fails, so the next run tries again", async () => {
    const r = await run({ failEmailTo: ["uri@example.com"] });
    expect(byId(r.maslekaRequests, "22222222-0000-4000-8000-000000000001").client_reminded_at).toBeNull();
    expect(r.json.warnings).toContain("client_reminder_failed");
  });

  it("claims the client reminder in one conditional update that checks it was never sent", async () => {
    const r = await run();
    const claim = r.requestPatches.find((p) => "token_hash" in p.fields)!;
    expect(claim.query).toContain("client_reminded_at=is.null");
    expect(claim.query).toContain("status=eq.invited");
    expect(Object.keys(claim.fields).sort()).toEqual(["client_reminded_at", "token_hash"]);
  });

  it("does not remind a client whose link a person sent by hand, or one whose link has expired", async () => {
    const rows = ROWS();
    // A fresh hand-sent link sets client_reminded_at (Ruling 19); this row is old enough to be due otherwise.
    rows[4].client_reminded_at = "2026-10-17T10:00:00.000Z";
    rows[6].token_expires_at = "2026-10-17T00:00:00.000Z";
    const r = await run({ fake: { requests: rows } });
    expect(r.emails.filter((e) => e.subject.startsWith("תזכורת"))).toHaveLength(0);
    expect(byId(r.maslekaRequests, "22222222-0000-4000-8000-000000000001").token_hash).toBe(sha(OLD_TOKEN));
  });

  it("sends nothing to a client when another run has already claimed the reminder", async () => {
    const r = await run({ fake: { raceBeforePatch: { client_reminded_at: "2026-10-18T10:00:00.000Z" } } });
    expect(r.emails.filter((e) => e.subject.startsWith("תזכורת"))).toHaveLength(0);
    expect(r.json).toMatchObject({ clients: 0 });
  });

  it("writes no name, address, token or link to a log line", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a) => { lines.push(a.join(" ")); }));
    const ok = await run();
    const failed = await run({ failEmailTo: ["uri@example.com", ...STAFF_EMAILS] });
    spies.forEach((s) => s.mockRestore());
    const all = lines.join("\n");
    expect(all).toContain("masleka-remind");
    for (const secret of ["אורי", "רונית", "uri@example.com", "staff@example.com", SECRET, "masleka#t=", OLD_TOKEN]) expect(all).not.toContain(secret);
    expect(ok.status).toBe(200);
    expect(failed.status).toBe(200);
  });

  it("answers how many it sent", async () => {
    const r = await run();
    expect(r.json).toMatchObject({ ok: true, ready: 1, deadline: 1, clients: 1, warnings: [] });
  });
});
