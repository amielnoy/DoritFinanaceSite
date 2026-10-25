// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Duplicate leads on /admin/leads (feature 1): leads that share a phone or an
 * email show as one row with "כפילות (N)"; the row opens to every submission;
 * "מזג" (Admin+) folds them into one, and a merged lead can be taken out again.
 */
const h = vi.hoisted(() => ({
  leads: [] as Record<string, unknown>[],
  merge: vi.fn(),
  unmerge: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMergeLeads: () => ({ mutate: h.merge, isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: h.unmerge, isPending: false, error: null }),
  useLeadEvents: () => ({ data: [], isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useLogWhatsapp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAgencyProfile: () => ({ data: undefined }),
  useCampaigns: () => ({ data: [] }),
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
const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, phone: "", source: "quick", status: "new", topic: "פנסיה", agency_id: AGENCY,
  created_date: "2026-10-10T08:00:00Z", ...over,
});

const show = () => render(<MemoryRouter><Leads /></MemoryRouter>);

describe("duplicate leads on /admin/leads", () => {
  beforeEach(() => {
    h.merge.mockReset();
    h.unmerge.mockReset();
    role.role = "admin";
    h.leads = [
      lead("old", "אבי ישן", { phone: "054-1234567", status: "contacted", created_date: "2026-09-01T08:00:00Z" }),
      lead("new", "אבי חדש", { phone: "+972541234567", created_date: "2026-10-20T08:00:00Z" }),
      lead("solo", "דנה", { phone: "050-0000000", email: "dana@example.com" }),
    ];
  });

  it("shows two submissions of one phone as one row, under the newest, with the count", () => {
    show();
    expect(screen.getByText("אבי חדש")).toBeTruthy();
    expect(screen.queryByText("אבי ישן")).toBeNull();
    expect(screen.getByRole("button", { name: /כפילות \(2\)/ })).toBeTruthy();
    expect(screen.getByText("2 פניות להצגה")).toBeTruthy();
  });

  it("opens the row to every submission", () => {
    show();
    const badge = screen.getByRole("button", { name: /כפילות \(2\)/ });
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(badge);
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("אבי ישן")).toBeTruthy();
  });

  it("merges into the oldest lead when an Admin clicks מזג", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /מזג/ }));
    expect(h.merge).toHaveBeenCalledWith({ primaryId: "old", otherIds: ["new"] }, expect.anything());
  });

  it("groups by email too, ignoring case", () => {
    h.leads = [
      lead("a", "רונית", { email: "Ronit@Example.com", created_date: "2026-10-01T08:00:00Z" }),
      lead("b", "רונית כהן", { email: "ronit@example.com ", created_date: "2026-10-02T08:00:00Z" }),
    ];
    show();
    expect(screen.getByRole("button", { name: /כפילות \(2\)/ })).toBeTruthy();
  });

  it("offers no merge to a User", () => {
    role.role = "user";
    show();
    expect(screen.getByRole("button", { name: /כפילות \(2\)/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /מזג/ })).toBeNull();
  });

  it("folds a merged lead under its main one, out of the counts, and can take it out again", () => {
    h.leads = [
      lead("main", "יעל", { phone: "0521111111", created_date: "2026-09-01T08:00:00Z" }),
      lead("child", "יעל שוב", { phone: "0521111111", mergedInto: "main", created_date: "2026-10-01T08:00:00Z" }),
    ];
    show();
    expect(screen.getByText("1 פניות להצגה")).toBeTruthy();
    expect(screen.queryByText("יעל שוב")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /מוזגו 1/ }));
    expect(screen.getByText("יעל שוב")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /מזג/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ביטול מיזוג" }));
    expect(h.unmerge).toHaveBeenCalledWith("child");
  });

  it("does not group leads with no phone and no email", () => {
    h.leads = [lead("x", "בלי פרטים א"), lead("y", "בלי פרטים ב")];
    show();
    expect(screen.queryByRole("button", { name: /כפילות/ })).toBeNull();
    expect(screen.getByText("2 פניות להצגה")).toBeTruthy();
  });
});
