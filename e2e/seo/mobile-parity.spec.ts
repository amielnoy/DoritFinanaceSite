import { devices } from "@playwright/test";
import { expect, test, test_step } from "../fixtures/app";

/**
 * Google indexes and ranks the site from its *mobile* render. If the phone
 * viewport serves less content, different metadata or different structured data
 * than the desktop one, the desktop version's rankings are lost.
 *
 * This spec drives one desktop context and one phone context in the same test
 * and compares them, so it runs once rather than per project.
 */
test.describe("Mobile-first indexing parity", () => {
  test.skip(({ isMobile }) => !!isMobile, "opens its own contexts; runs once from a desktop project");

  const ROUTES = ["/", "/blog", "/claims", "/privacy", "/accessibility"];

  async function snapshot(browser: import("@playwright/test").Browser, mobile: boolean, baseURL: string) {
    const context = await browser.newContext(
      mobile
        ? { ...devices["Pixel 7"], baseURL }
        : { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL }
    );
    const page = await context.newPage();

    // The suite's API stubs live on the fixture's page, so stub here too.
    await page.route(/googletagmanager\.com|google-analytics\.com|fonts\.gstatic\.com/, (r) => r.abort());
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes("/public-settings/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "e2e-sanity-app", public_settings: {} }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    const out: Record<string, { title: string; description: string; canonical: string; robots: string; ldTypes: string[]; text: number }> = {};
    for (const path of ROUTES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#root")).not.toBeEmpty();
      await page.waitForFunction(() => !!document.querySelector('link[rel="canonical"]'));

      out[path] = await page.evaluate(() => ({
        title: document.title,
        description:
          document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
        robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
        ldTypes: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((s) => {
            try {
              return JSON.parse(s.textContent ?? "{}")["@type"] as string;
            } catch {
              return "invalid";
            }
          })
          .sort(),
        // Content only: the header nav and footer legitimately change shape
        // between viewports (full nav vs. burger), which is not a parity gap.
        text: (() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("header, footer, nav").forEach((n) => n.remove());
          return (clone.innerText ?? clone.textContent ?? "").replace(/\s+/g, " ").trim().length;
        })(),
      }));
    }

    await context.close();
    return out;
  }

  test("phone and desktop serve identical metadata and structured data", async ({ browser, baseURL }) => {
    const desktop = await test_step("crawl every route in a desktop context", () =>
      snapshot(browser, false, baseURL!)
    );
    const mobile = await test_step("crawl every route in a Pixel 7 context", () =>
      snapshot(browser, true, baseURL!)
    );

    for (const path of ROUTES) {
      await test_step(`${path} serves the same head to both`, async () => {
        expect(mobile[path].title, `${path}: title differs on mobile`).toBe(desktop[path].title);
        expect(mobile[path].description, `${path}: description differs`).toBe(desktop[path].description);
        expect(mobile[path].canonical, `${path}: canonical differs`).toBe(desktop[path].canonical);
        expect(mobile[path].robots, `${path}: robots directive differs`).toBe(desktop[path].robots);
        expect(mobile[path].ldTypes, `${path}: structured data differs`).toEqual(desktop[path].ldTypes);
      });
    }
  });

  test("the phone render is not a stripped-down version of the desktop one", async ({ browser, baseURL }) => {
    const desktop = await test_step("measure the content each route renders on desktop", () =>
      snapshot(browser, false, baseURL!)
    );
    const mobile = await test_step("measure the content each route renders on a phone", () =>
      snapshot(browser, true, baseURL!)
    );

    for (const path of ROUTES) {
      await test_step(`${path} shows the phone everything the desktop shows`, async () => {
        // Mobile-first indexing means content hidden on mobile is content Google
        // never sees. Header/footer chrome is excluded in snapshot(); what is left
        // is the page's actual content, which must match.
        const ratio = mobile[path].text / Math.max(1, desktop[path].text);
        expect(ratio, `${path}: mobile shows only ${Math.round(ratio * 100)}% of the desktop content`)
          .toBeGreaterThan(0.98);
      });
    }
  });
});

test.describe("Mobile crawlability", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile projects only");

  test("declares a responsive viewport that permits zoom", async ({ page }) => {
    const viewport = await test_step("read the viewport meta the phone receives", async () => {
      await page.goto("/");
      return page.locator('head meta[name="viewport"]').getAttribute("content");
    });

    await test_step("it is responsive", async () => {
      expect(viewport).toContain("width=device-width");
      expect(viewport).toContain("initial-scale=1");
    });

    await test_step("it does not block pinch-zoom", async () => {
      // Blocking zoom is both an accessibility failure and a mobile-usability
      // signal Google reports in Search Console.
      expect(viewport ?? "").not.toMatch(/user-scalable\s*=\s*(no|0)/);
      expect(viewport ?? "").not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
    });
  });

  test("body copy is legible without pinch-zooming", async ({ page }) => {
    await test_step("open the home page on a phone", async () => {
      await page.goto("/");
      await expect(page.locator("#about")).toBeAttached();
    });

    // Sentence-length prose is what Google's "text too small to read" check
    // targets. Short uppercase eyebrow labels are measured separately below.
    const tooSmall = await test_step("measure every paragraph and list item", () =>
      page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("p, li"))) {
        const node = el as HTMLElement;
        const text = (node.innerText ?? "").trim();
        if (!node.offsetParent || text.length < 60) continue;
        const size = parseFloat(getComputedStyle(node).fontSize);
        if (size < 12) out.push(`${size}px: ${text.slice(0, 40)}`);
      }
        return out;
      })
    );

    await test_step("no sentence-length text is set below 12px", async () => {
      expect(tooSmall).toEqual([]);
    });
  });

  test("reports sub-12px display labels (informational)", async ({ page }) => {
    await test_step("open the home page on a phone", async () => {
      await page.goto("/");
      await expect(page.locator("#about")).toBeAttached();
    });

    // The brand's eyebrow labels and stat captions are set at 11px uppercase.
    // Shrinking or growing them is a type-scale decision, not an SEO fix, so
    // this is tracked rather than enforced — see tests/test-plan/10-known-issues.
    const small = await test_step("collect every label under 12px", () =>
      page.evaluate(() =>
      Array.from(document.querySelectorAll("p, li, span"))
        .filter((el) => {
          const n = el as HTMLElement;
          return !!n.offsetParent && !!(n.innerText ?? "").trim() &&
            parseFloat(getComputedStyle(n).fontSize) < 12;
        })
          .map((el) => (el as HTMLElement).innerText.trim().slice(0, 30))
      )
    );

    await test_step("record the finding on the report rather than failing", async () => {
      test.info().annotations.push({
        type: "mobile-font-size",
        description: small.length ? `${small.length} label(s) under 12px` : "none",
      });
      expect(Array.isArray(small)).toBe(true);
    });
  });

  test("the LCP hero image is preloaded and eagerly fetched", async ({ page }) => {
    const preload = page.locator('head link[rel="preload"][as="image"]');

    await test_step("open the home page on a phone", async () => {
      await page.goto("/");
    });

    await test_step("the hero image is preloaded at high priority", async () => {
      await expect(preload).toHaveCount(1);
      expect(await preload.getAttribute("href")).toMatch(/^https:\/\//);
      expect(await preload.getAttribute("fetchpriority")).toBe("high");
    });
  });

  test("fonts do not block the first paint", async ({ request }) => {
    // Asserted against the served HTML, not the live DOM: the preload promotes
    // itself to rel="stylesheet" once loaded, which is the point of the pattern.
    const html = await test_step("fetch the served HTML", async () =>
      (await request.get("/")).text()
    );

    const fontLinks = await test_step("find the Google Fonts links in the head", async () => {
      const found = [...html.matchAll(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/g)].map((m) => m[0]);
      expect(found.length, "no Google Fonts link found").toBeGreaterThan(0);
      return found;
    });

    await test_step("the only render-blocking font link is the <noscript> fallback", async () => {
      const renderBlocking = fontLinks.filter(
        (tag) => /rel=["']stylesheet["']/.test(tag) && !/rel=["']preload["']/.test(tag)
      );
      for (const tag of renderBlocking) {
        const idx = html.indexOf(tag);
        const before = html.slice(Math.max(0, idx - 200), idx);
        expect(before, `render-blocking font link: ${tag}`).toContain("<noscript>");
      }
    });

    await test_step("the fonts are fetched through a preload instead", async () => {
      expect(html).toMatch(/rel="preload"\s+as="style"/);
    });
  });
});
