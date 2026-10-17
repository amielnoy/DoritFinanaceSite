import { describe, expect, it, vi } from "vitest";
import { orderClientMeetings, timeRange, type ClientMeeting } from "@/lib/meetings";
import { eventTitle, googleCalendarUrl, icsFor } from "@/lib/calendar-file";
import { toClientMeeting } from "@/services/account-mapping";
import { SupabaseAccountService } from "@/services/supabase/SupabaseAccountService";
import { AccountLoadError } from "@/services/ports";

/**
 * The client's meetings (docs/superpowers/specs/2026-10-17-client-meetings-design.md,
 * rollout 4): their order on the tab, a row as my_meetings() sends it, and the
 * calendar files — which must land on Israel's hour on either side of the
 * daylight-saving change (25 October 2026, 02:00).
 */
const meeting = (over: Partial<ClientMeeting> = {}): ClientMeeting => ({
  id: "m-1", scheduledAt: "2026-11-04T08:00:00.000Z", durationMin: 45, topic: "סקירה שנתית", kind: "annual_review",
  status: "scheduled", mode: "office", location: "", clientSummary: null, summaryPublishedAt: null, inCalendar: true,
  openRequest: null, ...over,
});
const NOW = new Date("2026-10-20T09:00:00Z");

describe("orderClientMeetings", () => {
  it("puts the soonest upcoming meeting first, then the rest soonest first, then the past most recent first", () => {
    const list = [
      meeting({ id: "later", scheduledAt: "2026-12-14T15:30:00Z" }),
      meeting({ id: "soon", scheduledAt: "2026-11-04T08:00:00Z" }),
      meeting({ id: "old", scheduledAt: "2026-09-03T06:30:00Z", status: "done" }),
      meeting({ id: "recent", scheduledAt: "2026-09-22T08:00:00Z", status: "done" }),
    ];
    const o = orderClientMeetings(list, NOW);
    expect(o.next?.id).toBe("soon");
    expect(o.upcoming.map((m) => m.id)).toEqual(["later"]);
    expect(o.past.map((m) => m.id)).toEqual(["recent", "old"]);
  });

  it("keeps cancelled meetings apart, and counts a scheduled meeting whose time has gone by as past", () => {
    const o = orderClientMeetings(
      [meeting({ id: "x", status: "cancelled", scheduledAt: "2026-11-01T08:00:00Z" }), meeting({ id: "gone", scheduledAt: "2026-10-01T08:00:00Z" })],
      NOW,
    );
    expect(o.cancelled.map((m) => m.id)).toEqual(["x"]);
    expect(o.next).toBeNull();
    expect(o.past.map((m) => m.id)).toEqual(["gone"]);
  });

  it("lists an undated scheduled meeting as upcoming, never as the next one", () => {
    const o = orderClientMeetings([meeting({ id: "undated", scheduledAt: null })], NOW);
    expect(o.next).toBeNull();
    expect(o.upcoming.map((m) => m.id)).toEqual(["undated"]);
  });
});

describe("toClientMeeting", () => {
  const row = {
    id: "m-1", scheduled_at: "2026-11-04T08:00:00+00:00", duration_min: 45, topic: "סקירה", kind: "annual_review",
    status: "done", mode: "video", location: "https://meet.example/x", client_summary: "סיכמנו", summary_published_at: "2026-11-05T07:00:00+00:00",
    in_calendar: true, open_request: null,
  };

  it("maps the twelve columns", () => {
    expect(toClientMeeting(row)).toMatchObject({ id: "m-1", durationMin: 45, mode: "video", clientSummary: "סיכמנו", inCalendar: true, openRequest: null });
  });

  it("shows no summary without its publication time", () => {
    expect(toClientMeeting({ ...row, summary_published_at: null }).clientSummary).toBeNull();
  });

  it("falls back rather than passing a raw key through", () => {
    expect(toClientMeeting({ ...row, kind: "secret", status: "x", mode: "fax", open_request: "maybe" })).toMatchObject({
      kind: "other", status: "scheduled", mode: null, openRequest: null,
    });
  });
});

describe("the calendar files, on Israel's clock", () => {
  it("writes 10:00 in Israel as 07:00Z in summer time and 08:00Z in winter time", () => {
    const summer = icsFor(meeting({ scheduledAt: "2026-10-22T07:00:00.000Z", durationMin: 45 }), "t", NOW)!;
    const winter = icsFor(meeting({ scheduledAt: "2026-10-26T08:00:00.000Z", durationMin: 45 }), "t", NOW)!;
    expect(summer).toContain("DTSTART:20261022T070000Z");
    expect(summer).toContain("DTEND:20261022T074500Z");
    expect(winter).toContain("DTSTART:20261026T080000Z");
    // And the page shows both as 10:00.
    expect(timeRange("2026-10-22T07:00:00.000Z", 45)).toBe("10:00–10:45");
    expect(timeRange("2026-10-26T08:00:00.000Z", 45)).toBe("10:00–10:45");
  });

  it("is a well-formed VEVENT, its text escaped and its lines folded to 75 octets", () => {
    const ics = icsFor(meeting({ location: "רחוב הברזל 1, תל אביב; קומה 3" }), eventTitle(meeting({ topic: "א".repeat(60) }), "x"), NOW)!;
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:meeting-m-1@govari-fin.co.il");
    expect(ics).toContain("LOCATION:רחוב הברזל 1\\, תל אביב\; קומה 3");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("carries no summary or note, only the title, time and place", () => {
    const ics = icsFor(meeting({ clientSummary: "סודי" }), "כותרת", NOW)!;
    expect(ics).not.toContain("סודי");
  });

  it("builds Google's add-event link with UTC times and Israel's zone", () => {
    const url = new URL(googleCalendarUrl(meeting(), "כותרת")!);
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261104T080000Z/20261104T084500Z");
    expect(url.searchParams.get("ctz")).toBe("Asia/Jerusalem");
  });

  it("offers nothing for a meeting with no time", () => {
    expect(icsFor(meeting({ scheduledAt: null }), "t")).toBeNull();
    expect(googleCalendarUrl(meeting({ scheduledAt: null }), "t")).toBeNull();
  });
});

describe("SupabaseAccountService — meetings", () => {
  it("reads my_meetings, and treats a signed-out call as signed out", async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: "m-1", status: "done", kind: "first" }], error: null }));
    const meetings = await new SupabaseAccountService({ rpc }).myMeetings();
    expect(rpc).toHaveBeenCalledWith("my_meetings");
    expect(meetings[0].id).toBe("m-1");
    const out = new SupabaseAccountService({ rpc: async () => ({ data: null, error: { message: "denied", code: "42501" } }) });
    await expect(out.myMeetings()).rejects.toEqual(new AccountLoadError("signed_out"));
  });

  it("asks through the meeting-request function, so Dorit is mailed", async () => {
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    await new SupabaseAccountService({ rpc: vi.fn(), functions: { invoke } }).requestMeetingChange("m-1", "reschedule", "אחר הצהריים");
    expect(invoke).toHaveBeenCalledWith("meeting-request", { body: { meetingId: "m-1", kind: "reschedule", note: "אחר הצהריים" } });
  });

  it("passes the function's own refusal through", async () => {
    const res = new Response(JSON.stringify({ error: "כבר נשלחה בקשה לפגישה הזו. דורית תחזור אליך.", rid: "r" }), { status: 409 });
    const invoke = vi.fn(async () => ({ data: null, error: { context: res } }));
    await expect(new SupabaseAccountService({ rpc: vi.fn(), functions: { invoke } }).requestMeetingChange("m-1", "cancel")).rejects.toThrow(/כבר נשלחה בקשה/);
  });
});
