import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendSheetRow, sheetCell } from "../../supabase/functions/_shared/sheets";
import { calendarConfigured, createCalendarEvent } from "../../supabase/functions/_shared/calendar";
import { selectRows, updateRow, upsertRow } from "../../supabase/functions/_shared/rest";
import { resetGoogleTokenCache } from "../../supabase/functions/_shared/google";

vi.mock("../../supabase/functions/_shared/google", async (orig) => ({
  ...(await orig<typeof import("../../supabase/functions/_shared/google")>()),
  googleAccessToken: vi.fn(async () => "test-token"),
}));

let env: Record<string, string>;
let calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[];
let answer: (url: string) => Response;

beforeEach(() => {
  resetGoogleTokenCache();
  env = { GOOGLE_CALENDAR_ID: "govaridorit@gmail.com", SHEET_ID: "sheet-123", SUPABASE_URL: "https://p.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "svc" };
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
  calls = [];
  answer = () => new Response("{}", { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: String(init.method ?? "GET"), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer(url);
  }));
});

describe("createCalendarEvent", () => {
  it("writes to Dorit's calendar by id, with no attendees and today's reminders", async () => {
    answer = () => new Response(JSON.stringify({ id: "ev1", iCalUID: "ev1@google.com", htmlLink: "https://cal/ev1", start: { dateTime: "2026-10-14T10:00:00+03:00" }, end: { dateTime: "2026-10-14T10:30:00+03:00" } }), { status: 200 });
    const ev = await createCalendarEvent({ summary: "s", description: "d", startIso: "2026-10-14T10:00:00", endIso: "2026-10-14T10:30:00" });
    expect(calls[0].url).toBe("https://www.googleapis.com/calendar/v3/calendars/govaridorit%40gmail.com/events");
    expect(calls[0].headers.Authorization).toBe("Bearer test-token");
    expect(calls[0].body).toEqual({
      summary: "s",
      description: "d",
      start: { dateTime: "2026-10-14T10:00:00", timeZone: "Asia/Jerusalem" },
      end: { dateTime: "2026-10-14T10:30:00", timeZone: "Asia/Jerusalem" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }, { method: "email", minutes: 720 }] },
    });
    expect(ev).toMatchObject({ id: "ev1", iCalUID: "ev1@google.com", htmlLink: "https://cal/ev1" });
    expect(ev.start.toISOString()).toBe("2026-10-14T07:00:00.000Z");
  });

  it("names a refusal by status — a calendar that was never shared answers 404", async () => {
    answer = () => new Response('{"error":{"message":"Not Found"}}', { status: 404 });
    await expect(createCalendarEvent({ summary: "s", description: "d", startIso: "2026-10-14T10:00:00", endIso: "2026-10-14T10:30:00" })).rejects.toThrow(/^calendar_http_404$/);
  });

  it("is not configured without a calendar id", () => {
    env.GOOGLE_CALENDAR_ID = "";
    expect(calendarConfigured()).toBe(false);
  });
});

describe("appendSheetRow", () => {
  it("appends as entered, keeps a leading zero, and links the sheet", async () => {
    const status = await appendSheetRow("Events", 19, ["2026-10-14 10:00:00", "0536667788"]);
    expect(calls[0].url).toBe("https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/Events!A%3AS:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS");
    expect(calls[0].body).toEqual({ values: [["2026-10-14 10:00:00", "'0536667788"]] });
    expect(status).toBe("נרשם ✓ — https://docs.google.com/spreadsheets/d/sheet-123/edit");
  });

  it("stores a value that would start a formula as text", async () => {
    await appendSheetRow("Events", 19, ['=IMPORTXML("https://x.test","//a")', "+972501234567", "-1+1", "@SUM(A1)", "\t=1", "\r=1", "דנה"]);
    expect(calls[0].body).toEqual({
      values: [["'=IMPORTXML(\"https://x.test\",\"//a\")", "'+972501234567", "'-1+1", "'@SUM(A1)", "'\t=1", "'\r=1", "דנה"]],
    });
  });

  it("says it is not configured, without calling Google, when there is no sheet", async () => {
    env.SHEET_ID = "";
    expect(await appendSheetRow("Events", 19, [])).toBe("לא מוגדר");
    expect(calls).toHaveLength(0);
  });
});

describe("PostgREST helpers", () => {
  it("selects with the service key and the query as given", async () => {
    answer = () => new Response(JSON.stringify([{ id: "a" }]), { status: 200 });
    expect(await selectRows("leads", "select=id&phone=eq.050")).toEqual([{ id: "a" }]);
    expect(calls[0]).toMatchObject({ url: "https://p.supabase.test/rest/v1/leads?select=id&phone=eq.050", method: "GET" });
    expect(calls[0].headers).toMatchObject({ apikey: "svc", Authorization: "Bearer svc" });
  });

  it("updates one row by id", async () => {
    await updateRow("leads", "abc", { status: "new" });
    expect(calls[0]).toMatchObject({ url: "https://p.supabase.test/rest/v1/leads?id=eq.abc", method: "PATCH", body: { status: "new" } });
  });

  it("upserts on the named key", async () => {
    // Any table and key: meetings no longer upserts (20261104000000_client_meetings_many.sql).
    await upsertRow("contacts", { phone: "0501234567", name: "x" }, "phone");
    expect(calls[0].url).toBe("https://p.supabase.test/rest/v1/contacts?on_conflict=phone");
    expect(calls[0].headers.Prefer).toBe("resolution=merge-duplicates,return=minimal");
  });

  it("reports a refusal by status and code only", async () => {
    answer = () => new Response('{"code":"23505","message":"Failing row contains (secret)"}', { status: 409 });
    await expect(upsertRow("meetings", {}, "lead_id")).rejects.toThrow(/^upsert_http_409:23505$/);
  });
});

describe("sheetCell", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@x", "'@x"],
    ["\tx", "'\tx"],
    ["\rx", "'\rx"],
    ["0536667788", "'0536667788"],
  ])("prefixes %j", (input, expected) => {
    expect(sheetCell(input)).toBe(expected);
  });

  it.each([
    ["a=1", "a=1"],
    [" =1", " =1"],
    ["536667788", "536667788"],
    ["0", "0"],
    ["", ""],
  ])("leaves %j as it is", (input, expected) => {
    expect(sheetCell(input)).toBe(expected);
  });

  it("writes null and undefined as empty cells, and numbers as text", () => {
    expect(sheetCell(null)).toBe("");
    expect(sheetCell(undefined)).toBe("");
    expect(sheetCell(19)).toBe("19");
  });
});
