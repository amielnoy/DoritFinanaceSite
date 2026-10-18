import { describe, expect, it, vi } from "vitest";

/*
 * With VITE_MEETINGS_STAFF the leads screen holds the agenda too, and its row in
 * the sidebar says so — "פניות ופגישות". The counter on it stays the leads' own
 * (the unassigned queue for Admin+, a User's new leads).
 */
vi.mock("@/config/meetings", () => ({ MEETINGS_STAFF: true, MEETINGS_CLIENT: false }));

const { adminNavFor } = await import("@/components/dorit/admin/adminNav");

const leadsRow = (access: Parameters<typeof adminNavFor>[0]) =>
  adminNavFor(access, false).flatMap((g) => g.items).find((i) => i.to === "/admin/leads");

describe("the leads row, with the meetings switch on", () => {
  it("is named 'פניות ופגישות' for every role", () => {
    for (const access of ["operator", "owner", "admin", "user"] as const) expect(leadsRow(access)?.label).toBe("פניות ופגישות");
  });

  it("keeps the leads' counter", () => {
    expect(leadsRow("admin")?.counter).toEqual({ key: "unassigned", label: "לא שויכו" });
    expect(leadsRow("user")?.counter).toEqual({ key: "newLeads", label: "חדשות" });
  });
});
