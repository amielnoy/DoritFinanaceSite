import type { Frame, Page } from "@playwright/test";
import { AGAINST_A_DEPLOYMENT, expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The old Base44 host, played by this build.
 *
 * Base44 keeps serving a copy of the site at safe-arch-plan.base44.app and
 * cannot 301 it, so the page itself moves the visitor to govari-fin.co.il and
 * marks the copy noindex. Here the browser is told that host *is* the local
 * preview server — every request to it is answered from this build — and
 * production is a stub page, so nothing leaves the machine. Backend paths on
 * the old host fall through to the suite's usual /api stubs.
 */

const OLD = "https://safe-arch-plan.base44.app";
const PROD = "https://govari-fin.co.il";

test.skip(AGAINST_A_DEPLOYMENT, "plays the old host with the local build");

interface Served {
  /** Backend paths the page asked the old host for. */
  backend: string[];
  /** Production URLs the browser navigated to (answered by a stub). */
  production: string[];
}

async function playOldHostAndProduction(page: Page, baseURL: string): Promise<Served> {
  const served: Served = { backend: [], production: [] };

  await page.route(
    (url) => url.origin === OLD,
    async (route) => {
      const url = new URL(route.request().url());
      if (/^\/(api|ws-user-apps)(\/|$)/.test(url.pathname)) {
        served.backend.push(url.pathname);
        return route.fallback();
      }
      const response = await route.fetch({ url: new URL(url.pathname + url.search, baseURL).toString() });
      return route.fulfill({ response });
    },
  );

  await page.route(
    (url) => url.origin === PROD,
    (route) => {
      served.production.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>production</title><p>production</p>",
      });
    },
  );

  return served;
}

const head = (target: Page | Frame) => ({
  robots: () => target.locator('head meta[name="robots"]').first().getAttribute("content"),
  canonical: () => target.locator('head link[rel="canonical"]').first().getAttribute("href"),
  ogUrl: () => target.locator('head meta[property="og:url"]').first().getAttribute("content"),
});

test.describe("The old Base44 host", () => {
  test("sends a visitor to the same address on the production domain", async ({ page, baseURL }) => {
    const served = await playOldHostAndProduction(page, baseURL!);

    await test_step("open /faq with a campaign tag and a fragment on the old host", async () => {
      await page.goto(`${OLD}/faq?utm_source=wa#q3`, { waitUntil: "commit" });
    });

    await test_step("the browser lands on the same path, query and fragment on production", async () => {
      await page.waitForURL(`${PROD}/faq?utm_source=wa#q3`);
      expect(served.production[0]).toBe(`${PROD}/faq?utm_source=wa`);
    });

    await test_step("the old copy asked its backend for nothing on the way out but Base44's own page-view log", async () => {
      expect(served.backend.filter((p) => !p.startsWith("/api/app-logs/"))).toEqual([]);
    });
  });

  test("keeps a page whose sign-in is in flight, marked noindex with the canonical on production", async ({
    page,
    baseURL,
  }) => {
    const served = await playOldHostAndProduction(page, baseURL!);

    await test_step("open /faq on the old host carrying an OAuth error callback", async () => {
      await page.goto(`${OLD}/faq?error=access_denied`, { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.routeCommitted ?? null))
        .toBe("/faq");
    });

    await test_step("it stayed, and the route's own SEO did not undo the noindex", async () => {
      expect(new URL(page.url()).origin).toBe(OLD);
      expect(served.production).toEqual([]);
      await expect.poll(() => page.title()).toContain("שאלות");
      expect(await head(page).robots()).toBe("noindex");
      expect(await head(page).canonical()).toBe(`${PROD}/faq`);
      expect(await head(page).ogUrl()).toBe(`${PROD}/faq`);
    });
  });

  test("stays inside a frame, as in the Base44 dashboard, and is still noindex", async ({ page, baseURL }) => {
    const served = await playOldHostAndProduction(page, baseURL!);
    await page.route("https://editor.example/", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><iframe src="${OLD}/faq" width="1200" height="800"></iframe>`,
      }),
    );

    const frame = await test_step("open a page that frames the old host", async () => {
      await page.goto("https://editor.example/");
      const frame = page.frameLocator("iframe");
      await expect(frame.locator("h1").first()).toBeVisible();
      return page.frames().find((f) => f.url().startsWith(OLD))!;
    });

    await test_step("the frame stayed on the old host, marked noindex", async () => {
      expect(frame, "the frame left the old host").toBeTruthy();
      expect(served.production).toEqual([]);
      await expect.poll(() => head(frame).robots()).toBe("noindex");
      expect(await head(frame).canonical()).toBe(`${PROD}/faq`);
    });
  });
});

test.describe("Any other host", () => {
  test("is left as it was: indexable, and not redirected", async ({ page }) => {
    await gotoApp(page, "/faq");
    expect(new URL(page.url()).pathname).toBe("/faq");
    expect(await head(page).robots()).toBe("index, follow, max-image-preview:large, max-snippet:-1");
    expect(await head(page).canonical()).toBe(`${PROD}/faq`);
  });
});
