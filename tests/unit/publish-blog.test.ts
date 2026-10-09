import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { planPublish, readExecResult } from "../../scripts/publish-blog.mjs";

/**
 * Publishing is a deliberate, by-title action — never "everything that is
 * currently a draft" — so what is worth pinning is how each title resolves
 * against what Base44 actually holds: found and draft, found and already
 * published (a no-op, not a re-write), or not found at all (reported, never
 * silently skipped).
 */
describe("planPublish", () => {
  it("marks a draft found by title as ready to publish", () => {
    const [step] = planPublish(
      ["להוריד דמי ניהול בפנסיה"],
      [{ id: "b44-7", title: "להוריד דמי ניהול בפנסיה", published: false }]
    );
    expect(step).toEqual({ title: "להוריד דמי ניהול בפנסיה", found: true, id: "b44-7", alreadyPublished: false });
  });

  it("marks an already-published title as a no-op rather than re-writing it", () => {
    const [step] = planPublish(
      ["להוריד דמי ניהול בפנסיה"],
      [{ id: "b44-7", title: "להוריד דמי ניהול בפנסיה", published: true }]
    );
    expect(step.alreadyPublished).toBe(true);
  });

  it("reports a title that matches no post, instead of throwing or silently skipping it", () => {
    const [step] = planPublish(["מאמר שלא קיים"], []);
    expect(step).toEqual({ title: "מאמר שלא קיים", found: false });
  });

  it("resolves every title independently, in the order given", () => {
    const steps = planPublish(
      ["א", "ב", "ג"],
      [{ id: "1", title: "א", published: false }, { id: "2", title: "ג", published: true }]
    );
    expect(steps.map((s: { title: string }) => s.title)).toEqual(["א", "ב", "ג"]);
    expect(steps[0]).toMatchObject({ found: true, alreadyPublished: false });
    expect(steps[1]).toMatchObject({ found: false });
    expect(steps[2]).toMatchObject({ found: true, alreadyPublished: true });
  });
});

/**
 * The real run this pins against: the publish exec call printed the bare
 * word `ok` after the marker instead of a JSON-encoded string, and
 * readExecResult's JSON.parse blew up on it *after* the Base44 updates had
 * already run — the writes succeeded, only reading back the confirmation
 * crashed the script, in a way this test would have caught before the first
 * real GitHub Actions run did.
 */
describe("readExecResult", () => {
  it("parses a JSON-encoded string result, not just an array or object", () => {
    const stdout = ['npm notice run base44-app@0.0.0 npx', '@@publish-blog@@"ok"'].join("\n");
    expect(readExecResult(stdout)).toBe("ok");
  });

  it("throws a clear error rather than a JSON.parse crash on a bare, unquoted word", () => {
    // This is the exact shape of the bug this test exists to catch — guard
    // against reintroducing `console.log(RESULT + "ok")` instead of
    // `console.log(RESULT + JSON.stringify("ok"))`.
    const stdout = "@@publish-blog@@ok";
    expect(() => readExecResult(stdout)).toThrow();
  });
});
