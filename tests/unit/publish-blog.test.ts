import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { listPosts, planPublish, publishInSupabase } from "../../scripts/publish-blog.mjs";

/**
 * Publishing is a deliberate, by-title action — never "everything that is
 * currently a draft" — so what is worth pinning is how each title resolves
 * against what `blog_posts` actually holds: found and draft, found and already
 * published (a no-op, not a re-write), not found at all, or found twice
 * (reported, never silently skipped or guessed).
 */
const post = (over: Record<string, unknown> = {}) => ({
  id: "uuid-7",
  slug: "horadat-dmei-nihul",
  title: "להוריד דמי ניהול בפנסיה",
  published: false,
  ...over,
});

describe("planPublish", () => {
  it("marks a draft found by title as ready to publish", () => {
    const [step] = planPublish(["להוריד דמי ניהול בפנסיה"], [post()]);
    expect(step).toEqual({
      title: "להוריד דמי ניהול בפנסיה",
      found: true,
      id: "uuid-7",
      slug: "horadat-dmei-nihul",
      alreadyPublished: false,
    });
  });

  it("marks an already-published title as a no-op rather than re-writing it", () => {
    const [step] = planPublish(["להוריד דמי ניהול בפנסיה"], [post({ published: true })]);
    expect(step.alreadyPublished).toBe(true);
  });

  it("reports a title that matches no post, instead of throwing or silently skipping it", () => {
    const [step] = planPublish(["מאמר שלא קיים"], []);
    expect(step).toEqual({ title: "מאמר שלא קיים", found: false });
  });

  it("refuses a title two posts share, naming both, rather than publishing either", () => {
    const [step] = planPublish(["להוריד דמי ניהול בפנסיה"], [post(), post({ id: "uuid-8", slug: "dmei-nihul-2" })]);
    expect(step).toEqual({ title: "להוריד דמי ניהול בפנסיה", found: false, ambiguous: ["horadat-dmei-nihul", "dmei-nihul-2"] });
  });

  it("resolves every title independently, in the order given", () => {
    const steps = planPublish(
      ["א", "ב", "ג"],
      [post({ id: "1", title: "א" }), post({ id: "2", title: "ג", published: true })],
    );
    expect(steps.map((s: { title: string }) => s.title)).toEqual(["א", "ב", "ג"]);
    expect(steps[0]).toMatchObject({ found: true, alreadyPublished: false });
    expect(steps[1]).toMatchObject({ found: false });
    expect(steps[2]).toMatchObject({ found: true, alreadyPublished: true });
  });
});

const reply = (body: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

describe("listPosts", () => {
  it("reads every post, drafts included, with the service role", async () => {
    const fetchImpl = reply([post()]);
    expect(await listPosts("https://x.supabase.co", "service-key", fetchImpl)).toEqual([post()]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/rest/v1/blog_posts?select=id,slug,title,published&limit=1000");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
  });

  it("fails on a refusal, naming the status", async () => {
    await expect(listPosts("https://x.supabase.co", "k", reply({ message: "x" }, 401))).rejects.toThrow(/401/);
  });

  it("fails on an answer that is not a list", async () => {
    await expect(listPosts("https://x.supabase.co", "k", reply({}))).rejects.toThrow(/not a list/);
  });
});

describe("publishInSupabase", () => {
  it("PATCHes the one row by id, touching only `published`", async () => {
    const fetchImpl = reply([{ id: "uuid-7" }]);
    await publishInSupabase("https://x.supabase.co", "service-key", "uuid-7", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/rest/v1/blog_posts?id=eq.uuid-7");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(String(init!.body))).toEqual({ published: true });
    expect((init!.headers as Record<string, string>).Prefer).toBe("return=representation");
  });

  it("fails when no row has the id, rather than reporting it published", async () => {
    await expect(publishInSupabase("https://x.supabase.co", "k", "uuid-7", reply([]))).rejects.toThrow(/no blog_posts row/);
  });

  it("fails on a refusal, naming the status", async () => {
    await expect(publishInSupabase("https://x.supabase.co", "k", "uuid-7", reply({ message: "x" }, 401))).rejects.toThrow(/401/);
  });
});
