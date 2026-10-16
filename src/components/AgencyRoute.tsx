import React, { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import { meets, type AgencyRole } from "@/config/permissions";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { useAuth } from "@/lib/AuthContext";

/**
 * An agency screen's gate: signed in, and at least `min` in the current agency
 * (`?agency=`, else the person's own), or the platform operator.
 *
 * Builds on ProtectedRoute exactly as AdminRoute does. The role is asked of the
 * database on each visit (`my_agency_role`, through useAgencyRole) and never
 * cached across mounts — but this only chooses which screen to offer. Row-level
 * security and the Edge Functions decide every read and write, so a membership
 * removed mid-session fails on the next request.
 *
 * Fails closed: the outlet renders only for the operator or a role at or
 * above `min`; a failed check says so instead of guessing.
 */
export interface AgencyRouteProps {
  min: AgencyRole;
  unauthenticatedElement: React.ReactElement;
}

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

export default function AgencyRoute({ min, unauthenticatedElement }: AgencyRouteProps) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();
  const { agencyId, isLoading: agenciesLoading } = useCurrentAgency();
  const { role, isOperator, isLoading, isError } = useAgencyRole(agencyId);

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) void checkUserAuth();
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) return <Spinner />;
  if (authError || !isAuthenticated) return <ProtectedRoute fallback={<Spinner />} unauthenticatedElement={unauthenticatedElement} />;
  if (isOperator) return <Outlet />;
  if (!user?.id) return <Navigate to="/" replace />;
  if (agenciesLoading || isLoading) return <Spinner />;
  if (isError) {
    return (
      <p role="alert" dir="rtl" className="max-w-[720px] mx-auto px-4 py-16 text-center">
        לא הצלחנו לאמת את ההרשאה. רעננו את הדף.
      </p>
    );
  }
  if (!meets(role, min)) return <Navigate to="/" replace />;
  return <Outlet />;
}
