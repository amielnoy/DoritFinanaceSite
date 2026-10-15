import { ClipboardList, Inbox, LayoutDashboard, Newspaper, Users, type LucideIcon } from "lucide-react";
import type { AdminAccess, AdminCounts } from "@/hooks/useAdminMenu";

/**
 * The admin sidebar, grouped by task rather than by table: what Dorit handles
 * every day first, then what she sets up once in a while.
 *
 * `access: "staff"` marks what agency staff may open as well (the
 * clearinghouse); everything else is the platform admin's alone. The routes
 * guard each of these again — this only decides what to offer.
 */
export interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  access: "admin" | "staff";
  /** Mounted only while the clearinghouse is on (VITE_MASLEKA_ENABLED). */
  masleka?: boolean;
  /** Which counter sits on the row, and the word a screen reader hears after the number. */
  counter?: { key: Exclude<keyof AdminCounts, "total">; label: string };
  /** Active on this exact path only (the main page), not on everything beneath it. */
  end?: boolean;
}

export interface AdminNavGroup {
  /** Shown above the group on a wide screen; null for the main page, which stands alone. */
  title: string | null;
  items: AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { title: null, items: [{ to: "/account", label: "ראשי", icon: LayoutDashboard, access: "admin", end: true }] },
  {
    title: "טיפול שוטף",
    items: [
      { to: "/admin/leads", label: "פניות", icon: Inbox, access: "admin", counter: { key: "newLeads", label: "חדשות" } },
      {
        to: "/admin/masleka",
        label: "בקשות מסלקה",
        icon: ClipboardList,
        access: "staff",
        masleka: true,
        counter: { key: "maslekaWaiting", label: "ממתינות להגשה" },
      },
    ],
  },
  {
    title: "תוכן והגדרות",
    items: [
      { to: "/admin/blog", label: "בלוג", icon: Newspaper, access: "admin" },
      { to: "/admin/users", label: "משתמשים", icon: Users, access: "admin" },
    ],
  },
];

/** The groups `access` may see. The admin sees everything; a group left with no items is dropped. */
export function adminNavFor(access: AdminAccess, maslekaEnabled: boolean): AdminNavGroup[] {
  if (!access) return [];
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => (access === "admin" || item.access === "staff") && (!item.masleka || maslekaEnabled)),
  })).filter((group) => group.items.length > 0);
}

/** Where "ממשק ניהול" leads: the admin's main page, or the board for agency staff. */
export const adminHome = (access: "admin" | "staff"): string => (access === "admin" ? "/account" : "/admin/masleka");
