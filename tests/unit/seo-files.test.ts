import { describe, expect, it } from "vitest";
import {
  buildLlms,
  buildLlmsFull,
  absolutizeLinks,
  buildSitemap,
  demoteHeadings,
  lastmodOf,
  originFromSitemap,
  withBuiltPages,
  // @ts-expect-error — plain .mjs tooling, imported for its pure steps.
} from "../../scripts/seo-files.mjs";

const ORIGIN = "https://govari-fin.co.il";
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${ORIGIN}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${ORIGIN}/blog</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
`;
const LLMS = `# כותרת

> גילוי

## פרטי קשר

- טלפון

## מגבלות שחשוב לדעת עליהן

- אין ייעוץ

## דפים

- [דף הבית](${ORIGIN}/)

## הערה למנועי חיפוש ולסוכני AI

הערה.
`;
const A = { slug: "horadat-dmei-nihul", title: "הורדת דמי ניהול", excerpt: "איך מורידים.", body: "גוף המאמר.", updated_at: "2026-10-10T08:00:00Z" };
const B = { slug: "kesef-shenishkach", title: "כסף [שנשכח] & <אבוד>", excerpt: null, body: "שורה\nשנייה", updated_at: null, created_at: "2026-09-01T00:00:00Z" };

describe("originFromSitemap", () => {
  it("reads the host the site-url plugin already chose", () => {
    expect(originFromSitemap(SITEMAP)).toBe(ORIGIN);
  });
  it("refuses a sitemap with no https <loc>", () => {
    expect(() => originFromSitemap("<urlset></urlset>")).toThrow(/no <loc>/);
  });
});

describe("lastmodOf", () => {
  it("prefers updated_at, then the created dates, and normalises to ISO", () => {
    expect(lastmodOf(A)).toBe("2026-10-10T08:00:00.000Z");
    expect(lastmodOf(B)).toBe("2026-09-01T00:00:00.000Z");
    expect(lastmodOf({ created_date: "2026-10-01T09:00:00Z" })).toBe("2026-10-01T09:00:00.000Z");
  });
  it("is null when there is no usable date", () => {
    expect(lastmodOf({})).toBeNull();
    expect(lastmodOf({ updated_at: "not a date" })).toBeNull();
  });
});

describe("buildSitemap", () => {
  const xml = buildSitemap(SITEMAP, [A, B]);

  it("keeps the static routes without a lastmod", () => {
    expect(xml).toMatch(new RegExp(`<loc>${ORIGIN}/</loc>\\s*<changefreq>`));
  });
  it("dates /blog by its newest article", () => {
    expect(xml).toMatch(new RegExp(`<loc>${ORIGIN}/blog</loc>\\s*<lastmod>2026-10-10T08:00:00.000Z</lastmod>`));
  });
  it("adds every article at /blog/<slug> with its own lastmod", () => {
    expect(xml).toContain(`<loc>${ORIGIN}/blog/horadat-dmei-nihul</loc>\n    <lastmod>2026-10-10T08:00:00.000Z</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/blog/kesef-shenishkach</loc>\n    <lastmod>2026-09-01T00:00:00.000Z</lastmod>`);
  });
  it("writes no empty lastmod for an article without a date", () => {
    const out = buildSitemap(SITEMAP, [{ slug: "no-date", title: "t" }]);
    expect(out).not.toContain("<lastmod></lastmod>");
    expect(out).toContain(`<loc>${ORIGIN}/blog/no-date</loc>\n    <changefreq>`);
  });
  it("stays one well-formed urlset", () => {
    expect(xml.match(/<urlset/g)).toHaveLength(1);
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(4);
  });
  it("leaves /blog undated when there are no articles", () => {
    expect(buildSitemap(SITEMAP, [])).toBe(SITEMAP);
  });
});

describe("buildLlms", () => {
  const out = buildLlms(LLMS, ORIGIN, [A, B]);

  it("keeps everything before the pages list verbatim", () => {
    expect(out.startsWith(LLMS.slice(0, LLMS.indexOf("## דפים")))).toBe(true);
  });
  it("adds an articles section before the crawler note, one line per article", () => {
    const section = out.slice(out.indexOf("## מאמרים"), out.indexOf("## הערה למנועי חיפוש ולסוכני AI"));
    expect(section).toContain(`- [הורדת דמי ניהול](${ORIGIN}/blog/horadat-dmei-nihul) — איך מורידים.`);
    expect(section).toContain(`- [כסף (שנשכח) & <אבוד>](${ORIGIN}/blog/kesef-shenishkach)\n`);
    expect(section.split("\n").filter((l) => l.startsWith("- ["))).toHaveLength(2);
  });
  it("points at llms-full.txt from the crawler note", () => {
    expect(out).toContain(`${ORIGIN}/llms-full.txt`);
  });
  it("collapses a line break in an excerpt so the list stays a list", () => {
    const one = buildLlms(LLMS, ORIGIN, [{ ...A, excerpt: "שורה\nשנייה" }]);
    expect(one).toContain("— שורה שנייה");
  });
  it("refuses a template without the crawler note it inserts before", () => {
    expect(() => buildLlms("# x\n", ORIGIN, [A])).toThrow(/הערה למנועי חיפוש/);
  });
});

describe("buildLlmsFull", () => {
  const out = buildLlmsFull(LLMS, ORIGIN, [{ q: "מה זה?", a: "תשובה." }], [A, B]);

  it("opens with the identity, contact, disclosure and limitations, verbatim", () => {
    expect(out.startsWith(LLMS.slice(0, LLMS.indexOf("## דפים")))).toBe(true);
    expect(out).not.toContain("## דפים");
  });
  it("carries every question and answer under its own heading", () => {
    expect(out).toContain(`## שאלות ותשובות\n\nמקור: ${ORIGIN}/faq\n\n### מה זה?\n\nתשובה.\n`);
  });
  it("carries every article's text under its title and address", () => {
    expect(out).toContain(`### הורדת דמי ניהול\n\n${ORIGIN}/blog/horadat-dmei-nihul · עודכן 2026-10-10\n\nגוף המאמר.\n`);
    expect(out).toContain(`${ORIGIN}/blog/kesef-shenishkach · עודכן 2026-09-01\n\nשורה\nשנייה\n`);
  });
  it("refuses a template without the pages heading it cuts at", () => {
    expect(() => buildLlmsFull("# x\n", ORIGIN, [], [])).toThrow(/## דפים/);
  });
});

describe("demoteHeadings", () => {
  it("moves every heading two levels down, stopping at h6", () => {
    expect(demoteHeadings("## a\n\n#### b\n\n###### c")).toBe("#### a\n\n###### b\n\n###### c");
    expect(demoteHeadings("# t")).toBe("### t");
  });
  it("leaves a heading-looking line inside a fenced block alone", () => {
    expect(demoteHeadings("```\n## x\n```\n## y")).toBe("```\n## x\n```\n#### y");
    expect(demoteHeadings("~~~\n## x\n~~~\n## y")).toBe("~~~\n## x\n~~~\n#### y");
  });
  it("leaves #hashtag (no space) and mid-line hashes alone", () => {
    expect(demoteHeadings("#hashtag\ntext ## not")).toBe("#hashtag\ntext ## not");
  });
});

describe("absolutizeLinks", () => {
  it("makes a root-relative Markdown link target absolute", () => {
    expect(absolutizeLinks("[a](/#start) and [b](/blog)", ORIGIN)).toBe(`[a](${ORIGIN}/#start) and [b](${ORIGIN}/blog)`);
  });
  it("leaves absolute and protocol-relative targets alone", () => {
    const text = "[x](https://x.example/a) [y](//cdn.example/a)";
    expect(absolutizeLinks(text, ORIGIN)).toBe(text);
  });
  it("leaves a fenced block alone", () => {
    expect(absolutizeLinks("```\n[a](/x)\n```", ORIGIN)).toBe("```\n[a](/x)\n```");
  });
});

describe("withBuiltPages", () => {
  const rows = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
  it("keeps only articles whose page exists, and names the rest", () => {
    const out = withBuiltPages(rows, (slug: string) => slug !== "b");
    expect(out.kept).toEqual([{ slug: "a" }, { slug: "c" }]);
    expect(out.dropped).toEqual(["b"]);
  });
  it("drops nothing when every page exists", () => {
    expect(withBuiltPages(rows, () => true)).toEqual({ kept: rows, dropped: [] });
  });
});

describe("buildLlmsFull — article bodies", () => {
  const article = { slug: "s", title: "T", body: "## מה בודקים\n\nראו [כאן](/#start).", updated_at: "2026-10-10T00:00:00Z" };
  const out = buildLlmsFull(LLMS, ORIGIN, [], [article]);
  it("demotes the body's headings below the article title", () => {
    expect(out).toContain("#### מה בודקים");
    expect(out).not.toMatch(/^## מה בודקים/m);
  });
  it("makes the body's root-relative links absolute", () => {
    expect(out).toContain(`[כאן](${ORIGIN}/#start)`);
  });
});
