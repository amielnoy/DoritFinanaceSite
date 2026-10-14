import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches, read synchronously on the first render.
 *
 * `use-mobile.jsx` starts at `undefined` and settles in an effect, so a phone
 * paints the desktop layout for one frame first. This one asks `matchMedia`
 * during render, so the first frame is already the right one.
 *
 * `fallback` is the answer where there is no `matchMedia` at all — jsdom, and
 * a prerender that never laid anything out.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : fallback,
    () => fallback,
  );
}

/** Tailwind's `md`: the width at which the site stops being laid out for a phone. */
export const MD_UP = "(min-width: 768px)";
