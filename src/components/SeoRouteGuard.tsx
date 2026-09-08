import { useLocation } from "react-router-dom";
import { applySeo } from "@/lib/seo";
import { useEffect } from "react";

/**
 * Keeps private and non-content routes out of search results.
 *
 * The static <head> in index.html says `index, follow`, so without this the
 * login, registration, password-reset, OAuth-consent and admin screens were all
 * indexable — thin, duplicate pages that dilute the site's ranking and can
 * surface an admin URL in results.
 *
 * Public pages declare their own metadata with useSeo() and are deliberately
 * absent from this list, so the two never fight: this component only acts on a
 * path it recognises as private.
 */
const NO_INDEX_ROUTES: Array<{ match: RegExp; title: string; description: string }> = [
  { match: /^\/login\/?$/, title: "כניסה | דורית גוב ארי", description: "כניסה לאזור האישי." },
  { match: /^\/register\/?$/, title: "הרשמה | דורית גוב ארי", description: "יצירת חשבון." },
  { match: /^\/forgot-password\/?$/, title: "שחזור סיסמה | דורית גוב ארי", description: "איפוס סיסמה." },
  { match: /^\/reset-password\/?$/, title: "איפוס סיסמה | דורית גוב ארי", description: "בחירת סיסמה חדשה." },
  { match: /^\/oauth\//, title: "אישור גישה | דורית גוב ארי", description: "אישור גישה ליישום." },
  { match: /^\/admin(\/|$)/, title: "ניהול | דורית גוב ארי", description: "אזור ניהול." },
];

export default function SeoRouteGuard() {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = NO_INDEX_ROUTES.find((r) => r.match.test(pathname));
    if (!route) return;
    applySeo({
      title: route.title,
      description: route.description,
      path: pathname,
      noIndex: true,
    });
  }, [pathname]);

  return null;
}
