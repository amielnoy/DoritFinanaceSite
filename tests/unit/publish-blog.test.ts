import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { planPublish } from "../../scripts/publish-blog.mjs";

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
