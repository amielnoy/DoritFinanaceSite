import type { Page } from "@playwright/test";
import { collectPageErrors, expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * Reach the header's navigation on whatever platform is running.
 *
 * The desktop nav is `hidden md:flex`, so on a phone the links exist only
 * inside the drawer behind the hamburger. Tests that skip this step do not
 * fail honestly — before this helper existed, the anchor test selected
 * `a[href="#services"]` unscoped, and on mobile the only visible match was the
 * *footer* link, so it silently exercised the footer instead of the header.
 */
async function openHeaderNav(page: Page, isMobile: boolean | undefined): Promise<void> {
  if (!isMobile) return;
  await page.getByRole("button", { name: "תפריט" }).click();
}

const PUBLIC_ROUTES = [
  { path: "/", heading: /דורית גוב ארי|אדריכלות/ },
  { path: "/blog", heading: /בלוג|מאמרים/ },
  { path: "/claims", heading: /תביע/ },
  // /faq was missing from this list, so none of the checks below ever ran
  // against it — while the footer linked to it twice.
  { path: "/faq", heading: /שאלות|תשובות/ },
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

  test("in-page anchors move the viewport to the right section", async ({ page, isMobile }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("click the services link in the header navigation", async () => {
      await openHeaderNav(page, isMobile);
      await page.locator("header").getByRole("link", { name: "שירותים" }).first().click();
    });

    await test_step("the services section is scrolled into view", async () => {
      await expect(page.locator("#services")).toBeInViewport({ ratio: 0.05 });
    });
  });

  test("the main menu reaches a home section from another route", async ({ page, isMobile }) => {
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
      await openHeaderNav(page, isMobile);
      await page.locator("header").getByRole("link", { name: "שירותים" }).first().click();
    });

    await test_step("it lands on the home page at that section", async () => {
      await expect(page).toHaveURL(/\/#services$/);
      await expect(page.locator("#services")).toBeInViewport({ ratio: 0.05 });
    });
  });

  test("the footer reaches a home section from another route", async ({ page }) => {
    // The same defect the header test above guards against, in the menu that
    // carries more links and sits on all seven pages. The header was fixed and
    // the footer was not, so `אודות`, `שירותים`, `תיקי הצלחה` and `קביעת ייעוץ`
    // stayed dead everywhere except home — a bare `#about` on /blog resolves to
    // no element and silently does nothing.
    await test_step("open the blog, away from the home page", async () => {
      await gotoApp(page, "/blog");
    });

    await test_step("click the about link in the footer", async () => {
      await page.locator("footer").getByRole("link", { name: "אודות" }).first().click();
    });

    await test_step("it lands on the home page at that section", async () => {
      await expect(page).toHaveURL(/\/#about$/);
      await expect(page.locator("#about")).toBeInViewport({ ratio: 0.05 });
    });
  });

  test("no link anywhere points at a section the page does not have", async ({ page }) => {
    // The general form of the bug, checked rather than enumerated. Every
    // same-page `#hash` anchor on every public route must resolve to an element
    // on that route — an anchor that does not is inert, and inert is invisible:
    // nothing throws, nothing logs, the click simply does nothing.
    for (const route of PUBLIC_ROUTES) {
      await test_step(`every in-page anchor on ${route.path} resolves`, async () => {
        await gotoApp(page, route.path);
        const dead = await page.evaluate(() =>
          [...document.querySelectorAll('a[href^="#"]')]
            .map((a) => a.getAttribute("href") as string)
            .filter((href) => href.length > 1 && !document.getElementById(href.slice(1))),
        );
        expect(dead, `${route.path} has anchors pointing nowhere`).toEqual([]);
      });
    }
  });

  test("every internal link lands on a real route, not the not-found page", async ({ page }) => {
    // The other half of the dead-link problem. An anchor that names a section
    // which is not there does nothing; a link that names a route which is not
    // registered does something worse — it renders the 404 and looks like the
    // site is broken. Neither throws, so neither shows up in a console check.
    await gotoApp(page, "/");
    const hrefs = await page.evaluate(() =>
      [...new Set(
        [...document.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href") as string)
          .filter((h) => h.startsWith("/") && !h.startsWith("//")),
      )],
    );
    expect(hrefs.length, "no internal links found — the selector has rotted").toBeGreaterThan(3);

    for (const href of hrefs) {
      const path = href.split("#")[0].split("?")[0];
      if (!path || path === "/") continue;
      await test_step(`${path} is a registered route`, async () => {
        await gotoApp(page, path);
        await expect(
          page.getByRole("heading", { name: "404" }),
          `${path} is linked from the site but renders the not-found page`,
        ).toHaveCount(0);
      });
    }
  });

  test("every link in the footer menu goes where its label says", async ({ page }) => {
    // Driven from /blog on purpose: on the home page a bare `#about` works by
    // accident, which is exactly why the footer's dead links survived so long.
    const EXPECTED: Array<[label: string, url: RegExp]> = [
      ["אודות", /\/#about$/],
      ["שירותים", /\/#services$/],
      ["מדריך תביעות", /\/claims$/],
      ["שאלות ותשובות", /\/faq$/],
      ["תיקי הצלחה", /\/#proof$/],
      ["בלוג", /\/blog$/],
      ["לשיחה קצרה עם דורית", /\/#start$/],
    ];

    for (const [label, url] of EXPECTED) {
      await test_step(`${label} reaches its target from /blog`, async () => {
        await gotoApp(page, "/blog");
        await page.locator("footer").getByRole("link", { name: label, exact: true }).first().click();
        await expect(page).toHaveURL(url);
      });
    }
  });

  test("navigating between routes scrolls back to the top", async ({ page }) => {
    await test_step("open the home page and scroll down to the contact form", async () => {
      await gotoApp(page);
      await page.locator("#common-questions").scrollIntoViewIfNeeded();
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
