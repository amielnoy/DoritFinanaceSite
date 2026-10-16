import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { can as allowed, type Action } from "@/config/permissions";
import { services, type AgencyRole, type MyAgency } from "@/services";

/** Agency 1 — Dorit's. The operator's default, and the site's own content's agency. */
export const AGENCY_1 = "00000000-0000-0000-0000-000000000001";

/**
 * How long an answer may be reused. A route guard asks fresh on every mount
 * (the default); the header's menu, mounted on every public page, may reuse an
 * answer for a few minutes — it only decides whether to show a link.
 */
export interface Freshness {
  staleTime?: number;
}
const FRESH = { staleTime: 0, gcTime: 0 };
const cacheFor = (o?: Freshness) => (o?.staleTime ? { staleTime: o.staleTime } : FRESH);

/**
 * The agencies the signed-in person belongs to. Keyed by the user, and by
 * default never cached past the mount that asked: a membership removed a
 * minute ago is gone from the next screen, and another person signing in
 * never sees this list.
 */
export function useMyAgencies(options?: Freshness) {
  const { user, isAuthenticated } = useAuth();
  const userId = typeof user?.id === "string" ? user.id : "";
  return useQuery({
    queryKey: ["agency", "mine", userId],
    queryFn: () => services.agency.myAgencies(userId),
    enabled: isAuthenticated && userId !== "",
    ...cacheFor(options),
    retry: false,
  });
}

export interface CurrentAgency {
  /** The agency the admin screens act on. */
  agencyId: string;
  agencies: MyAgency[];
  /** Keeps the choice in the URL (`?agency=`), so a reload and a shared link keep it. */
  setAgency(id: string): void;
  isLoading: boolean;
}

/**
 * The agency the screens act on: `?agency=` when it is one of the person's,
 * else the first of theirs (agency 1 first when they are in it), else agency
 * 1 — which is where the platform operator, a member of none, lands.
 */
export function useCurrentAgency(options?: Freshness): CurrentAgency {
  const [params, setParams] = useSearchParams();
  const mine = useMyAgencies(options);
  const agencies = mine.data ?? [];
  const asked = params.get("agency") ?? "";
  const agencyId =
    agencies.find((a) => a.id === asked)?.id ??
    agencies.find((a) => a.id === AGENCY_1)?.id ??
    agencies[0]?.id ??
    AGENCY_1;
  const setAgency = useCallback(
    (id: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("agency", id);
        return next;
      }),
    [setParams],
  );
  return { agencyId, agencies, setAgency, isLoading: mine.isLoading };
}

export interface AgencyRoleState {
  role: AgencyRole | null;
  /** The platform operator (`profiles.role = 'admin'`) — not an agency's Admin. */
  isOperator: boolean;
  can(action: Action): boolean;
  isLoading: boolean;
  isError: boolean;
}

/**
 * The signed-in person's role in one agency, asked of the database
 * (`my_agency_role`) on each mount and keyed by user and agency. It only
 * chooses what to show; the database and the functions decide.
 */
export function useAgencyRole(agencyId: string, options?: Freshness): AgencyRoleState {
  const { user, isAuthenticated } = useAuth();
  const userId = typeof user?.id === "string" ? user.id : "";
  const isOperator = isAuthenticated && user?.role === "admin";
  const query = useQuery({
    queryKey: ["agency", "role", userId, agencyId],
    queryFn: () => services.agency.myRole(agencyId),
    enabled: isAuthenticated && userId !== "" && agencyId !== "",
    ...cacheFor(options),
    retry: false,
  });
  const role = query.data ?? null;
  return {
    role,
    isOperator,
    can: (action) => allowed(role, isOperator, action),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
