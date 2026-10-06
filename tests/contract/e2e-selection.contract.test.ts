import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * A block for one kind of device is selected by tag, not skipped by condition.
 *
 * `test.skip(({ isMobile }) => …)` at the top of a describe runs as a hook, and
 * allure-playwright reports every skip it makes as a failed hook: the Allure
 * report carried 38 "Global Errors" reading "skip modifier failed: Test is
 * skipped: mobile projects only", on a run where nothing had failed.
 * Noise in that tab hides the day it holds something real.
 *
 * The blocks are tagged `@mobile-only` / `@desktop-only` instead, and each
 * project's `grepInvert` in playwright.config.ts keeps it from collecting the
 * other kind's.
 */

const E2E = join(REPO_ROOT, "e2e");

function specs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return specs(path);
    return name.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("e2e — choosing which device runs a block", () => {
  it("finds the specs to check", () => {
    expect(specs(E2E).length).toBeGreaterThan(5);
  });

  it("never skips by a condition callback, which Allure reports as a failed hook", () => {
    const offenders = specs(E2E).filter((path) => /test\.skip\(\s*\(/.test(readFileSync(path, "utf8")));
    expect(offenders.map((p) => relative(REPO_ROOT, p))).toEqual([]);
  });

  it("filters each tag out of the projects it does not belong to", () => {
    const config = readFileSync(join(REPO_ROOT, "playwright.config.ts"), "utf8");
    // Two desktop projects drop the mobile blocks; two phone projects drop the desktop ones.
    expect(config.match(/grepInvert:\s*\/@mobile-only\//g)?.length).toBe(2);
    expect(config.match(/grepInvert:\s*\/@desktop-only\//g)?.length).toBe(2);
  });
});
