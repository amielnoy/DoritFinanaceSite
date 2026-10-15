import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { BOARD_KEY } from "@/lib/masleka";
import { services } from "@/services";
import type { MaslekaRequest } from "@/services/ports";

/**
 * Who gets the "ניהול" menu and the admin sidebar: the platform admin, or —
 * for the clearinghouse alone — a member of the agency. Everyone else, null.
 *
 * Only what to offer depends on this. The routes (AdminRoute, StaffRoute) and
 * row-level security decide what anyone can actually open or read.
 */
export type AdminAccess = "admin" | "staff" | null;

export function useAdminAccess(): AdminAccess {
  const { user, isAuthenticated } = useAuth();
  const userId = typeof user?.id === "string" ? user.id : "";
  const isAdmin = isAuthenticated && user?.role === "admin";
  // The staff role is in `memberships`, not in the token, so it is asked of the
  // database — and only while the clearinghouse is on, so a dark build never asks.
  const role = useQuery({
    queryKey: ["admin", "staff-role-menu", userId],
    queryFn: () => services.masleka.myRole(),
    enabled: MASLEKA_ENABLED && isAuthenticated && !isAdmin && userId !== "",
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (isAdmin) return "admin";
  if (MASLEKA_ENABLED && isAuthenticated && typeof role.data === "string" && role.data) return "staff";
  return null;
}

export interface AdminCounts {
  /** Leads still `new`. Always 0 for agency staff, who do not see the leads. */
  newLeads: number;
  /** Clearinghouse requests waiting to be submitted — the client sent the code. */
  maslekaWaiting: number;
  total: number;
}

/** Under the leads' own key, so a status change on the leads screen refreshes the counter too. */
export const NEW_LEADS_KEY = ["admin", "leads", "new-count"] as const;
const REFRESH_MS = 60_000;

/** The requests the board shows under "ממתין להגשה" (`boardColumns`). */
export const waitingCount = (requests: MaslekaRequest[]): number =>
  requests.filter((r) => r.status === "code_received").length;

export function useAdminCounts(access: AdminAccess): AdminCounts {
  const leads = useQuery({
    queryKey: NEW_LEADS_KEY,
    queryFn: () => services.leadsAdmin.countNew(),
    enabled: access === "admin",
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  // The board's own query and cache entry: opening the board and the menu reads once.
  const masleka = useQuery({
    queryKey: BOARD_KEY,
    queryFn: () => services.masleka.list(),
    enabled: MASLEKA_ENABLED && access !== null,
    refetchInterval: REFRESH_MS,
    select: waitingCount,
    retry: false,
  });
  // A failed read counts as nothing: a counter is a hint, and the screens behind it say what failed.
  const newLeads = access === "admin" ? leads.data ?? 0 : 0;
  const maslekaWaiting = access !== null ? masleka.data ?? 0 : 0;
  return { newLeads, maslekaWaiting, total: newLeads + maslekaWaiting };
}
