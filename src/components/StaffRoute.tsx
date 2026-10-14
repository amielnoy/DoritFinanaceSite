import React, { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/AuthContext";
import { services, type StaffRole } from "@/services";

/**
 * The clearinghouse board's gate: signed in, and either the platform admin
 * or a member of the agency (any `memberships` role in agency 1).
 *
 * Builds on ProtectedRoute exactly as AdminRoute does; the blog and the site
 * administration stay behind AdminRoute, admin-only. The role is asked of
 * the database on each visit (`my_staff_role`) and never cached across
 * mounts — but this only decides which screen to offer. Every action the
 * board takes is re-checked by the Edge Function that performs it, so a
 * membership removed mid-session fails on the next click.
 *
 * Fails closed: the outlet renders only for `user.role === "admin"` or a
 * known staff role. The query is keyed by user id, so another user who signs
 * in in the same tab never sees the previous user's answer.
 */
export interface StaffRouteProps {
  unauthenticatedElement: React.ReactElement;
  loadRole?: () => Promise<StaffRole | null>;
}

const STAFF_ROLES: readonly string[] = ["admin", "owner", "agent", "staff"];

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

export default function StaffRoute({
  unauthenticatedElement,
  loadRole = () => services.masleka.myRole(),
}: StaffRouteProps) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) void checkUserAuth();
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  const userId: string = user?.id ?? "";
  const signedIn = authChecked && !isLoadingAuth && !authError && isAuthenticated;
  const isAdmin = user?.role === "admin";
  const role = useQuery({
    queryKey: ["admin", "staff-role", userId],
    queryFn: loadRole,
    enabled: signedIn && !isAdmin && userId !== "",
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  if (isLoadingAuth || !authChecked) return <Spinner />;
  if (authError || !isAuthenticated) return <ProtectedRoute fallback={<Spinner />} unauthenticatedElement={unauthenticatedElement} />;
  if (isAdmin) return <Outlet />;
  if (userId === "") return <Navigate to="/" replace />;
  if (role.isPending) return <Spinner />;
  if (role.isError) {
    return (
      <p role="alert" dir="rtl" className="max-w-[720px] mx-auto px-4 py-16 text-center">
        לא הצלחנו לאמת את ההרשאה. רעננו את הדף.
      </p>
    );
  }
  if (typeof role.data !== "string" || !STAFF_ROLES.includes(role.data)) return <Navigate to="/" replace />;
  return <Outlet />;
}
