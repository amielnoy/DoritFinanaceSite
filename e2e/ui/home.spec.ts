import { collectPageErrors, expect, gotoApp, test, test_step } from "../fixtures/app";

test.describe("Home — sanity", () => {
  test("boots past the auth/bootstrap spinner and renders the page shell", async ({ page, mockApi }) => {
    const { errors } = collectPageErrors(page);

    await test_step("open the home page and wait for the SPA to mount", async () => {
      await gotoApp(page);
    });

    await test_step("the page shell is rendered and the bootstrap spinner is gone", async () => {
      await expect(page.locator("#top")).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator(".animate-spin")).toHaveCount(0);
    });

    await test_step("booting raised no console or page error", async () => {
      expect(errors, errors.join("\n")).toEqual([]);
    });

    await test_step("the shell asked the backend for its public settings", async () => {
      expect(mockApi.requestsTo("/public-settings/").length).toBeGreaterThan(0);
    });
  });

  test("has the RTL Hebrew document contract search engines rely on", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("the document declares Hebrew and right-to-left", async () => {
      await expect(page.locator("html")).toHaveAttribute("lang", "he");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    });

    await test_step("the title and description are the home route's own", async () => {
      await expect(page).toHaveTitle(/דורית גוב ארי/);
      // The head is re-written at runtime by useSeo(), so this asserts the home
      // route's own description — not the static one index.html shipped with.
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        /יועצת ביטוחית ופיננסית/
      );
    });
  });

  test("renders every top-level section of the landing page", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    for (const id of [
      "top",
      "about",
      "perspective",
      "services",
      "fee-calculator",
      "quick-contact",
      "proof",
      "testimonials",
      "faq",
      "consultation",
      "detailed-contact",
      "common-questions",
    ]) {
      await test_step(`the "${id}" section is on the page`, async () => {
        await expect(page.locator(`#${id}`), `#${id} is missing`).toHaveCount(1);
      });
    }
  });

  test("exposes exactly one h1 and a sane heading order", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    const levels = await test_step("read every visible heading level in document order", () =>
      page.$$eval("h1,h2,h3,h4", (nodes) =>
        nodes
          .filter((n) => (n as HTMLElement).offsetParent !== null || n.tagName === "H1")
          .map((n) => Number(n.tagName[1]))
      )
    );

    await test_step("there is exactly one h1", async () => {
      expect(levels.filter((l) => l === 1).length).toBe(1);
    });

    await test_step("no heading level is skipped", async () => {
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1], `heading jump at index ${i}`).toBeLessThanOrEqual(1);
      }
    });
  });

  test("renders the reviews pulled from the backend", async ({ page, mockApi }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("the page requested the testimonials", async () => {
      await mockApi.waitForRequest("/entities/Testimonial");
    });

    await test_step("a testimonial from the backend is on screen", async () => {
      await expect(page.getByText("רונית לוי").first()).toBeVisible();
    });
  });

  test("survives a backend that is completely down", async ({ page, mockApi }) => {
    const { errors } = collectPageErrors(page);

    await test_step("make every entity endpoint fail with a 500", async () => {
      mockApi.failOn("/entities/", 500, { error: "boom" });
    });

    await test_step("open the home page against the broken backend", async () => {
      await gotoApp(page);
    });

    await test_step("static content still renders — the page does not white-screen", async () => {
      await expect(page.locator("#top")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(errors.filter((e) => e.startsWith("pageerror")), errors.join("\n")).toEqual([]);
    });
  });

  test("wires the primary CTAs to real targets", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("the consultation CTA is visible", async () => {
      // :visible — the same hrefs also exist in the desktop nav / mobile drawer,
      // only one set of which is rendered per viewport.
      const cta = page.locator('a[href="#consultation"]:visible').first();
      await expect(cta).toBeVisible();
    });

    await test_step("the call CTA dials the adviser's real number", async () => {
      const tel = page.locator('a[href^="tel:"]:visible').first();
      await expect(tel).toHaveAttribute("href", "tel:+972508311776");
    });
  });
});
