import { can, type Action, type AgencyRole } from "../../src/config/permissions";

/**
 * A stand-in for src/hooks/useAgency.ts in component tests: the signed-in
 * person's role in one agency, set by the test.
 *
 *   const role = vi.hoisted(() => ({ role: "owner", isOperator: true }) as RoleState);
 *   vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));
 *
 * `can()` reads the real src/config/permissions.ts, so a screen tested here
 * shows what that table allows its role, not what the test assumes.
 */
export interface RoleState {
  role: AgencyRole | null;
  isOperator: boolean;
  /** The person's agencies, for the switcher; one by default. */
  agencies?: { id: string; name: string; role: AgencyRole }[];
}

export const AGENCY_1 = "00000000-0000-0000-0000-000000000001";

export function agencyHookMock(state: RoleState) {
  const agencies = () => state.agencies ?? (state.role ? [{ id: AGENCY_1, name: "דורית גוב ארי", role: state.role }] : []);
  const roleState = () => ({
    role: state.role,
    isOperator: state.isOperator,
    can: (action: Action) => can(state.role, state.isOperator, action),
    isLoading: false,
    isError: false,
  });
  return {
    AGENCY_1,
    useMyAgencies: () => ({ data: agencies(), isLoading: false }),
    useCurrentAgency: () => ({ agencyId: agencies()[0]?.id ?? AGENCY_1, agencies: agencies(), setAgency: () => {}, isLoading: false }),
    useAgencyRole: () => roleState(),
  };
}
