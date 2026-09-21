import { Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import SeoRouteGuard from '@/components/SeoRouteGuard';
// Add page imports here
// The home page is the marketing entry point and the LCP path, so it stays in
// the main chunk. Everything else is split out: mobile-first indexing scores
// Core Web Vitals on the phone experience, and a visitor landing on the home
// page should not download the blog admin and the rich-text editor to read it.
import Home from '@/pages/Home';
import FloatingActions from '@/components/dorit/layout/FloatingActions';
import AdminRoute from '@/components/AdminRoute';

const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const Accessibility = lazy(() => import('@/pages/Accessibility'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const Leads = lazy(() => import('@/pages/Leads'));
const Blog = lazy(() => import('@/pages/Blog'));
const BlogPost = lazy(() => import('@/pages/BlogPost'));
const BlogAdmin = lazy(() => import('@/pages/BlogAdmin'));
const Claims = lazy(() => import('@/pages/Claims'));
const FAQPage = lazy(() => import('@/pages/FAQPage'));
const Tools = lazy(() => import('@/pages/Tools'));
const Perspective = lazy(() => import('@/pages/Perspective'));

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

// The routes render immediately, including before auth has been checked.
//
// This used to open with a full-screen spinner held until `getPublicSettings()`
// resolved, and then send the visitor to `/login` if it came back
// `auth_required`. On a lead-generation site that inverts the priority twice
// over: the marketing copy that earns the phone call waited on a service only
// the admin area needs, and a backend hiccup bounced a visitor to a login screen
// for a site that has nothing to log into and no account to use.
//
// The gate was also redundant. `ProtectedRoute` and `AdminRoute` each run their
// own `checkUserAuth()` and render their own fallback, so `/admin/*` is guarded
// by the component that guards it — not by a blanket check in front of the whole
// router. Nothing outside this file read `appPublicSettings` or
// `isLoadingPublicSettings`; the gate's only effect was on first paint.
//
// `AuthProvider` still resolves auth in the background, so a visitor who *is*
// signed in still is, and a deep link into the admin area still waits for the
// answer — inside the guard, where waiting is correct.
//
// E2E-HOM-001 and E2E-HOM-006 assert the home page renders with the backend
// dead, which is exactly the case this used to fail.
const AuthenticatedApp = () => {
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Add your page Route elements here */}
        <Route path="/" element={<Home />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/accessibility" element={<Accessibility />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:id" element={<BlogPost />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/perspective" element={<Perspective />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<AdminRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
          <Route path="/admin/leads" element={<Leads />} />
          <Route path="/admin/blog" element={<BlogAdmin />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
      </Suspense>
      <FloatingActions />
    </>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <SeoRouteGuard />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App