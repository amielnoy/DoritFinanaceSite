import { describe, expect, it, vi } from "vitest";
import { toEnquiry } from "@/services/account-mapping";
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
