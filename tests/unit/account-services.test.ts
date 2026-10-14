import { describe, expect, it, vi } from "vitest";
import { toClientSnapshot, toEnquiry } from "@/services/account-mapping";
import { SupabaseAccountService } from "@/services/supabase/SupabaseAccountService";
import { AccountLoadError } from "@/services/ports";

const row = {
  created_at: "2026-10-06T07:55:18Z", source: "interview", track: "pension", track_label: "פנסיה, גמל והשתלמות",
  meeting_topic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduled_at: "2026-10-11T07:00:00Z",
  summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, in_calendar: true,
};

describe("toEnquiry", () => {
  it("maps a row to the page's shape", () => {
    expect(toEnquiry(row)).toEqual({
      createdAt: "2026-10-06T07:55:18Z", source: "interview", track: "pension", trackLabel: "פנסיה, גמל והשתלמות",
      meetingTopic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduledAt: "2026-10-11T07:00:00Z",
      summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, inCalendar: true,
    });
  });

  it("survives an old enquiry with no profile", () => {
    expect(toEnquiry({ ...row, profile: null, summary: null }).profile).toEqual([]);
  });

  it("drops a profile that is not label/value pairs rather than crashing", () => {
    expect(toEnquiry({ ...row, profile: { goal: "x" } }).profile).toEqual([]);
    expect(toEnquiry({ ...row, profile: [["ok", "1"], ["bad"], [1, 2], "x"] }).profile).toEqual([["ok", "1"]]);
  });
});

describe("SupabaseAccountService", () => {
  it("reads my_enquiries over RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const out = await new SupabaseAccountService({ rpc }).myEnquiries();
    expect(rpc).toHaveBeenCalledWith("my_enquiries");
    expect(out[0].trackLabel).toBe("פנסיה, גמל והשתלמות");
  });

  it("turns an RPC error into AccountLoadError", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(new SupabaseAccountService({ rpc }).myEnquiries()).rejects.toBeInstanceOf(AccountLoadError);
  });

  it.each(["42501", "PGRST301"])("names RPC error %s as signed out", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "x", code } });
    await expect(new SupabaseAccountService({ rpc }).myEnquiries()).rejects.toMatchObject({ reason: "signed_out" });
  });

  it("names an unrecognised RPC error code as failed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "x", code: "XX000" } });
    await expect(new SupabaseAccountService({ rpc }).myEnquiries()).rejects.toMatchObject({ reason: "failed" });
  });
});

/** What `my_snapshot()` answers: its four keys, the snapshot in `data`, the items with their six. */
const PUBLISHED = {
  taken_at: "2026-10-12T09:00:00Z",
  published_at: "2026-10-14T10:00:00Z",
  data: {
    takenAt: "2026-10-12T09:00:00Z",
    interfaceVersion: "9.0",
    client: { idLast4: "0018", age: 40, hasDependants: true },
    accounts: [{ id: "p1", kind: "pension", provider: "מגדל", planName: "x", active: true, balance: 300000, coverage: {} }],
  },
  items: [
    { id: "i1", title: "דמי ניהול", body: "נבקש הפחתה", priority: "important", client_status: "open", client_note: null },
    { id: "i2", title: "כיסוי", body: "נבדוק", priority: "check", client_status: "question", client_note: "מה זה?" },
    { id: "i3", title: "x", body: "y", priority: "urgent" },
  ],
};

describe("toClientSnapshot — the personal area's snapshot", () => {
  it("reads my_snapshot's answer, dropping an item that does not fit", () => {
    const s = toClientSnapshot(PUBLISHED)!;
    expect(s.publishedAt).toBe("2026-10-14T10:00:00Z");
    expect(s.snapshot.accounts).toHaveLength(1);
    expect(s.items.map((i) => [i.id, i.priority, i.clientStatus, i.clientNote])).toEqual([
      ["i1", "important", "open", null],
      ["i2", "check", "question", "מה זה?"],
    ]);
  });

  it("is null when nothing is published, or the report cannot be read", () => {
    expect(toClientSnapshot(null)).toBeNull();
    expect(toClientSnapshot({ ...PUBLISHED, data: { accounts: "x" } })).toBeNull();
    expect(toClientSnapshot({ ...PUBLISHED, published_at: null })).toBeNull();
  });
});

describe("SupabaseAccountService — the snapshot", () => {
  it("reads my_snapshot over RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: PUBLISHED, error: null });
    const s = await new SupabaseAccountService({ rpc }).mySnapshot();
    expect(rpc).toHaveBeenCalledWith("my_snapshot");
    expect(s?.items).toHaveLength(2);
    expect(await new SupabaseAccountService({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }).mySnapshot()).toBeNull();
  });

  it("sends an answer to respond_to_recommendation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await new SupabaseAccountService({ rpc }).respondToRecommendation("i2", "question", "מה זה?");
    expect(rpc).toHaveBeenCalledWith("respond_to_recommendation", { p_item: "i2", p_status: "question", p_note: "מה זה?" });
  });

  it("tells an unconfirmed address, another's recommendation and a sign-out apart", async () => {
    const answer = (error: { message: string; code?: string }) =>
      new SupabaseAccountService({ rpc: vi.fn().mockResolvedValue({ data: null, error }) }).respondToRecommendation("i1", "accepted");
    await expect(answer({ message: "unverified", code: "42501" })).rejects.toMatchObject({ reason: "unverified" });
    await expect(answer({ message: "not_found", code: "42501" })).rejects.toMatchObject({ reason: "failed" });
    await expect(answer({ message: "JWT expired", code: "PGRST301" })).rejects.toMatchObject({ reason: "signed_out" });
  });
});
