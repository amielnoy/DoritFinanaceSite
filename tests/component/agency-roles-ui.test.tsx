// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The screens by role (docs/superpowers/specs/2026-10-15-agency-roles-design.md):
 * what a User, an Admin and an Owner are offered. The database and the
 * functions refuse the rest; these check that the screens do not offer it.
 */

const A1 = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  leads: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  articles: [] as Record<string, unknown>[],
  assign: vi.fn(),
  setRole: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  leave: vi.fn(async () => {}),
  transferOwnership: vi.fn(async () => {}),
  profile: vi.fn(),
  updateProfile: vi.fn(async () => {}),
}));

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "me", role: "user" }, isAuthenticated: true }) }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => <p>מעקב לידים</p> }));
vi.mock("@/hooks/useAdmin", () => ({
  adminKeys: { leads: ["admin", "leads"] },
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useMergeLeads: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLeadEvents: () => ({ data: [], isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useLeadMeetings: () => ({ data: [], isPending: false, isError: false }),
  useAssignLead: () => ({ mutate: h.assign, isPending: false, isError: false }),
  useAdminUsers: () => ({ data: h.users, isLoading: false }),
  useTranscriptLeadIds: () => ({ data: [] }),
  useLeadTranscript: () => ({ data: undefined, isLoading: false, error: null }),
  useAdminArticles: () => ({ data: h.articles, isPending: false, isError: false }),
  useSaveArticle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetArticlePublished: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveArticle: () => ({ mutate: vi.fn(), isError: false }),
}));
vi.mock("@/services", () => ({
  services: {
    leadsAdmin: { documentLink: vi.fn() },
    uploads: { upload: vi.fn() },
    usersAdmin: { setRole: h.setRole, remove: h.remove, leave: h.leave, transferOwnership: h.transferOwnership },
    agency: { profile: h.profile, updateProfile: h.updateProfile },
  },
}));
const role = vi.hoisted(() => ({ role: "user", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

import Leads from "@/pages/Leads";
import BlogAdmin from "@/pages/BlogAdmin";
import AgencyMembers from "@/components/dorit/admin/AgencyMembers";
import AgencyProfile from "@/pages/AgencyProfile";

const show = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
const lead = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `לקוח ${id}`, phone: "050", source: "quick", status: "new", created_date: "2026-10-10T08:00:00Z",
  agency_id: A1, assigned_user_id: null, ...over,
});
const member = (id: string, email: string, r: string) => ({
  id, email, role: "user", createdAt: "", memberships: [{ orgId: A1, orgName: "דורית", role: r, joinedAt: "" }],
});

beforeEach(() => {
  role.role = "user";
  role.isOperator = false;
  h.leads = [lead("1", { assigned_user_id: "me" }), lead("2", { status: "escalated", assigned_user_id: "me" })];
  h.users = [member("me", "me@example.com", "user"), member("u2", "two@example.com", "user"), member("o1", "owner@example.com", "owner")];
  h.articles = [
    { id: "p1", title: "טיוטה", body: "x", slug: "draft", published: false, created_date: "2026-10-01" },
    { id: "p2", title: "מפורסם", body: "x", slug: "live", published: true, created_date: "2026-10-02" },
  ];
  for (const fn of [h.assign, h.setRole, h.remove, h.leave, h.transferOwnership, h.updateProfile]) fn.mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("the leads screen, by role", () => {
  it("shows a User 'הפניות שלי', with no assignment, no delete and no tracking panel", () => {
    show(<Leads />);
    expect(screen.getByRole("heading", { name: "הפניות שלי" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מחיקה" })).toBeNull();
    expect(screen.queryByLabelText(/שיוך הפנייה/)).toBeNull();
    expect(screen.queryByRole("button", { name: /לא שויכו/ })).toBeNull();
    expect(screen.queryByText("מעקב לידים")).toBeNull();
  });

  it("shows a backend-written status as it is, and not as a choice", () => {
    show(<Leads />);
    const select = screen.getByLabelText("סטטוס הפנייה של לקוח 2") as HTMLSelectElement;
    expect(select.value).toBe("escalated");
    expect(within(select).getByRole("option", { name: "הועברה לטיפול אישי" })).toBeDisabled();
  });

  it("gives an Admin the queue: an assignee per lead, the unassigned chip, and delete", () => {
    role.role = "admin";
    h.leads = [lead("1"), lead("2", { assigned_user_id: "u2" }), lead("3", { status: "closed" })];
    show(<Leads />);
    expect(screen.getByRole("heading", { name: "ניהול פניות" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "מחיקה" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /לא שויכו\s*1/ }));
    expect(screen.getByText("לקוח 1")).toBeInTheDocument();
    expect(screen.queryByText("לקוח 2")).toBeNull();
    // The closed lead is not in the queue.
    expect(screen.queryByText("לקוח 3")).toBeNull();
    const assign = screen.getByLabelText("שיוך הפנייה של לקוח 1") as HTMLSelectElement;
    expect([...assign.options].map((o) => o.textContent)).toEqual(["לא שויכה", "me@example.com", "owner@example.com", "two@example.com"]);
    fireEvent.change(assign, { target: { value: "u2" } });
    expect(h.assign).toHaveBeenCalledWith({ id: "1", userId: "u2" });
  });

  it("offers everyone the escalated and partial chips", () => {
    show(<Leads />);
    expect(screen.getByRole("button", { name: /הועברו לטיפול\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ראיונות שלא הושלמו\s*0/ })).toBeInTheDocument();
  });

  it("shows only the current agency's leads", () => {
    role.role = "admin";
    h.leads = [lead("1"), lead("9", { agency_id: "0abcfa0b-cc26-40f0-8971-54bd4d845139" })];
    show(<Leads />);
    expect(screen.getByText("לקוח 1")).toBeInTheDocument();
    expect(screen.queryByText("לקוח 9")).toBeNull();
  });
});

describe("the blog admin, by role", () => {
  it("lets a User write drafts only: no publish toggle, no delete, no edit of a live article", () => {
    show(<BlogAdmin />);
    expect(screen.queryByRole("button", { name: "החלפת פרסום" })).toBeNull();
    expect(screen.queryByRole("button", { name: "מחיקה" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "עריכה" })).toHaveLength(1);
  });

  it("gives an Admin publishing and deleting", () => {
    role.role = "admin";
    show(<BlogAdmin />);
    expect(screen.getAllByRole("button", { name: "החלפת פרסום" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "מחיקה" })).toHaveLength(2);
  });
});

describe("the agency's members, by role", () => {
  it("shows a User the members, lets them leave, and offers no change to anyone else", async () => {
    show(<AgencyMembers />);
    const list = screen.getByRole("list", { name: "חברי הסוכנות" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "הסרה" })).toBeNull();
    expect(screen.queryByLabelText(/התפקיד של/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "עזיבת הסוכנות" }));
    await vi.waitFor(() => expect(h.leave).toHaveBeenCalledWith(A1));
  });

  it("lets an Admin remove a User, saying how many leads go back to the queue, and never touch the Owner", async () => {
    role.role = "admin";
    h.users = [member("me", "me@example.com", "admin"), member("u2", "two@example.com", "user"), member("o1", "owner@example.com", "owner")];
    h.leads = [lead("1", { assigned_user_id: "u2" }), lead("2", { assigned_user_id: "u2" })];
    show(<AgencyMembers />);
    const rows = within(screen.getByRole("list", { name: "חברי הסוכנות" })).getAllByRole("listitem");
    const owner = rows.find((r) => r.textContent?.includes("owner@example.com"))!;
    expect(within(owner).queryByRole("button", { name: "הסרה" })).toBeNull();
    const two = rows.find((r) => r.textContent?.includes("two@example.com"))!;
    // An Admin gives User only, so there is no role to choose.
    expect(within(two).queryByLabelText(/התפקיד של/)).toBeNull();
    fireEvent.click(within(two).getByRole("button", { name: "הסרה" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("2 פניות פתוחות"));
    await vi.waitFor(() => expect(h.remove).toHaveBeenCalledWith(A1, "u2"));
  });

  it("lets the Owner change roles and hand over ownership", async () => {
    role.role = "owner";
    h.users = [member("me", "me@example.com", "owner"), member("u2", "two@example.com", "user")];
    show(<AgencyMembers />);
    fireEvent.change(screen.getByLabelText("התפקיד של two@example.com"), { target: { value: "admin" } });
    await vi.waitFor(() => expect(h.setRole).toHaveBeenCalledWith(A1, "u2", "admin"));
    fireEvent.change(screen.getByLabelText("העברת בעלות ל"), { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "העברת בעלות" }));
    await vi.waitFor(() => expect(h.transferOwnership).toHaveBeenCalledWith(A1, "u2"));
  });
});

describe("the agency profile", () => {
  const PROFILE = {
    agencyId: A1, displayName: "דורית גוב ארי", phoneE164: "+972508311776", phoneDisplay: "050-831-1776",
    whatsapp: "972508311776", email: "dorit@govari-fin.co.il", defaultWhatsappMessage: "שלום",
    licenceEntity: "דורית גוב ארי", licenceNumber: "L-1", licenceRegulator: "רשות",
  };

  it("lets the Owner edit and save every field", async () => {
    role.role = "owner";
    h.profile.mockResolvedValue(PROFILE);
    show(<AgencyProfile />);
    const name = await screen.findByLabelText("שם לתצוגה");
    fireEvent.change(name, { target: { value: "דורית" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await vi.waitFor(() => expect(h.updateProfile).toHaveBeenCalledWith(A1, expect.objectContaining({ displayName: "דורית" })));
  });

  it("shows anyone else the details read-only, with no save", async () => {
    role.role = "admin";
    h.profile.mockResolvedValue(PROFILE);
    show(<AgencyProfile />);
    expect(await screen.findByLabelText("שם לתצוגה")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "שמירה" })).toBeNull();
  });
});
