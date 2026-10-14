import { describe, expect, it, vi } from "vitest";
import {
  ARTICLE_BODY_LIMIT,
  ARTICLE_LIST_LIMIT,
  SLUG_PATTERN,
  createArticleSource,
} from "../../supabase/functions/chat/articles.ts";
import { SLUG_PATTERN as SITE_SLUG } from "@/lib/articlePath";

const AGENCY = "00000000-0000-0000-0000-000000000001";
const source = (rows: Record<string, unknown>[] = []) => {
  const select = vi.fn(async (_t: string, _q: string) => rows);
  return { select, articles: createArticleSource(select, AGENCY) };
};

describe("the chat's article source", () => {
  it("lists only published articles of this agency or shared ones, newest first, capped", async () => {
    const { select, articles } = source([{ slug: "a", title: "T", excerpt: "E", tags: "פנסיה" }]);
    expect(await articles.list()).toEqual([{ slug: "a", title: "T", excerpt: "E", tags: "פנסיה" }]);
    const [table, query] = select.mock.calls[0];
    expect(table).toBe("blog_posts");
    const p = new URLSearchParams(query);
    expect(p.get("published")).toBe("eq.true");
    expect(p.get("or")).toBe(`(agency_id.is.null,agency_id.eq.${AGENCY})`);
    expect(p.get("order")).toBe("created_at.desc");
    expect(p.get("limit")).toBe(String(ARTICLE_LIST_LIMIT));
    expect(p.get("select")).toBe("slug,title,excerpt,tags");
  });

  it("turns missing columns into empty strings rather than undefined", async () => {
    const { articles } = source([{ slug: "a", title: "T", excerpt: null, tags: null }]);
    expect(await articles.list()).toEqual([{ slug: "a", title: "T", excerpt: "", tags: "" }]);
  });

  it("reads one published article by slug, with the same agency filter", async () => {
    const { select, articles } = source([{ slug: "dmei-nihul", title: "דמי ניהול", body: "גוף" }]);
    expect(await articles.read("dmei-nihul")).toEqual({ slug: "dmei-nihul", title: "דמי ניהול", body: "גוף", truncated: false });
    const p = new URLSearchParams(select.mock.calls[0][1]);
    expect(p.get("slug")).toBe("eq.dmei-nihul");
    expect(p.get("published")).toBe("eq.true");
    expect(p.get("or")).toBe(`(agency_id.is.null,agency_id.eq.${AGENCY})`);
    expect(p.get("limit")).toBe("1");
  });

  it("keeps a body of exactly the limit whole", async () => {
    const { articles } = source([{ slug: "a", title: "T", body: "א".repeat(ARTICLE_BODY_LIMIT) }]);
    const read = await articles.read("a");
    expect(read?.body).toHaveLength(ARTICLE_BODY_LIMIT);
    expect(read?.truncated).toBe(false);
  });

  it("queries for a slug of 200 characters, the longest it accepts", async () => {
    const { select, articles } = source([]);
    await articles.read("x".repeat(200));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("cuts a long body and says so", async () => {
    const { articles } = source([{ slug: "a", title: "T", body: "א".repeat(ARTICLE_BODY_LIMIT + 50) }]);
    const read = await articles.read("a");
    expect(read?.body).toHaveLength(ARTICLE_BODY_LIMIT);
    expect(read?.truncated).toBe(true);
  });

  it.each(["", "Has Spaces", "a--b", "../etc", "a&published=eq.false", "x".repeat(201)])(
    "refuses %j as a slug without querying",
    async (slug) => {
      const { select, articles } = source();
      expect(await articles.read(slug)).toBeNull();
      expect(select).not.toHaveBeenCalled();
    },
  );

  it("answers null for a slug no published article has", async () => {
    expect(await source([]).articles.read("nope")).toBeNull();
  });

  it("uses the site's slug rule", () => {
    expect(SLUG_PATTERN.source).toBe(SITE_SLUG.source);
  });
});
