import type { AdminUser } from "@/services/ports";
import { organizationDirectory, type Organization } from "@/config/organizations";

/**
 * The users screen's logic, apart from React: who matches a search and an
 * organization filter, in what order, and which organization is a user's
 * primary one. tests/unit/admin-users.test.ts covers it.
 */

export const SITE_ROLE_LABEL: Record<AdminUser["role"], string> = { admin: "מנהל/ת", user: "משתמש/ת" };
export const ORG_ROLE_LABEL: Record<string, string> = { owner: "בעלים", agent: "סוכן/ת", staff: "צוות" };

/** A user's name on the screen. Accounts keep no name of their own, so it is the email. */
export const displayName = (u: Pick<AdminUser, "email">): string => u.email ?? "ללא אימייל";

/** Every organization any of `users` belongs to, coloured and coded together so no two codes collide. */
export function directoryFor(users: readonly AdminUser[]): Map<string, Organization> {
  const seen = new Map<string, string>();
  for (const u of users) for (const m of u.memberships) seen.set(m.orgId, m.orgName);
  return organizationDirectory([...seen].map(([id, name]) => ({ id, name })));
}

/** A user's organizations, primary first (memberships are oldest first). */
export const orgsOf = (u: AdminUser, dir: ReadonlyMap<string, Organization>): Organization[] =>
  u.memberships.map((m) => dir.get(m.orgId)).filter((o): o is Organization => !!o);

/** The primary organization: the first the user joined (no flag is kept — the user's decision of 2026-10-15). */
export const primaryOrg = (u: AdminUser, dir: ReadonlyMap<string, Organization>): Organization | undefined => orgsOf(u, dir)[0];

const norm = (s: string) => s.toLocaleLowerCase("he").trim();

/** Does the user match a search: by name (email), role (site or organization, Hebrew or not) or organization name? */
export function matchesSearch(u: AdminUser, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const fields = [
    displayName(u),
    u.role,
    SITE_ROLE_LABEL[u.role],
    ...u.memberships.flatMap((m) => [m.orgName, m.role, ORG_ROLE_LABEL[m.role] ?? ""]),
  ];
  return fields.some((f) => norm(f).includes(q));
}

/** A user matches the organization filter by belonging to ANY of the selected organizations; none selected is all. */
export const matchesOrgs = (u: AdminUser, orgIds: readonly string[]): boolean =>
  orgIds.length === 0 || u.memberships.some((m) => orgIds.includes(m.orgId));

/** The search AND the organization filter. */
export const filterUsers = (users: readonly AdminUser[], query: string, orgIds: readonly string[]): AdminUser[] =>
  users.filter((u) => matchesSearch(u, query) && matchesOrgs(u, orgIds));

export type SortKey = "name" | "role" | "org";
export type SortDir = "asc" | "desc";

/**
 * In order by name, role or primary organization's name; ties by name. A user
 * with no organization sorts after every user with one, in either direction.
 */
export function sortUsers(users: readonly AdminUser[], key: SortKey, dir: SortDir): AdminUser[] {
  const collator = new Intl.Collator("he");
  const keyOf = (u: AdminUser): string | null =>
    key === "name" ? displayName(u) : key === "role" ? SITE_ROLE_LABEL[u.role] : (u.memberships[0]?.orgName ?? null);
  const sign = dir === "asc" ? 1 : -1;
  return [...users].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null || kb === null) return ka === kb ? collator.compare(displayName(a), displayName(b)) : ka === null ? 1 : -1;
    return sign * collator.compare(ka, kb) || collator.compare(displayName(a), displayName(b));
  });
}
