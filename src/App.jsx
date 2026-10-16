import { Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { initClickTracking, initInternalFlag, measureRoute } from '@/lib/analytics';
import { captureAttribution } from '@/lib/attribution';
import { MotionConfig } from 'framer-motion';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
const PageNotFound = lazy(() => import('./lib/PageNotFound'));
import { AuthProvider } from '@/lib/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import LocaleLayout from '@/i18n/LocaleLayout';
import { ENABLED_LOCALES, DEFAULT_LOCALE } from '@/i18n/locales';
import RouteCommitted from '@/components/RouteCommitted';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import SeoRouteGuard from '@/components/SeoRouteGuard';
// `/react`, not `/next`: Vercel's docs lead with the Next entry, which pulls
// `next/navigation` and has nothing to bind to in a Vite SPA.
import { Analytics } from '@vercel/analytics/react';
import { stripFragment } from '@/lib/vercel-analytics';
// Add page imports here
// The home page is the marketing entry point and the LCP path, so it stays in
// the main chunk. Everything else is split out: mobile-first indexing scores
// Core Web Vitals on the phone experience, and a visitor landing on the home
// page should not download the blog admin and the rich-text editor to read it.
import Home from '@/pages/Home';
import FloatingActions from '@/components/dorit/layout/FloatingActions';
import AgencyRoute from '@/components/AgencyRoute';
import { MASLEKA_ENABLED } from '@/config/masleka';

const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const Accessibility = lazy(() => import('@/pages/Accessibility'));
const Account = lazy(() => import('@/pages/Account'));
const Login = lazy(() => import('@/pages/Login'));
const Leads = lazy(() => import('@/pages/Leads'));
// The admin interface's sidebar frame — inside the guards below, never instead of them.
const AdminLayout = lazy(() => import('@/components/dorit/admin/AdminLayout'));
const AdminUsers = lazy(() => import('@/pages/AdminUsers'));
const AgencyProfile = lazy(() => import('@/pages/AgencyProfile'));
const Blog = lazy(() => import('@/pages/Blog'));
const BlogPost = lazy(() => import('@/pages/BlogPost'));
const BlogAdmin = lazy(() => import('@/pages/BlogAdmin'));
const Claims = lazy(() => import('@/pages/Claims'));
const FAQPage = lazy(() => import('@/pages/FAQPage'));
const Tools = lazy(() => import('@/pages/Tools'));
const PensionCheck = lazy(() => import('@/pages/PensionCheck'));
const YearEndSelfEmployed = lazy(() => import('@/pages/YearEndSelfEmployed'));
const Perspective = lazy(() => import('@/pages/Perspective'));
const Masleka = lazy(() => import('@/pages/Masleka'));
const MaslekaBoard = lazy(() => import('@/pages/MaslekaBoard'));
const MaslekaGuide = lazy(() => import('@/pages/MaslekaGuide'));
const MaslekaAnalysis = lazy(() => import('@/pages/MaslekaAnalysis'));

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
// Sends a signed-out visitor to sign-in carrying the page they asked for, so
// they come back to it. A bare "/login" dropped it: an admin who opened
// /admin/leads signed in and landed on "/". The login page reads returnTo
// through `safeReturnTo`, which is the open-redirect guard — this only says
// where to come back to.
const LoginRedirect = () => {
  const { pathname, search } = useLocation();
  return <Navigate to={`/login?returnTo=${encodeURIComponent(pathname + search)}`} replace />;
};

// GA4 is off on /admin, switched before the route's screen renders (measureRoute).
const AnalyticsRouteGuard = () => {
  const { pathname } = useLocation();
  useLayoutEffect(() => measureRoute(pathname), [pathname]);
  return null;
};

const AuthenticatedApp = () => {
  const { pathname } = useLocation();
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
      <ErrorBoundary scope="page" resetKey={pathname}>
      <Routes>
        {/* English and French (/en, /fr): the public pages only, and only for
            the languages VITE_LOCALES names — a build without it registers
            none of these (src/i18n/locales.ts). */}
        {ENABLED_LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => (
          <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
            <Route index element={<Home />} />
            <Route path="tools" element={<Tools />} />
            <Route path="pension-check" element={<PensionCheck />} />
            <Route path="claims" element={<Claims />} />
            <Route path="faq" element={<FAQPage />} />
            <Route path="atzmaim-31-12" element={<YearEndSelfEmployed />} />
            <Route path="*" element={<PageNotFound />} />
          </Route>
        ))}
        {/* Hebrew, at the unprefixed addresses — every page, as before. */}
        <Route element={<LocaleLayout locale={DEFAULT_LOCALE} />}>
        {/* Add your page Route elements here */}
        <Route path="/" element={<Home />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/accessibility" element={<Accessibility />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:key" element={<BlogPost />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/pension-check" element={<PensionCheck />} />
        <Route path="/atzmaim-31-12" element={<YearEndSelfEmployed />} />
        <Route path="/perspective" element={<Perspective />} />
        <Route path="/masleka" element={<Masleka />} />
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login?returnTo=/account" replace />} />}>
          {/* The admin's main page sits in the admin frame; a client's is the plain page. */}
          <Route element={<AdminLayout adminOnly />}>
            <Route path="/account" element={<Account />} />
          </Route>
        </Route>
        {/* An agency's screens, by the least role each needs in the current
            agency (AgencyRoute; the platform operator passes every one). The
            screens hide what a role may not do; row-level security and the
            functions refuse it. */}
        <Route element={<AgencyRoute min="user" unauthenticatedElement={<LoginRedirect />} />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin/leads" element={<Leads />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/blog" element={<BlogAdmin />} />
          </Route>
        </Route>
        <Route element={<AgencyRoute min="owner" unauthenticatedElement={<LoginRedirect />} />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin/agency" element={<AgencyProfile />} />
          </Route>
        </Route>
        {/* The clearinghouse board: any member of the agency (a User sees their
            own requests). Not registered at all until VITE_MASLEKA_ENABLED — a
            dark build answers 404 here. */}
        {MASLEKA_ENABLED ? (
          <Route element={<AgencyRoute min="user" unauthenticatedElement={<LoginRedirect />} />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin/masleka" element={<MaslekaBoard />} />
              <Route path="/admin/masleka/guide" element={<MaslekaGuide />} />
              <Route path="/admin/masleka/analysis/:snapshotId" element={<MaslekaAnalysis />} />
            </Route>
          </Route>
        ) : null}
        <Route path="*" element={<PageNotFound />} />
        </Route>
      </Routes>
      </ErrorBoundary>
      {/* After the route (or its error screen) commits — read by e2e gotoApp. */}
      <RouteCommitted />
      </Suspense>
      <FloatingActions />
    </>
  );
};


function App() {
  // GA4 lead events: one click listener for the whole site, and the
  // ?internal=1 marker for the agency's own browsers. See src/lib/analytics.ts.
  useEffect(() => {
    initInternalFlag();
    initClickTracking();
    captureAttribution();
  }, []);

  return (
    <AuthProvider>
      {/* One switch for every motion component on the site. `user` means the
          operating system decides, which is the only party that knows. */}
      <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AnalyticsRouteGuard />
          <SeoRouteGuard />
          {/* Mounted only where its endpoint exists. The beacon posts to
              `/_vercel/insights/*`, a path Vercel's edge synthesises and no
              other host serves — so on Base44, while it was production, the
              component mounted, found nothing, and cost a failed request on
              every page load while reporting no data at all. The flag is
              derived from `VERCEL` in `vite.config.js`, so there is nothing to
              set per environment and nothing to forget. */}
          {import.meta.env.VITE_VERCEL_ANALYTICS ? <Analytics beforeSend={stripFragment} /> : null}
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
      </MotionConfig>
    </AuthProvider>
  )
}

export default App