import { describe, expect, it, vi } from "vitest";
import { DualWriteContentAdminService } from "@/services/dual/DualWriteContentAdminService";
import type { ContentAdminPort, ShadowWritePort } from "@/services/ports";

/** A port that records what it was asked to do, and can be told to fail. */
const fake = (label: string, calls: string[], failOn?: string): ShadowWritePort => {
  const run = async (op: string, detail = "") => {
    calls.push(`${label}:${op}${detail}`);
    if (op === failOn) throw new Error(`${label} ${op} exploded`);
  };
  return {
    listArticles: async () => { await run("listArticles"); return []; },
    listTestimonials: async () => { await run("listTestimonials"); return []; },
    // A created row's id is what the two stores correlate on, so the fake mints
    // a recognisable one rather than returning a blank.
    createArticle: async () => { await run("createArticle"); return `${label}-article-1`; },
    createTestimonial: async () => { await run("createTestimonial"); return `${label}-testimonial-1`; },
    updateArticle: (id) => run("updateArticle", `(${id})`),
    removeArticle: (id) => run("removeArticle", `(${id})`),
    removeTestimonial: (id) => run("removeTestimonial", `(${id})`),
    createArticleMirroring: (primaryId) => run("createArticleMirroring", `(${primaryId})`),
    createTestimonialMirroring: (primaryId) => run("createTestimonialMirroring", `(${primaryId})`),
  } as ShadowWritePort;
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
    expect(calls).toEqual([
      "primary:createTestimonial",
      "shadow:createTestimonialMirroring(primary-testimonial-1)",
    ]);
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
      fake("shadow", calls, "createTestimonialMirroring"),
      onShadowFailure,
    );

    // The visitor's write landed in the authoritative store, and the caller
    // still gets the id back. Raising here would turn a reconciliation problem
    // into a lost submission.
    await expect(svc.createTestimonial(draft)).resolves.toBe("primary-testimonial-1");
    expect(onShadowFailure).toHaveBeenCalledOnce();
    expect(onShadowFailure.mock.calls[0][0]).toBe("createTestimonial");
  });

  it("hands the shadow the primary's id, so the copies stay correlated", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(fake("primary", calls), fake("shadow", calls));

    const id = await svc.createTestimonial(draft);

    // The shadow mints its own uuid; without being told which row it mirrors,
    // the copy is uncorrelated and reconciliation cannot pair them up.
    expect(id).toBe("primary-testimonial-1");
    expect(calls).toContain("shadow:createTestimonialMirroring(primary-testimonial-1)");
  });

  it("passes the primary's id through on update and delete, for the shadow to translate", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(fake("primary", calls), fake("shadow", calls));

    await svc.removeArticle("base44-abc");

    // Postgres has never heard of that id — it lives in base44_id. Matching the
    // wrong column deletes nothing and reports success, which is the quiet
    // failure this whole arrangement exists to avoid.
    expect(calls).toContain("shadow:removeArticle(base44-abc)");
  });

  it("covers every write on the port, so none can quietly skip the shadow", async () => {
    const calls: string[] = [];
    const svc = new DualWriteContentAdminService(fake("primary", calls), fake("shadow", calls));

    await svc.createArticle({ title: "t", body: "b" } as never);
    await svc.updateArticle("1", { published: true } as never);
    await svc.removeArticle("1");
    await svc.createTestimonial(draft);
    await svc.removeTestimonial("1");

    const shadowed = calls
      .filter((c) => c.startsWith("shadow:"))
      .map((c) => c.split(":")[1].replace(/\(.*\)$/, ""));
    expect(shadowed).toEqual([
      "createArticleMirroring", "updateArticle", "removeArticle",
      "createTestimonialMirroring", "removeTestimonial",
    ]);
  });
});
