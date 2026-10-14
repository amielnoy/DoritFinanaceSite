import type { Page } from "@playwright/test";
import { expect, gotoApp, test, test_step, waitForLive } from "../fixtures/app";

/**
 * The support chat has to be findable from where a visitor already is.
 *
 * It lives at the bottom of /faq, and the only ways there were two footer
 * links. Dorit could not find it herself, on a phone or on a desktop. These
 * cases pin the two ways in that are now on screen without scrolling: the
 * header menu, and a support button beside the other ways to reach her — the
 * round dock on a desktop, and on a phone the menu's own "תמיכה" item, since
 * the sticky bar became לשיחה קצרה, WhatsApp and a call (stage 3).
 */

const SUPPORT = "#support-chat";

/** The phone's drawer — the last <nav> once the burger is open. */
const drawer = (page: Page) => page.getByRole("navigation").last();

test.describe("Support chat — reachable from the header and a button", () => {
  test("the header menu lists שאלות ותשובות and it opens the page", async ({ page, isMobile }) => {
    await test_step("open the blog, a page with no link to it in view", async () => {
      await gotoApp(page, "/blog");
    });

    const nav = isMobile
      ? page.getByRole("navigation").last()
      : page.locator("header").getByRole("navigation");

    await test_step("open the menu where the platform keeps it", async () => {
      // The desktop bar is `hidden md:flex`; on a phone the same items live in
      // the drawer behind the burger.
      if (isMobile) await page.getByRole("button", { name: "תפריט" }).click();
    });

    await test_step("the item is there and goes to /faq", async () => {
      await nav.getByRole("link", { name: "שאלות ותשובות", exact: true }).click();
      await expect(page).toHaveURL(/\/faq$/);
    });
  });

  test("the support button lands on the chat, not the top of the page", async ({
    page,
    isMobile,
  }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page, "/");
    });

    await test_step("press the support button where the platform shows it", async () => {
      // Desktop: the round dock beside WhatsApp and the phone. Phone: the
      // menu, where שאלות ותשובות already is, one tap from any screen.
      if (isMobile) {
        // A tap on the prerendered burger reaches no handler; wait for React's.
        await waitForLive(page, "header");
        await page.getByRole("button", { name: "תפריט" }).click();
      }
      const button = isMobile
        ? drawer(page).getByRole("link", { name: /תמיכה/ })
        : page.getByRole("link", { name: /^תמיכה/ });
      await expect(button).toBeVisible();
      await button.click();
    });

    await test_step("the chat itself is on screen", async () => {
      // /faq is lazy-loaded. A scroll scheduled before its chunk arrives finds
      // no section and leaves the visitor at the top, a page of answers away
      // from the question box — which is the failure this button exists to fix.
      await expect(page).toHaveURL(/\/faq#support-chat$/);
      await expect(page.locator(SUPPORT).getByRole("heading").first()).toBeInViewport();
    });
  });

  test("pressed again on /faq, it still brings the chat back into view", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the phone's support item is in the menu, which closes as it navigates — the desktop dock is what stays on screen");

    await test_step("open /faq and stay at the top", async () => {
      await gotoApp(page, "/faq");
      await expect(page.locator(SUPPORT)).not.toBeInViewport();
    });

    await test_step("the button scrolls down to the chat", async () => {
      await page.getByRole("link", { name: /^תמיכה/ }).click();
      await expect(page.locator(SUPPORT).getByRole("heading").first()).toBeInViewport();
    });

    await test_step("scrolled away and pressed again, it scrolls back", async () => {
      // Same URL, so the router sees nothing change. The button has to do the
      // scrolling itself, or the second press is inert.
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator(SUPPORT)).not.toBeInViewport();
      await page.getByRole("link", { name: /^תמיכה/ }).click();
      await expect(page.locator(SUPPORT).getByRole("heading").first()).toBeInViewport();
    });
  });
});
