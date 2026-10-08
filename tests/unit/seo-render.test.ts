import { describe, expect, it } from "vitest";
import { SITE_URL, renderSeoHtml, type SeoConfig } from "@/lib/seo";

// A trimmed stand-in for `dist/app.html`'s <head> — one of every tag
// `renderSeoHtml` patches, each with a value a passing test must not see.
const SHELL = `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <title>כותרת ברירת מחדל</title>
    <meta name="description" content="תיאור ברירת מחדל" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <link rel="canonical" href="${SITE_URL}/" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="כותרת ברירת מחדל" />
    <meta property="og:description" content="תיאור ברירת מחדל" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:image" content="https://old.example/default.png" />
    <meta name="twitter:title" content="כותרת ברירת מחדל" />
    <meta name="twitter:description" content="תיאור ברירת מחדל" />
    <meta name="twitter:image" content="https://old.example/default.png" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const articleConfig: SeoConfig = {
  title: "מאמר לדוגמה | בלוג",
  description: "תקציר המאמר לבדיקה.",
  path: "/blog/post-1",
  type: "article",
  image: "https://cdn.example/post-1.jpg",
  imageAlt: "תמונת המאמר",
  publishedTime: "2026-01-01T00:00:00Z",
  tags: ["פנסיה", "חיסכון"],
  jsonLd: [{ "@type": "BlogPosting", headline: "מאמר לדוגמה" }],
};

describe("renderSeoHtml", () => {
  it("replaces the title, description and robots tag in the shell", () => {
    const out = renderSeoHtml(SHELL, articleConfig);
    expect(out).toContain(`<title>${articleConfig.title}</title>`);
    expect(out).toContain(`<meta name="description" content="${articleConfig.description}" />`);
    expect(out).toContain('content="index, follow, max-image-preview:large, max-snippet:-1"');
  });

  it("points the canonical and og:url at the post's own path", () => {
    const out = renderSeoHtml(SHELL, articleConfig);
    expect(out).toContain(`<link rel="canonical" href="${SITE_URL}/blog/post-1" />`);
    expect(out).toContain(`<meta property="og:url" content="${SITE_URL}/blog/post-1" />`);
  });

  it("replaces the Open Graph and Twitter tags with the post's own, dropping the shell's", () => {
    const out = renderSeoHtml(SHELL, articleConfig);
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).toContain(`<meta property="og:title" content="${articleConfig.title}" />`);
    expect(out).toContain(`<meta property="og:image" content="${articleConfig.image}" />`);
    expect(out).toContain(`<meta name="twitter:image" content="${articleConfig.image}" />`);
    expect(out).not.toContain("https://old.example/default.png");
  });

  it("appends image alt, published time and article tags before </head>", () => {
    const out = renderSeoHtml(SHELL, articleConfig);
    const headClose = out.indexOf("</head>");
    expect(out.indexOf(`property="og:image:alt" content="${articleConfig.imageAlt}"`)).toBeLessThan(headClose);
    expect(out).toContain(`<meta property="article:published_time" content="${articleConfig.publishedTime}" />`);
    expect(out).toContain('<meta property="article:tag" content="פנסיה" />');
    expect(out).toContain('<meta property="article:tag" content="חיסכון" />');
  });

  it("serialises JSON-LD blocks as a script tag", () => {
    const out = renderSeoHtml(SHELL, articleConfig);
    expect(out).toContain(
      '<script type="application/ld+json">{"@type":"BlogPosting","headline":"מאמר לדוגמה"}</script>'
    );
  });

  it("marks a not-found page noindex and never emits article-only tags", () => {
    const out = renderSeoHtml(SHELL, {
      title: "המאמר לא נמצא",
      description: "המאמר המבוקש אינו קיים או הוסר.",
      path: "/blog",
      noIndex: true,
    });
    expect(out).toContain('content="noindex, nofollow"');
    expect(out).not.toContain("article:tag");
    expect(out).not.toContain("article:published_time");
  });

  it("escapes HTML-significant characters in attribute values", () => {
    const out = renderSeoHtml(SHELL, {
      title: `כותרת עם "גרשיים" & <תג>`,
      description: "תיאור רגיל",
      path: "/blog/x",
    });
    expect(out).toContain("&quot;גרשיים&quot;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&lt;תג&gt;");
    expect(out).not.toContain('"גרשיים"');
  });
});
