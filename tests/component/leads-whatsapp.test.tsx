// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * One-click WhatsApp on /admin/leads (feature 3): each lead with a number gets
 * a wa.me link with the agency's message filled in; opening it logs the fact,
 * and a new lead is offered "נוצר קשר" — only after the member says yes.
 */
const h = vi.hoisted(() => ({
  leads: [] as Record<string, unknown>[],
  profile: undefined as Record<string, unknown> | undefined,
  setStatus: vi.fn(),
  logWhatsapp: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: h.setStatus, isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMergeLeads: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLeadEvents: () => ({ data: [], isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useLogWhatsapp: () => ({ mutate: h.logWhatsapp, isPending: false, isError: false }),
  useAgencyProfile: () => ({ data: h.profile }),
  useCampaigns: () => ({ data: [] }),
  useLeadMeetings: () => ({ data: [], isPending: false, isError: false }),
  useAdminUsers: () => ({ data: [] }),
  useTranscriptLeadIds: () => ({ data: [] }),
  useLeadTranscript: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: { documentLink: vi.fn() } } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "me", full_name: "דורית גוב ארי" } }) }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => null }));
const role = vi.hoisted(() => ({ role: "user", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

const AGENCY = "00000000-0000-0000-0000-000000000001";
const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, phone: "054-1234567", source: "quick", status: "new", topic: "פנסיה", agency_id: AGENCY,
  created_date: "2026-10-20T08:00:00Z", ...over,
});
const show = () => render(<MemoryRouter><Leads /></MemoryRouter>);
const decoded = (a: HTMLElement) => decodeURIComponent(a.getAttribute("href")!.split("?text=")[1]);

describe("one-click WhatsApp on /admin/leads", () => {
  beforeEach(() => {
    h.setStatus.mockReset();
    h.logWhatsapp.mockReset();
    h.profile = undefined;
    h.leads = [
      lead("n1", "רחל לוי"),
      lead("c1", "דנה", { phone: "+972 52 765 4321", status: "contacted", topic: "" }),
      lead("x1", "בלי מספר", { phone: "050" }),
    ];
  });

  it("opens WhatsApp to the lead's number with the default message, the member's name and the topic", () => {
    show();
    const link = screen.getByRole("link", { name: "וואטסאפ לרחל לוי" });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/972541234567\?text=/);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(decoded(link)).toBe("היי רחל לוי, כאן דורית גוב ארי — קיבלתי את הפנייה שלך בנושא פנסיה, מתי נוח לדבר?");
  });

  it("uses the agency's own message when the Owner has set one", () => {
    h.profile = { displayName: "דורית", leadWhatsappTemplate: "שלום {name}! מדברת {agent} לגבי {topic}." };
    show();
    expect(decoded(screen.getByRole("link", { name: "וואטסאפ לדנה" }))).toBe("שלום דנה! מדברת דורית גוב ארי לגבי שפנית אלינו.");
  });

  it("offers no WhatsApp to a lead without a number anyone could have", () => {
    show();
    expect(screen.queryByRole("link", { name: "וואטסאפ לבלי מספר" })).toBeNull();
  });

  it("logs the message and, for a new lead, asks before moving it to נוצר קשר", () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "וואטסאפ לרחל לוי" }));
    expect(h.logWhatsapp).toHaveBeenCalledWith("n1");
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("לסמן את הפנייה כ״נוצר קשר״?")).toBeTruthy();
    expect(h.setStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "כן, נוצר קשר" }));
    expect(h.setStatus).toHaveBeenCalledWith({ id: "n1", status: "contacted" });
  });

  it("leaves the status alone when the member says not now", () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "וואטסאפ לרחל לוי" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "לא עכשיו" }));
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("only logs, and asks nothing, for a lead already past new", () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "וואטסאפ לדנה" }));
    expect(h.logWhatsapp).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("offers the same message from the lead's drawer", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "רחל לוי" }));
    const drawerLink = within(screen.getByRole("dialog")).getByRole("link", { name: "וואטסאפ לרחל לוי" });
    expect(drawerLink.textContent).toContain("שליחת הודעה");
    expect(drawerLink.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/972541234567\?text=/);
  });
});
