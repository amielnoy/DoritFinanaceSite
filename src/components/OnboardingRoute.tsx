import React, { useEffect } from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/AuthContext";
import { useOnboardingRole } from "@/hooks/useOnboarding";

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

/**
 * The wizard's gate: the platform operator, or the owner of the agency being
 * set up (onboarding_role — my_agency_role is null for a draft, so AgencyRoute
 * would turn the owner away). Only chooses the screen; row-level security and
 * the RPCs decide every read and write.
 */
export default function OnboardingRoute({ unauthenticatedElement }: { unauthenticatedElement: React.ReactElement }) {
  const { agencyId = "" } = useParams();
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();
  const isOperator = user?.role === "admin";
  const role = useOnboardingRole(isAuthenticated && !isOperator ? agencyId : "");

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) void checkUserAuth();
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) return <Spinner />;
  if (authError || !isAuthenticated) return <ProtectedRoute fallback={<Spinner />} unauthenticatedElement={unauthenticatedElement} />;
  if (isOperator) return <Outlet />;
  if (role.isPending) return <Spinner />;
  if (role.data !== "owner") return <Navigate to="/" replace />;
  return <Outlet />;
}
