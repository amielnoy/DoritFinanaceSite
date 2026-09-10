import { useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

/**
 * Admin-only route. Builds on ProtectedRoute (auth gate) and additionally
 * restricts access to users whose role is "admin". Non-admins who somehow
 * land here are redirected to the home page — the data itself is already
 * locked down by RLS, this just keeps the page out of reach.
 */
export default function AdminRoute({ unauthenticatedElement }) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (authError || !isAuthenticated) {
    return <ProtectedRoute unauthenticatedElement={unauthenticatedElement} />;
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}