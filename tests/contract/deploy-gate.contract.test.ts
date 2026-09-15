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

  it("keeps CI the thing that deploys", () => {
    expect(workflow).toContain("vercel deploy --prebuilt");
    expect(workflow).toMatch(/deploy-vercel:[\s\S]*?needs: \[build, test-node, test-e2e\]/);
  });

  it("promotes to production only when the suites went green", () => {
    // This test used to be part of the one above, asserting the `needs:` line
    // and calling that "behind the tests". It is not: `needs:` orders jobs, it
    // does not gate them, and deploy-vercel's own `if:` requires only `build`.
    // A red run reached the deploy step and, on main, handed it `--prod`.
    //
    // So assert the thing that actually decides, which is the step that chooses
    // the flag. Deploying on red is deliberate — promoting on red is the bug.
    const step = workflow.slice(
      workflow.indexOf("- name: Choose production or preview"),
      workflow.indexOf("- name: Build for Vercel"),
    );
    expect(step, "the step that picks --prod has moved or been renamed").toContain("prod=--prod");

    for (const result of ["needs.test-node.result", "needs.test-e2e.result"]) {
      expect(step, `--prod is not conditioned on ${result}`).toContain(result);
    }
    // Both suites, and the ref, on the branch that sets --prod.
    expect(step).toMatch(/\[ "\$GITHUB_REF" = "refs\/heads\/main" \][\s\S]*?\$UNIT[\s\S]*?\$E2E[\s\S]*?prod=--prod/);
  });

  it("still deploys a red run, as a preview", () => {
    // The reason staging exists: a failing run is when you most want the build
    // somewhere you can open it. Narrowing the job's `if:` to green would have
    // fixed the promotion hole by removing that, which is the wrong trade.
    const job = workflow.slice(workflow.indexOf("  deploy-vercel:"), workflow.indexOf("  smoke:"));
    expect(job).toMatch(/if: >-\s*\n\s*!cancelled\(\) &&\s*\n\s*needs\.build\.result == 'success'/);
    expect(job).not.toMatch(/if:[\s\S]{0,200}needs\.test-e2e\.result == 'success' &&[\s\S]{0,80}github\.ref/);
  });
});
