import React from "react";
import { useT } from "@/i18n/LocaleContext";

/**
 * "Skip to main content" — the first thing Tab reaches on every page, hidden
 * until it has focus (WCAG 2.4.1). Without it the first Tab landed on the logo,
 * and a keyboard visitor tabbed through the whole header on every page (D-08,
 * manual test 2026-10-14).
 *
 * Every page's `<main>` is `id="main"`, so the link works as a plain anchor in
 * the prerendered HTML before the app runs. Once it runs, the click moves
 * focus there as well as the view — a bare hash scrolls without moving focus
 * in some browsers, and ScrollToTop would read it as a section to scroll to —
 * and keeps the address free of a `#main`.
 */
export default function SkipLink() {
  const t = useT("common");
  const skip = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById("main") ?? document.querySelector("main");
    if (!main) return;
    e.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    // focus() brings it into view as well.
    main.focus();
  };
  return (
    <a
      href="#main"
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-3 focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-highlight"
    >
      {t("a11y.skipToMain")}
    </a>
  );
}
