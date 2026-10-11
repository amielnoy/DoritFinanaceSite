import { describe, expect, it } from "vitest";
import { fetchRows, toPortRow } from "@/services/supabase/SupabaseTableClient";
import { SupabaseContentService } from "@/services/supabase/SupabaseContentService";
import { tableFake } from "../helpers/supabase-table-fake";

const articleRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-000000000001",
  base44_id: "b44-post-1",
  title: "כותרת",
  excerpt: "תקציר",
  body: "גוף",
  image_url: null,
  tags: "פנסיה",
  action_time: "רבע שעה",
  published: true,
  created_at: "2026-10-01T09:00:00+00:00",
  ...over,
});

const testimonialRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-000000000002",
  base44_id: "b44-t-1",
  name: "רונית",
  role: null,
  quote: "שירות מצוין",
  image_url: null,
  rating: "5",
  source: "google",
  created_at: "2026-09-01T09:00:00+00:00",
  ...over,
});

const ok = (data: unknown[]) => ({ data, error: null });
const failed = { data: null, error: { message: "permission denied for table blog_posts", code: "42501" } };

describe("toPortRow", () => {
  it("exposes base44_id as id and created_at as created_date", () => {
    const out = toPortRow(articleRow());
    expect(out.id).toBe("b44-post-1");
    expect(out.created_date).toBe("2026-10-01T09:00:00+00:00");
    expect(out).not.toHaveProperty("base44_id");
    expect(out).not.toHaveProperty("created_at");
  });

  it("falls back to the Supabase id for a row that never had a Base44 one", () => {
    expect(toPortRow(articleRow({ base44_id: null })).id).toBe("6f1c0e3a-0000-4000-8000-000000000001");
  });

  it("drops null columns, since the ports declare them optional, not nullable", () => {
    const out = toPortRow(articleRow({ excerpt: null, action_time: null }));
    expect(out).not.toHaveProperty("excerpt");
    expect(out).not.toHaveProperty("action_time");
    expect(out).not.toHaveProperty("image_url");
  });
});

describe("fetchRows", () => {
  it("throws when PostgREST answers with an error instead of rows", async () => {
    const { client } = tableFake(failed);
    await expect(fetchRows(client.from("blog_posts").select("*"), "blog_posts")).rejects.toThrow(
      /blog_posts read failed: permission denied/,
    );
  });

  it("treats a null data with no error as no rows", async () => {
    const { client } = tableFake({ data: null, error: null });
    await expect(fetchRows(client.from("blog_posts").select("*"), "blog_posts")).resolves.toEqual([]);
  });
});

describe("SupabaseContentService.listArticles", () => {
  it("asks for published posts only, newest first, up to the limit", async () => {
    const { client, calls } = tableFake(ok([articleRow()]));
    await new SupabaseContentService(client).listArticles(7);
    expect(calls[0]).toEqual(["from", "blog_posts"]);
    expect(calls).toContainEqual(["eq", "published", true]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 7]);
  });

  it("defaults to 50, as the Base44 adapter does", async () => {
    const { client, calls } = tableFake(ok([]));
    await new SupabaseContentService(client).listArticles();
    expect(calls).toContainEqual(["limit", 50]);
  });

  it("returns articles keyed by their Base44 id", async () => {
    const { client } = tableFake(ok([articleRow()]));
    const [a] = await new SupabaseContentService(client).listArticles();
    expect(a).toMatchObject({ id: "b44-post-1", title: "כותרת", action_time: "רבע שעה", created_date: "2026-10-01T09:00:00+00:00" });
  });

  it("throws on a failed read rather than reporting no articles", async () => {
    const { client } = tableFake(failed);
    await expect(new SupabaseContentService(client).listArticles()).rejects.toThrow();
  });
});

describe("SupabaseContentService.getArticle", () => {
  it("filters on base44_id, not on Supabase's own id", async () => {
    const { client, calls } = tableFake(ok([articleRow()]));
    await new SupabaseContentService(client).getArticle("b44-post-1");
    expect(calls).toContainEqual(["eq", "base44_id", "b44-post-1"]);
    expect(calls.filter((c) => c[0] === "eq" && c[1] === "id")).toEqual([]);
  });

  it("returns the article under the id it was asked for", async () => {
    const { client } = tableFake(ok([articleRow()]));
    const a = await new SupabaseContentService(client).getArticle("b44-post-1");
    expect(a.id).toBe("b44-post-1");
  });

  it("throws when no row matches, so the page shows 'not found'", async () => {
    const { client } = tableFake(ok([]));
    await expect(new SupabaseContentService(client).getArticle("gone")).rejects.toThrow(/not found/);
  });
});

describe("SupabaseContentService.listTestimonials", () => {
  it("reads testimonials newest first, up to 50 by default", async () => {
    const { client, calls } = tableFake(ok([]));
    await new SupabaseContentService(client).listTestimonials();
    expect(calls[0]).toEqual(["from", "testimonials"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 50]);
  });

  it("turns PostgREST's string rating back into a number", async () => {
    const { client } = tableFake(ok([testimonialRow({ rating: "4" })]));
    const [t] = await new SupabaseContentService(client).listTestimonials();
    expect(t.rating).toBe(4);
    expect(t.id).toBe("b44-t-1");
    expect(t).not.toHaveProperty("role");
  });

  it("leaves a missing rating missing, rather than NaN", async () => {
    const { client } = tableFake(ok([testimonialRow({ rating: null })]));
    const [t] = await new SupabaseContentService(client).listTestimonials();
    expect(t).not.toHaveProperty("rating");
  });
});
