import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { planPublish, publishInSupabase, readExecResult } from "../../scripts/publish-blog.mjs";

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
    const stdout = ['npm notice run dorit-finance-site@0.0.0 npx', '@@publish-blog@@"ok"'].join("\n");
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

describe("publishInSupabase", () => {
  const reply = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );

  it("PATCHes the one row by base44_id, touching only `published`", async () => {
    const fetchImpl = reply([{ base44_id: "b44-7" }]);
    await publishInSupabase("https://x.supabase.co", "service-key", "b44-7", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/rest/v1/blog_posts?base44_id=eq.b44-7");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(String(init!.body))).toEqual({ published: true });
    expect((init!.headers as Record<string, string>).Prefer).toBe("return=representation");
  });

  it("fails when no Supabase row has the id, rather than reporting it published", async () => {
    await expect(publishInSupabase("https://x.supabase.co", "k", "b44-7", reply([]))).rejects.toThrow(/no Supabase row/);
  });

  it("fails on a refusal, naming the status", async () => {
    await expect(publishInSupabase("https://x.supabase.co", "k", "b44-7", reply({ message: "x" }, 401))).rejects.toThrow(
      /401/,
    );
  });
});
