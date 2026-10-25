import { describe, expect, it } from "vitest";
import {
  ANY_STATUS_LABEL,
  IN_PROGRESS,
  STATUS,
  STATUS_LABEL,
  canChooseStatus,
  followUpState,
  isUrgent,
  slaBreached,
} from "@/lib/lead-pipeline";
import type { LeadRecord } from "@/services/ports";

const lead = (over: Partial<LeadRecord> = {}): LeadRecord => ({
  id: "l1",
  name: "דנה",
  phone: "0541234567",
  source: "quick",
  status: "new",
  created_date: "2026-10-25T06:00:00Z",
  ...over,
});
const urgent = "דחיפות: דחוף — אשמח לשיחה השבוע";

describe("the pipeline", () => {
  it("runs חדשה → נוצר קשר → נקבעה פגישה → נשלחה הצעה → נסגר / לא רלוונטי", () => {
    expect(STATUS).toEqual(["new", "contacted", "meeting_set", "proposal_sent", "client", "closed"]);
    expect(STATUS.map((s) => STATUS_LABEL[s])).toEqual([
      "חדשה", "נוצר קשר", "נקבעה פגישה", "נשלחה הצעה", "נסגר (לקוח/ה)", "לא רלוונטי",
    ]);
  });

  it("labels the statuses only the backend writes, and offers neither", () => {
    expect(ANY_STATUS_LABEL.escalated).toBe("הועברה לטיפול אישי");
    expect(ANY_STATUS_LABEL.partial).toBe("ראיון שלא הושלם");
    expect(canChooseStatus("new", "escalated")).toBe(false);
    expect(canChooseStatus("new", "partial")).toBe(false);
  });

  it("lets a lead move to any pipeline status, forwards or back, from anywhere", () => {
    expect(canChooseStatus("new", "proposal_sent")).toBe(true);
    expect(canChooseStatus("proposal_sent", "contacted")).toBe(true);
    expect(canChooseStatus("escalated", "contacted")).toBe(true);
    expect(canChooseStatus("partial", "closed")).toBe(true);
    expect(canChooseStatus("contacted", "contacted")).toBe(false);
  });

  it("counts contact, meeting and proposal as in progress", () => {
    expect([...IN_PROGRESS]).toEqual(["contacted", "meeting_set", "proposal_sent"]);
  });
});

describe("followUpState", () => {
  const today = "2026-10-25";
  it("is overdue before today, due today, later after, and nothing without a date", () => {
    expect(followUpState(lead({ nextFollowUpOn: "2026-10-24" }), today)).toBe("overdue");
    expect(followUpState(lead({ nextFollowUpOn: "2026-10-25" }), today)).toBe("today");
    expect(followUpState(lead({ nextFollowUpOn: "2026-10-26" }), today)).toBe("later");
    expect(followUpState(lead({ nextFollowUpOn: null }), today)).toBeNull();
    expect(followUpState(lead(), today)).toBeNull();
  });

  it("asks nothing of a lead that is done", () => {
    expect(followUpState(lead({ status: "client", nextFollowUpOn: "2026-10-01" }), today)).toBeNull();
    expect(followUpState(lead({ status: "closed", nextFollowUpOn: "2026-10-01" }), today)).toBeNull();
  });
});

describe("the urgent-lead SLA", () => {
  const at = (iso: string) => new Date(iso);

  it("reads urgency from the interview's דחיפות line", () => {
    expect(isUrgent(lead({ message: urgent }))).toBe(true);
    expect(isUrgent(lead({ message: "דחיפות: בחודשים הקרובים" }))).toBe(false);
    expect(isUrgent(lead({ message: "דאגה מרכזית: דחוף לי לדעת" }))).toBe(false);
    expect(isUrgent(lead())).toBe(false);
  });

  it("is breached once an urgent lead has been new for more than the threshold", () => {
    const l = lead({ message: urgent, created_date: "2026-10-25T06:00:00Z" });
    expect(slaBreached(l, at("2026-10-25T09:59:00Z"), 4)).toBe(false);
    expect(slaBreached(l, at("2026-10-25T10:00:00Z"), 4)).toBe(false);
    expect(slaBreached(l, at("2026-10-25T10:01:00Z"), 4)).toBe(true);
  });

  it("follows the configured threshold", () => {
    const l = lead({ message: urgent, created_date: "2026-10-25T06:00:00Z" });
    expect(slaBreached(l, at("2026-10-25T08:30:00Z"), 2)).toBe(true);
    expect(slaBreached(l, at("2026-10-25T08:30:00Z"), 8)).toBe(false);
  });

  it("is not breached once someone has acted, or for a lead that is not urgent", () => {
    const now = at("2026-10-26T06:00:00Z");
    expect(slaBreached(lead({ message: urgent, status: "contacted" }), now, 4)).toBe(false);
    expect(slaBreached(lead({ message: urgent, status: "escalated" }), now, 4)).toBe(false);
    expect(slaBreached(lead({ message: "דחיפות: רק בודק/ת כרגע" }), now, 4)).toBe(false);
  });

  it("is not breached for a lead without a readable date", () => {
    expect(slaBreached(lead({ message: urgent, created_date: "" }), at("2026-10-26T06:00:00Z"), 4)).toBe(false);
  });
});
