// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";

/*
 * "דורשות טיפול" on /admin/leads (review 2026-10-15, item 17): a visitor who
 * asked for Dorit herself (`escalated`) needs someone as much as a new lead,
 * so the card counts both and its filter shows both.
 */
const h = vi.hoisted(() => ({
  leads: [
    { id: "l-1", name: "דנה", phone: "050", source: "quick", status: "new", topic: "פנסיה", created_date: "2026-10-10T08:00:00Z" },
    { id: "l-2", name: "יוסי", phone: "051", source: "chat", status: "escalated", topic: "ביטוח", created_date: "2026-10-11T08:00:00Z" },
    { id: "l-3", name: "רונית", phone: "052", source: "quick", status: "contacted", topic: "חיסכון", created_date: "2026-10-12T08:00:00Z" },
    { id: "l-4", name: "אבי", phone: "053", source: "chat", status: "partial", topic: "פנסיה", created_date: "2026-10-13T08:00:00Z" },
  ],
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAdminUsers: () => ({ data: [] }),
  useTranscriptLeadIds: () => ({ data: [] }),
  useLeadTranscript: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: { documentLink: vi.fn() } } }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => null }));
const role = vi.hoisted(() => ({ role: "owner", isOperator: true }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

describe("דורשות טיפול on /admin/leads", () => {
  it("counts the new and the escalated leads together", () => {
    render(<MemoryRouter><Leads /></MemoryRouter>);
    const card = screen.getByText("דורשות טיפול").closest("button")!;
    expect(within(card).getByText("2")).toBeTruthy();
  });

  it("shows the new and the escalated leads when clicked, and no other", () => {
    render(<MemoryRouter><Leads /></MemoryRouter>);
    fireEvent.click(screen.getByText("דורשות טיפול").closest("button")!);
    expect(screen.getAllByText("דנה").length).toBeGreaterThan(0);
    expect(screen.getAllByText("יוסי").length).toBeGreaterThan(0);
    expect(screen.queryByText("רונית")).toBeNull();
    expect(screen.queryByText("אבי")).toBeNull();
  });
});
