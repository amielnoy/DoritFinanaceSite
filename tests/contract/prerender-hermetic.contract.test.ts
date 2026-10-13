import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The prerender runs the real app in Chromium once per route. Without this
 * block each build sent one fake page_view per route to Google Analytics, so
 * the abort is pinned the same way e2e/fixtures/app.ts does it (CTR-PRH-001).
 */
describe("the prerender is hermetic", () => {
  const source = readFileSync(join(REPO_ROOT, "scripts/prerender.mjs"), "utf8");
  const fixture = readFileSync(join(REPO_ROOT, "e2e/fixtures/app.ts"), "utf8");

  it("aborts requests to the analytics hosts, as the e2e fixture does", () => {
    const pattern = /page\.route\(\/googletagmanager\\\.com\|google-analytics\\\.com\/,/;
    expect(fixture).toMatch(pattern);
    expect(source).toMatch(pattern);
    expect(source).toMatch(/r\.abort\(\)/);
  });

  it("installs the abort before navigating", () => {
    expect(source.indexOf("google-analytics")).toBeGreaterThan(-1);
    expect(source.indexOf("google-analytics")).toBeLessThan(source.indexOf("await page.goto("));
  });
});
