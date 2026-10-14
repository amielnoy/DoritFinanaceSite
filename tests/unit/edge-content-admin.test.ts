import { describe, expect, it, vi } from "vitest";
import { EdgeContentAdminService, type ContentFunctionsClient } from "@/services/supabase/EdgeContentAdminService";
import type { ContentAdminPort } from "@/services/ports";

function fakeReads(): ContentAdminPort {
  return {
    listArticles: vi.fn().mockResolvedValue(["article"]),
    listTestimonials: vi.fn().mockResolvedValue(["testimonial"]),
  } as unknown as ContentAdminPort;
}

/** supabase-js resolves a non-2xx answer as `{ error }` with the Response on `error.context`. */
function fakeClient(status: number, body: Record<string, unknown>): ContentFunctionsClient {
  const ok = status >= 200 && status < 300;
  return {
    functions: {
      invoke: vi.fn().mockResolvedValue(
        ok
          ? { data: body, error: null }
          : { data: null, error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) } },
      ),
    },
  };
}

const article = { title: "t", body: "b", published: false };

describe("EdgeContentAdminService", () => {
  it("delegates reads to the injected reads port", async () => {
    const reads = fakeReads();
    const svc = new EdgeContentAdminService(fakeClient(200, {}), reads, async () => "tok");
    await svc.listArticles(5);
    await svc.listTestimonials(3);
    expect(reads.listArticles).toHaveBeenCalledWith(5);
    expect(reads.listTestimonials).toHaveBeenCalledWith(3);
  });

  it("refuses to write without a session, before calling the function", async () => {
    const client = fakeClient(200, { id: "x" });
    const svc = new EdgeContentAdminService(client, fakeReads(), async () => null);
    await expect(svc.createArticle(article)).rejects.toThrow("נדרשת התחברות.");
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it("calls content-admin with the op and the session's token on Authorization", async () => {
    const client = fakeClient(200, { ok: true, id: "new-id" });
    const svc = new EdgeContentAdminService(client, fakeReads(), async () => "the-token");
    expect(await svc.createArticle(article)).toBe("new-id");
    expect(client.functions.invoke).toHaveBeenCalledWith("content-admin", {
      body: { op: "createArticle", draft: article },
      headers: { Authorization: "Bearer the-token" },
    });
  });

  it.each([
    ["updateArticle", (s: EdgeContentAdminService) => s.updateArticle("id1", { published: true }), { op: "updateArticle", id: "id1", draft: { published: true } }],
    ["removeArticle", (s: EdgeContentAdminService) => s.removeArticle("id1"), { op: "removeArticle", id: "id1" }],
    ["createTestimonial", (s: EdgeContentAdminService) => s.createTestimonial({ name: "n", quote: "q" } as never), { op: "createTestimonial", draft: { name: "n", quote: "q" } }],
    ["removeTestimonial", (s: EdgeContentAdminService) => s.removeTestimonial("id1"), { op: "removeTestimonial", id: "id1" }],
  ])("sends %s with its payload", async (_name, run, body) => {
    const client = fakeClient(200, { ok: true });
    await run(new EdgeContentAdminService(client, fakeReads(), async () => "tok"));
    expect((client.functions.invoke as ReturnType<typeof vi.fn>).mock.calls[0][1].body).toEqual(body);
  });

  it("throws the function's own message with its status, so the form can explain a slug refusal", async () => {
    const svc = new EdgeContentAdminService(fakeClient(409, { error: "הכתובת כבר בשימוש במאמר אחר.", rid: "r1" }), fakeReads(), async () => "tok");
    await expect(svc.createArticle(article)).rejects.toMatchObject({ message: "הכתובת כבר בשימוש במאמר אחר.", status: 409 });
  });

  it("still throws, with the status, when the answer has no readable body", async () => {
    const client: ContentFunctionsClient = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { message: "network", context: undefined } }) },
    };
    const svc = new EdgeContentAdminService(client, fakeReads(), async () => "tok");
    await expect(svc.removeArticle("x")).rejects.toThrow(/הפעולה נכשלה/);
  });
});
