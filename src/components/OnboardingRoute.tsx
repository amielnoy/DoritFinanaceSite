import React, { useEffect } from "react";
import { Link, Navigate, Outlet, useParams } from "react-router-dom";
import { ExternalLink, LogOut } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/AuthContext";
import { useOnboardingRole } from "@/hooks/useOnboarding";
import { useAdminAccess } from "@/hooks/useAdminMenu";

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

/**
 * The owner's way out of the wizard. An agency still being set up gives its
 * owner no admin role yet, so AdminLayout renders the bare page — without
 * this bar there is no link back to the site and no sign-out.
 */
function OwnerBar() {
  const { logout } = useAuth();
  if (useAdminAccess() !== null) return null;
  return (
    <header dir="rtl" className="border-b border-border bg-surface print:hidden">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-3">
        <span className="font-heading text-lg font-bold">הקמת סוכנות</span>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm hover:border-accent">
            <ExternalLink size={16} aria-hidden="true" />
            לאתר
          </Link>
          <button type="button" onClick={() => logout(true, `${window.location.origin}/`)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm text-destructive hover:border-destructive">
            <LogOut size={16} aria-hidden="true" />
            יציאה
          </button>
        </div>
      </div>
    </header>
  );
}

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
  return (
    <>
      <OwnerBar />
      <Outlet />
    </>
  );
}
