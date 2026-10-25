import { describe, expect, it } from "vitest";
import { ADMIN_NAV, adminHome, adminNavFor } from "@/components/dorit/admin/adminNav";
import { initials } from "@/components/dorit/admin/AdminMenu";
import { waitingCount } from "@/hooks/useAdminMenu";
import type { MaslekaRequest } from "@/services/ports";

/* The admin sidebar's groups, the "ניהול" menu's initials and its clearinghouse counter. */

const labels = (groups: ReturnType<typeof adminNavFor>) => groups.map((g) => [g.title, g.items.map((i) => i.label)]);

describe("adminNavFor", () => {
  it("gives the platform operator every page, grouped by task", () => {
    expect(labels(adminNavFor("operator", true))).toEqual([
      [null, ["ראשי"]],
      ["טיפול שוטף", ["פניות", "בקשות מסלקה", "קמפיינים"]],
      ["תוכן והגדרות", ["בלוג", "משתמשים", "פרטי הסוכנות"]],
    ]);
  });

  it("leaves the clearinghouse out while its switch is off", () => {
    expect(labels(adminNavFor("operator", false))[1]).toEqual(["טיפול שוטף", ["פניות", "קמפיינים"]]);
  });

  it("gives an Owner the agency's pages and its details, not the operator's main page", () => {
    expect(labels(adminNavFor("owner", true))).toEqual([
      ["טיפול שוטף", ["פניות", "בקשות מסלקה", "קמפיינים"]],
      ["תוכן והגדרות", ["בלוג", "משתמשים", "פרטי הסוכנות"]],
    ]);
  });

  it("gives an Admin and a User the same rows, but not the agency's details", () => {
    for (const role of ["admin", "user"] as const) {
      expect(labels(adminNavFor(role, true))).toEqual([
        ["טיפול שוטף", ["פניות", "בקשות מסלקה", "קמפיינים"]],
        ["תוכן והגדרות", ["בלוג", "משתמשים"]],
      ]);
    }
  });

  it("counts the unassigned queue for Admin+, and a User's own new leads", () => {
    const leadsRow = (access: Parameters<typeof adminNavFor>[0]) =>
      adminNavFor(access, true).flatMap((g) => g.items).find((i) => i.to === "/admin/leads")?.counter?.key;
    expect(leadsRow("operator")).toBe("unassigned");
    expect(leadsRow("owner")).toBe("unassigned");
    expect(leadsRow("admin")).toBe("unassigned");
    expect(leadsRow("user")).toBe("newLeads");
  });

  it("has no meeting-requests counter without the meetings switch", () => {
    const rows = adminNavFor("admin", true).flatMap((g) => g.items);
    expect(rows.some((i) => i.alert)).toBe(false);
  });

  it("offers the operator the agencies being set up only while the wizard is on", () => {
    const has = (on: boolean) => adminNavFor("operator", true, on).flatMap((g) => g.items).some((i) => i.to === "/admin/agencies");
    expect(has(true)).toBe(true);
    expect(has(false)).toBe(false);
    expect(adminNavFor("owner", true, true).flatMap((g) => g.items).some((i) => i.to === "/admin/agencies")).toBe(false);
  });

  it("gives anyone else nothing", () => {
    expect(adminNavFor(null, true)).toEqual([]);
  });

  it("names a route for every page, each once", () => {
    const routes = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toEqual(["/account", "/admin/leads", "/admin/masleka", "/admin/campaigns", "/admin/blog", "/admin/users", "/admin/agency", "/admin/agencies"]);
  });

  it("sends the operator to their main page and an agency's members to the leads", () => {
    expect(adminHome("operator")).toBe("/account");
    for (const role of ["owner", "admin", "user"] as const) expect(adminHome(role)).toBe("/admin/leads");
  });
});

describe("initials", () => {
  it.each([
    ["דורית גוב ארי", "דג"],
    ["Dorit", "D"],
    ["dorit@govari-fin.co.il", "D"],
    ["dorit.govari@example.com", "DG"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("waitingCount", () => {
  it("counts the requests whose code has arrived and is not yet submitted", () => {
    const rows = ["code_received", "invited", "submitted", "code_received", "completed"].map((status) => ({ status }) as MaslekaRequest);
    expect(waitingCount(rows)).toBe(2);
    expect(waitingCount([])).toBe(0);
  });
});
