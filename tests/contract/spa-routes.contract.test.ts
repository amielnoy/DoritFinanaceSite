import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { readVercelConfig, servesShell, sourcePattern } from "../helpers/vercel-routes";
import { TRANSLATED_ROUTES, localePath } from "../../src/i18n/locales";

/**
 * Which addresses Vercel answers with the app, and which with a 404.
 *
 * The app shell used to be the answer to every path (`/((?!assets/).*)`), so
 * `/nope-xyz` was a 200 carrying the home page's canonical and
 * `index, follow` — a soft 404, and a duplicate of the home page in the index
 * under any URL anyone cared to link (D-05, manual test 2026-10-14). Now only
 * the routes App.jsx registers get the shell; anything else falls through to
 * `dist/404.html`, which Vercel serves with a 404 status.
 *
 * The cost of the list is that it can drift: a route added to App.jsx and not
 * here works when clicked to and is a 404 when reloaded. These cases are what
 * fails first.
 */
const { rewrites, headers } = readVercelConfig();
const app = readFileSync(join(REPO_ROOT, "src/App.jsx"), "utf8");

/** Every absolute `path="/…"` App.jsx registers, a `:param` filled with a sample. */
const appRoutes = [...app.matchAll(/path="(\/[^"]*)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "/")
  .map((p) => p.replace(/:[A-Za-z_]\w*/g, "sample-1"));

describe("the routes the app serves", () => {
  it("finds App.jsx's routes to check", () => {
    expect(appRoutes).toContain("/faq");
    expect(appRoutes).toContain("/admin/leads");
    expect(appRoutes.length).toBeGreaterThan(15);
  });

  it.each(appRoutes)("%s is served the app on a reload", (path) => {
    expect(servesShell(rewrites, path), `${path} is routed in App.jsx but vercel.json answers it 404`).toBe(true);
  });

  it.each(["en", "fr"] as const)("the %s pages are served the app", (locale) => {
    for (const route of TRANSLATED_ROUTES) {
      const path = localePath(locale, route);
      expect(servesShell(rewrites, path), `${path} is a 404`).toBe(true);
    }
  });

  it("an article published since the last build is served the app", () => {
    // Its prerendered file does not exist yet; the app reads it live.
    expect(servesShell(rewrites, "/blog/new-article-slug")).toBe(true);
  });
});

describe("an address no route claims", () => {
  it.each(["/nope-xyz", "/blog/a/b", "/admin", "/admin/nope", "/en/nope", "/de", "/assets/Gone-OLDHASH.js"])(
    "%s is not served the app, so it gets the 404 page",
    (path) => {
      expect(servesShell(rewrites, path)).toBe(false);
    },
  );
});

describe("private screens are kept out of the index by a header too", () => {
  // The shell's static <head> says `index, follow`; the app corrects it once
  // it runs (SeoRouteGuard), which a crawler that does not run scripts never
  // sees.
  const noindex = (path: string) =>
    headers.some(
      (rule) =>
        sourcePattern(rule.source).test(path) &&
        rule.headers.some((h) => h.key.toLowerCase() === "x-robots-tag" && /noindex/.test(h.value)),
    );

  it.each(["/login", "/account", "/masleka", "/admin/leads", "/admin/masleka/guide", "/404"])("%s", (path) => {
    expect(noindex(path), `${path} has no X-Robots-Tag: noindex`).toBe(true);
  });

  it.each(["/", "/faq", "/blog", "/blog/horadat-dmei-nihul", "/claims"])("but not the public page %s", (path) => {
    expect(noindex(path)).toBe(false);
  });
});

describe("dist/404.html", () => {
  const prerender = readFileSync(join(REPO_ROOT, "scripts/prerender.mjs"), "utf8");

  it("is written by the prerender, from the shell first and then as the rendered not-found page", () => {
    expect(prerender).toMatch(/cp\(shellPath, join\(DIST, '404\.html'\)\)/);
    expect(prerender).toMatch(/const NOT_FOUND_ROUTE = '\/404'/);
    expect(prerender).toMatch(/NOT_FOUND_ROUTE,\n\s*\]/);
  });
});
