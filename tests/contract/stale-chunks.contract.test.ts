import { describe, expect, it } from "vitest";
import { readVercelConfig, servesShell, shellRules, sourcePattern } from "../helpers/vercel-routes";

/**
 * A chunk a newer deploy no longer has must be missing, not the app shell.
 *
 * The SPA rewrite used to catch `/assets/*` too, so an old tab that asked for
 * a removed page chunk got `200 text/html` — which the browser refuses as a
 * module, and which the `/assets` header rule then cached as immutable for a
 * year under that chunk's name. On 2026-10-12 that was /faq in a tab opened
 * before the day's deploys.
 */
describe("hashed assets that no longer exist", () => {
  const { rewrites } = readVercelConfig();

  it("are not rewritten to the app shell", () => {
    expect(shellRules(rewrites).length).toBeGreaterThan(0);
    for (const rule of shellRules(rewrites)) {
      expect(sourcePattern(rule.source).test("/assets/Faq-OLDHASH.js"), `${rule.source} still swallows /assets`).toBe(false);
    }
    // And the shell is still what serves a page that has no file of its own.
    expect(servesShell(rewrites, "/faq"), "no rule serves /faq the app").toBe(true);
  });
});
