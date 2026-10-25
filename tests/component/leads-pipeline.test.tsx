// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The lead pipeline on /admin/leads (feature 2): the six statuses, the "בתהליך"
 * card, follow-ups (overdue first, "לטיפול היום"), the urgent-lead SLA alert,
 * and the drawer's "פעילות" tab.
 */
const h = vi.hoisted(() => ({
  leads: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  setStatus: vi.fn(),
  addNote: vi.fn(),
  setFollowUp: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: h.setStatus, isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMergeLeads: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLeadEvents: () => ({ data: h.events, isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: h.addNote, isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: h.setFollowUp, isPending: false, isError: false }),
  useLogWhatsapp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAgencyProfile: () => ({ data: undefined }),
  useLeadMeetings: () => ({ data: [], isPending: false, isError: false }),
  useAdminUsers: () => ({ data: [] }),
  useTranscriptLeadIds: () => ({ data: [] }),
  useLeadTranscript: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: { documentLink: vi.fn() } } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => null }));
const role = vi.hoisted(() => ({ role: "admin", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

const AGENCY = "00000000-0000-0000-0000-000000000001";
// Sunday 25 October 2026, 12:00 in Israel (+02:00 after summer time ends).
const NOW = new Date("2026-10-25T10:00:00Z");
let phone = 0;
const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, phone: `05400000${String(++phone).padStart(2, "0")}`, source: "quick", status: "new", topic: "פנסיה",
  agency_id: AGENCY, created_date: "2026-10-20T08:00:00Z", ...over,
});
const URGENT = "דחיפות: דחוף — אשמח לשיחה השבוע";
const show = () => render(<MemoryRouter><Leads /></MemoryRouter>);
const rowNames = () =>
  screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("button")[0].textContent);

describe("the lead pipeline on /admin/leads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (const f of [h.setStatus, h.addNote, h.setFollowUp]) f.mockReset();
    h.events = [];
    h.leads = [
      lead("n1", "חדשה רגילה", { created_date: "2026-10-25T09:00:00Z" }),
      lead("c1", "בקשר", { status: "contacted", created_date: "2026-10-24T08:00:00Z" }),
      lead("m1", "עם פגישה", { status: "meeting_set", created_date: "2026-10-23T08:00:00Z" }),
      lead("p1", "קיבל הצעה", { status: "proposal_sent", created_date: "2026-10-22T08:00:00Z" }),
      lead("late", "מעקב שפוספס", { status: "contacted", nextFollowUpOn: "2026-10-22", created_date: "2026-10-01T08:00:00Z" }),
      lead("due", "מעקב היום", { status: "meeting_set", nextFollowUpOn: "2026-10-25", created_date: "2026-10-02T08:00:00Z" }),
    ];
  });
  afterEach(() => vi.useRealTimers());

  it("offers the six statuses in pipeline order", () => {
    show();
    const select = screen.getByRole("combobox", { name: "סטטוס הפנייה של חדשה רגילה" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "חדשה", "נוצר קשר", "נקבעה פגישה", "נשלחה הצעה", "נסגר (לקוח/ה)", "לא רלוונטי",
    ]);
    fireEvent.change(select, { target: { value: "proposal_sent" } });
    expect(h.setStatus).toHaveBeenCalledWith({ id: "n1", status: "proposal_sent" });
  });

  it("counts contact, meeting and proposal under בתהליך, and filters to them", () => {
    show();
    const card = screen.getByText("בתהליך").closest("button")!;
    expect(within(card).getByText("5")).toBeTruthy();
    fireEvent.click(card);
    expect(screen.queryByText("חדשה רגילה")).toBeNull();
    expect(screen.getByText("קיבל הצעה")).toBeTruthy();
  });

  it("puts an overdue follow-up at the top, in red, and shows today's", () => {
    show();
    expect(rowNames()[0]).toBe("מעקב שפוספס");
    expect(screen.getByText(/מעקב באיחור 22\.10$/)).toBeTruthy();
    expect(screen.getByText(/מעקב היום 25\.10$/)).toBeTruthy();
  });

  it("shows the late and today's follow-ups under לטיפול היום", () => {
    show();
    const chip = screen.getByRole("button", { name: /לטיפול היום/ });
    expect(within(chip).getByText("2")).toBeTruthy();
    fireEvent.click(chip);
    expect(rowNames().sort()).toEqual(["מעקב היום", "מעקב שפוספס"].sort());
  });

  it("alerts when an urgent lead has been new for more than 4 hours, and lists it", () => {
    h.leads.push(lead("u1", "דחוף ומחכה", { message: URGENT, created_date: "2026-10-25T05:00:00Z" }));
    h.leads.push(lead("u2", "דחוף וטרי", { message: URGENT, created_date: "2026-10-25T08:00:00Z" }));
    show();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("פנייה דחופה אחת ממתינה");
    expect(screen.getByText(/דחופה, ממתינה מעל 4 שעות/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "הצגה" }));
    expect(rowNames()).toEqual(["דחוף ומחכה"]);
  });

  it("raises no alert once someone has made contact", () => {
    h.leads.push(lead("u1", "דחוף בטיפול", { status: "contacted", message: URGENT, created_date: "2026-10-24T05:00:00Z" }));
    show();
    expect(screen.queryByText(/דחופה, ממתינה/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the lead's activity: the log, a note, and the next follow-up", () => {
    h.events = [
      { id: "2", kind: "status", actorId: null, from: "new", to: "contacted", note: null, at: "2026-10-24T09:00:00Z" },
      { id: "1", kind: "note", actorId: null, from: null, to: null, note: "ביקש שנחזור אחרי החגים", at: "2026-10-24T08:00:00Z" },
    ];
    show();
    fireEvent.click(screen.getByRole("button", { name: "בקשר" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "פעילות" }));
    expect(within(dialog).getByText("הסטטוס שונה מ״חדשה״ ל״נוצר קשר״")).toBeTruthy();
    expect(within(dialog).getByText("ביקש שנחזור אחרי החגים")).toBeTruthy();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "הערה חדשה" }), { target: { value: "נקבעה שיחה" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "הוספת הערה" }));
    expect(h.addNote).toHaveBeenCalledWith({ leadId: "c1", text: "נקבעה שיחה" }, expect.anything());

    fireEvent.change(within(dialog).getByLabelText("תאריך המעקב הבא"), { target: { value: "2026-11-01" } });
    expect(h.setFollowUp).toHaveBeenCalledWith({ leadId: "c1", on: "2026-11-01" });
  });
});
