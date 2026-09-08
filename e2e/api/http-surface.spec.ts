import { expect, test, test_step } from "../fixtures/app";

/**
 * The site's own HTTP surface, exercised without a browser page. These run
 * against whatever PLAYWRIGHT_BASE_URL points at — the local production
 * preview by default, a deployed URL in CI smoke runs.
 */
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
      expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/);
    });

    await test_step("the canonical and the social card are complete", async () => {
      expect(html).toMatch(/<link rel="canonical" href="https:\/\//);
      expect(html).toMatch(/<meta property="og:title"/);
      expect(html).toMatch(/<meta property="og:image" content="https:\/\//);
      expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/);
    });

    await test_step("the document is responsive", async () => {
      expect(html).toMatch(/<meta name="viewport" content="[^"]*width=device-width/);
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
