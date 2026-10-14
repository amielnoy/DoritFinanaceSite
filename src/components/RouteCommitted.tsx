import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Marks `<html data-route-committed="<path>">` once React has committed the
 * element for the current route without suspending.
 *
 * The prerendered pages ship that route's markup inside #root, and main.jsx
 * mounts with createRoot, which throws the prerendered DOM away on its first
 * commit. "#root is not empty" therefore says nothing about whether the app is
 * live: anything grabbed, clicked or scrolled before that commit belongs to a
 * page that is about to vanish. e2e/fixtures/app.ts (gotoApp) waits for this
 * marker instead.
 *
 * What it does and does not promise:
 * - It sits beside the page ErrorBoundary inside the route Suspense, so it never
 *   commits while the route-chunk spinner shows, and it does commit when the
 *   boundary renders its error screen.
 * - "Committed" is the route element, not its data. A page that loads content
 *   (the blog list) or a guard that checks auth (ProtectedRoute, AdminRoute)
 *   commits its own spinner first; a test waits for what it needs beyond that.
 * - Navigating away from an error screen, the boundary resets on the next
 *   commit, so for one commit the new path can be marked over the old screen.
 *
 * It writes the router's pathname — the path of the route that committed — in a
 * passive effect, which runs after the commit, so the live DOM is attached by
 * the time anyone sees the marker. React Router keeps it percent-encoded, the
 * same as `location.pathname`, which is what a reader compares it with.
 *
 * scripts/prerender.mjs strips the attribute before it saves a page; a page
 * served with it would claim to be live before any JavaScript ran.
 */
export default function RouteCommitted(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    document.documentElement.dataset.routeCommitted = pathname;
  }, [pathname]);
  return null;
}
