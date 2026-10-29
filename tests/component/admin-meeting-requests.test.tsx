// @vitest-environment jsdom
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";

/*
 * A client's request to move or cancel a meeting waits on staff, so it shows
 * on the leads row as a second counter, in the alert colour, beside the
 * leads' own — and in the header's "ניהול" menu. VITE_MEETINGS_STAFF only.
 */

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "d@example.com", role: "admin" }, isAuthenticated: true, logout: () => {} }),
}));
vi.mock("@/config/masleka", () => ({ MASLEKA_ENABLED: false }));
vi.mock("@/config/meetings", () => ({ MEETINGS_STAFF: true, MEETINGS_CLIENT: false }));

const countUnassigned = vi.hoisted(() => vi.fn(async () => 4));
const countOpenMeetingRequests = vi.hoisted(() => vi.fn(async () => 2));
vi.mock("@/services", () => ({
  services: {
    masleka: { list: async () => [] },
    leadsAdmin: { countNew: async () => 0, countUnassigned, countOpenMeetingRequests },
    agency: { myRole: async () => null, myAgencies: async () => [] },
  },
}));

import AdminLayout from "@/components/dorit/admin/AdminLayout";
import AdminMenu from "@/components/dorit/admin/AdminMenu";
import { agendaKeys } from "@/hooks/useAdmin";

const renderSidebar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/leads"]}>
        <Routes>
          <Route element={<AdminLayout />}>
            <Route path="/admin/leads" element={<p>מסך הפניות</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, nav: () => screen.getByRole("navigation", { name: "ממשק ניהול" }) };
};

describe("open meeting requests on the leads row", () => {
  it("shows them after the leads' counter, spoken with their word, in the alert colour", async () => {
    const { nav } = renderSidebar();
    const row = await within(nav()).findByRole("link", { name: /^פניות ופגישות\s*4 לא שויכו\s*2 בקשות שינוי$/ });
    const badge = within(row).getByText("2 בקשות שינוי").parentElement!;
    expect(badge).toHaveClass("bg-destructive");
    expect(within(row).getByText("4 לא שויכו").parentElement).toHaveClass("bg-amber-700");
  });

  it("shows nothing for none, and keeps the leads' counter", async () => {
    countOpenMeetingRequests.mockResolvedValueOnce(0);
    const { nav } = renderSidebar();
    expect(await within(nav()).findByRole("link", { name: /^פניות ופגישות\s*4 לא שויכו$/ })).toBeInTheDocument();
  });

  it("is read again when the agenda is — so marking a request handled clears it", async () => {
    const { client, nav } = renderSidebar();
    await within(nav()).findByRole("link", { name: /2 בקשות שינוי/ });
    countOpenMeetingRequests.mockResolvedValueOnce(1);
    await client.invalidateQueries({ queryKey: agendaKeys.all });
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /1 בקשות שינוי$/ })).toBeInTheDocument());
  });
});

describe("open meeting requests in the header menu", () => {
  it("has its own row, to the meetings tab, and counts towards the total", () => {
    render(
      <MemoryRouter>
        <AdminMenu
          access="admin"
          counts={{ newLeads: 0, unassigned: 0, maslekaWaiting: 0, meetingRequests: 2, total: 2 }}
          name="דורית גוב ארי"
          roleLabel="מנהלת"
          onSignOut={() => {}}
        />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole("button", { name: /^ניהול/ });
    expect(trigger).toHaveAccessibleName(/2 פריטים ממתינים/);
    fireEvent.keyDown(trigger, { key: "Enter" });
    const item = screen.getByRole("menuitem", { name: /בקשות שינוי בפגישות/ });
    expect(item).toHaveAttribute("href", "/admin/leads?tab=meetings");
    expect(item).toHaveAccessibleName(/2 פתוחות/);
  });
});
