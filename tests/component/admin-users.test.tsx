// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminUser } from "@/services/ports";

/* /admin/users: search, the organization filter, sorting, the states, and table vs cards. */

const list = vi.fn<() => Promise<AdminUser[]>>();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, usersAdmin: { list: () => list() }, leadsAdmin: { list: async () => [] } } };
});
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "me", role: "admin" }, isAuthenticated: true }) }));
// The person's role in the agency (src/hooks/useAgency.ts): full access unless a case narrows it.
const role = vi.hoisted(() => ({ role: "owner", isOperator: true }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: AdminUsers } = await import("@/pages/AdminUsers");

const m = (orgId: string, orgName: string, joinedAt: string) => ({ orgId, orgName, role: "agent", joinedAt });
const USERS: AdminUser[] = [
  { id: "1", email: "dana@example.com", role: "admin", createdAt: "", memberships: [m("a", "סוכנות אלפא", "1"), m("b", "משרד בטא", "2"), m("c", "גמא פיננסים", "3")] },
  { id: "2", email: "yossi@example.com", role: "user", createdAt: "", memberships: [m("b", "משרד בטא", "1")] },
  { id: "3", email: "avi@example.com", role: "user", createdAt: "", memberships: [m("c", "גמא פיננסים", "1")] },
];

let location = "";
function Where() {
  location = useLocation().search;
  return null;
}
function renderAt(path = "/admin/users") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/users" element={<><AdminUsers /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const table = () => screen.getByRole("table");
const rowNames = () => within(table()).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent?.replace(/^\S\s?/, "").trim());

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue(USERS);
});

describe("/admin/users", () => {
  it("shows skeletons while loading, then the count and every user sorted by name", async () => {
    let resolve!: (u: AdminUser[]) => void;
    list.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderAt();
    expect(screen.getAllByTestId("user-skeleton")).toHaveLength(4);
    resolve(USERS);
    expect(await screen.findByText("מציג 3 מתוך 3 משתמשים")).toBeInTheDocument();
    expect(rowNames()).toEqual(["avi@example.com", "dana@example.com", "yossi@example.com"]);
    expect(within(table()).getByRole("columnheader", { name: "משתמש/ת" })).toHaveAttribute("aria-sort", "ascending");
  });

  it("filters by organization with pressed buttons — ANY of them — and keeps it in the URL", async () => {
    renderAt();
    await screen.findByText("מציג 3 מתוך 3 משתמשים");
    const filter = within(screen.getByRole("group", { name: "סינון לפי ארגון" }));
    expect(filter.getByRole("button", { name: "כל הארגונים" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(filter.getByRole("button", { name: /משרד בטא/ }));
    expect(filter.getByRole("button", { name: /משרד בטא/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("מציג 2 מתוך 3 משתמשים")).toBeInTheDocument();
    await userEvent.click(filter.getByRole("button", { name: /גמא פיננסים/ }));
    expect(screen.getByText("מציג 3 מתוך 3 משתמשים")).toBeInTheDocument();
    expect(new URLSearchParams(location).get("org")?.split(",").sort()).toEqual(["b", "c"]);
  });

  it("searches after a short pause, combined with the filter, and reads both back from the URL", async () => {
    renderAt("/admin/users?org=b");
    await screen.findByText("מציג 2 מתוך 3 משתמשים");
    await userEvent.type(screen.getByRole("searchbox", { name: "חיפוש משתמשים" }), "yossi");
    await waitFor(() => expect(screen.getByText("מציג 1 מתוך 3 משתמשים")).toBeInTheDocument());
    expect(new URLSearchParams(location).get("q")).toBe("yossi");
    expect(rowNames()).toEqual(["yossi@example.com"]);
  });

  it("says when nothing matches, and clears the search and the filter", async () => {
    renderAt("/admin/users?q=nobody&org=a");
    expect(await screen.findByText("לא נמצאו משתמשים שמתאימים לחיפוש")).toBeInTheDocument();
    expect(screen.getByText("מציג 0 מתוך 3 משתמשים")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ניקוי סינון" }));
    expect(screen.getByText("מציג 3 מתוך 3 משתמשים")).toBeInTheDocument();
    expect(location).toBe("");
    expect(screen.getByRole("searchbox", { name: "חיפוש משתמשים" })).toHaveValue("");
  });

  it("sorts by a column, marking it with aria-sort, and turns it around on a second click", async () => {
    renderAt();
    await screen.findByText("מציג 3 מתוך 3 משתמשים");
    const header = within(table()).getByRole("columnheader", { name: "ארגון" });
    await userEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(rowNames()).toEqual(["avi@example.com", "yossi@example.com", "dana@example.com"]);
    await userEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(within(table()).getByRole("columnheader", { name: "משתמש/ת" })).toHaveAttribute("aria-sort", "none");
  });

  it("switches from cards to the table at 680px, as the design asks", async () => {
    list.mockResolvedValue(USERS);
    renderAt();
    await screen.findAllByText("dana@example.com");
    // jsdom has no layout: the breakpoint is read off the two classes that carry it.
    expect(table().className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(table().className).toContain("min-[680px]:table");
    expect(screen.getByRole("list", { name: "משתמשים" }).className).toContain("min-[680px]:hidden");
  });

  it("shows the organization column in the table without avatar badges, and the badge on the cards", async () => {
    renderAt();
    await screen.findByText("מציג 3 מתוך 3 משתמשים");
    expect(within(table()).queryAllByRole("img", { name: /^ארגון:/ })).toHaveLength(0);
    const danaRow = within(table()).getAllByRole("row").find((r) => r.textContent?.includes("dana"))!;
    expect(within(danaRow).getByRole("button", { name: "ועוד 1 ארגונים" })).toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "משתמשים" }));
    expect(cards.getAllByRole("img", { name: /^ארגון:/ })).toHaveLength(3);
    expect(cards.getAllByRole("img", { name: "ארגון: סוכנות אלפא" })).toHaveLength(1);
  });

  it("turns the filter into a searchable multi-select above six organizations, with removable chips", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `u${i}`, email: `user${i}@example.com`, role: "user" as const, createdAt: "",
      memberships: [m(`o${i}`, `ארגון ${["אלף", "בית", "גימל", "דלת", "הא", "וו", "זין", "חית"][i]}`, "1")],
    }));
    list.mockResolvedValue(many);
    renderAt();
    await screen.findByText("מציג 8 מתוך 8 משתמשים");
    expect(screen.queryByRole("group", { name: "סינון לפי ארגון" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "כל הארגונים" }));
    await userEvent.type(await screen.findByRole("searchbox", { name: "חיפוש ארגון" }), "גימל");
    const options = within(screen.getByRole("list", { name: "ארגונים" }));
    expect(options.getAllByRole("checkbox")).toHaveLength(1);
    await userEvent.click(options.getByRole("checkbox"));
    expect(screen.getByText("מציג 1 מתוך 8 משתמשים")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const chips = within(screen.getByRole("list", { name: "ארגונים שנבחרו" }));
    await userEvent.click(chips.getByRole("button", { name: "הסרת ארגון גימל מהסינון" }));
    expect(screen.getByText("מציג 8 מתוך 8 משתמשים")).toBeInTheDocument();
  });

  it("says so when there are no users at all, with nothing to clear", async () => {
    list.mockResolvedValue([]);
    renderAt();
    expect(await screen.findByText("עדיין אין משתמשים")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניקוי סינון" })).toBeNull();
  });
});
