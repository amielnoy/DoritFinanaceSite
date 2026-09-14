import { describe, expect, it, vi } from "vitest";
import { Base44ContentAdminService } from "@/services/base44/Base44ContentAdminService";
import { Base44LeadAdminService } from "@/services/base44/Base44LeadAdminService";

/**
 * The admin adapters, exercised against a fake rather than a mocked vendor module.
 *
 * Being able to write this file at all is the point of the change that introduced it:
 * until the admin screens went through a port, the only way to test them was to
 * `vi.mock("@/api/base44Client")` and assert on the SDK's own shape.
 */

const leadClient = () => ({
  entities: {
    Lead: {
      list: vi.fn(async () => [
        { id: "l1", name: "א", phone: "050", source: "quick", status: "new", created_date: "2026-01-02" },
      ]),
      update: vi.fn(async () => ({ ok: true })),
      delete: vi.fn(async () => ({ ok: true })),
    },
  },
});

const contentClient = () => ({
  entities: {
    BlogPost: {
      list: vi.fn(async () => [{ id: "p1", title: "כותרת", created_date: "2026-01-02" }]),
      create: vi.fn(async () => ({ id: "p2" })),
      update: vi.fn(async () => ({ ok: true })),
      delete: vi.fn(async () => ({ ok: true })),
    },
    Testimonial: {
      list: vi.fn(async () => [{ id: "t1", name: "ב", quote: "ג", created_date: "2026-01-02" }]),
      create: vi.fn(async () => ({ id: "t2" })),
      delete: vi.fn(async () => ({ ok: true })),
    },
  },
});

describe("Base44LeadAdminService", () => {
  it("asks for leads newest-first", async () => {
    // Not a preference: the owner's next action is always about the newest enquiry,
    // and a screen that silently sorted the other way would bury it.
    const client = leadClient();
    await new Base44LeadAdminService(client).list();
    expect(client.entities.Lead.list).toHaveBeenCalledWith("-created_date", 500);
  });

  it("accepts a caller-chosen page size", async () => {
    const client = leadClient();
    await new Base44LeadAdminService(client).list(25);
    expect(client.entities.Lead.list).toHaveBeenCalledWith("-created_date", 25);
  });

  it("returns an array when the store answers with nothing", async () => {
    const client = leadClient();
    client.entities.Lead.list = vi.fn(async () => null as unknown as unknown[]);
    await expect(new Base44LeadAdminService(client).list()).resolves.toEqual([]);
  });

  it("patches only the status when a lead is moved along", async () => {
    // A patch that carried the whole row would let a stale screen overwrite a field
    // somebody else had just changed.
    const client = leadClient();
    await new Base44LeadAdminService(client).setStatus("l1", "contacted");
    expect(client.entities.Lead.update).toHaveBeenCalledWith("l1", { status: "contacted" });
  });

  it("deletes by id", async () => {
    const client = leadClient();
    await new Base44LeadAdminService(client).remove("l1");
    expect(client.entities.Lead.delete).toHaveBeenCalledWith("l1");
  });
});

describe("Base44ContentAdminService", () => {
  it("lists every article, drafts included", async () => {
    /* The public `ContentPort.listArticles` filters to `published: true`. This one must
       not, or the owner cannot see the draft they are about to publish — the same verb
       on two ports answering to two different audiences. */
    const client = contentClient();
    await new Base44ContentAdminService(client).listArticles();
    expect(client.entities.BlogPost.list).toHaveBeenCalledWith("-created_date", 100);
    expect(client.entities.BlogPost.filter).toBeUndefined();
  });

  it("creates an article with published coerced to a boolean", async () => {
    const client = contentClient();
    await new Base44ContentAdminService(client).createArticle({
      title: "כותרת",
      body: "גוף",
      published: undefined as unknown as boolean,
    });
    expect(client.entities.BlogPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "כותרת", body: "גוף", published: false })
    );
  });

  it("forwards a partial update without inventing the fields it was not given", async () => {
    // The publish toggle sends one field. Filling in the rest from a stale screen is
    // how a toggle silently reverts an edit made in another tab.
    const client = contentClient();
    await new Base44ContentAdminService(client).updateArticle("p1", { published: true });
    expect(client.entities.BlogPost.update).toHaveBeenCalledWith("p1", { published: true });
  });

  it("defaults a testimonial's rating and source rather than sending empty ones", async () => {
    const client = contentClient();
    await new Base44ContentAdminService(client).createTestimonial({ name: "ב", quote: "ג" });
    expect(client.entities.Testimonial.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ב", quote: "ג", rating: 5, source: "google" })
    );
  });

  it("keeps a rating the visitor actually chose", async () => {
    const client = contentClient();
    await new Base44ContentAdminService(client).createTestimonial({ name: "ב", quote: "ג", rating: 3 });
    expect(client.entities.Testimonial.create).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 3 })
    );
  });

  it("removes an article and a testimonial by id", async () => {
    const client = contentClient();
    const service = new Base44ContentAdminService(client);
    await service.removeArticle("p1");
    await service.removeTestimonial("t1");
    expect(client.entities.BlogPost.delete).toHaveBeenCalledWith("p1");
    expect(client.entities.Testimonial.delete).toHaveBeenCalledWith("t1");
  });
});
