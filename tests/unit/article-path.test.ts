import { describe, expect, it } from "vitest";
import {
  BASE44_ID_PATTERN,
  SLUG_PATTERN,
  SLUG_PROBLEMS,
  UUID_PATTERN,
  articlePath,
  isValidSlug,
  slugProblem,
} from "@/lib/articlePath";

/**
 * An article's address. Every link to an article is built by `articlePath`,
 * so these cases are what every card, the blog's JSON-LD, the post's
 * canonical and the server's redirect inherit.
 */
describe("articlePath", () => {
  it("is /blog/<slug> when the article has one", () => {
    expect(articlePath({ id: "64f0a1b2c3d4e5f6a7b8c9d0", slug: "horadat-dmei-nihul" })).toBe(
      "/blog/horadat-dmei-nihul",
    );
  });

  it("falls back to the id where the article has no slug", () => {
    expect(articlePath({ id: "64f0a1b2c3d4e5f6a7b8c9d0" })).toBe("/blog/64f0a1b2c3d4e5f6a7b8c9d0");
    expect(articlePath({ id: "post-1", slug: "" })).toBe("/blog/post-1");
  });
});

describe("slugProblem", () => {
  it.each(["horadat-dmei-nihul", "tofes-101", "a", "2026", "pensia-beidan-ha-ai"])("accepts %j", (slug) => {
    expect(slugProblem(slug)).toBeNull();
    expect(isValidSlug(slug)).toBe(true);
  });

  it("asks for a slug when there is none", () => {
    expect(slugProblem("")).toBe(SLUG_PROBLEMS.missing);
  });

  it.each(["Horadat", "dmei nihul", "-a", "a-", "a--b", "דמי-ניהול", "a_b", "a/b", "../x", "a.b"])(
    "refuses %j as not Latin kebab-case",
    (slug) => {
      expect(slugProblem(slug)).toBe(SLUG_PROBLEMS.format);
      expect(isValidSlug(slug)).toBe(false);
    },
  );

  it("refuses a slug shaped like a Base44 id — vercel.json sends those to the old-link redirect", () => {
    expect(slugProblem("64f0a1b2c3d4e5f6a7b8c9d0")).toBe(SLUG_PROBLEMS.base44Id);
    // One character either way is an ordinary slug.
    expect(slugProblem("64f0a1b2c3d4e5f6a7b8c9d")).toBeNull();
    expect(slugProblem("64f0a1b2c3d4e5f6a7b8c9d0e")).toBeNull();
  });

  it("is false for anything that is not a string", () => {
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(42)).toBe(false);
  });
});

describe("the key shapes", () => {
  it("tells a Base44 id, a uuid and a slug apart", () => {
    expect(BASE44_ID_PATTERN.test("64f0a1b2c3d4e5f6a7b8c9d0")).toBe(true);
    expect(UUID_PATTERN.test("6f1c0e3a-0000-4000-8000-000000000001")).toBe(true);
    expect(UUID_PATTERN.test("horadat-dmei-nihul")).toBe(false);
    // All three are slug-shaped, which is what lets one filter ask for any of them.
    for (const key of ["64f0a1b2c3d4e5f6a7b8c9d0", "6f1c0e3a-0000-4000-8000-000000000001", "horadat-dmei-nihul"]) {
      expect(SLUG_PATTERN.test(key)).toBe(true);
    }
  });
});
