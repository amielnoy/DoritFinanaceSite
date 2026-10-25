import { useQuery } from "@tanstack/react-query";
import { services } from "@/services";

/** The new-agency wizard's reads (VITE_AGENCY_ONBOARDING). Never cached past the screen: two people may be editing. */
export const onboardingKeys = {
  record: (agencyId: string) => ["onboarding", "record", agencyId] as const,
  role: (agencyId: string) => ["onboarding", "role", agencyId] as const,
  inProgress: ["onboarding", "in-progress"] as const,
};

/** Everything the wizard edits for one agency. */
export function useOnboardingRecord(agencyId: string) {
  return useQuery({
    queryKey: onboardingKeys.record(agencyId),
    queryFn: () => services.onboarding.load(agencyId),
    enabled: Boolean(agencyId),
    staleTime: 0,
    retry: false,
  });
}

/** The caller's role in an agency being set up (onboarding_role): only "owner" edits it. */
export function useOnboardingRole(agencyId: string) {
  return useQuery({
    queryKey: onboardingKeys.role(agencyId),
    queryFn: () => services.onboarding.role(agencyId),
    enabled: Boolean(agencyId),
    staleTime: 0,
    retry: false,
  });
}

/** Operator: draft and pending agencies, last edited first. */
export function useInProgressAgencies(enabled = true) {
  return useQuery({ queryKey: onboardingKeys.inProgress, queryFn: () => services.onboarding.listInProgress(), enabled, staleTime: 0 });
}
