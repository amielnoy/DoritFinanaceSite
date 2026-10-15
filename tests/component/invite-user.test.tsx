// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminUser, InviteInput, InviteResult } from "@/services/ports";

/* "הוספת משתמש" on /admin/users: an address, an organization and a role, sent to invite-user. */

const list = vi.fn<() => Promise<AdminUser[]>>(async () => []);
const organizations = vi.fn(async () => [{ id: "org-a", name: "סוכנות אלפא" }, { id: "org-b", name: "משרד בטא" }]);
const invite = vi.fn<(input: InviteInput) => Promise<InviteResult>>();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, usersAdmin: { list: () => list(), organizations: () => organizations(), invite: (i: InviteInput) => invite(i) } } };
});

const { default: AdminUsers } = await import("@/pages/AdminUsers");

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/admin/users"]}>
        <AdminUsers />
      </MemoryRouter>
    </QueryClientProvider>,
  );

async function openAndFill(email = "new@example.com") {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "הוספת משתמש" }));
  const dialog = await screen.findByRole("dialog", { name: "הוספת משתמש" });
  if (email) await user.type(screen.getByLabelText("כתובת דוא״ל"), email);
  await screen.findByRole("option", { name: "משרד בטא" });
  await user.selectOptions(screen.getByLabelText("ארגון"), "org-b");
  await user.selectOptions(screen.getByLabelText("תפקיד"), "staff");
  return { user, dialog };
}

describe("הוספת משתמש", () => {
  beforeEach(() => {
    invite.mockReset();
    list.mockClear();
  });

  it("invites with the address, organization and role, says so, and reloads the list", async () => {
    invite.mockResolvedValue({ created: true, mailed: true });
    const { user } = await openAndFill();
    const before = list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ email: "new@example.com", orgId: "org-b", role: "staff" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ההזמנה נשלחה ל-new@example.com");
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it("says plainly when the membership was added but the mail did not go", async () => {
    invite.mockResolvedValue({ created: false, mailed: false });
    const { user } = await openAndFill();
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));
    expect(await screen.findByRole("status")).toHaveTextContent("נוסף לארגון, אבל המייל לא נשלח");
  });

  it("shows the function's refusal in its own words", async () => {
    invite.mockRejectedValue(new Error("התפקיד אינו מוכר."));
    const { user } = await openAndFill();
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("התפקיד אינו מוכר.");
  });

  it("asks for an address before sending anything", async () => {
    const { user } = await openAndFill("");
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("יש להזין כתובת דוא״ל תקינה");
    expect(invite).not.toHaveBeenCalled();
  });
});
