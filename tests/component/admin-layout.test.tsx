// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";


const auth = vi.hoisted(() => ({
  value: { user: null, isAuthenticated: false, logout: () => {} } as {
    user: Record<string, unknown> | null;
    isAuthenticated: boolean;
    logout: (...a: unknown[]) => void;
  },
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/config/masleka", () => ({ MASLEKA_ENABLED: true }));

const myRole = vi.hoisted(() => vi.fn<(agencyId: string) => Promise<string | null>>(async () => null));
const myAgencies = vi.hoisted(() => vi.fn(async () => [] as { id: string; name: string; role: string }[]));
const list = vi.hoisted(() => vi.fn(async () => [] as { status: string }[]));
const countNew = vi.hoisted(() => vi.fn(async () => 0));
const countUnassigned = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("@/services", () => ({
  services: { masleka: { list }, leadsAdmin: { countNew, countUnassigned }, agency: { myRole, myAgencies } },
}));
const A1 = "00000000-0000-0000-0000-000000000001";
const TRUST = "0abcfa0b-cc26-40f0-8971-54bd4d845139";

import AdminLayout from "@/components/dorit/admin/AdminLayout";

/* The admin interface's frame: the sidebar, grouped by task, around every admin screen. */

const ADMIN = { id: "u1", email: "d@example.com", role: "admin" };

const renderAt = (path: string, user: Record<string, unknown> | null = ADMIN, logout = vi.fn()) => {
  auth.value = { user, isAuthenticated: user !== null, logout };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AdminLayout adminOnly />}>
            <Route path="/account" element={<p>האזור האישי</p>} />
          </Route>
          <Route element={<AdminLayout />}>
            <Route path="/admin/leads" element={<p>מסך הפניות</p>} />
            <Route path="/admin/masleka" element={<p>לוח המסלקה</p>} />
            <Route path="/admin/masleka/guide" element={<p>המדריך</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { logout };
};

const sidebar = () => screen.getByRole("navigation", { name: "ממשק ניהול" });

describe("<AdminLayout />", () => {
  it("groups the admin's pages by task, around the screen", async () => {
    renderAt("/admin/leads");
    expect(await screen.findByText("מסך הפניות")).toBeInTheDocument();
    const daily = within(sidebar()).getByRole("group", { name: "טיפול שוטף" });
    expect(within(daily).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/admin/leads", "/admin/masleka", "/admin/campaigns"]);
    const setup = within(sidebar()).getByRole("group", { name: "תוכן והגדרות" });
    expect(within(setup).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/admin/blog", "/admin/users", "/admin/agency"]);
    expect(within(sidebar()).getByRole("link", { name: "ראשי" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "צפייה באתר" })).toHaveAttribute("href", "/");
  });

  it("marks the current page, and only it", () => {
    renderAt("/admin/leads");
    expect(within(sidebar()).getByRole("link", { name: /^פניות/ })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar()).getByRole("link", { name: "ראשי" })).not.toHaveAttribute("aria-current");
    expect(within(sidebar()).getByRole("link", { name: /^בקשות מסלקה/ })).not.toHaveAttribute("aria-current");
  });

  it("keeps a page beneath the board under בקשות מסלקה", () => {
    renderAt("/admin/masleka/guide");
    expect(within(sidebar()).getByRole("link", { name: /^בקשות מסלקה/ })).toHaveAttribute("aria-current", "page");
  });

  it("counts the unassigned queue for the operator, and waiting requests, and shows no zero", async () => {
    countUnassigned.mockResolvedValue(4);
    list.mockResolvedValue([{ status: "invited" }]);
    renderAt("/admin/leads");
    expect(await within(sidebar()).findByRole("link", { name: /פניות\s*4 לא שויכו/ })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "בקשות מסלקה" })).toHaveTextContent(/^בקשות מסלקה$/);
  });

  it("gives a User the agency's pages but not its details, counting their own new leads (agency roles)", async () => {
    myAgencies.mockResolvedValue([{ id: A1, name: "דורית", role: "user" }]);
    myRole.mockResolvedValue("user");
    countNew.mockResolvedValue(2);
    countUnassigned.mockClear();
    renderAt("/admin/masleka", { id: "u2", email: "s@example.com", role: "user" });
    const nav = await screen.findByRole("navigation", { name: "ממשק ניהול" });
    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/admin/leads", "/admin/masleka", "/admin/campaigns", "/admin/blog", "/admin/users",
    ]);
    expect(await within(nav).findByRole("link", { name: /פניות\s*2 חדשות/ })).toBeInTheDocument();
    expect(countUnassigned).not.toHaveBeenCalled();
  });

  it("gives someone in two agencies a switcher, and keeps the choice on every link", async () => {
    myAgencies.mockResolvedValue([{ id: A1, name: "דורית", role: "user" }, { id: TRUST, name: "Trust", role: "owner" }]);
    myRole.mockImplementation(async (id: string) => (id === TRUST ? "owner" : "user"));
    renderAt(`/admin/leads?agency=${TRUST}`, { id: "u4", email: "t@example.com", role: "user" });
    const picker = await screen.findByLabelText("סוכנות");
    expect(picker).toHaveValue(TRUST);
    const nav = await screen.findByRole("navigation", { name: "ממשק ניהול" });
    expect(await within(nav).findByRole("link", { name: "פרטי הסוכנות" })).toHaveAttribute("href", `/admin/agency?agency=${TRUST}`);
    myRole.mockImplementation(async () => null);
  });

  it("shows no switcher with one agency", async () => {
    myAgencies.mockResolvedValue([{ id: A1, name: "דורית", role: "user" }]);
    myRole.mockResolvedValue("user");
    renderAt("/admin/leads", { id: "u5", email: "u@example.com", role: "user" });
    await screen.findByRole("navigation", { name: "ממשק ניהול" });
    expect(screen.queryByLabelText("סוכנות")).toBeNull();
  });

  it("shows a client's personal area without the frame", async () => {
    myAgencies.mockResolvedValue([]);
    myRole.mockResolvedValue(null);
    renderAt("/account", { id: "u3", email: "c@example.com", role: "user" });
    expect(await screen.findByText("האזור האישי")).toBeInTheDocument();
    await vi.waitFor(() => expect(myRole).toHaveBeenCalled());
    expect(screen.queryByRole("navigation", { name: "ממשק ניהול" })).toBeNull();
  });

  it("shows the admin's personal area as her main page, in the frame", () => {
    renderAt("/account");
    expect(screen.getByText("האזור האישי")).toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "ראשי" })).toHaveAttribute("aria-current", "page");
  });

  it("signs out and sends her home", () => {
    const { logout } = renderAt("/admin/leads");
    fireEvent.click(screen.getByRole("button", { name: "יציאה" }));
    expect(logout).toHaveBeenCalledWith(true, `${window.location.origin}/`);
  });
});
