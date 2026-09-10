import { collectPageErrors, expect, gotoApp, test, test_step } from "../fixtures/app";

const PUBLIC_ROUTES = [
  { path: "/", heading: /דורית גוב ארי|אדריכלות/ },
  { path: "/blog", heading: /בלוג|מאמרים/ },
  { path: "/claims", heading: /תביע/ },
  { path: "/privacy", heading: /פרטיות/ },
  { path: "/accessibility", heading: /נגישות/ },
  // The auth screens ship with the Base44 starter copy (English).
  { path: "/login", heading: /Welcome back/i },
];

test.describe("Routing — sanity", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} renders without a client-side error`, async ({ page }) => {
      const { errors } = collectPageErrors(page);

      await test_step(`navigate to ${route.path}`, async () => {
        await gotoApp(page, route.path);
      });

      await test_step("the route renders its own content, not an empty shell", async () => {
        await expect(page.locator("#root")).not.toBeEmpty();
        await expect(page.getByRole("heading").first()).toBeVisible();
        await expect(page.locator("body")).toContainText(route.heading);
      });

      await test_step("rendering raised no client-side error", async () => {
        expect(errors, `${route.path}: ${errors.join("\n")}`).toEqual([]);
      });
    });
  }

  test("an unknown path lands on the app's not-found page, not a blank screen", async ({ page }) => {
    await test_step("navigate to a route that does not exist", async () => {
      await gotoApp(page, "/this-route-does-not-exist");
    });

    await test_step("the app renders its not-found page instead of nothing", async () => {
      await expect(page.locator("#root")).not.toBeEmpty();
      await expect(page.locator("body")).not.toHaveText("");
    });
  });

  test("deep links are served by the SPA fallback with a 200", async ({ page }) => {
    const response = await test_step("request /blog directly, as a shared link would", () =>
      page.goto("/blog")
    );

    await test_step("the server answers with the HTML shell, not a 404", async () => {
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"]).toContain("text/html");
    });
  });

  test("in-page anchors move the viewport to the right section", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("click the services link in the navigation", async () => {
      // :visible — the desktop nav and the mobile drawer both carry this href.
      await page.locator('a[href="/#services"]:visible').first().click();
    });

    await test_step("the services section is scrolled into view", async () => {
      await expect(page.locator("#services")).toBeInViewport({ ratio: 0.05 });
    });
  });

  test("the main menu reaches a home section from another route", async ({ page }) => {
    // The header renders on every route, but every section it names lives on
    // the home page. While these were bare `#section` hrefs, clicking one from
    // /blog set the URL to /blog#services and did nothing at all — the whole
    // menu was dead on every route except home.
    await test_step("open the blog, away from the home page", async () => {
      await gotoApp(page, "/blog");
      await expect(page).toHaveURL(/\/blog$/);
    });

    await test_step("click the services link in the header", async () => {
      // By its label rather than its href: the point is that the visitor gets
      // there, not how the anchor happens to be written.
      await page.locator("header").getByRole("link", { name: "שירותים" }).first().click();
    });

    await test_step("it lands on the home page at that section", async () => {
      await expect(page).toHaveURL(/\/#services$/);
      await expect(page.locator("#services")).toBeInViewport({ ratio: 0.05 });
    });
  });

  test("navigating between routes scrolls back to the top", async ({ page }) => {
    await test_step("open the home page and scroll down to the contact form", async () => {
      await gotoApp(page);
      await page.locator("#detailed-contact").scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });

    await test_step("follow the blog link from deep down the page", async () => {
      await page.getByRole("link", { name: "בלוג" }).first().click();
      await expect(page).toHaveURL(/\/blog$/);
    });

    await test_step("the new route starts at the top rather than mid-page", async () => {
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
    });
  });

  test("browser back returns to the previous route", async ({ page }) => {
    await test_step("go from the home page to the blog", async () => {
      await gotoApp(page);
      await page.getByRole("link", { name: "בלוג" }).first().click();
      await expect(page).toHaveURL(/\/blog$/);
    });

    await test_step("press the browser's back button", async () => {
      await page.goBack();
    });

    await test_step("the home page is restored", async () => {
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator("#top")).toBeVisible();
    });
  });

  test("admin routes bounce an anonymous visitor to login", async ({ page }) => {
    await test_step("request an admin route without a session", async () => {
      await gotoApp(page, "/admin/leads");
    });

    await test_step("the visitor is redirected to the login screen", async () => {
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
