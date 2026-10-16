import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Nothing said which Node the project needs (manual test 2026-10-14). Vite 8
 * and its React plugin need 22.12 or later, and CI runs 22, so a checkout on
 * an older Node failed somewhere in the build with nothing pointing at the
 * cause. package.json's `engines` says it (npm warns on install), `.nvmrc`
 * lets nvm and fnm pick it, and these keep both in step with CI.
 */
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const ciNode = read(".github/workflows/ci.yml").match(/^\s*NODE_VERSION:\s*"?(\d+)"?/m)?.[1];

describe("the Node version is pinned", () => {
  it("package.json asks for Node 22.12 or later, and the lockfile agrees", () => {
    expect(pkg.engines?.node).toBe(">=22.12.0");
    expect(lock.packages[""].engines?.node).toBe(pkg.engines.node);
  });

  it(".nvmrc names the major CI runs", () => {
    expect(ciNode, "ci.yml has no NODE_VERSION").toBeTruthy();
    expect(read(".nvmrc").trim()).toBe(ciNode);
  });

  it("CI's Node satisfies the engines floor", () => {
    expect(Number(ciNode)).toBeGreaterThanOrEqual(22);
  });
});
