import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { INDEXNOW_KEY } from "../../scripts/indexnow.mjs";

const ROOT = join(__dirname, "../..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const step = ci.slice(ci.indexOf("- name: Tell IndexNow about new and changed articles"));
const stepBlock = step.slice(0, step.indexOf("\n      - name:", 10) === -1 ? undefined : step.indexOf("\n      - name:", 10));

describe("IndexNow", () => {
  it("publishes the key file at the site root, holding the key", () => {
    expect(readFileSync(join(ROOT, "public", `${INDEXNOW_KEY}.txt`), "utf8").trim()).toBe(INDEXNOW_KEY);
  });

  it("is a step of the Vercel deploy job, for production only", () => {
    expect(step.length).toBeGreaterThan(0);
    expect(stepBlock).toContain("steps.target.outputs.env == 'production'");
    expect(stepBlock).toContain("node scripts/indexnow.mjs");
  });

  it("can never fail the deploy", () => {
    expect(stepBlock).toMatch(/continue-on-error:\s*true/);
    const source = readFileSync(join(ROOT, "scripts/indexnow.mjs"), "utf8");
    expect(source).not.toMatch(/process\.exit\(\s*[1-9]/);
    expect(source).not.toMatch(/process\.exitCode\s*=\s*[1-9]/);
  });
});
