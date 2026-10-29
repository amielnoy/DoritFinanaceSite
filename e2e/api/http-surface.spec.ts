import { expect, test, test_step } from "../fixtures/app";

/**
 * The site's own HTTP surface, exercised without a browser page. These run
 * against whatever PLAYWRIGHT_BASE_URL points at — the local production
 * preview by default, a deployed URL in CI smoke runs.
 */

/**
 * Read a tag's attributes instead of matching raw markup.
 *
 * A host may serve the deployed HTML through a pretty-printer that reorders
 * every attribute alphabetically (the site's first host did): what the source writes as
 * `<meta name="description" content="…">` arrives as
 * `<meta content="…" name="description"/>`. A regex over the byte order
 * therefore passes against the local `dist/` and fails against production —
 * which is what the smoke test kept reporting, on a head that was in fact
 * complete. Serving order is the platform's business; presence and value are
 * ours, so assert on those.
 */
function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([a-zA-Z][\w:-]*)="([^"]*)"/g)) {
    attributes[name] = value;
  }
  return attributes;
}

/** Every `<meta>` or `<link>` in the document, as attribute maps. */
function tags(html: string, element: "meta" | "link"): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${element}\\s[^>]*>`, "g"))].map(([tag]) =>
    attributesOf(tag)
  );
}

/** The `content` of the `<meta>` identified by `name=` / `property=`, or "". */
function metaContent(html: string, key: "name" | "property", value: string): string {
  return tags(html, "meta").find((tag) => tag[key] === value)?.content ?? "";
}

test.describe("HTTP surface — sanity", () => {
  test("GET / returns HTML with the Hebrew RTL shell", async ({ request }) => {
    const res = await test_step("GET /", () => request.get("/"));

    await test_step("the response is a 200 HTML document", async () => {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
    });

    await test_step("the shell declares Hebrew, RTL and the React root", async () => {
      const html = await res.text();
      expect(html).toContain('lang="he"');
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('<div id="root">');
    });
  });

  test("the HTML head carries the SEO and social contract", async ({ request }) => {
    const html = await test_step("fetch the served index.html", async () =>
      (await request.get("/")).text()
    );

    await test_step("the title and description are present and substantial", async () => {
      expect(html).toMatch(/<title>[^<]*דורית גוב ארי[^<]*<\/title>/);
      expect(metaContent(html, "name", "description").length).toBeGreaterThanOrEqual(50);
    });

    await test_step("the canonical and the social card are complete", async () => {
      const canonical = tags(html, "link").find((tag) => tag.rel === "canonical");
      expect(canonical?.href).toMatch(/^https:\/\//);
      expect(metaContent(html, "property", "og:title")).not.toBe("");
      expect(metaContent(html, "property", "og:image")).toMatch(/^https:\/\//);
      expect(metaContent(html, "name", "twitter:card")).toBe("summary_large_image");
    });

    await test_step("the document is responsive", async () => {
      expect(metaContent(html, "name", "viewport")).toContain("width=device-width");
    });
  });

  test("structured data blocks are valid JSON-LD", async ({ request }) => {
    const html = await test_step("fetch the served index.html", async () =>
      (await request.get("/")).text()
    );

    const types = await test_step("every JSON-LD block parses as schema.org", async () => {
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks.length).toBeGreaterThanOrEqual(2);

      return blocks.map((b) => {
        const parsed = JSON.parse(b[1]);
        expect(parsed["@context"]).toBe("https://schema.org");
        return parsed["@type"];
      });
    });

    await test_step("the static head claims the site-wide identity types", async () => {
      // Organisation identity is valid site-wide, so it stays in the static head.
      expect(types).toContain("FinancialService");
      expect(types).toContain("Person");
    });

    await test_step("the static head does not claim an FAQ it may not display", async () => {
      // FAQPage may only appear where the questions are rendered, and index.html
      // is served for every route, so the home page injects it at runtime — see
      // e2e/seo/metadata.spec.ts, "FAQPage markup appears only where the
      // questions are rendered".
      expect(types).not.toContain("FAQPage");
    });
  });

  test("robots.txt is served as text and points at the sitemap", async ({ request }) => {
    const res = await test_step("GET /robots.txt", () => request.get("/robots.txt"));

    await test_step("it is served as plain text", async () => {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/plain");
    });

    await test_step("it welcomes crawlers and points them at the sitemap", async () => {
      const body = await res.text();
      expect(body).toMatch(/^User-agent: \*/m);
      expect(body).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
      // The site deliberately opts into AI crawlers; a Disallow would be a regression.
      expect(body).not.toMatch(/^Disallow: \/$/m);
    });
  });

  test("sitemap.xml is well-formed and lists only https URLs", async ({ request }) => {
    const res = await test_step("GET /sitemap.xml", () => request.get("/sitemap.xml"));

    await test_step("it is served as XML", async () => {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/xml/);
    });

    const body = await res.text();

    await test_step("it declares the sitemap schema", async () => {
      expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(body).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
    });

    await test_step("every listed URL is absolute and https", async () => {
      const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(locs.length).toBeGreaterThan(0);
      for (const loc of locs) expect(loc).toMatch(/^https:\/\//);
    });
  });

  test("every sitemap URL resolves on this deployment", async ({ request }) => {
    const paths = await test_step("read the paths the sitemap advertises", async () => {
      const body = await (await request.get("/sitemap.xml")).text();
      return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    });

    for (const path of paths) {
      await test_step(`${path} resolves`, async () => {
        const res = await request.get(path);
        expect(res.status(), `${path} is listed in the sitemap but does not resolve`).toBe(200);
      });
    }
  });

  test("llms.txt is published for generative crawlers", async ({ request }) => {
    const res = await test_step("GET /llms.txt", () => request.get("/llms.txt"));

    await test_step("it is served as plain text with real content", async () => {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/plain");
      expect((await res.text()).length).toBeGreaterThan(50);
    });
  });

  // These three run against every build: the e2e fixture build in CI and the
  // live site in the post-deploy smoke (`PLAYWRIGHT_BASE_URL`). So they assert
  // properties any real article list has, never the fixture's own slug.
  const ARTICLE_LOC = /<loc>(https:\/\/[^<]+\/blog\/[a-z0-9-]+)<\/loc>(\s*<lastmod>[^<]+<\/lastmod>)?/g;

  test("the sitemap lists the prebuilt articles", async ({ request }) => {
    const body = await test_step("GET /sitemap.xml", async () => (await request.get("/sitemap.xml")).text());
    await test_step("there is at least one article, and each has a lastmod", async () => {
      const articles = [...body.matchAll(ARTICLE_LOC)];
      expect(articles.length, "no /blog/<slug> URL in the sitemap").toBeGreaterThan(0);
      for (const [, loc, lastmod] of articles) expect(lastmod, `${loc} has no <lastmod>`).toBeTruthy();
    });
  });

  test("llms.txt lists the articles and points at the full text", async ({ request }) => {
    const [llms, sitemap] = await test_step("GET /llms.txt and /sitemap.xml", async () =>
      Promise.all([(await request.get("/llms.txt")).text(), (await request.get("/sitemap.xml")).text()]),
    );
    await test_step("its articles are the sitemap's articles, and it links llms-full.txt", async () => {
      expect(llms).toContain("## מאמרים");
      expect(llms).toContain("/llms-full.txt");
      const listed = [...llms.matchAll(/^- \[[^\]]*\]\((https:\/\/[^)]+\/blog\/[a-z0-9-]+)\)/gm)].map((m) => m[1]);
      const inSitemap = [...sitemap.matchAll(ARTICLE_LOC)].map((m) => m[1]);
      expect(listed.length, "no article line in llms.txt").toBeGreaterThan(0);
      expect(listed.sort()).toEqual(inSitemap.sort());
    });
  });

  test("llms-full.txt carries the questions and the articles as text", async ({ request }) => {
    const res = await test_step("GET /llms-full.txt", () => request.get("/llms-full.txt"));
    await test_step("it is served as plain text with both sections", async () => {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/plain");
      const body = await res.text();
      expect(body).toContain("## שאלות ותשובות");
      expect(body).toContain("## מאמרים");
      expect(body).toContain("L-00107009");
      // Articles' own headings are demoted below their "###" titles, so nothing
      // after "## מאמרים" is a top-level section of the file.
      const articles = body.slice(body.indexOf("## מאמרים") + "## מאמרים".length);
      expect(articles).not.toMatch(/^## /m);
      expect(articles).toMatch(/^### /m);
      // Links inside the articles are absolute: the file is read on its own.
      expect(articles).not.toMatch(/\]\(\/(?!\/)/);
    });
  });

  test("client-side routes fall back to the SPA shell with a 200", async ({ request }) => {
    for (const path of ["/blog", "/claims", "/privacy", "/accessibility", "/blog/some-id"]) {
      await test_step(`${path} is answered with the SPA shell`, async () => {
        const res = await request.get(path);
        expect(res.status(), path).toBe(200);
        expect(res.headers()["content-type"], path).toContain("text/html");
        expect(await res.text()).toContain('<div id="root">');
      });
    }
  });

  test("the built JS and CSS bundles are reachable and non-empty", async ({ request }) => {
    const assets = await test_step("collect the hashed assets index.html references", async () => {
      const html = await (await request.get("/")).text();
      const found = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      expect(found.length, "the production build should emit hashed assets").toBeGreaterThan(0);
      return found;
    });

    for (const asset of assets) {
      await test_step(`${asset} is served with a body`, async () => {
        const res = await request.get(asset);
        expect(res.status(), asset).toBe(200);
        expect((await res.body()).length, asset).toBeGreaterThan(0);
      });
    }
  });

  test("every same-origin file referenced by index.html actually exists", async ({ request }) => {
    const refs = await test_step("collect every same-origin file the document references", async () => {
      const html = await (await request.get("/")).text();
      return [...html.matchAll(/(?:href|src)="(\/[^"/][^"]*)"/g)]
        .map((m) => m[1])
        .filter((p) => !p.startsWith("/src/")) // dev-only module entry
        // Files, not routes. `/` used to be the SPA shell, whose only
        // same-origin references were assets — since prerendering it is the
        // rendered home page, so it also carries the site's own navigation
        // (`/faq`, `/#top`), which is *supposed* to answer with HTML. A path
        // whose last segment has an extension is the thing this test is about:
        // the manifest, the icons, the hashed bundles. Routes are covered by
        // "every internal link lands on a real route" in navigation.spec.ts.
        .filter((p) => /\.[a-z0-9]+$/i.test(p.split(/[?#]/)[0]))
        .filter((p, i, all) => all.indexOf(p) === i);
    });

    for (const path of refs) {
      await test_step(`${path} exists as a real file`, async () => {
        const res = await request.get(path);
        expect(res.status(), `${path} is referenced by index.html`).toBe(200);
        // A missing static file is silently swallowed by the SPA fallback, which
        // hands back index.html with a 200 — so assert it is not HTML.
        expect(res.headers()["content-type"], `${path} falls through to the SPA shell`).not.toContain(
          "text/html"
        );
      });
    }
  });

  test("HEAD on the document does not error", async ({ request }) => {
    const res = await test_step("HEAD /", () => request.head("/"));

    await test_step("the server answers a HEAD probe cleanly", async () => {
      expect([200, 204, 405]).toContain(res.status());
    });
  });
});
