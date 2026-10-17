import { describe, expect, it } from "vitest";
import type { FetchCall } from "../helpers/base44-function";
import { SUPABASE_URL, invokeEdge, type EdgeOptions } from "../helpers/edge-function";

/**
 * A client asks to move or cancel a meeting (supabase/functions/meeting-request,
 * docs/superpowers/specs/2026-10-17-client-meetings-design.md D5). The rules
 * themselves — whose meeting, verified address, one open request — are
 * Postgres's (request_meeting_change, proved by
 * supabase/tests/client_meetings_check.sql); what is pinned here is that the
 * function asks with the client's own session, reports each refusal plainly,
 * and tells staff without ever carrying the client's note.
 */
const MEETING = "22222222-0000-4000-8000-000000000002";
const REQUEST = "33333333-0000-4000-8000-000000000001";
const TOKEN = "client-session-token-0123456789";
const SIGNED_IN = { Authorization: `Bearer ${TOKEN}` };
const NOTE = "אפשר ביום שלישי? יש לי טיפול רפואי ביום הזה";

/** Postgres's side: the RPCs and the meeting row, answered as the database would. */
function database(refusal?: string, staff: string[] = ["dorit@example.com", "assigned@example.com"]) {
  return (call: FetchCall): Response | undefined => {
    if (call.url === `${SUPABASE_URL}/rest/v1/rpc/request_meeting_change`) {
      if (refusal) return new Response(JSON.stringify({ code: "42501", message: refusal }), { status: 400 });
      return new Response(JSON.stringify(REQUEST), { status: 200 });
    }
    if (call.url === `${SUPABASE_URL}/rest/v1/rpc/meeting_request_recipients`) {
      return new Response(JSON.stringify(staff), { status: 200 });
    }
    if (call.url.startsWith(`${SUPABASE_URL}/rest/v1/meetings?`)) {
      // 10:00 in Israel on 2026-11-03 (winter time, UTC+2).
      return new Response(JSON.stringify([{ scheduled_at: "2026-11-03T08:00:00Z", topic: "סקירה שנתית" }]), { status: 200 });
    }
    return undefined;
  };
}

const ask = (body: unknown, options: EdgeOptions = {}) =>
  invokeEdge("meeting-request", body, { headers: SIGNED_IN, upstream: database(), ...options });

describe("meeting-request — a client asks to change a meeting", () => {
  it("asks Postgres with the client's own session, and answers the request id", async () => {
    const r = await ask({ meetingId: MEETING, kind: "reschedule", note: NOTE });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, requestId: REQUEST, notified: true });
    expect(r.json.rid).toBeTruthy();
    const rpc = r.callsTo("/rest/v1/rpc/request_meeting_change")[0];
    expect(rpc.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(rpc.body).toEqual({ p_meeting: MEETING, p_kind: "reschedule", p_note: NOTE });
  });

  it("tells the team, the assigned user and the agency's admins — once each", async () => {
    const r = await ask({ meetingId: MEETING, kind: "cancel" }, {
      upstream: database(undefined, ["dorit@example.com", "Assigned@Example.com", "dorit@example.com"]),
    });
    const to = r.emails.map((m) => m.to);
    expect(to).toEqual(expect.arrayContaining(["dorit@example.com", "assigned@example.com"]));
    expect(new Set(to).size).toBe(to.length);
  });

  it("never carries the client's note, in the subject or anywhere in the mail", async () => {
    const r = await ask({ meetingId: MEETING, kind: "reschedule", note: NOTE });
    expect(r.emails.length).toBeGreaterThan(0);
    for (const mail of r.emails) {
      for (const part of [mail.subject, mail.html, mail.text]) {
        expect(part).not.toContain("טיפול רפואי");
      }
      expect(mail.subject).toBe("בקשה לשינוי פגישה: מועד אחר");
    }
  });

  it("gives the meeting's time in Israel, not UTC", async () => {
    const r = await ask({ meetingId: MEETING, kind: "reschedule" });
    expect(r.emails[0].text).toContain("10:00");
    expect(r.emails[0].text).not.toContain("08:00");
  });

  it.each([
    ["already_open", 409, "כבר נשלחה בקשה"],
    ["not_found", 404, "הפגישה לא נמצאה"],
    ["unverified", 403, "לאמת את כתובת המייל"],
  ])("answers Postgres's %s as %i, and mails nobody", async (refusal, status, text) => {
    const r = await ask({ meetingId: MEETING, kind: "cancel" }, { upstream: database(refusal) });
    expect(r.status).toBe(status);
    expect(String(r.json.error)).toContain(text);
    expect(r.json.rid).toBeTruthy();
    expect(r.emails).toEqual([]);
  });

  it("asks nothing without a session", async () => {
    const r = await ask({ meetingId: MEETING, kind: "cancel" }, { headers: {} });
    expect(r.status).toBe(401);
    expect(r.callsTo("/rest/v1/rpc/")).toEqual([]);
  });

  it.each([
    [{ meetingId: "not-a-uuid", kind: "cancel" }, "הפגישה אינה מוכרת"],
    [{ meetingId: MEETING, kind: "move" }, "מועד אחר או ביטול"],
    [{ meetingId: MEETING, kind: "cancel", note: "א".repeat(501) }, "עד 500 תווים"],
    [{ meetingId: MEETING, kind: "cancel", note: 7 }, "עד 500 תווים"],
  ])("refuses a malformed request before asking Postgres (%j)", async (body, text) => {
    const r = await ask(body);
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain(text);
    expect(r.callsTo("/rest/v1/rpc/")).toEqual([]);
  });

  it("keeps the request when the mail does not go, and says so", async () => {
    const r = await ask({ meetingId: MEETING, kind: "cancel" }, { resendStatus: 500 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, requestId: REQUEST, notified: false });
  });
});
