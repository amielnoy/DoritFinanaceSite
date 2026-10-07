import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The Deno functions and the frontend must run the same Base44 SDK.
 *
 * The functions pin `npm:@base44/sdk@x.y.z` in each `entry.ts`; the frontend
 * takes a caret range from package.json. They drifted (0.8.44 vs ^0.8.53), so
 * the code the tests exercised was not the code that ran server-side. A
 * published function picks up a change only on the next Base44 publish.
 */
const FUNCTIONS = join(REPO_ROOT, "base44/functions");
// The lockfile, not node_modules: it is what `npm ci` installs in CI and on
// Base44, while a local node_modules can hold whatever an earlier install left.
const installed = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8")).packages[
  "node_modules/@base44/sdk"
].version as string;

const pins = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    try {
      const source = readFileSync(join(FUNCTIONS, d.name, "entry.ts"), "utf8");
      return [...source.matchAll(/npm:@base44\/sdk@([^'"\s]+)/g)].map((m) => ({
        fn: d.name,
        version: m[1],
      }));
    } catch {
      return [];
    }
  });

describe("Base44 SDK version parity", () => {
  it("finds at least one function pin", () => {
    expect(pins.length).toBeGreaterThan(0);
  });

  it.each(pins.map((p) => [p.fn, p.version]))(
    "%s pins the SDK version the lockfile installs",
    (_fn, version) => {
      expect(version).toBe(installed);
    },
  );
});
