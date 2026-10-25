/**
 * Who may do what in an agency — the permissions table of
 * docs/superpowers/specs/2026-10-15-agency-roles-design.md, for the screens.
 *
 * This file only chooses what to show. The database (row-level security and
 * the member functions) and the Edge Functions decide; a button hidden here
 * and shown by mistake is still refused there.
 * tests/contract/permissions.contract.test.ts holds this table to the
 * functions' gates, so the two cannot drift.
 *
 * Two kinds of "admin", kept apart: the platform operator ("מפעיל הפלטפורמה",
 * `profiles.role = 'admin'`) and an agency's Admin ("מנהל/ת",
 * `memberships.role = 'admin'`).
 */
export type AgencyRole = "owner" | "admin" | "user";

/** Ranked: a higher role can do everything a lower one can. */
export const ROLE_RANK: Record<AgencyRole, number> = { user: 1, admin: 2, owner: 3 };

export const ROLE_LABELS: Record<AgencyRole, string> = {
  owner: "בעלים",
  admin: "מנהל/ת",
  user: "משתמש/ת",
};

export const OPERATOR_LABEL = "מפעיל הפלטפורמה";

/**
 * The least role an action needs; "operator" is the platform operator's alone.
 * "Own" actions are allowed to a User for the leads assigned to them — the
 * database narrows what they see, so the screen does not filter again.
 */
export const PERMISSIONS = {
  /** All of the agency's leads; a User reads only their own. */
  "leads.readAll": "admin",
  "leads.readOwn": "user",
  "leads.changeStatus": "user",
  "leads.assign": "admin",
  "leads.delete": "admin",
  /** A member enters a lead by hand (create-lead). */
  "leads.create": "user",
  /** Folds duplicate leads into one, and takes them apart again (merge_leads, unmerge_lead). */
  "leads.merge": "admin",
  /** Exports what the person can already see. */
  "leads.export": "user",
  /** Creates and edits the agency's reactivation campaigns (campaigns_insert_admin / campaigns_update_admin); every member sees them. */
  "campaigns.manage": "admin",
  "contacts.read": "admin",
  "transcripts.read": "user",
  "claimDocuments.open": "user",
  "masleka.create": "user",
  "masleka.reveal": "user",
  "masleka.publish": "user",
  "blog.writeDraft": "user",
  "blog.publish": "admin",
  "blog.delete": "admin",
  "blog.sharedLibrary": "operator",
  "testimonials.write": "admin",
  "members.view": "user",
  /** Invite, remove or change a User. */
  "members.manageUsers": "admin",
  /** Invite, remove or change an Admin. */
  "members.manageAdmins": "owner",
  "members.transferOwnership": "owner",
  "members.leave": "user",
  "agencyProfile.edit": "owner",
  "audit.read": "admin",
  /**
   * The "מעקב לידים" tab on /admin/leads: what the site reports to GA4.
   * Display only — it reads no agency data, and GA4 itself asks for a Google
   * account — so no gate stands behind it.
   */
  "leads.tracking": "owner",
  "agencies.manage": "operator",
} as const satisfies Record<string, AgencyRole | "operator">;

export type Action = keyof typeof PERMISSIONS;

/** Whether `role` holds at least `min`. */
export function meets(role: AgencyRole | null | undefined, min: AgencyRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Whether the caller may do `action`. The operator may do everything an
 * agency member may, except leave an agency they do not belong to.
 */
export function can(role: AgencyRole | null | undefined, isOperator: boolean, action: Action): boolean {
  const min = PERMISSIONS[action];
  if (isOperator) return action !== "members.leave" || !!role;
  return min === "operator" ? false : meets(role, min);
}

/** The roles the caller may give — never above their own: an Admin gives User only. */
export function grantableRoles(role: AgencyRole | null | undefined, isOperator: boolean): AgencyRole[] {
  if (isOperator || role === "owner") return ["owner", "admin", "user"];
  if (role === "admin") return ["user"];
  return [];
}

/** Whether the caller may change or remove someone who holds `target`. */
export function canManage(role: AgencyRole | null | undefined, isOperator: boolean, target: AgencyRole): boolean {
  if (isOperator || role === "owner") return true;
  return role === "admin" && target === "user";
}
