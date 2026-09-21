import { describe, expect, it, vi } from "vitest";
import { DualWriteContentAdminService } from "@/services/dual/DualWriteContentAdminService";
import type { ContentAdminPort } from "@/services/ports";

/** A port that records what it was asked to do, and can be told to fail. */
const fake = (label: string, calls: string[], failOn?: string): ContentAdminPort => {
  const run = async (op: string) => {
    calls.push(`${label}:${op}`);
    if (op === failOn) throw new Error(`${label} ${op} exploded`);
  };
  return {
    listArticles: async () => { await run("listArticles"); return []; },
    listTestimonials: async () => { await run("listTestimonials"); return []; },
    createArticle: (d) => run("createArticle"),
    updateArticle: (id, d) => run("updateArticle"),
    removeArticle: (id) => run("removeArticle"),
    createTestimonial: (d) => run("createTestimonial"),
    removeTestimonial: (id) => run("removeTestimonial"),
  } as ContentAdminPort;
};

const draft = { name: "א", quote: "ב", rating: 5 };

describe("dual-write — the cutover mechanism", () => {
  it("reads from the primary only, so a sick shadow cannot serve stale content", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(fake("primary", calls), fake("shadow", calls));

    await svc.listArticles();
    await svc.listTestimonials();

    expect(calls).toEqual(["primary:listArticles", "primary:listTestimonials"]);
  });

  it("writes to both, primary first", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(fake("primary", calls), fake("shadow", calls));

    await svc.createTestimonial(draft);

    // Order matters: a shadow that hangs must never delay or prevent the
    // authoritative write.
    expect(calls).toEqual(["primary:createTestimonial", "shadow:createTestimonial"]);
  });

  it("fails the caller when the primary fails, and never touches the shadow", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(
      fake("primary", calls, "createTestimonial"),
      fake("shadow", calls),
    );

    await expect(svc.createTestimonial(draft)).rejects.toThrow(/primary createTestimonial/);
    expect(calls).toEqual(["primary:createTestimonial"]);
  });

  it("swallows a shadow failure and reports it — the enquiry is already safe", async () => {
    const calls: string[] = [];
    const onShadowFailure = vi.fn();
    const svc = new DualWriteContentAdminService(
      fake("primary", calls),
      fake("shadow", calls, "createTestimonial"),
      onShadowFailure,
    );

    // The visitor's write landed in the authoritative store. Raising here would
    // turn a reconciliation problem into a lost submission.
    await expect(svc.createTestimonial(draft)).resolves.toBeUndefined();
    expect(onShadowFailure).toHaveBeenCalledOnce();
    expect(onShadowFailure.mock.calls[0][0]).toBe("createTestimonial");
  });

  it("covers every write on the port, so none can quietly skip the shadow", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(fake("primary", calls), fake("shadow", calls));

    await svc.createArticle({ title: "t", body: "b" } as never);
    await svc.updateArticle("1", { published: true } as never);
    await svc.removeArticle("1");
    await svc.createTestimonial(draft);
    await svc.removeTestimonial("1");

    const shadowed = calls.filter((c) => c.startsWith("shadow:")).map((c) => c.split(":")[1]);
    expect(shadowed).toEqual([
      "createArticle", "updateArticle", "removeArticle", "createTestimonial", "removeTestimonial",
    ]);
  });
});
