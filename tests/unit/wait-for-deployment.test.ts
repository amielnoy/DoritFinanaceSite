import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure step.
import { releaseServed } from "../../scripts/wait-for-deployment.mjs";

/**
 * When the smoke may open a browser. With the asset the Vercel job just built
 * (`expected`), the answer is "when production serves that asset" — at once if
 * the bundle did not change, which is most commits. Without it (a preview
 * run), the old rule: "when production serves something other than
 * what it served before the publish".
 */
describe("releaseServed", () => {
  const OLD = "/assets/index-AAAA1111.js";
  const NEW = "/assets/index-BBBB2222.js";

  it("is served at once when the built bundle is the one already live", () => {
    expect(releaseServed({ served: OLD, expected: OLD, previous: OLD })).toBe(true);
  });

  it("waits while production still serves the previous bundle", () => {
    expect(releaseServed({ served: OLD, expected: NEW, previous: OLD })).toBe(false);
  });

  it("is served once production serves the built bundle", () => {
    expect(releaseServed({ served: NEW, expected: NEW, previous: OLD })).toBe(true);
  });

  it("does not accept some third bundle in place of the one just built", () => {
    expect(releaseServed({ served: "/assets/index-CCCC3333.js", expected: NEW, previous: OLD })).toBe(false);
  });

  it("falls back to 'anything but the previous bundle' without an expected one", () => {
    expect(releaseServed({ served: OLD, expected: "", previous: OLD })).toBe(false);
    expect(releaseServed({ served: NEW, expected: "", previous: OLD })).toBe(true);
  });

  it("never counts an unreadable page as served", () => {
    expect(releaseServed({ served: null, expected: NEW, previous: OLD })).toBe(false);
    expect(releaseServed({ served: null, expected: "", previous: OLD })).toBe(false);
  });
});
