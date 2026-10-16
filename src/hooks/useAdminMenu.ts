import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { meets, type AgencyRole } from "@/config/permissions";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { BOARD_KEY } from "@/lib/masleka";
import { services } from "@/services";
import type { MaslekaRequest } from "@/services/ports";

/**
 * Who gets the "ניהול" menu and the admin sidebar, and at what level: the
 * platform operator, or the person's role in the current agency. Everyone
 * else, null.
 *
 * Only what to offer depends on this. AgencyRoute and row-level security
 * decide what anyone can actually open or read.
 */
export type AdminAccess = "operator" | AgencyRole | null;

const MENU_CACHE = { staleTime: 5 * 60_000 };

export function useAdminAccess(): AdminAccess {
  const { isAuthenticated } = useAuth();
  // The menu shows on every page: a few minutes' reuse, where the routes ask fresh.
  const { agencyId } = useCurrentAgency(MENU_CACHE);
  const { role, isOperator } = useAgencyRole(agencyId, MENU_CACHE);
  if (!isAuthenticated) return null;
  if (isOperator) return "operator";
  return role;
}

/** Whether `access` reaches at least `min` — the operator reaches everything. */
export const reaches = (access: AdminAccess, min: AgencyRole | "operator"): boolean =>
  access === "operator" || (min !== "operator" && meets(access === null ? null : access, min));

export interface AdminCounts {
  /** A User's leads still `new` or `escalated` — row-level security counts only their own. */
  newLeads: number;
  /** Open leads nobody works yet — Admin+, who assign them. */
  unassigned: number;
  /** Clearinghouse requests waiting to be submitted — the client sent the code. */
  maslekaWaiting: number;
  total: number;
}

/** Under the leads' own key, so a status change on the leads screen refreshes the counter too. */
export const NEW_LEADS_KEY = ["admin", "leads", "new-count"] as const;
const REFRESH_MS = 60_000;

/** The requests at the board's "מוכן להגשה" stage: the code is in, waiting to be submitted. */
export const waitingCount = (requests: MaslekaRequest[]): number =>
  requests.filter((r) => r.status === "code_received").length;

/** Under the leads' own key too, so an assignment refreshes the counter. */
export const UNASSIGNED_KEY = ["admin", "leads", "unassigned-count"] as const;

export function useAdminCounts(access: AdminAccess): AdminCounts {
  const assigns = reaches(access, "admin");
  const leads = useQuery({
    queryKey: NEW_LEADS_KEY,
    queryFn: () => services.leadsAdmin.countNew(),
    enabled: access !== null && !assigns,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const queue = useQuery({
    queryKey: UNASSIGNED_KEY,
    queryFn: () => services.leadsAdmin.countUnassigned(),
    enabled: assigns,
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
  const newLeads = access !== null && !assigns ? leads.data ?? 0 : 0;
  const unassigned = assigns ? queue.data ?? 0 : 0;
  const maslekaWaiting = access !== null ? masleka.data ?? 0 : 0;
  return { newLeads, unassigned, maslekaWaiting, total: newLeads + unassigned + maslekaWaiting };
}
