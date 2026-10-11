import { describe, expect, it } from "vitest";
import { SupabaseContentAdminService } from "@/services/supabase/SupabaseContentAdminService";
import { tableFake } from "../helpers/supabase-table-fake";

const draftRow = {
  id: "6f1c0e3a-0000-4000-8000-000000000003",
  base44_id: "b44-draft",
  title: "טיוטה",
  body: "גוף",
  published: false,
  created_at: "2026-10-02T09:00:00+00:00",
};

describe("SupabaseContentAdminService reads", () => {
  it("does not filter on published — the admin list must include drafts", async () => {
    const { client, calls } = tableFake({ data: [draftRow], error: null });
    const [a] = await new SupabaseContentAdminService(client).listArticles();
    expect(calls.filter((c) => c[0] === "eq")).toEqual([]);
    expect(a).toMatchObject({ id: "b44-draft", published: false, created_date: "2026-10-02T09:00:00+00:00" });
  });

  it("lists articles newest first, up to 100 by default", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseContentAdminService(client).listArticles();
    expect(calls[0]).toEqual(["from", "blog_posts"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 100]);
  });

  it("lists testimonials newest first, up to 50 by default, rating as a number", async () => {
    const { client, calls } = tableFake({
      data: [{ id: "u", base44_id: "b44-t", name: "נ", quote: "ק", rating: "5", created_at: "2026-09-01" }],
      error: null,
    });
    const [t] = await new SupabaseContentAdminService(client).listTestimonials();
    expect(calls[0]).toEqual(["from", "testimonials"]);
    expect(calls).toContainEqual(["limit", 50]);
    expect(t.rating).toBe(5);
  });

  it("throws on a failed read", async () => {
    const { client } = tableFake({ data: null, error: { message: "JWT expired", code: "PGRST301" } });
    await expect(new SupabaseContentAdminService(client).listArticles()).rejects.toThrow(/JWT expired/);
  });
});

describe("SupabaseContentAdminService writes", () => {
  const service = () => new SupabaseContentAdminService(tableFake({ data: [], error: null }).client);

  it.each([
    ["createArticle", (s: SupabaseContentAdminService) => s.createArticle({ title: "t", body: "b", published: false })],
    ["updateArticle", (s: SupabaseContentAdminService) => s.updateArticle("x", { title: "t" })],
    ["removeArticle", (s: SupabaseContentAdminService) => s.removeArticle("x")],
    ["createTestimonial", (s: SupabaseContentAdminService) => s.createTestimonial({ name: "n", quote: "q" })],
    ["removeTestimonial", (s: SupabaseContentAdminService) => s.removeTestimonial("x")],
  ])("refuses %s — writes belong to FunctionContentAdminService", async (_name, call) => {
    await expect(call(service())).rejects.toThrow("writes go through FunctionContentAdminService");
  });
});
