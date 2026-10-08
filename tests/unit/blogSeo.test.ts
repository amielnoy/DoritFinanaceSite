import { describe, expect, it } from "vitest";
import {
  BLOG_POST_NOT_FOUND_SEO,
  blogSummary,
  blogTagList,
  computeBlogSeoConfig,
} from "@/lib/blogSeo";
import { SITE_URL } from "@/lib/seo";
import type { Article } from "@/services";

const post: Article = {
  id: "post-1",
  title: "איך לבחור קרן פנסיה",
  body: "# כותרת\n\nפסקה ראשונה עם [קישור](https://example.com) ועוד *טקסט מודגש*.",
  tags: "פנסיה, חיסכון, ",
  image_url: "https://cdn.example/post-1.jpg",
  created_date: "2026-01-01T00:00:00Z",
};

describe("blogSummary", () => {
  it("strips markdown syntax and link URLs, keeping the link text", () => {
    const summary = blogSummary(post);
    expect(summary).toContain("קישור");
    expect(summary).not.toContain("[");
    expect(summary).not.toContain("https://example.com");
    expect(summary).not.toContain("#");
    expect(summary).not.toContain("*");
  });

  it("returns an empty string for a post with no body", () => {
    expect(blogSummary({ body: undefined })).toBe("");
  });
});

describe("blogTagList", () => {
  it("splits, trims and drops empty entries", () => {
    expect(blogTagList({ tags: "פנסיה, חיסכון, " })).toEqual(["פנסיה", "חיסכון"]);
  });

  it("returns an empty array when there are no tags", () => {
    expect(blogTagList({ tags: undefined })).toEqual([]);
  });
});

describe("computeBlogSeoConfig", () => {
  const config = computeBlogSeoConfig(post);

  it("builds the post's title, path and article type", () => {
    expect(config.title).toBe(`${post.title} | בלוג · דורית גוב ארי`);
    expect(config.path).toBe(`/blog/${post.id}`);
    expect(config.type).toBe("article");
    expect(config.image).toBe(post.image_url);
    expect(config.imageAlt).toBe(post.title);
    expect(config.publishedTime).toBe(post.created_date);
    expect(config.tags).toEqual(["פנסיה", "חיסכון"]);
  });

  it("falls back to the default OG image when the post has none", () => {
    const { image } = computeBlogSeoConfig({ ...post, image_url: undefined });
    expect(image).not.toBe(post.image_url);
    expect(image).toContain(SITE_URL);
  });

  it("falls back to a generic description when the post body is empty", () => {
    const { description } = computeBlogSeoConfig({ ...post, body: undefined });
    expect(description).toBe(`מאמר מאת דורית גוב ארי — ${post.title}`);
  });

  it("includes a breadcrumb and a BlogPosting JSON-LD block", () => {
    expect(config.jsonLd).toHaveLength(2);
    expect(config.jsonLd?.[0]).toMatchObject({ "@type": "BreadcrumbList" });
    const posting = config.jsonLd?.[1] as Record<string, unknown>;
    expect(posting["@type"]).toBe("BlogPosting");
    expect(posting.headline).toBe(post.title);
    expect(posting.keywords).toBe("פנסיה, חיסכון");
  });

  it("omits keywords and image when the post has neither tags nor an image", () => {
    const bare = computeBlogSeoConfig({ ...post, tags: undefined, image_url: undefined });
    const posting = bare.jsonLd?.[1] as Record<string, unknown>;
    expect(posting.keywords).toBeUndefined();
    expect(posting.image).toBeUndefined();
  });
});

describe("BLOG_POST_NOT_FOUND_SEO", () => {
  it("is noindex and points back at the blog listing", () => {
    expect(BLOG_POST_NOT_FOUND_SEO.noIndex).toBe(true);
    expect(BLOG_POST_NOT_FOUND_SEO.path).toBe("/blog");
  });
});
