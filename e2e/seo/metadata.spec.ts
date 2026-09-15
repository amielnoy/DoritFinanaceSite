import type { Page } from "@playwright/test";
import { BLOG_POSTS } from "../fixtures/data";
import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The SPA ships one static <head>, so every route used to serve the same title,
 * description and canonical — the canonical pointing at the home page, which
 * tells search engines that /blog, /claims and every post *are* the home page.
 * These specs assert each route now carries its own.
 */

const PUBLIC_ROUTES = [
  { path: "/", name: "home", titleContains: "דורית גוב ארי" },
  { path: "/blog", name: "blog list", titleContains: "בלוג" },
  { path: `/blog/${BLOG_POSTS[0].id}`, name: "blog post", titleContains: BLOG_POSTS[0].title },
  { path: "/claims", name: "claims", titleContains: "תביעות" },
  { path: "/privacy", name: "privacy", titleContains: "פרטיות" },
  { path: "/accessibility", name: "accessibility", titleContains: "נגישות" },
];

const PRIVATE_ROUTES = ["/login", "/register", "/forgot-password", "/admin/leads"];

const head = {
  title: (p: Page) => p.title(),
  meta: (p: Page, name: string) =>
    p.locator(`head meta[name="${name}"]`).first().getAttribute("content"),
  og: (p: Page, prop: string) =>
    p.locator(`head meta[property="${prop}"]`).first().getAttribute("content"),
  canonical: (p: Page) => p.locator('head link[rel="canonical"]').getAttribute("href"),
  jsonLd: async (p: Page) =>
    (await p.locator('head script[type="application/ld+json"]').allTextContents()).map((t) =>
      JSON.parse(t)
    ),
};

/** Opens a route and waits for its own metadata to have replaced the shell's. */
const openRoute = (page: Page, route: { path: string; titleContains: string }) =>
  test_step(`open ${route.path} and wait for its own metadata to be applied`, async () => {
    await gotoApp(page, route.path);
    await expect.poll(() => head.title(page)).toContain(route.titleContains);
  });

test.describe("Per-route metadata", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} has its own title, description and canonical`, async ({ page }) => {
      await openRoute(page, route);

      await test_step("the title is this route's own and short enough to survive search results", async () => {
        const title = await head.title(page);
        // Google truncates around 60 characters.
        expect(title.length, `title too long: ${title}`).toBeLessThanOrEqual(75);
      });

      await test_step("the description is present and within the rendered length", async () => {
        const description = await head.meta(page, "description");
        expect(description, "missing description").toBeTruthy();
        expect(description!.length).toBeGreaterThan(50);
        expect(description!.length).toBeLessThanOrEqual(161);
      });

      await test_step("the canonical points at this route, not the home page", async () => {
        const canonical = await head.canonical(page);
        expect(canonical).toMatch(/^https:\/\//);
        const expectedPath = route.path === "/" ? "/" : route.path.replace(/\/$/, "");
        expect(new URL(canonical!).pathname).toBe(expectedPath);
      });
    });
  }

  test("every public route's title and canonical are unique", async ({ page }) => {
    const titles: string[] = [];
    const canonicals: string[] = [];
    const descriptions: string[] = [];

    for (const route of PUBLIC_ROUTES) {
      await openRoute(page, route);
      await test_step(`collect ${route.name}'s title, canonical and description`, async () => {
        titles.push(await head.title(page));
        canonicals.push((await head.canonical(page))!);
        descriptions.push((await head.meta(page, "description"))!);
      });
    }

    await test_step("no two routes duplicate each other's metadata", async () => {
      expect(new Set(titles).size, `duplicate titles: ${titles.join(" | ")}`).toBe(titles.length);
      expect(new Set(canonicals).size, `duplicate canonicals: ${canonicals.join(" | ")}`).toBe(
        canonicals.length
      );
      expect(new Set(descriptions).size, "duplicate descriptions").toBe(descriptions.length);
    });
  });

  test("navigating between routes replaces the metadata instead of stacking it", async ({ page }) => {
    await test_step("go to the blog, then on to the claims page", async () => {
      await gotoApp(page, "/blog");
      await expect.poll(() => head.title(page)).toContain("בלוג");
      await gotoApp(page, "/claims");
      await expect.poll(() => head.title(page)).toContain("תביעות");
    });

    await test_step("each managed tag exists exactly once", async () => {
      for (const sel of [
        'head meta[name="description"]',
        'head link[rel="canonical"]',
        'head meta[property="og:title"]',
        'head meta[name="robots"]',
      ]) {
        expect(await page.locator(sel).count(), sel).toBe(1);
      }
    });
  });
});

test.describe("Indexability", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} is indexable`, async ({ page }) => {
      await openRoute(page, route);

      await test_step("the robots directive invites indexing", async () => {
        const robots = await head.meta(page, "robots");
        expect(robots).toContain("index");
        expect(robots).not.toContain("noindex");
      });
    });
  }

  for (const path of PRIVATE_ROUTES) {
    test(`${path} is kept out of the index`, async ({ page }) => {
      await test_step(`open the private route ${path}`, async () => {
        await gotoApp(page, path);
      });

      await test_step("it declares itself noindex", async () => {
        await expect.poll(async () => head.meta(page, "robots")).toContain("noindex");
      });
    });
  }

  test("a missing blog post is noindex, not a thin indexable page", async ({ page }) => {
    await test_step("open a post id that does not exist", async () => {
      await gotoApp(page, "/blog/does-not-exist");
      await expect(page.getByText("המאמר לא נמצא")).toBeVisible();
    });

    await test_step("the not-found page is kept out of the index", async () => {
      await expect.poll(async () => head.meta(page, "robots")).toContain("noindex");
    });
  });

  test("the 404 page is noindex", async ({ page }) => {
    await test_step("open an unknown route", async () => {
      await gotoApp(page, "/no-such-route");
    });

    await test_step("the 404 page is kept out of the index", async () => {
      await expect.poll(async () => head.meta(page, "robots")).toContain("noindex");
    });
  });
});

test.describe("Social sharing cards", () => {
  test("the home page ships a complete Open Graph card", async ({ page }) => {
    await openRoute(page, { path: "/", titleContains: "דורית גוב ארי" });

    await test_step("the Open Graph card is complete and localised", async () => {
      expect(await head.og(page, "og:title")).toBeTruthy();
      expect(await head.og(page, "og:description")).toBeTruthy();
      expect(await head.og(page, "og:type")).toBe("website");
      expect(await head.og(page, "og:locale")).toBe("he_IL");
    });

    await test_step("it carries an absolute image with alt text and a large Twitter card", async () => {
      expect(await head.og(page, "og:image")).toMatch(/^https:\/\//);
      expect(await head.og(page, "og:image:alt")).toBeTruthy();
      expect(await head.meta(page, "twitter:card")).toBe("summary_large_image");
    });
  });

  test("a blog post shares as an article with its own image and date", async ({ page }) => {
    await openRoute(page, { path: `/blog/${BLOG_POSTS[0].id}`, titleContains: BLOG_POSTS[0].title });

    await test_step("the post shares as an article, with its own image and publish date", async () => {
      expect(await head.og(page, "og:type")).toBe("article");
      expect(await head.og(page, "og:image")).toBe(BLOG_POSTS[0].image_url);
      expect(await head.og(page, "article:published_time")).toBe(BLOG_POSTS[0].created_date);
      expect(await page.locator('head meta[property="article:tag"]').count()).toBe(2);
    });
  });

  test("a post without its own image falls back to the site card", async ({ page }) => {
    await openRoute(page, { path: `/blog/${BLOG_POSTS[1].id}`, titleContains: BLOG_POSTS[1].title });

    await test_step("the site's own card image is used instead", async () => {
      expect(await head.og(page, "og:image")).toMatch(/^https:\/\//);
    });
  });
});

test.describe("Structured data", () => {
  test("every JSON-LD block on every route is valid schema.org", async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await openRoute(page, route);

      await test_step(`${route.name}'s structured data parses and is typed`, async () => {
        const blocks = await head.jsonLd(page);
        expect(blocks.length, `${route.path} has no structured data`).toBeGreaterThan(0);
        for (const block of blocks) {
          expect(block["@context"], `${route.path}`).toBe("https://schema.org");
          expect(block["@type"], `${route.path}`).toBeTruthy();
        }
      });
    }
  });

  test("FAQPage markup appears only where the questions are rendered", async ({ page }) => {
    // The home page used to declare FAQPage for six pension questions that only
    // /faq renders — it displayed a list of tips instead. Two URLs claiming the
    // same FAQ, one of them without the answers on it, is the A-6 defect again.
    await test_step("the home page claims no FAQ it does not display", async () => {
      await gotoApp(page);
      await expect
        .poll(async () => (await head.jsonLd(page)).map((b) => b["@type"]))
        .not.toContain("FAQPage");
    });

    await test_step("every question and answer the markup declares is in the HTML", async () => {
      await gotoApp(page, "/faq");
      const declared = (await head.jsonLd(page)).find((b) => b["@type"] === "FAQPage") as
        | { mainEntity?: Array<{ name: string; acceptedAnswer?: { text?: string } }> }
        | undefined;
      expect(declared?.mainEntity?.length, "FAQPage declares no questions").toBeGreaterThan(5);

      // Present, not visible. Google's FAQ guidance allows hidden content and
      // requires present content — unmounted is absent, which was the defect:
      // the page rendered one category and dropped the rest. Radix keeps a
      // collapsed answer mounted, so the accordion itself was never the
      // problem; this asserts the property rather than the mechanism, and will
      // fail if a future Radix starts unmounting it. Read off the markup, so
      // the two can never disagree.
      const html = await page.content();
      for (const item of declared!.mainEntity!) {
        expect(html, `question not in the HTML: ${item.name}`).toContain(item.name);
        const answer = item.acceptedAnswer?.text ?? "";
        expect(html, `answer not in the HTML: ${item.name}`).toContain(answer.slice(0, 40));
      }
    });

    await test_step("/faq claims it, and renders the questions", async () => {
      await gotoApp(page, "/faq");
      await expect
        .poll(async () => (await head.jsonLd(page)).map((b) => b["@type"]))
        .toContain("FAQPage");
      // A question from the default category. The page renders one category at
      // a time and unmounts the rest, so most of what the markup declares is
      // not in the DOM until a tab is clicked — see 10-known-issues B.
      await expect(page.getByText("כיצד תכנון מס נכון חוסך")).toBeVisible();
    });

    for (const path of ["/privacy", "/blog", "/accessibility"]) {
      await test_step(`${path} claims no FAQ it does not display`, async () => {
        await gotoApp(page, path);
        await expect.poll(() => head.title(page)).not.toContain("אדריכלות של ביטחון");
        const types = (await head.jsonLd(page)).map((b) => b["@type"]);
        expect(types, `${path} claims an FAQ it does not display`).not.toContain("FAQPage");
      });
    }
  });

  test("inner pages carry a breadcrumb trail back to the home page", async ({ page }) => {
    for (const path of ["/blog", "/claims", "/privacy", "/accessibility"]) {
      await test_step(`${path} publishes a breadcrumb trail starting at the home page`, async () => {
        await gotoApp(page, path);
        const crumbs = (await head.jsonLd(page)).find((b) => b["@type"] === "BreadcrumbList");
        expect(crumbs, `${path} has no BreadcrumbList`).toBeTruthy();
        expect(crumbs.itemListElement[0]).toMatchObject({ position: 1, name: "ראשי" });
        expect(crumbs.itemListElement.at(-1).item).toContain(path);
      });
    }
  });

  test("a blog post publishes BlogPosting markup with author and publisher", async ({ page }) => {
    await openRoute(page, { path: `/blog/${BLOG_POSTS[0].id}`, titleContains: BLOG_POSTS[0].title });

    const posting = await test_step("read the post's BlogPosting block", async () => {
      const found = (await head.jsonLd(page)).find((b) => b["@type"] === "BlogPosting");
      expect(found, "no BlogPosting markup").toBeTruthy();
      return found;
    });

    await test_step("it names the article, its date, its author and its publisher", async () => {
      expect(posting.headline).toBe(BLOG_POSTS[0].title);
      expect(posting.datePublished).toBe(BLOG_POSTS[0].created_date);
      expect(posting.author).toMatchObject({ "@type": "Person", name: "דורית גוב ארי" });
      expect(posting.publisher["@type"]).toBe("Organization");
      expect(posting.mainEntityOfPage["@id"]).toContain(`/blog/${BLOG_POSTS[0].id}`);
    });

    await test_step("its description is prose, not raw markdown", async () => {
      expect(posting.description).not.toMatch(/[#*`]|\]\(/);
    });
  });

  test("the claims page describes itself as a Service", async ({ page }) => {
    await test_step("open the claims page", async () => {
      await gotoApp(page, "/claims");
    });

    await test_step("it publishes Service markup", async () => {
      const types = (await head.jsonLd(page)).map((b) => b["@type"]);
      expect(types).toContain("Service");
    });
  });
});

test.describe("Crawl directives", () => {
  test("robots.txt keeps private areas out of crawl budget", async ({ request }) => {
    const body = await test_step("fetch robots.txt", async () =>
      (await request.get("/robots.txt")).text()
    );

    await test_step("the private areas are disallowed", async () => {
      for (const path of ["/admin/", "/login", "/register", "/oauth/"]) {
        expect(body, `${path} should be disallowed`).toContain(`Disallow: ${path}`);
      }
    });

    await test_step("the public site stays crawlable, AI crawlers included", async () => {
      expect(body).toMatch(/^Allow: \/$/m);
      expect(body).not.toMatch(/^Disallow: \/$/m);
      // The explicit GPTBot/Claude-Web allow-list was dropped upstream. It was
      // redundant — `Allow: /` under `User-agent: *` already covers them — so
      // assert that none is *blocked* rather than requiring the list back.
      for (const bot of ["GPTBot", "Claude-Web", "PerplexityBot", "Google-Extended"]) {
        const blocked = new RegExp(`User-agent: ${bot}[\\s\\S]*?^Disallow: /$`, "m");
        expect(blocked.test(body), `${bot} is explicitly blocked`).toBe(false);
      }
    });
  });

  test("the sitemap lists every public content route", async ({ request }) => {
    const paths = await test_step("read the paths the sitemap advertises", async () => {
      const body = await (await request.get("/sitemap.xml")).text();
      return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    });

    await test_step("every public route is listed", async () => {
      for (const expected of ["/", "/blog", "/claims", "/faq", "/tools", "/perspective", "/privacy", "/accessibility"]) {
        expect(paths, `sitemap is missing ${expected}`).toContain(expected);
      }
    });
  });

  test("the sitemap lists no route that is marked noindex", async ({ request }) => {
    const paths = await test_step("read the paths the sitemap advertises", async () => {
      const body = await (await request.get("/sitemap.xml")).text();
      return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    });

    await test_step("none of them is a route the app marks noindex", async () => {
      for (const path of paths) {
        expect(PRIVATE_ROUTES, `${path} is both in the sitemap and noindex`).not.toContain(path);
      }
    });
  });

  test("sitemap URLs share the canonical origin the pages declare", async ({ page, request }) => {
    const sitemapOrigin = await test_step("read the origin the sitemap uses", async () => {
      const body = await (await request.get("/sitemap.xml")).text();
      return new URL(body.match(/<loc>([^<]+)<\/loc>/)![1]).origin;
    });

    await openRoute(page, { path: "/", titleContains: "דורית גוב ארי" });

    await test_step("the page's canonical uses the same origin", async () => {
      expect(new URL((await head.canonical(page))!).origin).toBe(sitemapOrigin);
    });
  });
});
