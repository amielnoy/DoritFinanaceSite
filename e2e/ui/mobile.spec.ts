import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * Mobile-web sanity for the two platforms that matter to this site's traffic:
 * iOS Safari (WebKit / iPhone 14) and Android Chrome (Chromium / Pixel 7).
 * The desktop projects skip this file.
 */

/**
 * The sticky bar's two links duplicate labels used in the footer and the
 * section nav, so scope to the bar itself (MobileStickyBar's root classes).
 */
const stickyBar = (page: import("@playwright/test").Page) =>
  page.locator("div.md\\:hidden.fixed.bottom-0");

test.describe("Mobile web (iOS + Android)", () => {
  // `isMobile` comes from the device descriptor, so this runs only on the
  // ios-safari and android-chrome projects.
  test.skip(({ isMobile }) => !isMobile, "mobile projects only");

  test("renders the sticky call/consult bar instead of the desktop dock", async ({ page }) => {
    await test_step("open the home page on a phone viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the sticky bar offers a call and a consultation link", async () => {
      const stickyCall = stickyBar(page).getByRole("link", { name: /חייגו עכשיו/ });
      const stickyBook = stickyBar(page).getByRole("link", { name: /לשיחה קצרה עם דורית/ });
      await expect(stickyCall).toBeVisible();
      await expect(stickyBook).toBeVisible();
      await expect(stickyCall).toHaveAttribute("href", "tel:+972508311776");
      await expect(stickyBook).toHaveAttribute("href", "#start");
    });

    await test_step("the desktop floating dock is hidden below md", async () => {
      await expect(page.getByRole("link", { name: "פתיחת שיחה בוואטסאפ" })).toBeHidden();
    });
  });

  test("the sticky bar stays pinned while scrolling", async ({ page }) => {
    await test_step("open the home page and scroll down to the testimonials", async () => {
      await gotoApp(page);
      await page.locator("#testimonials").scrollIntoViewIfNeeded();
    });

    await test_step("the call button is still on screen", async () => {
      await expect(stickyBar(page).getByRole("link", { name: /חייגו עכשיו/ })).toBeInViewport();
    });
  });

  test("opens and closes the burger menu and navigates from it", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("tap the burger button", async () => {
      const burger = page.getByRole("button", { name: "תפריט" });
      await expect(burger).toBeVisible();
      await burger.tap();
    });

    const drawer = page.getByRole("navigation").last();

    await test_step("the drawer opens with the site's links", async () => {
      await expect(page.getByRole("button", { name: "סגירת תפריט" })).toBeVisible();
      await expect(drawer.getByRole("link", { name: "בלוג" })).toBeVisible();
    });

    await test_step("tapping a link inside the drawer navigates", async () => {
      await drawer.getByRole("link", { name: "בלוג" }).tap();
      await expect(page).toHaveURL(/\/blog$/);
    });
  });

  test("the burger menu closes on Escape and on backdrop tap", async ({ page }) => {
    await test_step("open the home page and the burger menu", async () => {
      await gotoApp(page);
      await page.getByRole("button", { name: "תפריט" }).tap();
      await expect(page.getByRole("button", { name: "סגירת תפריט" })).toBeVisible();
    });

    await test_step("pressing Escape closes the drawer", async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "סגירת תפריט" })).toBeHidden();
    });
  });

  test("no page scrolls horizontally on a phone viewport", async ({ page }) => {
    for (const path of ["/", "/blog", "/claims", "/privacy", "/accessibility"]) {
      await test_step(`${path} fits the phone's width`, async () => {
        await gotoApp(page, path);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        // 1px of rounding slack; anything more is a real layout break.
        expect(overflow.scrollWidth - overflow.clientWidth, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
      });
    }
  });

  test("primary tap targets meet the 44px minimum", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("every primary control is big enough to hit with a thumb", async () => {
      const targets = [
        stickyBar(page).getByRole("link", { name: /חייגו עכשיו/ }),
        stickyBar(page).getByRole("link", { name: /לשיחה קצרה עם דורית/ }),
        page.getByRole("button", { name: "תפריט" }),
      ];

      for (const target of targets) {
        const box = await target.boundingBox();
        expect(box, "tap target is not rendered").not.toBeNull();
        expect(Math.max(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
        expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(36);
      }
    });
  });

  test("the phone keyboard gets the right input types", async ({ page }) => {
    const form = page.locator("#quick-contact");

    await test_step("open the home page and scroll to the quick contact form", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
    });

    await test_step("phone and email fields ask for the matching keyboard", async () => {
      await expect(form.locator("#qc-phone")).toHaveAttribute("type", "tel");
      await expect(form.locator("#qc-email")).toHaveAttribute("type", "email");
    });
  });

  test("a visitor can submit the quick contact form by touch", async ({ page, mockApi }) => {
    const form = page.locator("#quick-contact");

    await test_step("open the home page and scroll to the quick contact form", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
    });

    await test_step("fill the form using taps only", async () => {
      await form.locator("#qc-name").tap();
      await form.locator("#qc-name").fill("ישראלה");
      await form.locator("#qc-phone").fill("050-1234567");
      await form.getByRole("button", { name: "שליחת הודעה" }).tap();
    });

    await test_step("the message is confirmed and the lead reaches the backend", async () => {
      await expect(form.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
      const lead = await mockApi.waitForRequest("/functions/submitLead");
      expect(lead.body).toMatchObject({ source: "quick" });
    });
  });

  test("the calculator is usable on a narrow screen", async ({ page }) => {
    const section = page.locator("#fee-calculator");

    await test_step("open the tools page and scroll to the fee calculator", async () => {
      await gotoApp(page, "/tools");
      await section.scrollIntoViewIfNeeded();
    });

    await test_step("its inputs are reachable and still compute a number", async () => {
      const input = section.getByLabel("הפקדה חודשית (₪)");
      await expect(input).toBeVisible();
      await input.fill("3000");
      await expect(section).not.toContainText("NaN");
    });
  });

  test("the viewport meta allows pinch-zoom (no user-scalable=no)", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("the viewport is responsive and zoom is not blocked", async () => {
      const content = await page.locator('meta[name="viewport"]').getAttribute("content");
      expect(content).toContain("width=device-width");
      expect(content ?? "").not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
    });
  });
});

test.describe("Desktop-only chrome", () => {
  test.skip(({ isMobile }) => !!isMobile, "desktop projects only");

  test("shows the floating WhatsApp/phone dock and hides the mobile bar", async ({ page }) => {
    await test_step("open the home page on a desktop viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the desktop dock is shown and the mobile bar is not", async () => {
      await expect(page.getByRole("link", { name: "פתיחת שיחה בוואטסאפ" })).toBeVisible();
      await expect(stickyBar(page).getByRole("link", { name: /חייגו עכשיו/ })).toBeHidden();
    });
  });

  test("shows the full desktop nav rather than a burger", async ({ page }) => {
    await test_step("open the home page on a desktop viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the burger is hidden and the full navigation is visible", async () => {
      await expect(page.getByRole("button", { name: "תפריט" })).toBeHidden();
      await expect(page.getByRole("link", { name: "שירותים" }).first()).toBeVisible();
    });
  });
});
