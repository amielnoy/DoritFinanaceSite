import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * ניווט לעוגן שנמצא רק בדף הבית, מכל מסלול שהוא.
 * Jumping to a section that only exists on the home page, from any route.
 *
 * Every `#about`-style section on this site lives on `/`. The header, the
 * footer and a CTA inside /claims all point at them, and all three are rendered
 * on routes where the target is absent. A bare `href="#about"` on /blog sets the
 * URL to `/blog#about`, finds no element of that id, and does nothing at all —
 * silently. Nothing errors, nothing logs; the link is simply inert.
 *
 * It is worse than a 404, which at least tells the visitor something happened.
 *
 * A hash-only anchor also fires `hashchange` rather than `popstate`, so React
 * Router never learns about it and `ScrollToTop` cannot rescue the click either.
 *
 * So: route home first, then scroll. This was written once inside
 * FloatingHeader and fixed only the header — the footer, which carries the
 * larger menu and sits on all seven pages, kept the dead links. One definition,
 * used by everything that points at a home section.
 */
export function useSectionNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  /**
   * `hash` is the fragment with its `#`, e.g. `"#about"`.
   *
   * Give the anchor a real `/#about` href alongside this handler, never a bare
   * `#about`: middle-click, "open in new tab" and a load with JS disabled all
   * go through the href and must land somewhere real on their own.
   */
  return useCallback(
    (e: React.MouseEvent, hash: string) => {
      // Leave modified clicks to the browser, or new-tab stops working.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();

      if (pathname !== "/") {
        navigate(`/${hash}`);
        return;
      }

      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
      // Keep the address bar honest without letting the browser jump-scroll.
      window.history.replaceState(null, "", hash);
    },
    [navigate, pathname]
  );
}

export default useSectionNav;
