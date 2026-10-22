import { describe, expect, it } from "vitest";
import { fetchRows, toPortRow } from "@/services/supabase/SupabaseTableClient";
import { ARTICLE_COLUMNS, SupabaseContentService } from "@/services/supabase/SupabaseContentService";
import { AGENCY1_ID } from "@/config/agency1";
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
  const B44 = "64f0a1b2c3d4e5f6a7b8c9d0";
  const UUID = "6f1c0e3a-0000-4000-8000-000000000001";
  const slugRow = (over: Record<string, unknown> = {}) =>
    articleRow({ base44_id: B44, slug: "horadat-dmei-nihul", ...over });

  it("reads the slug with every article", () => {
    expect(ARTICLE_COLUMNS.split(",")).toContain("slug");
  });

  it("asks for the key as a slug or a Base44 id, in one request", async () => {
    const { client, calls } = tableFake(ok([slugRow()]));
    await new SupabaseContentService(client).getArticle("horadat-dmei-nihul");
    expect(calls).toContainEqual(["or", "slug.eq.horadat-dmei-nihul,base44_id.eq.horadat-dmei-nihul"]);
    expect(calls.filter((c) => c[0] === "eq")).toEqual([]);
  });

  it("adds the uuid clause only for a uuid-shaped key — PostgREST errors on id.eq.<anything else>", async () => {
    const { client, calls } = tableFake(ok([slugRow({ id: UUID, base44_id: null })]));
    await new SupabaseContentService(client).getArticle(UUID);
    expect(calls).toContainEqual(["or", `slug.eq.${UUID},base44_id.eq.${UUID},id.eq.${UUID}`]);
  });

  it("prefers the slug, then the Base44 id, then the uuid", async () => {
    // Three rows, each matching the key a different way, in the worst order.
    const byUuid = slugRow({ id: UUID, base44_id: "b-1", slug: "s-1", title: "by uuid" });
    const byBase44 = slugRow({ id: "6f1c0e3a-0000-4000-8000-000000000002", base44_id: UUID, slug: "s-2", title: "by base44 id" });
    const bySlug = slugRow({ id: "6f1c0e3a-0000-4000-8000-000000000003", base44_id: "b-3", slug: UUID, title: "by slug" });

    const all = tableFake(ok([byUuid, byBase44, bySlug]));
    expect((await new SupabaseContentService(all.client).getArticle(UUID)).title).toBe("by slug");

    const noSlug = tableFake(ok([byUuid, byBase44]));
    expect((await new SupabaseContentService(noSlug.client).getArticle(UUID)).title).toBe("by base44 id");
  });

  it("returns the article under its Base44 id, with its slug", async () => {
    const { client } = tableFake(ok([slugRow()]));
    const a = await new SupabaseContentService(client).getArticle(B44);
    expect(a.id).toBe(B44);
    expect(a.slug).toBe("horadat-dmei-nihul");
  });

  it("throws a 404 'not found' when no row matches, so the page shows 'not found'", async () => {
    const { client } = tableFake(ok([]));
    await expect(new SupabaseContentService(client).getArticle("gone")).rejects.toMatchObject({
      message: expect.stringMatching(/not found/),
      status: 404,
    });
  });

  it.each(["Has-Capitals", "a,b", "x)", "slug.eq.y", "", "../etc"])(
    "never asks about %j — no article's slug, Base44 id or uuid looks like it",
    async (key) => {
      const { client, calls } = tableFake(ok([slugRow()]));
      await expect(new SupabaseContentService(client).getArticle(key)).rejects.toMatchObject({ status: 404 });
      expect(calls).toEqual([]);
    },
  );

  it("fails, rather than answering 'not found', when the read fails", async () => {
    const { client } = tableFake(failed);
    const err = await new SupabaseContentService(client).getArticle("horadat-dmei-nihul").catch((e) => e);
    expect(err.message).toMatch(/blog_posts read failed/);
    expect(err.status).toBeUndefined();
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

  it("asks for one agency's testimonials only when it is named", async () => {
    const named = tableFake(ok([]));
    await new SupabaseContentService(named.client).listTestimonials(50, AGENCY1_ID);
    expect(named.calls).toContainEqual(["eq", "agency_id", AGENCY1_ID]);

    const unnamed = tableFake(ok([]));
    await new SupabaseContentService(unnamed.client).listTestimonials();
    expect(unnamed.calls.filter(([method]) => method === "eq")).toEqual([]);
  });

  it("leaves a missing rating missing, rather than NaN", async () => {
    const { client } = tableFake(ok([testimonialRow({ rating: null })]));
    const [t] = await new SupabaseContentService(client).listTestimonials();
    expect(t).not.toHaveProperty("rating");
  });
});
