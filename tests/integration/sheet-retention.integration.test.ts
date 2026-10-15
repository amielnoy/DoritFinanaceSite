import { describe, expect, it } from "vitest";
import { invokeEdge, SUPABASE_URL, type EdgeOptions } from "../helpers/edge-function";

/**
 * The leads sheet held to the database's retention (supabase/functions/sheet-retention,
 * Architecture N-02): which Events and Support rows lose their personal cells,
 * which cells, and that the database decides who is still a live lead.
 */
const SECRET = "cron-secret-for-tests-0123456789";
const AUTH = { headers: { "x-site-cron": SECRET }, envPatch: { MASLEKA_CRON_SECRET: SECRET } };
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/sheet-test";

const DAY = 86_400_000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10) + " 09:00:00";
/** A date as the sheet answers a cell it took for one: a serial day number. */
const serialDaysAgo = (days: number) => Math.floor((Date.now() - days * DAY) / DAY) + 25569;

/** An Events row (A..S): date, type, source, track, agent, topic, timing, name, phone, email, id, reason, summary, meeting, 4 profile, completeness. */
const event = (date: string | number, id: string, personal = true) => [
  date, "quick_contact", "contact", "", "", "פנסיה",
  personal ? "בוקר" : "", personal ? "ישראל ישראלי" : "", personal ? "0501234567" : "", personal ? "a@example.com" : "",
  id, "", personal ? "תקציר" : "", "", personal ? "שכיר" : "", "", "", "", "full",
];
/** A Support row (A..G): date, channel, phone, topic, outcome, messages, transcript. */
const support = (date: string | number, personal = true) => [date, "site", personal ? "0501234567" : "", "פנסיה", "נענה", 6, personal ? "שיחה…" : ""];

function sheet(events: unknown[][], supportRows: unknown[][], live: string[]) {
  const cleared: string[][] = [];
  const asked: string[][] = [];
  const upstream: EdgeOptions["upstream"] = (call) => {
    const url = decodeURIComponent(call.url);
    if (call.method === "GET" && url.startsWith(`${SHEETS}/values/Events!A2:S?`)) return Response.json({ values: events });
    if (call.method === "GET" && url.startsWith(`${SHEETS}/values/Support!A2:G?`)) return Response.json({ values: supportRows });
    if (call.method === "POST" && call.url === `${SHEETS}/values:batchClear`) {
      cleared.push((call.body as { ranges: string[] }).ranges);
      return Response.json({});
    }
    if (call.url === `${SUPABASE_URL}/rest/v1/rpc/lead_sheet_live`) {
      const ids = (call.body as { p_ids: string[] }).p_ids;
      asked.push(ids);
      return Response.json(ids.filter((id) => live.includes(id)));
    }
    return undefined;
  };
  return { upstream, cleared, asked };
}

describe("sheet-retention — the sheet keeps what the database keeps", () => {
  it("refuses a call without the cron secret, and one when no secret is configured", async () => {
    const s = sheet([event(isoDaysAgo(900), "")], [], []);
    const wrong = await invokeEdge("sheet-retention", {}, { ...AUTH, headers: { "x-site-cron": "nope" }, upstream: s.upstream });
    expect(wrong.status).toBe(401);
    const unset = await invokeEdge("sheet-retention", {}, { headers: AUTH.headers, envPatch: { MASLEKA_CRON_SECRET: null }, upstream: s.upstream });
    expect(unset.status).toBe(503);
    expect(s.cleared).toEqual([]);
  });

  it("does nothing, and says so, when no sheet is configured", async () => {
    const s = sheet([event(isoDaysAgo(900), "")], [], []);
    const res = await invokeEdge("sheet-retention", {}, { headers: AUTH.headers, envPatch: { ...AUTH.envPatch, SHEET_ID: null }, upstream: s.upstream });
    expect(res.json).toMatchObject({ ok: true, skipped: "sheet_not_configured" });
    expect(res.callsTo("sheets.googleapis.com")).toEqual([]);
  });

  it("empties an Events row whose lead is anonymized or deleted, and keeps a live lead's", async () => {
    const s = sheet(
      [
        event(isoDaysAgo(10), "live-1"), // row 2: live — kept
        event(isoDaysAgo(900), "anon-1"), // row 3: anonymized — cleared
        event(isoDaysAgo(5), "gone-1"), // row 4: deleted from /admin/leads — cleared, however recent
        event(isoDaysAgo(900), "anon-1", false), // row 5: already empty — left alone
      ],
      [],
      ["live-1"],
    );
    const res = await invokeEdge("sheet-retention", {}, { ...AUTH, upstream: s.upstream });
    expect(res.status).toBe(200);
    expect(s.asked).toEqual([["live-1", "anon-1", "gone-1"]]);
    // Requested time, name, phone, email (G-J), the summary (M) and the profile (O-R); the rest stays.
    expect(s.cleared).toEqual([
      ["Events!G3:J3", "Events!M3", "Events!O3:R3", "Events!G4:J4", "Events!M4", "Events!O4:R4"],
    ]);
    expect(res.json).toMatchObject({ ok: true, events: { rows: 4, cleared: 2, undated: 0 } });
  });

  it("goes by the row's own date when it names no lead: 24 months", async () => {
    const s = sheet(
      [
        event(isoDaysAgo(800), ""), // row 2: past 24 months — cleared
        event(isoDaysAgo(600), ""), // row 3: within — kept
        event(serialDaysAgo(800), ""), // row 4: a date cell, past — cleared
        event("15.03.2019", ""), // row 5: an older row's format, past — cleared
        event("someday", ""), // row 6: no date to go by — left, and counted
      ],
      [],
      [],
    );
    const res = await invokeEdge("sheet-retention", {}, { ...AUTH, upstream: s.upstream });
    expect(s.asked).toEqual([]);
    expect(s.cleared[0].filter((r) => r.endsWith(":J2") || r.endsWith(":J4") || r.endsWith(":J5"))).toHaveLength(3);
    expect(s.cleared[0].some((r) => /[A-Z]3(:|$)/.test(r) || /[A-Z]6(:|$)/.test(r))).toBe(false);
    expect(res.json).toMatchObject({ events: { cleared: 3, undated: 1 } });
  });

  it("empties a Support row's phone and transcript after 12 months, and nothing else", async () => {
    const s = sheet([], [support(isoDaysAgo(400)), support(isoDaysAgo(300)), support(serialDaysAgo(400)), support(isoDaysAgo(400), false)], []);
    const res = await invokeEdge("sheet-retention", {}, { ...AUTH, upstream: s.upstream });
    expect(s.cleared).toEqual([["Support!C2", "Support!G2", "Support!C4", "Support!G4"]]);
    expect(res.json).toMatchObject({ support: { rows: 4, cleared: 2, undated: 0 } });
  });

  it("fails without clearing anything when the database cannot say who is live", async () => {
    const s = sheet([event(isoDaysAgo(900), "anon-1")], [], []);
    const failing: EdgeOptions["upstream"] = (call) =>
      call.url === `${SUPABASE_URL}/rest/v1/rpc/lead_sheet_live` ? new Response("no", { status: 500 }) : s.upstream!(call);
    const res = await invokeEdge("sheet-retention", {}, { ...AUTH, upstream: failing });
    expect(res.status).toBe(500);
    expect(s.cleared).toEqual([]);
  });

  it("logs counts, never a cell", async () => {
    const s = sheet([event(isoDaysAgo(900), "anon-1")], [support(isoDaysAgo(400))], []);
    const res = await invokeEdge("sheet-retention", {}, { ...AUTH, upstream: s.upstream });
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.json);
    for (const personal of ["ישראל ישראלי", "0501234567", "a@example.com", "שיחה"]) expect(body).not.toContain(personal);
  });
});
