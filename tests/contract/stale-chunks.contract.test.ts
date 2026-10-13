import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

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
  const vercel = JSON.parse(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8")) as {
    rewrites: { source: string; destination: string }[];
  };

  it("are not rewritten to the app shell", () => {
    const shell = vercel.rewrites.filter((r) => r.destination === "/app");
    expect(shell.length).toBeGreaterThan(0);
    for (const rule of shell) {
      const re = new RegExp(`^${rule.source}$`);
      expect(re.test("/assets/Faq-OLDHASH.js"), `${rule.source} still swallows /assets`).toBe(false);
      expect(re.test("/faq"), `${rule.source} no longer serves the app`).toBe(true);
      expect(re.test("/"), `${rule.source} no longer serves the home page`).toBe(true);
    }
  });
});
