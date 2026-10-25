/**
 * @vitest-environment jsdom
 *
 * The "שיחה" tab on /admin/leads: shown only for a lead with a conversation
 * behind it, read-only, and the visitor's words rendered as plain text. The
 * hooks are stubbed; the reads are covered in tests/unit/supabase-lead-admin.test.ts.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const HOSTILE = '<img src=x onerror=alert(1)> **bold** <b>tag</b>';
const h = vi.hoisted(() => ({
  leads: [
    { id: "l-chat", name: "דנה", phone: "050", source: "interview", status: "new", topic: "פנסיה", created_date: "2026-10-10T08:00:00Z" },
    { id: "l-form", name: "יוסי", phone: "051", source: "quick", status: "new", topic: "ביטוח", created_date: "2026-10-11T08:00:00Z" },
  ],
  ids: ["l-chat"] as string[],
  transcript: [{ role: "user", content: "", at: "t" }] as { role: string; content: string; at: string }[],
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useMergeLeads: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLeadEvents: () => ({ data: [], isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useLogWhatsapp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAgencyProfile: () => ({ data: undefined }),
  useLeadMeetings: () => ({ data: [], isPending: false, isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAdminUsers: () => ({ data: [] }),
  useTranscriptLeadIds: () => ({ data: h.ids }),
  useLeadTranscript: (_id: string, enabled: boolean) => ({ data: enabled ? h.transcript : undefined, isLoading: false, error: null }),
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: { documentLink: vi.fn() } } }));
// Rendered without an AuthProvider: nobody is signed in (useCurrentUserId reads useAuth).
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => null }));
// The person's role in the agency (src/hooks/useAgency.ts): full access unless a case narrows it.
const role = vi.hoisted(() => ({ role: "owner", isOperator: true }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");
const renderLeads = () => render(<MemoryRouter><Leads /></MemoryRouter>);

describe("the lead's interview tab", () => {
  it("is offered for the lead with a conversation and for no other", () => {
    h.ids = ["l-chat"];
    renderLeads();
    expect(screen.getAllByRole("button", { name: "שיחה" })).toHaveLength(1);
  });

  it("is absent when no lead has a conversation", () => {
    h.ids = [];
    renderLeads();
    expect(screen.queryByRole("button", { name: "שיחה" })).toBeNull();
  });

  it("shows the visitor's markup as text, never as elements", () => {
    h.ids = ["l-chat"];
    h.transcript = [{ role: "user", content: HOSTILE, at: "t" }];
    const { container } = renderLeads();
    fireEvent.click(screen.getByRole("button", { name: "שיחה" }));
    expect(container.textContent).toContain(HOSTILE);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("offers no control to write from the tab", () => {
    h.ids = ["l-chat"];
    h.transcript = [{ role: "assistant", content: "שלום", at: "t" }];
    renderLeads();
    fireEvent.click(screen.getByRole("button", { name: "שיחה" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "הסתרת השיחה" })).toBeTruthy();
  });
});
