// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";

/* "נסגר (לקוח/ה)" on /admin/leads (stored `client`): the status that keeps an enquiry from the 24-month anonymization. */
const h = vi.hoisted(() => ({
  leads: [
    { id: "l-1", name: "דנה", phone: "050", source: "quick", status: "contacted", topic: "פנסיה", created_date: "2026-10-10T08:00:00Z" },
    { id: "l-2", name: "יוסי", phone: "051", source: "quick", status: "client", topic: "ביטוח", created_date: "2026-10-11T08:00:00Z" },
  ],
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: h.mutate, isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useMergeLeads: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLeadEvents: () => ({ data: [], isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useLogWhatsapp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAgencyProfile: () => ({ data: undefined }),
  useCampaigns: () => ({ data: [] }),
  useLeadMeetings: () => ({ data: [], isPending: false, isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAdminUsers: () => ({ data: [] }),
  useTranscriptLeadIds: () => ({ data: [] }),
  useLeadTranscript: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: { documentLink: vi.fn() } } }));
// Rendered without an AuthProvider: nobody is signed in (useCurrentUserId reads useAuth).
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => null }));
// The person's role in the agency (src/hooks/useAgency.ts): full access unless a case narrows it.
const role = vi.hoisted(() => ({ role: "owner", isOperator: true }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

describe("the client status on /admin/leads", () => {
  it("offers נסגר (לקוח/ה), labels a client lead with it, and filters by it", () => {
    render(<MemoryRouter><Leads /></MemoryRouter>);
    expect(screen.getAllByText("נסגר (לקוח/ה)").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^נסגר \(לקוח\/ה\)/ }));
    expect(screen.queryByText("דנה")).toBeNull();
    expect(screen.getByText("יוסי")).toBeInTheDocument();
  });

  it("marks a lead as a client", () => {
    render(<MemoryRouter><Leads /></MemoryRouter>);
    const select = screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "contacted") as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "נסגר (לקוח/ה)" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "client" } });
    expect(h.mutate).toHaveBeenCalledWith({ id: "l-1", status: "client" });
  });
});
