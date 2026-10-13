import { describe, expect, it, vi } from "vitest";
import {
  FunctionContentAdminService,
  type FunctionsClient,
} from "@/services/base44/FunctionContentAdminService";
import type { ContentAdminPort } from "@/services/ports";

function fakeReads(): ContentAdminPort {
  return {
    listArticles: vi.fn().mockResolvedValue(["article"]),
    listTestimonials: vi.fn().mockResolvedValue(["testimonial"]),
    createArticle: vi.fn(),
    updateArticle: vi.fn(),
    removeArticle: vi.fn(),
    createTestimonial: vi.fn(),
    removeTestimonial: vi.fn(),
  } as unknown as ContentAdminPort;
}

function fakeClient(status: number, body: unknown): FunctionsClient {
  return {
    functions: {
      fetch: vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }),
    },
  };
}

describe("FunctionContentAdminService", () => {
  it("delegates reads to the injected reads port, untouched", async () => {
    const reads = fakeReads();
    const svc = new FunctionContentAdminService(fakeClient(200, {}), reads, async () => "tok");

    await svc.listArticles(5);
    await svc.listTestimonials(3);

    expect(reads.listArticles).toHaveBeenCalledWith(5);
    expect(reads.listTestimonials).toHaveBeenCalledWith(3);
  });

  it("refuses to write without a token, before any call reaches the client", async () => {
    const client = fakeClient(200, { id: "x" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => null);

    await expect(svc.createArticle({ title: "t", body: "b", published: false })).rejects.toThrow(
      "נדרשת התחברות.",
    );
    expect(client.functions.fetch).not.toHaveBeenCalled();
  });

  it("sends the visitor's token in X-Supabase-Auth, not Authorization", async () => {
    const client = fakeClient(200, { id: "new-id" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "the-token");

    const id = await svc.createArticle({ title: "t", body: "b", published: false });

    expect(id).toBe("new-id");
    const [path, init] = (client.functions.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("contentAdmin");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Supabase-Auth"]).toBe("the-token");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ op: "createArticle", draft: { title: "t" } });
  });

  it("throws the server's error message on a refusal, rather than treating 200-with-error as success", async () => {
    const client = fakeClient(403, { error: "not an admin" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "tok");

    await expect(svc.removeTestimonial("t1")).rejects.toThrow("not an admin");
  });

  it("carries the HTTP status on the thrown error", async () => {
    const svc = new FunctionContentAdminService(
      fakeClient(409, { error: "הכתובת כבר בשימוש במאמר אחר." }),
      fakeReads(),
      async () => "tok",
    );
    await expect(svc.updateArticle("id", { slug: "x" })).rejects.toMatchObject({
      message: "הכתובת כבר בשימוש במאמר אחר.",
      status: 409,
    });
  });

  it("falls back to a status-coded message when the body carries no error text", async () => {
    const client = fakeClient(500, {});
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "tok");

    await expect(svc.removeArticle("a1")).rejects.toThrow("500");
  });

  it("passes id and draft through for updateArticle and createTestimonial", async () => {
    const client = fakeClient(200, { id: "" });
    const svc = new FunctionContentAdminService(client, fakeReads(), async () => "tok");

    await svc.updateArticle("a1", { title: "new" });
    const [, init] = (client.functions.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ op: "updateArticle", id: "a1", draft: { title: "new" } });

    await svc.createTestimonial({ name: "n", quote: "q" });
    const [, init2] = (client.functions.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse(init2.body)).toMatchObject({ op: "createTestimonial", draft: { name: "n", quote: "q" } });
  });
});
