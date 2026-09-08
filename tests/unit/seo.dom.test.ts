/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  SITE_URL,
  absoluteUrl,
  applySeo,
  breadcrumbLd,
  clampDescription,
} from "@/lib/seo";

const head = () => document.head;
const content = (sel: string) => head().querySelector(sel)?.getAttribute("content");
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute("href");
const jsonLd = () =>
  Array.from(head().querySelectorAll("script[data-seo-jsonld]")).map((s) =>
    JSON.parse(s.textContent ?? "{}")
  );

beforeEach(() => {
  head().innerHTML = "";
  document.title = "";
});

describe("absoluteUrl", () => {
  it("resolves a route path against the canonical origin", () => {
    expect(absoluteUrl("/blog")).toBe(`${SITE_URL}/blog`);
  });

  it("keeps the root's trailing slash but strips it elsewhere, so one URL per page", () => {
    expect(absoluteUrl("/")).toBe(`${SITE_URL}/`);
    expect(absoluteUrl("/blog/")).toBe(`${SITE_URL}/blog`);
    expect(absoluteUrl("/blog")).toBe(`${SITE_URL}/blog`);
  });

  it("tolerates a path without a leading slash", () => {
    expect(absoluteUrl("claims")).toBe(`${SITE_URL}/claims`);
  });

  it("passes an already-absolute URL through untouched", () => {
    expect(absoluteUrl("https://cdn.example/x.jpg")).toBe("https://cdn.example/x.jpg");
  });

  it("never emits a protocol-relative or doubled-slash URL", () => {
    for (const p of ["/", "/blog", "blog", "/blog/post-1/"]) {
      expect(absoluteUrl(p)).toMatch(/^https:\/\/[^/]+\/[^/]*/);
      expect(absoluteUrl(p).slice(8)).not.toContain("//");
    }
  });
});

describe("clampDescription", () => {
  it("leaves a short description alone", () => {
    expect(clampDescription("ייעוץ ביטוחי ופיננסי")).toBe("ייעוץ ביטוחי ופיננסי");
  });

  it("collapses whitespace and newlines", () => {
    expect(clampDescription("  ייעוץ\n\n  ביטוחי  ")).toBe("ייעוץ ביטוחי");
  });

  it("truncates on a word boundary within the search-result limit", () => {
    const out = clampDescription("word ".repeat(80));
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});

describe("applySeo", () => {
  const base = {
    title: "בלוג | דורית גוב ארי",
    description: "מאמרים על פנסיה וביטוח.",
    path: "/blog",
  };

  it("sets the title, description and a canonical for the route", () => {
    applySeo(base);
    expect(document.title).toBe(base.title);
    expect(content('meta[name="description"]')).toBe(base.description);
    expect(canonical()).toBe(`${SITE_URL}/blog`);
  });

  it("gives each route its own canonical rather than pointing at the home page", () => {
    applySeo(base);
    const first = canonical();
    applySeo({ ...base, path: "/claims", title: "תביעות" });
    expect(canonical()).not.toBe(first);
    expect(canonical()).toBe(`${SITE_URL}/claims`);
  });

  it("populates the Open Graph and Twitter cards", () => {
    applySeo({ ...base, image: "https://cdn.example/a.jpg", imageAlt: "תמונה" });
    expect(content('meta[property="og:title"]')).toBe(base.title);
    expect(content('meta[property="og:url"]')).toBe(`${SITE_URL}/blog`);
    expect(content('meta[property="og:type"]')).toBe("website");
    expect(content('meta[property="og:image"]')).toBe("https://cdn.example/a.jpg");
    expect(content('meta[property="og:image:alt"]')).toBe("תמונה");
    expect(content('meta[property="og:locale"]')).toBe("he_IL");
    expect(content('meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(content('meta[name="twitter:image"]')).toBe("https://cdn.example/a.jpg");
  });

  it("marks a public route as indexable", () => {
    applySeo(base);
    expect(content('meta[name="robots"]')).toContain("index");
    expect(content('meta[name="robots"]')).not.toContain("noindex");
  });

  it("marks a private route noindex, nofollow", () => {
    applySeo({ ...base, path: "/admin/leads", noIndex: true });
    expect(content('meta[name="robots"]')).toBe("noindex, nofollow");
  });

  it("emits article metadata only for articles", () => {
    applySeo({
      ...base,
      type: "article",
      path: "/blog/post-1",
      publishedTime: "2026-03-01T09:00:00Z",
      tags: ["פנסיה", "חיסכון"],
    });
    expect(content('meta[property="og:type"]')).toBe("article");
    expect(content('meta[property="article:published_time"]')).toBe("2026-03-01T09:00:00Z");
    expect(head().querySelectorAll('meta[property="article:tag"]')).toHaveLength(2);
  });

  it("clears the previous article's tags when navigating to a plain page", () => {
    applySeo({ ...base, type: "article", tags: ["a", "b", "c"] });
    expect(head().querySelectorAll('meta[property="article:tag"]')).toHaveLength(3);

    applySeo(base);
    expect(head().querySelectorAll('meta[property="article:tag"]')).toHaveLength(0);
    expect(head().querySelector('meta[property="article:published_time"]')).toBeNull();
  });

  it("injects route-scoped JSON-LD and removes the previous route's", () => {
    applySeo({ ...base, jsonLd: [{ "@type": "Blog" }, { "@type": "BreadcrumbList" }] });
    expect(jsonLd()).toHaveLength(2);

    applySeo({ ...base, path: "/claims", jsonLd: [{ "@type": "Service" }] });
    const after = jsonLd();
    expect(after).toHaveLength(1);
    expect(after[0]["@type"]).toBe("Service");
  });

  it("never duplicates a tag across repeated navigations", () => {
    for (let i = 0; i < 5; i++) applySeo({ ...base, path: `/blog/${i}` });
    for (const sel of [
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[name="robots"]',
      'link[rel="canonical"]',
    ]) {
      expect(head().querySelectorAll(sel), sel).toHaveLength(1);
    }
  });

  it("truncates an over-long description before it reaches the tag", () => {
    applySeo({ ...base, description: "מילה ".repeat(100) });
    expect((content('meta[name="description"]') ?? "").length).toBeLessThanOrEqual(161);
  });
});

describe("breadcrumbLd", () => {
  it("builds a positioned BreadcrumbList with absolute item URLs", () => {
    const ld = breadcrumbLd([
      { name: "ראשי", path: "/" },
      { name: "בלוג", path: "/blog" },
    ]) as any;

    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[0]).toMatchObject({ position: 1, name: "ראשי" });
    expect(ld.itemListElement[1].position).toBe(2);
    for (const item of ld.itemListElement) {
      expect(item.item).toMatch(/^https:\/\//);
    }
  });
});
