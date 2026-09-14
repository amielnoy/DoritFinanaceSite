import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Only one thing may promote production, and it must be the one that waits for tests.
 *
 * Vercel's Git integration and the CI workflow both deploy this project. While Vercel
 * was staging that was merely wasteful — two builds per push, last one wins. It stops
 * being harmless the moment the custom domain points at Vercel: the Git integration
 * fires immediately and ignores the test run, so a red push would reach customers
 * while the workflow was still deciding whether to allow it.
 *
 * `git.deploymentEnabled` turns Git-triggered builds off for the branches CI deploys
 * itself, and leaves them on everywhere else so pull requests keep their previews.
 */

const REPO_ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

describe("production has one promoter", () => {
  const vercel = JSON.parse(read("vercel.json"));
  const workflow = read(".github/workflows/ci.yml");

  it("disables Git-triggered deploys on every branch CI deploys itself", () => {
    const enabled = vercel.git?.deploymentEnabled;
    expect(enabled, "vercel.json has no git.deploymentEnabled").toBeDefined();
    // These are the two the workflow's deploy-vercel job targets.
    expect(enabled.main).toBe(false);
    expect(enabled.builder).toBe(false);
  });

  it("leaves previews on for every other branch", () => {
    // Unlisted branches default to true. A blanket `false` would be easy to reach for
    // and would take pull-request previews down with it.
    expect(vercel.git.deploymentEnabled).not.toBe(false);
    expect(Object.entries(vercel.git.deploymentEnabled).every(([, v]) => v === false)).toBe(true);
    expect(Object.keys(vercel.git.deploymentEnabled).sort()).toEqual(["builder", "main"]);
  });

  it("keeps CI the thing that deploys, and keeps it behind the tests", () => {
    expect(workflow).toContain("vercel deploy --prebuilt");
    // The job must not start until the suites have, or the gate is decorative.
    expect(workflow).toMatch(/deploy-vercel:[\s\S]*?needs: \[build, test-node, test-e2e\]/);
  });
});
