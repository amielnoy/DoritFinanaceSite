import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Dockerfile.test runs the suite on Microsoft's Playwright image, whose
 * browsers are built for exactly one Playwright release. Bump @playwright/test
 * without the tag and the container's Playwright refuses to launch them — a
 * failure nobody sees until someone next runs the container, since CI installs
 * its browsers from npm instead.
 */
const installed: string = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8")).packages[
  "node_modules/@playwright/test"
].version;

describe("Playwright version parity", () => {
  it("runs the container on the image built for the installed Playwright", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile.test"), "utf8");
    const tag = dockerfile.match(/^FROM mcr\.microsoft\.com\/playwright:v([\d.]+)-/m)?.[1];
    expect(tag, "Dockerfile.test has no Playwright base image").toBeTruthy();
    expect(tag).toBe(installed);
  });
});
