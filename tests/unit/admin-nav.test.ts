import { describe, expect, it } from "vitest";
import { ADMIN_NAV, adminHome, adminNavFor } from "@/components/dorit/admin/adminNav";
import { initials } from "@/components/dorit/admin/AdminMenu";
import { waitingCount } from "@/hooks/useAdminMenu";
import type { MaslekaRequest } from "@/services/ports";

/* The admin sidebar's groups, the "ניהול" menu's initials and its clearinghouse counter. */

const labels = (groups: ReturnType<typeof adminNavFor>) => groups.map((g) => [g.title, g.items.map((i) => i.label)]);

describe("adminNavFor", () => {
  it("gives the admin every page, grouped by task", () => {
    expect(labels(adminNavFor("admin", true))).toEqual([
      [null, ["ראשי"]],
      ["טיפול שוטף", ["פניות", "בקשות מסלקה"]],
      ["תוכן והגדרות", ["בלוג", "משתמשים"]],
    ]);
  });

  it("leaves the clearinghouse out while its switch is off", () => {
    expect(labels(adminNavFor("admin", false))[1]).toEqual(["טיפול שוטף", ["פניות"]]);
  });

  it("gives agency staff the clearinghouse alone, and drops the groups left empty", () => {
    expect(labels(adminNavFor("staff", true))).toEqual([["טיפול שוטף", ["בקשות מסלקה"]]]);
  });

  it("gives anyone else nothing", () => {
    expect(adminNavFor(null, true)).toEqual([]);
  });

  it("names a route for every page, each once", () => {
    const routes = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toEqual(["/account", "/admin/leads", "/admin/masleka", "/admin/blog", "/admin/users"]);
  });

  it("sends the admin to her main page and staff to the board", () => {
    expect(adminHome("admin")).toBe("/account");
    expect(adminHome("staff")).toBe("/admin/masleka");
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
