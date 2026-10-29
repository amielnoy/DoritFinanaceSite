import { describe, expect, it, vi } from "vitest";
import { LEAD_PAGE, SupabaseLeadAdminService } from "@/services/supabase/SupabaseLeadAdminService";
import { tableFake } from "../helpers/supabase-table-fake";
import type { SupabaseLeadTableClient, SupabaseQuery, SupabaseReadResult } from "@/services/supabase/SupabaseTableClient";

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-0000000000aa",
  base44_id: "b44-lead-1",
  name: "דנה",
  phone: "050-0000000",
  email: null,
  source: "consultation",
  topic: "פנסיה",
  timing: null,
  message: null,
  status: "new",
  created_at: "2026-10-10T08:00:00+00:00",
  ...over,
});

describe("SupabaseLeadAdminService.list", () => {
  it("reads leads newest first, a page at a time", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).list();
    expect(calls[0]).toEqual(["from", "leads"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["range", 0, LEAD_PAGE - 1]);
  });

  /**
   * "כל הפניות" and "ייצוא הכל" were the newest 500: past that, older leads left
   * the list, the counts and the export with no word (review 2026-10-15).
   */
  it("reads every lead, page after page, until a short page", async () => {
    const rows = Array.from({ length: LEAD_PAGE * 2 + 500 }, (_, i) => leadRow({ id: `lead-${i}` }));
    const { client, calls } = tableFake({ data: rows, error: null });
    const leads = await new SupabaseLeadAdminService(client).list();
    expect(leads).toHaveLength(LEAD_PAGE * 2 + 500);
    expect(calls.filter((c) => c[0] === "range")).toEqual([
      ["range", 0, LEAD_PAGE - 1],
      ["range", LEAD_PAGE, LEAD_PAGE * 2 - 1],
      ["range", LEAD_PAGE * 2, LEAD_PAGE * 3 - 1],
    ]);
  });

  it("asks for the port's columns only, not the whole row", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).list();
    const select = calls.find((c) => c[0] === "select")!;
    expect(select[1]).not.toBe("*");
    expect(String(select[1]).split(",")).toEqual(
      expect.arrayContaining(["id", "name", "phone", "status", "created_at"]),
    );
  });

  it("returns leads under their Supabase id, which the writes act on", async () => {
    const { client } = tableFake({ data: [leadRow()], error: null });
    const [lead] = await new SupabaseLeadAdminService(client).list();
    expect(lead).toMatchObject({
      id: "6f1c0e3a-0000-4000-8000-0000000000aa",
      name: "דנה",
      status: "new",
      created_date: "2026-10-10T08:00:00+00:00",
    });
    expect(lead).not.toHaveProperty("email");
  });

  it("lists a lead that never had a Base44 id the same way", async () => {
    const { client } = tableFake({ data: [leadRow({ base44_id: null })], error: null });
    const leads = await new SupabaseLeadAdminService(client).list();
    expect(leads.map((l) => l.id)).toEqual(["6f1c0e3a-0000-4000-8000-0000000000aa"]);
  });

  it("throws on a failed read rather than showing an empty inbox", async () => {
    const { client } = tableFake({ data: null, error: { message: "permission denied for table leads", code: "42501" } });
    await expect(new SupabaseLeadAdminService(client).list()).rejects.toThrow(/leads read failed/);
  });
});

describe("SupabaseLeadAdminService writes", () => {
  const changed = { data: [{ id: "6f1c0e3a-0000-4000-8000-0000000000aa" }], error: null };

  it("sets a status on the row with that Supabase id, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, changed);
    await new SupabaseLeadAdminService(client).setStatus("6f1c0e3a-0000-4000-8000-0000000000aa", "contacted");
    expect(calls).toEqual([
      ["from", "leads"],
      ["update", { status: "contacted" }],
      ["eq", "id", "6f1c0e3a-0000-4000-8000-0000000000aa"],
      ["select", "id"],
    ]);
  });

  it("deletes the row with that Supabase id, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, changed);
    await new SupabaseLeadAdminService(client).remove("6f1c0e3a-0000-4000-8000-0000000000aa");
    expect(calls).toEqual([
      ["from", "leads"],
      ["delete"],
      ["eq", "id", "6f1c0e3a-0000-4000-8000-0000000000aa"],
      ["select", "id"],
    ]);
  });

  it("throws on a refused write, naming the action", async () => {
    const { client } = tableFake(
      { data: [], error: null },
      { data: null, error: { message: "permission denied", code: "42501" } },
    );
    await expect(new SupabaseLeadAdminService(client).setStatus("x", "closed")).rejects.toThrow(
      /leads status failed: permission denied/,
    );
  });

  it("throws when nothing changed — a write the access rules refuse returns no error", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: [], error: null });
    await expect(new SupabaseLeadAdminService(client).remove("x")).rejects.toThrow(
      "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת",
    );
    await expect(new SupabaseLeadAdminService(client).setStatus("x", "closed")).rejects.toThrow("הפעולה לא בוצעה");
  });
});

describe("SupabaseLeadAdminService — claim-document links and assignment (agency roles)", () => {
  /** A functions client that answers `answer`, recording what was asked. */
  const functionsOf = (answer: { data: unknown; error: { message: string; context?: unknown } | null }) => {
    const invoke = vi.fn().mockResolvedValue(answer);
    return { client: { functions: { invoke } }, invoke };
  };
  const token = async () => "session-token";
  const ref = "storage:claim-documents/00000000-0000-0000-0000-000000000001/abc-tz.pdf";
  const LEAD = "bbbbbbbb-0000-4000-8000-000000000001";

  it("asks claim-document-link, as the person, for this lead's document", async () => {
    const { client } = tableFake({ data: [], error: null });
    const f = functionsOf({ data: { ok: true, url: "https://project.supabase.co/signed" }, error: null });
    const link = await new SupabaseLeadAdminService(client, f.client, token).documentLink(ref, LEAD);
    expect(link).toBe("https://project.supabase.co/signed");
    expect(f.invoke).toHaveBeenCalledWith("claim-document-link", {
      body: { leadId: LEAD, path: "00000000-0000-0000-0000-000000000001/abc-tz.pdf" },
      headers: { Authorization: "Bearer session-token" },
    });
  });

  it("a document ref outside claim-documents is refused", async () => {
    const { client } = tableFake({ data: [], error: null });
    const f = functionsOf({ data: null, error: null });
    await expect(
      new SupabaseLeadAdminService(client, f.client, token).documentLink("https://base44.app/api/files/tz.pdf", LEAD),
    ).rejects.toThrow("לא ניתן לפתוח את המסמך");
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("says the function's own refusal — another User's lead, or a document not on it", async () => {
    const { client } = tableFake({ data: [], error: null });
    const context = new Response(JSON.stringify({ error: "אין לך הרשאה לפעולה הזו.", rid: "r1" }), { status: 403 });
    const f = functionsOf({ data: null, error: { message: "non-2xx", context } });
    await expect(new SupabaseLeadAdminService(client, f.client, token).documentLink(ref, LEAD)).rejects.toThrow("אין לך הרשאה");
  });

  it("asks nothing without a session", async () => {
    const { client } = tableFake({ data: [], error: null });
    const f = functionsOf({ data: null, error: null });
    await expect(new SupabaseLeadAdminService(client, f.client, async () => null).documentLink(ref, LEAD)).rejects.toThrow("נדרשת התחברות");
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("assigns through assign-lead, and back to the queue with null", async () => {
    const { client } = tableFake({ data: [], error: null });
    const f = functionsOf({ data: { ok: true, mailed: true }, error: null });
    const service = new SupabaseLeadAdminService(client, f.client, token);
    expect(await service.assign(LEAD, "u2")).toEqual({ mailed: true });
    expect(f.invoke).toHaveBeenLastCalledWith("assign-lead", { body: { leadId: LEAD, userId: "u2" }, headers: { Authorization: "Bearer session-token" } });
    await service.assign(LEAD, null);
    expect(f.invoke).toHaveBeenLastCalledWith("assign-lead", { body: { leadId: LEAD, userId: null }, headers: { Authorization: "Bearer session-token" } });
  });

  it("counts open leads nobody works, by ids only", async () => {
    const { client, calls } = tableFake({ data: [{ id: "a" }, { id: "b" }], error: null });
    expect(await new SupabaseLeadAdminService(client).countUnassigned()).toBe(2);
    expect(calls).toContainEqual(["is", "merged_into", null]);
    expect(calls).toContainEqual(["select", "id"]);
    expect(calls).toContainEqual(["is", "assigned_user_id", null]);
    expect(calls).toContainEqual(["not", "status", "eq", "closed"]);
  });
});

/** A client whose answer depends on the table — the transcript reads two. Any write is a test failure. */
function byTable(answers: Record<string, SupabaseReadResult>) {
  const calls: unknown[][] = [];
  const query = (table: string): SupabaseQuery => {
    // `not … is null` and `limit` are applied to the canned rows, as PostgREST would; eq/order are only recorded.
    let rows = answers[table].data;
    const q: SupabaseQuery = {
      eq: (c, v) => (calls.push([table, "eq", c, v]), q),
      or: (f) => (calls.push([table, "or", f]), q),
      is: (c, v) => (calls.push([table, "is", c, v]), q),
      not: (c, op, v) => {
        calls.push([table, "not", c, op, v]);
        if (rows && op === "is" && v === null) rows = rows.filter((row) => (row as Record<string, unknown>)[c] != null);
        return q;
      },
      order: (c, o) => (calls.push([table, "order", c, o]), q),
      limit: (n) => {
        calls.push([table, "limit", n]);
        if (rows) rows = rows.slice(0, n);
        return q;
      },
      then: (f, r) => Promise.resolve({ ...answers[table], data: rows }).then(f, r),
    };
    return q;
  };
  const refuse = (table: string, verb: string) => () => {
    calls.push([table, verb]);
    throw new Error(`${verb} on ${table}`);
  };
  const client = {
    from: (table: string) => ({ select: () => query(table), update: refuse(table, "update"), delete: refuse(table, "delete") }),
  } as unknown as SupabaseLeadTableClient;
  return { client, calls };
}

describe("SupabaseLeadAdminService.transcript", () => {
  it("reads the lead's latest conversation, oldest message first, without the tool rows", async () => {
    const { client, calls } = byTable({
      chat_conversations: { data: [{ id: "c1" }], error: null },
      chat_messages: {
        data: [
          { role: "user", content: "שלום", created_at: "2026-10-13T09:00:00Z" },
          { role: "tool", content: "submitLead: ok", created_at: "2026-10-13T09:01:00Z" },
          { role: "assistant", content: "נשמר", created_at: "2026-10-13T09:01:00Z" },
        ],
        error: null,
      },
    });
    expect(await new SupabaseLeadAdminService(client).transcript("lead-1")).toEqual([
      { role: "user", content: "שלום", at: "2026-10-13T09:00:00Z" },
      { role: "assistant", content: "נשמר", at: "2026-10-13T09:01:00Z" },
    ]);
    expect(calls).toContainEqual(["chat_conversations", "eq", "lead_id", "lead-1"]);
    expect(calls).toContainEqual(["chat_messages", "eq", "conversation_id", "c1"]);
    expect(calls).toContainEqual(["chat_messages", "order", "id", { ascending: true }]);
  });

  it("is empty for a lead with no conversation", async () => {
    const { client } = byTable({ chat_conversations: { data: [], error: null }, chat_messages: { data: [], error: null } });
    expect(await new SupabaseLeadAdminService(client).transcript("lead-2")).toEqual([]);
  });

  it("throws on a refused read rather than showing an empty transcript", async () => {
    const { client } = byTable({ chat_conversations: { data: null, error: { message: "permission denied" } }, chat_messages: { data: [], error: null } });
    await expect(new SupabaseLeadAdminService(client).transcript("lead-3")).rejects.toThrow(/chat_conversations read failed/);
  });

  it("never writes: reading a transcript or the link list touches no update or delete", async () => {
    const { client, calls } = byTable({
      chat_conversations: { data: [{ id: "c1", lead_id: "lead-1" }], error: null },
      chat_messages: { data: [{ role: "user", content: "x", created_at: "t" }], error: null },
    });
    const s = new SupabaseLeadAdminService(client);
    await s.transcript("lead-1");
    await s.transcriptLeadIds();
    expect(calls.filter((c) => c[1] === "update" || c[1] === "delete")).toEqual([]);
  });

  it("returns message text untouched, markup and all, for the screen to show as text", async () => {
    const hostile = '<img src=x onerror=alert(1)> **bold** [a](javascript:alert(1))';
    const { client } = byTable({
      chat_conversations: { data: [{ id: "c1" }], error: null },
      chat_messages: { data: [{ role: "user", content: hostile, created_at: "t" }], error: null },
    });
    expect((await new SupabaseLeadAdminService(client).transcript("l"))[0].content).toBe(hostile);
  });
});

describe("SupabaseLeadAdminService.transcriptLeadIds", () => {
  it("lists each lead that has a conversation once, skipping conversations without a lead", async () => {
    const { client } = byTable({
      chat_conversations: { data: [{ lead_id: "a" }, { lead_id: null }, { lead_id: "b" }, { lead_id: "a" }], error: null },
      chat_messages: { data: [], error: null },
    });
    expect(await new SupabaseLeadAdminService(client).transcriptLeadIds()).toEqual(["a", "b"]);
  });

  it("finds an older linked conversation behind a thousand newer ones without a lead", async () => {
    const unlinked = Array.from({ length: 1000 }, () => ({ lead_id: null }));
    const { client, calls } = byTable({ chat_conversations: { data: [...unlinked, { lead_id: "older" }], error: null }, chat_messages: { data: [], error: null } });
    expect(await new SupabaseLeadAdminService(client).transcriptLeadIds()).toEqual(["older"]);
    expect(calls).toContainEqual(["chat_conversations", "not", "lead_id", "is", null]);
  });

  it("throws on a refused read", async () => {
    const { client } = byTable({ chat_conversations: { data: null, error: { message: "denied" } }, chat_messages: { data: [], error: null } });
    await expect(new SupabaseLeadAdminService(client).transcriptLeadIds()).rejects.toThrow(/chat_conversations read failed/);
  });
});

describe("SupabaseLeadAdminService.countNew", () => {
  it("counts the leads that need someone — new or escalated — reading their ids alone (review 2026-10-15)", async () => {
    const { client, calls } = byTable({ leads: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null } });
    expect(await new SupabaseLeadAdminService(client).countNew()).toBe(3);
    expect(calls).toContainEqual(["leads", "or", "status.eq.new,status.eq.escalated"]);
    expect(calls).toContainEqual(["leads", "is", "merged_into", null]);
    expect(calls).not.toContainEqual(["leads", "eq", "status", "new"]);
    expect(calls).toContainEqual(["leads", "limit", 1000]);
  });

  it("throws on a refused read rather than counting none", async () => {
    const { client } = byTable({ leads: { data: null, error: { message: "denied" } } });
    await expect(new SupabaseLeadAdminService(client).countNew()).rejects.toThrow(/leads read failed/);
  });
});

describe("SupabaseLeadAdminService.countOpenMeetingRequests", () => {
  it("counts clients' open requests to move or cancel a meeting", async () => {
    const { client, calls } = byTable({ meeting_requests: { data: [{ id: "r1" }, { id: "r2" }], error: null } });
    expect(await new SupabaseLeadAdminService(client).countOpenMeetingRequests()).toBe(2);
    expect(calls).toContainEqual(["meeting_requests", "eq", "status", "open"]);
    expect(calls).toContainEqual(["meeting_requests", "limit", 1000]);
  });

  it("throws on a refused read rather than counting none", async () => {
    const { client } = byTable({ meeting_requests: { data: null, error: { message: "denied" } } });
    await expect(new SupabaseLeadAdminService(client).countOpenMeetingRequests()).rejects.toThrow(/meeting_requests read failed/);
  });
});

/**
 * A lead's meetings (docs/superpowers/specs/2026-10-17-client-meetings-design.md,
 * Staff): read and written under the person's own session, so a write that
 * row-level security filters out must read as a failure, never as saved.
 */
describe("SupabaseLeadAdminService — a lead's meetings", () => {
  const meetingRow = (over: Record<string, unknown> = {}) => ({
    id: "m-1", scheduled_at: "2026-12-14T15:30:00+00:00", duration_min: 45, topic: "בדיקת כפלים",
    kind: "follow_up", status: "scheduled", mode: "video", location: "https://meet.example/x", notes: "פנימי",
    client_summary: null, summary_published_at: null, source: null, ...over,
  });

  /** One answer per table: the meetings read, then the open requests. */
  function twoTables(meetings: unknown[], requests: unknown[]) {
    const calls: unknown[][] = [];
    const chain = (data: unknown[]): SupabaseQuery => {
      const q: SupabaseQuery = {
        eq: (c, v) => (calls.push(["eq", c, v]), q),
        or: () => q, not: () => q, is: () => q,
        order: (c, o) => (calls.push(["order", c, o]), q),
        limit: () => q,
        then: (ok, bad) => Promise.resolve({ data, error: null } as SupabaseReadResult).then(ok, bad),
      };
      return q;
    };
    const client = {
      from: (table: string) => {
        calls.push(["from", table]);
        return { select: (cols: string) => (calls.push(["select", table, cols]), chain(table === "meetings" ? meetings : requests)) };
      },
    } as unknown as SupabaseLeadTableClient;
    return { client, calls };
  }

  it("reads one lead's meetings, newest first, with Dorit's notes and any open request on its meeting", async () => {
    const { client, calls } = twoTables(
      [meetingRow(), meetingRow({ id: "m-2", scheduled_at: null, kind: "first", source: "interview" })],
      [{ id: "r-1", meeting_id: "m-1", kind: "reschedule", note: "אחר הצהריים" }, { id: "r-9", meeting_id: "other-lead", kind: "cancel", note: null }],
    );
    const meetings = await new SupabaseLeadAdminService(client).meetings("lead-1");
    expect(calls).toContainEqual(["eq", "lead_id", "lead-1"]);
    expect(calls).toContainEqual(["order", "scheduled_at", { ascending: false }]);
    expect(calls).toContainEqual(["eq", "status", "open"]);
    expect(meetings.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(meetings[0]).toMatchObject({ notes: "פנימי", durationMin: 45, mode: "video", openRequest: { id: "r-1", kind: "reschedule", note: "אחר הצהריים" } });
    expect(meetings[1]).toMatchObject({ scheduledAt: null, source: "interview", openRequest: null });
  });

  it("puts a meeting with no time last, where Postgres's descending order puts it first", async () => {
    const { client } = twoTables([meetingRow({ id: "none", scheduled_at: null }), meetingRow({ id: "dated" })], []);
    const meetings = await new SupabaseLeadAdminService(client).meetings("lead-1");
    expect(meetings.map((m) => m.id)).toEqual(["dated", "none"]);
  });

  it("adds a meeting in the lead's own agency, and asks for the row back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, { data: [{ id: "m-new" }], error: null });
    await new SupabaseLeadAdminService(client).addMeeting({
      leadId: "lead-1", agencyId: "agency-1", scheduledAt: "2026-12-14T15:30:00.000Z", durationMin: 45,
      mode: "office", location: "", kind: "annual_review", topic: "סקירה שנתית",
    });
    expect(calls).toContainEqual(["from", "meetings"]);
    const insert = calls.find((c) => c[0] === "insert")![1] as Record<string, unknown>;
    expect(insert).toMatchObject({ lead_id: "lead-1", agency_id: "agency-1", kind: "annual_review", status: "scheduled", location: null });
    // created_by is the column's default (auth.uid()); the policy holds it to the caller.
    expect(insert).not.toHaveProperty("created_by");
  });

  it("reports an insert row-level security refused as a failure, not as added", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: [], error: null });
    await expect(
      new SupabaseLeadAdminService(client).addMeeting({
        leadId: "lead-1", agencyId: "agency-1", scheduledAt: "x", durationMin: 45, mode: "office", location: "", kind: "other", topic: "",
      }),
    ).rejects.toThrow(/לא בוצעה/);
  });

  it("publishes and unpublishes a summary by its column names, on one meeting", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, { data: [{ id: "m-1" }], error: null });
    const service = new SupabaseLeadAdminService(client);
    await service.updateMeeting("m-1", { clientSummary: "סיכמנו", summaryPublishedAt: "2026-10-17T09:00:00.000Z" });
    await service.updateMeeting("m-1", { summaryPublishedAt: null });
    const updates = calls.filter((c) => c[0] === "update").map((c) => c[1]);
    expect(updates).toEqual([
      { client_summary: "סיכמנו", summary_published_at: "2026-10-17T09:00:00.000Z" },
      { summary_published_at: null },
    ]);
    expect(calls).toContainEqual(["eq", "id", "m-1"]);
  });

  it("reports an update that changed nothing — another User's lead — as a failure", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: [], error: null });
    await expect(new SupabaseLeadAdminService(client).updateMeeting("m-1", { status: "done" })).rejects.toThrow(/לא בוצעה/);
  });

  it("marks a client's request handled, and nothing else", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, { data: [{ id: "r-1" }], error: null });
    await new SupabaseLeadAdminService(client).handleMeetingRequest("r-1");
    expect(calls).toContainEqual(["from", "meeting_requests"]);
    const update = calls.find((c) => c[0] === "update")![1] as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual(["handled_at", "status"]);
    expect(update.status).toBe("handled");
  });
});

/**
 * The agenda on /admin/leads ("פגישות"): one read of the agency's meetings,
 * with each lead's name and assignee and its requests embedded. Under the
 * person's own session — can_see_lead decides the rows; nothing here filters
 * by role.
 */
describe("SupabaseLeadAdminService.agencyMeetings", () => {
  const agendaRow = (over: Record<string, unknown> = {}) => ({
    id: "m-1",
    lead_id: "lead-1",
    scheduled_at: "2026-10-20T07:00:00+00:00",
    duration_min: 45,
    topic: "פנסיה",
    kind: "follow_up",
    status: "scheduled",
    mode: "office",
    location: "רחוב הרצל 1",
    summary_published_at: null,
    source: null,
    lead: { name: "יעל כהן", assigned_user_id: "u-1" },
    meeting_requests: [],
    ...over,
  });

  it("reads the agency's meetings in one query, newest first, with the lead and requests embedded", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).agencyMeetings("agency-1");
    expect(calls[0]).toEqual(["from", "meetings"]);
    expect(calls).toContainEqual(["eq", "agency_id", "agency-1"]);
    expect(calls).toContainEqual(["order", "scheduled_at", { ascending: false }]);
    expect(calls.filter((c) => c[0] === "from")).toHaveLength(1);
    const select = String(calls.find((c) => c[0] === "select")![1]);
    // `leads!lead_id`: meetings has a second key to leads (lead_base44_id), so the embed names its own.
    expect(select).toContain("lead:leads!lead_id(name,assigned_user_id)");
    expect(select).toContain("meeting_requests(id,kind,note,status)");
  });

  it("leaves Dorit's notes and the summary's text out of the agenda", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client).agencyMeetings("agency-1");
    const columns = String(calls.find((c) => c[0] === "select")![1]).split(",");
    expect(columns).not.toContain("notes");
    expect(columns).not.toContain("client_summary");
  });

  it("hands back each meeting with its lead's name and assignee, and its open request only", async () => {
    const { client } = tableFake({
      data: [
        agendaRow({
          meeting_requests: [
            { id: "r-old", kind: "cancel", note: "", status: "handled" },
            { id: "r-1", kind: "reschedule", note: "אחר הצהריים", status: "open" },
          ],
        }),
        agendaRow({ id: "m-2", lead_id: "lead-2", lead: { name: "דן", assigned_user_id: null } }),
      ],
      error: null,
    });
    const [first, second] = await new SupabaseLeadAdminService(client).agencyMeetings("agency-1");
    expect(first).toMatchObject({
      id: "m-1", leadId: "lead-1", leadName: "יעל כהן", assignedUserId: "u-1", durationMin: 45, location: "רחוב הרצל 1",
      openRequest: { id: "r-1", kind: "reschedule", note: "אחר הצהריים" },
    });
    expect(first).not.toHaveProperty("notes");
    expect(second).toMatchObject({ leadName: "דן", assignedUserId: null, openRequest: null });
  });

  it("puts a meeting with no time last, and survives a lead out of view", async () => {
    const { client } = tableFake({ data: [agendaRow({ id: "none", scheduled_at: null, lead: null }), agendaRow({ id: "dated" })], error: null });
    const meetings = await new SupabaseLeadAdminService(client).agencyMeetings("agency-1");
    expect(meetings.map((m) => m.id)).toEqual(["dated", "none"]);
    expect(meetings[1]).toMatchObject({ leadName: "", assignedUserId: null });
  });

  it("throws on a failed read rather than showing an empty agenda", async () => {
    const { client } = tableFake({ data: null, error: { message: "permission denied for table meetings", code: "42501" } });
    await expect(new SupabaseLeadAdminService(client).agencyMeetings("agency-1")).rejects.toThrow(/meetings read failed/);
  });
});

describe("SupabaseLeadAdminService — staff-created leads", () => {
  const functionsOf = (answer: { data: unknown; error: { message: string; context?: unknown } | null }) => {
    const invoke = vi.fn().mockResolvedValue(answer);
    return { client: { functions: { invoke } }, invoke };
  };
  const token = async () => "session-token";
  const input = {
    agencyId: "a1",
    name: "דנה",
    phone: "050-0000000",
    intake: "phone" as const,
    status: "new" as const,
    notice: "verbal" as const,
  };
  const make = (f: ReturnType<typeof functionsOf>) => new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, f.client, token);

  it("createLead invokes create-lead with the input and the bearer token", async () => {
    const f = functionsOf({ data: { leadId: "L1", duplicate: null, noticeSent: true, rid: "r" }, error: null });
    expect(await make(f).createLead(input)).toEqual({ leadId: "L1", duplicate: null, noticeSent: true });
    expect(f.invoke).toHaveBeenCalledWith("create-lead", { body: input, headers: { Authorization: "Bearer session-token" } });
  });

  it("reports a hidden duplicate and a missing noticeSent as null", async () => {
    const f = functionsOf({ data: { leadId: "L1", duplicate: "hidden", rid: "r" }, error: null });
    expect(await make(f).createLead(input)).toEqual({ leadId: "L1", duplicate: "hidden", noticeSent: null });
  });

  it("resolves a 409 to a visible duplicate instead of throwing", async () => {
    const context = new Response(JSON.stringify({ duplicate: "visible", leadId: "L9", rid: "r" }), { status: 409 });
    const f = functionsOf({ data: null, error: { message: "non-2xx", context } });
    expect(await make(f).createLead(input)).toEqual({ leadId: "L9", duplicate: "visible", noticeSent: null });
  });

  it("throws the function's Hebrew error for the other refusals", async () => {
    const context = new Response(JSON.stringify({ error: "נשלחו יותר מדי פניות.", rid: "r" }), { status: 429 });
    const f = functionsOf({ data: null, error: { message: "non-2xx", context } });
    await expect(make(f).createLead(input)).rejects.toThrow("נשלחו יותר מדי פניות.");
  });

  it("createLead needs a session", async () => {
    const f = functionsOf({ data: null, error: null });
    const service = new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, f.client, async () => null);
    await expect(service.createLead(input)).rejects.toThrow("נדרשת התחברות");
  });

  it("clearDuplicate sets possible_duplicate to false on that lead, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [], error: null }, { data: [{ id: "L1" }], error: null });
    await new SupabaseLeadAdminService(client).clearDuplicate("L1");
    expect(calls).toEqual([["from", "leads"], ["update", { possible_duplicate: false }], ["eq", "id", "L1"], ["select", "id"]]);
  });

  it("clearDuplicate throws when no row came back", async () => {
    const { client } = tableFake({ data: [], error: null }, { data: [], error: null });
    await expect(new SupabaseLeadAdminService(client).clearDuplicate("L1")).rejects.toThrow("הפעולה לא בוצעה");
  });

  it("with the flag on, selects the five staff columns and maps them", async () => {
    const row = leadRow({ source: "staff", brought_by: "u1", intake: "phone", referrer_note: "דוד", notice_method: "email", possible_duplicate: true });
    const { client, calls } = tableFake({ data: [row], error: null });
    const [lead] = await new SupabaseLeadAdminService(client, null, token, true).list();
    const select = String(calls.find((c) => c[0] === "select")![1]);
    for (const c of ["brought_by", "intake", "referrer_note", "notice_method", "possible_duplicate"]) expect(select.split(",")).toContain(c);
    expect(lead).toMatchObject({ broughtBy: "u1", intake: "phone", referrerNote: "דוד", noticeMethod: "email", possibleDuplicate: true });
  });

  it("with the flag on, an empty staff field maps to null and possibleDuplicate to false", async () => {
    const { client } = tableFake({ data: [leadRow({ brought_by: null, intake: null, referrer_note: null, notice_method: null, possible_duplicate: false })], error: null });
    const [lead] = await new SupabaseLeadAdminService(client, null, token, true).list();
    expect(lead).toMatchObject({ broughtBy: null, intake: null, referrerNote: null, noticeMethod: null, possibleDuplicate: false });
  });

  it("with the flag off, selects exactly today's columns and adds no staff fields", async () => {
    const { client, calls } = tableFake({ data: [leadRow()], error: null });
    const [lead] = await new SupabaseLeadAdminService(client, null, token, false).list();
    expect(calls.find((c) => c[0] === "select")![1]).toBe(
      "id,name,phone,email,source,topic,timing,message,status,created_at,agency_id,assigned_user_id,merged_into,next_follow_up_on,channel,campaign",
    );
    expect(lead).not.toHaveProperty("possibleDuplicate");
    expect(lead).not.toHaveProperty("broughtBy");
  });
});

describe("SupabaseLeadAdminService — merging duplicates", () => {
  const withRpc = (answer: { data: unknown; error: { message: string } | null }) => {
    const { client } = tableFake({ data: [], error: null });
    const rpc = vi.fn(async () => answer);
    return { client: { ...client, rpc } as SupabaseLeadTableClient, rpc };
  };

  it("reads merged_into as mergedInto, and null when the lead stands alone", async () => {
    const { client } = tableFake({ data: [leadRow({ merged_into: "main-1" }), leadRow({ id: "x", merged_into: null })], error: null });
    const [merged, alone] = await new SupabaseLeadAdminService(client).list();
    expect(merged.mergedInto).toBe("main-1");
    expect(merged).not.toHaveProperty("merged_into");
    expect(alone.mergedInto).toBeNull();
  });

  it("merges through merge_leads as the person, and says how many it folded", async () => {
    const { client, rpc } = withRpc({ data: 2, error: null });
    expect(await new SupabaseLeadAdminService(client).mergeLeads("main", ["a", "b"])).toBe(2);
    expect(rpc).toHaveBeenCalledWith("merge_leads", { p_primary: "main", p_others: ["a", "b"] });
  });

  it("unmerges through unmerge_lead", async () => {
    const { client, rpc } = withRpc({ data: null, error: null });
    await new SupabaseLeadAdminService(client).unmergeLead("a");
    expect(rpc).toHaveBeenCalledWith("unmerge_lead", { p_id: "a" });
  });

  it("says a refusal in Hebrew", async () => {
    const { client } = withRpc({ data: null, error: { message: "forbidden" } });
    await expect(new SupabaseLeadAdminService(client).mergeLeads("main", ["a"])).rejects.toThrow("רק מנהל/ת בסוכנות");
  });
});

describe("SupabaseLeadAdminService — the pipeline: activity log, notes, follow-ups", () => {
  it("reads next_follow_up_on as nextFollowUpOn", async () => {
    const { client } = tableFake({ data: [leadRow({ next_follow_up_on: "2026-11-02" }), leadRow({ id: "y" })], error: null });
    const [planned, none] = await new SupabaseLeadAdminService(client).list();
    expect(planned.nextFollowUpOn).toBe("2026-11-02");
    expect(planned).not.toHaveProperty("next_follow_up_on");
    expect(none.nextFollowUpOn).toBeNull();
  });

  it("reads a lead's log newest first, in the port's shape", async () => {
    const { client, calls } = tableFake({
      data: [{ id: 7, kind: "status", actor_id: "u-1", from_value: "new", to_value: "contacted", note: null, at: "2026-10-25T10:00:00Z" }],
      error: null,
    });
    const [event] = await new SupabaseLeadAdminService(client).leadEvents("lead-1");
    expect(event).toEqual({ id: "7", kind: "status", actorId: "u-1", from: "new", to: "contacted", note: null, at: "2026-10-25T10:00:00Z" });
    expect(calls).toContainEqual(["from", "lead_events"]);
    expect(calls).toContainEqual(["eq", "lead_id", "lead-1"]);
    expect(calls).toContainEqual(["order", "at", { ascending: false }]);
  });

  it("adds a note through add_lead_note, and says a refused one in Hebrew", async () => {
    const { client } = tableFake({ data: [], error: null });
    const rpc = vi.fn(async () => ({ data: 12, error: null }));
    await new SupabaseLeadAdminService({ ...client, rpc } as SupabaseLeadTableClient).addLeadNote("lead-1", "נקבעה שיחה");
    expect(rpc).toHaveBeenCalledWith("add_lead_note", { p_lead_id: "lead-1", p_note: "נקבעה שיחה" });
    const refusing = vi.fn(async () => ({ data: null, error: { message: "field_invalid" } }));
    await expect(
      new SupabaseLeadAdminService({ ...client, rpc: refusing } as SupabaseLeadTableClient).addLeadNote("lead-1", "ת.ז. 123456789"),
    ).rejects.toThrow("אין לכתוב בהערה מספר זהות");
  });

  it("sets and clears the follow-up on that lead, and asks for it back", async () => {
    const { client, calls } = tableFake({ data: [{ id: "lead-1" }], error: null });
    const service = new SupabaseLeadAdminService(client);
    await service.setFollowUp("lead-1", "2026-11-02");
    await service.setFollowUp("lead-1", null);
    expect(calls).toContainEqual(["update", { next_follow_up_on: "2026-11-02" }]);
    expect(calls).toContainEqual(["update", { next_follow_up_on: null }]);
  });
});

describe("SupabaseLeadAdminService — WhatsApp", () => {
  it("logs a message through log_lead_whatsapp, with the lead id only", async () => {
    const { client } = tableFake({ data: [], error: null });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await new SupabaseLeadAdminService({ ...client, rpc } as SupabaseLeadTableClient).logWhatsapp("lead-1");
    expect(rpc).toHaveBeenCalledWith("log_lead_whatsapp", { p_lead_id: "lead-1" });
  });
});

describe("SupabaseLeadAdminService — campaigns", () => {
  it("reads a lead's channel and campaign", async () => {
    const { client } = tableFake({ data: [leadRow({ channel: "reactivation", campaign: "k7x2m9qa1b2c" })], error: null });
    const [lead] = await new SupabaseLeadAdminService(client).list();
    expect(lead.channel).toBe("reactivation");
    expect(lead.campaign).toBe("k7x2m9qa1b2c");
  });
});

describe("SupabaseLeadAdminService — staff-added clients (VITE_STAFF_CLIENTS)", () => {
  const functionsOf = (answer: { data: unknown; error: { message: string; context?: unknown } | null }) => {
    const invoke = vi.fn().mockResolvedValue(answer);
    return { client: { functions: { invoke } }, invoke };
  };
  const token = async () => "session-token";
  const withRpc = (answer: { data: unknown; error: { message: string } | null }) => {
    const { client } = tableFake({ data: [], error: null });
    const rpc = vi.fn(async () => answer);
    return { client: { ...client, rpc } as SupabaseLeadTableClient, rpc };
  };

  it("asks for opened_as, client_since and products only with the switch on", async () => {
    const off = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(off.client, null, token, true, false).list();
    const offCols = String(off.calls.find((c) => c[0] === "select")![1]).split(",");
    for (const col of ["opened_as", "client_since", "products"]) expect(offCols).not.toContain(col);
    const on = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(on.client, null, token, true, true).list();
    const onCols = String(on.calls.find((c) => c[0] === "select")![1]).split(",");
    for (const col of ["opened_as", "client_since", "products"]) expect(onCols).toContain(col);
  });

  it("reads a client's fields as openedAs, a YYYY-MM clientSince and products", async () => {
    const { client } = tableFake({
      data: [
        leadRow({ opened_as: "client", client_since: "2019-03-01", products: ["pension", "health"], status: "client" }),
        leadRow({ id: "plain", opened_as: "lead", client_since: null, products: null }),
      ],
      error: null,
    });
    const [added, plain] = await new SupabaseLeadAdminService(client, null, token, true, true).list();
    expect(added).toMatchObject({ openedAs: "client", clientSince: "2019-03", products: ["pension", "health"] });
    expect(added).not.toHaveProperty("client_since");
    expect(added).not.toHaveProperty("opened_as");
    expect(plain).toMatchObject({ openedAs: "lead", clientSince: null, products: null });
  });

  it("sends a client's kind, month and products to create-lead, and passes `next` back", async () => {
    const f = functionsOf({ data: { leadId: "L1", duplicate: null, noticeSent: null, next: { invite: true, masleka: false }, rid: "r" }, error: null });
    const service = new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, f.client, token);
    const input = { agencyId: "a1", name: "רחל", phone: "0501110010", intake: "existing_client" as const, status: "client" as const,
      notice: "agreement" as const, kind: "client" as const, clientSince: "2019-03", products: ["pension" as const] };
    expect(await service.createLead(input)).toEqual({ leadId: "L1", duplicate: null, noticeSent: null, next: { invite: true, masleka: false } });
    expect(f.invoke).toHaveBeenCalledWith("create-lead", { body: input, headers: { Authorization: "Bearer session-token" } });
  });

  it("converts through convert_lead_to_client with the month's first day, and returns the id it converted", async () => {
    const { client, rpc } = withRpc({ data: "main-1", error: null });
    expect(await new SupabaseLeadAdminService(client).convertToClient("merged-1", "2019-03", ["life"])).toBe("main-1");
    expect(rpc).toHaveBeenCalledWith("convert_lead_to_client", { p_lead_id: "merged-1", p_client_since: "2019-03-01", p_products: ["life"] });
  });

  it.each([
    ["not_found", "הפעולה לא בוצעה"],
    ["bad_since", "החודש"],
    ["bad_products", "תחום"],
  ])("says the conversion's %s in Hebrew", async (reason, text) => {
    const { client } = withRpc({ data: null, error: { message: reason } });
    await expect(new SupabaseLeadAdminService(client).convertToClient("x", "2019-03", ["life"])).rejects.toThrow(text);
  });

  it("invites through invite-client as the person, and throws its Hebrew refusal", async () => {
    const ok = functionsOf({ data: { sent: true, rid: "r" }, error: null });
    await new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, ok.client, token).inviteClient("a1", "L1");
    expect(ok.invoke).toHaveBeenCalledWith("invite-client", { body: { agencyId: "a1", leadId: "L1" }, headers: { Authorization: "Bearer session-token" } });
    const context = new Response(JSON.stringify({ error: "כבר נשלחה הזמנה ללקוח/ה הזה/הזו.", rid: "r" }), { status: 409 });
    const refused = functionsOf({ data: null, error: { message: "non-2xx", context } });
    await expect(
      new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, refused.client, token).inviteClient("a1", "L1"),
    ).rejects.toThrow("כבר נשלחה הזמנה");
  });
});
