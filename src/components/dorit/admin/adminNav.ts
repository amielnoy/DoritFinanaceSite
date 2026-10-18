import { Building2, ClipboardList, Inbox, LayoutDashboard, Newspaper, Users, type LucideIcon } from "lucide-react";
import type { AgencyRole } from "@/config/permissions";
import { reaches, type AdminAccess, type AdminCounts } from "@/hooks/useAdminMenu";
import { MEETINGS_STAFF } from "@/config/meetings";

/**
 * The admin sidebar, grouped by task rather than by table: what Dorit handles
 * every day first, then what she sets up once in a while.
 *
 * `min` is the least role a row needs in the current agency ("operator": the
 * platform operator's alone). AgencyRoute guards each of these again, and
 * row-level security decides what is in them — this only decides what to offer.
 */
export interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  min: AgencyRole | "operator";
  /** Mounted only while the clearinghouse is on (VITE_MASLEKA_ENABLED). */
  masleka?: boolean;
  /** Which counter sits on the row, and the word a screen reader hears after the number. */
  counter?: { key: Exclude<keyof AdminCounts, "total">; label: string };
  /** A second counter after it, in the alert colour: what a client is waiting on. */
  alert?: { key: Exclude<keyof AdminCounts, "total">; label: string };
  /** Active on this exact path only (the main page), not on everything beneath it. */
  end?: boolean;
}

export interface AdminNavGroup {
  /** Shown above the group on a wide screen; null for the main page, which stands alone. */
  title: string | null;
  items: AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { title: null, items: [{ to: "/account", label: "ראשי", icon: LayoutDashboard, min: "operator", end: true }] },
  {
    title: "טיפול שוטף",
    items: [
      // "פניות ופגישות" once the screen holds the agenda (VITE_MEETINGS_STAFF); the counter is the leads' either way,
      // and beside it, the clients' open requests to move or cancel a meeting.
      {
        to: "/admin/leads",
        label: MEETINGS_STAFF ? "פניות ופגישות" : "פניות",
        icon: Inbox,
        min: "user",
        counter: { key: "newLeads", label: "חדשות" },
        alert: MEETINGS_STAFF ? { key: "meetingRequests", label: "בקשות שינוי" } : undefined,
      },
      {
        to: "/admin/masleka",
        label: "בקשות מסלקה",
        icon: ClipboardList,
        min: "user",
        masleka: true,
        counter: { key: "maslekaWaiting", label: "ממתינות להגשה" },
      },
    ],
  },
  {
    title: "תוכן והגדרות",
    items: [
      { to: "/admin/blog", label: "בלוג", icon: Newspaper, min: "user" },
      { to: "/admin/users", label: "משתמשים", icon: Users, min: "user" },
      { to: "/admin/agency", label: "פרטי הסוכנות", icon: Building2, min: "owner" },
    ],
  },
];

/**
 * The groups `access` may see; a group left with no items is dropped. The leads
 * row counts what its reader acts on: the unassigned queue for Admin+, who
 * assign it; a User's own new leads otherwise.
 */
export function adminNavFor(access: AdminAccess, maslekaEnabled: boolean): AdminNavGroup[] {
  if (!access) return [];
  const assigns = reaches(access, "admin");
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => reaches(access, item.min) && (!item.masleka || maslekaEnabled))
      .map((item) =>
        item.to === "/admin/leads" && assigns ? { ...item, counter: { key: "unassigned" as const, label: "לא שויכו" } } : item,
      ),
  })).filter((group) => group.items.length > 0);
}

/** Where "ממשק ניהול" leads: the operator's main page, or the leads for an agency's members. */
export const adminHome = (access: Exclude<AdminAccess, null>): string => (access === "operator" ? "/account" : "/admin/leads");
