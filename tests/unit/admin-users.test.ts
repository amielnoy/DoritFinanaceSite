import { describe, expect, it } from "vitest";
import type { AdminUser } from "@/services/ports";
import { directoryFor, filterUsers, matchesOrgs, matchesSearch, orgsOf, primaryOrg, sortUsers } from "@/lib/admin-users";

const m = (orgId: string, orgName: string, joinedAt: string, role = "user") => ({ orgId, orgName, role, joinedAt });
const USERS: AdminUser[] = [
  { id: "1", email: "dana@example.com", role: "admin", createdAt: "2026-01-01", memberships: [m("a", "סוכנות אלפא", "2026-01-02", "owner"), m("b", "משרד בטא", "2026-03-01")] },
  { id: "2", email: "yossi@example.com", role: "user", createdAt: "2026-02-01", memberships: [m("b", "משרד בטא", "2026-02-02")] },
  { id: "3", email: "avi@example.com", role: "user", createdAt: "2026-02-03", memberships: [m("c", "גמא פיננסים", "2026-02-04", "admin")] },
  { id: "4", email: "noa@example.com", role: "user", createdAt: "2026-02-05", memberships: [] },
];
const ids = (users: AdminUser[]) => users.map((u) => u.id);

describe("the users screen's logic", () => {
  it("searches by name, by role in Hebrew or English, and by organization name", () => {
    expect(ids(filterUsers(USERS, "YOSSI", []))).toEqual(["2"]);
    // The platform operator and an agency's Admin read differently (agency roles).
    expect(ids(filterUsers(USERS, "מפעיל", []))).toEqual(["1"]);
    expect(ids(filterUsers(USERS, "מנהל", []))).toEqual(["3"]);
    expect(ids(filterUsers(USERS, "admin", []))).toEqual(["1", "3"]);
    expect(ids(filterUsers(USERS, "בטא", []))).toEqual(["1", "2"]);
    expect(ids(filterUsers(USERS, "בעלים", []))).toEqual(["1"]);
    expect(ids(filterUsers(USERS, "  ", []))).toEqual(["1", "2", "3", "4"]);
  });

  it("matches a user in ANY selected organization, and everyone when none is selected", () => {
    expect(matchesOrgs(USERS[0], ["c"])).toBe(false);
    expect(ids(filterUsers(USERS, "", ["a", "c"]))).toEqual(["1", "3"]);
    expect(ids(filterUsers(USERS, "", []))).toEqual(["1", "2", "3", "4"]);
  });

  it("combines the search and the organization filter (AND)", () => {
    expect(ids(filterUsers(USERS, "example", ["b"]))).toEqual(["1", "2"]);
    expect(ids(filterUsers(USERS, "dana", ["c"]))).toEqual([]);
    expect(matchesSearch(USERS[2], "גמא") && matchesOrgs(USERS[2], ["c"])).toBe(true);
  });

  it("takes the organization a user joined first as the primary one", () => {
    const dir = directoryFor(USERS);
    expect(primaryOrg(USERS[0], dir)?.name).toBe("סוכנות אלפא");
    expect(orgsOf(USERS[0], dir).map((o) => o.name)).toEqual(["סוכנות אלפא", "משרד בטא"]);
    expect(primaryOrg(USERS[3], dir)).toBeUndefined();
  });

  it("sorts by name, by role and by primary organization, users without one last either way", () => {
    expect(ids(sortUsers(USERS, "name", "asc"))).toEqual(["3", "1", "4", "2"]);
    expect(ids(sortUsers(USERS, "name", "desc"))).toEqual(["2", "4", "1", "3"]);
    expect(ids(sortUsers(USERS, "role", "asc"))[0]).toBe("1");
    expect(ids(sortUsers(USERS, "org", "asc"))).toEqual(["3", "2", "1", "4"]);
    expect(ids(sortUsers(USERS, "org", "desc"))).toEqual(["1", "2", "3", "4"]);
  });

  it("codes the organizations shown together without collisions", () => {
    const dir = directoryFor([
      ...USERS,
      { id: "5", email: "x@example.com", role: "user", createdAt: "", memberships: [m("d", "סוכנות אור", "2026-01-01")] },
    ]);
    const codes = [...dir.values()].map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
