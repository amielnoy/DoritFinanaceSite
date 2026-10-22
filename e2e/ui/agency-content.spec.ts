import type { Page, TestInfo } from "@playwright/test";
import {
  AGAINST_A_DEPLOYMENT,
  STUBS_UNREACHABLE,
  expect,
  gotoApp,
  test,
  test_step,
  waitForAppLive,
} from "../fixtures/app";
import { agency1ContentRows } from "../fixtures/agency1-seed";

/**
 * The visual gate of agency content (R9). The e2e build has VITE_AGENCY_CONTENT
 * on (e2e/build-env.ts), so one run can render a page two ways: from agency 1's
 * rows as the seed migration writes them (A), and with `public_agency_sites`
 * refused, which falls back to the bundled constants (B) — the same object the
 * flag-off build renders. Moving Dorit's site onto the database is safe only if
 * the two are the same page, to the pixel and to the byte of `body`.
 */

interface Capture {
  png: Buffer;
  html: string;
}

async function capture(page: Page): Promise<Capture> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  return {
    png: await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" }),
    html: await page.locator("body").innerHTML(),
  };
}

/** Attached before the assertions, so a failing run carries both renders. */
async function attach(testInfo: TestInfo, a: Capture, b: Capture): Promise<void> {
  await testInfo.attach("A — seeded database", { body: a.png, contentType: "image/png" });
  await testInfo.attach("B — refused, bundled", { body: b.png, contentType: "image/png" });
}

function expectSame(a: Capture, b: Capture): void {
  expect(b.html).toBe(a.html);
  expect(Buffer.compare(a.png, b.png), "the database render differs from the bundled one").toBe(0);
}

test.describe("Agency content — the database render is the bundled render (R9)", () => {
  test.skip(AGAINST_A_DEPLOYMENT, STUBS_UNREACHABLE);

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  const routes = [
    { id: "E2E-AGC-001", route: "/" },
    { id: "E2E-AGC-002", route: "/perspective" },
    { id: "E2E-AGC-003", route: "/privacy" },
  ];

  for (const { id, route } of routes) {
    test(`${route} from the seeded rows matches the bundled fallback (${id})`, async ({ page, mockApi }, testInfo) => {
      const a = await test_step("render from agency 1's seeded rows", async () => {
        await gotoApp(page, route);
        await mockApi.waitForRequest("/rest/v1/public_agent_cards");
        return capture(page);
      });

      const b = await test_step("refuse the site read and render again", async () => {
        mockApi.failOn("/rest/v1/public_agency_sites", 503);
        await page.reload();
        await waitForAppLive(page);
        return capture(page);
      });

      await attach(testInfo, a, b);

      await test_step("the data path ran, and both renders are the same page", async () => {
        expect(mockApi.requestsTo("/rest/v1/public_agent_cards").length).toBeGreaterThanOrEqual(1);
        expectSame(a, b);
      });
    });
  }

  // A static file (R4): it never reads the database, and R9 names it.
  test("/poa.html is the same page whatever the database answers (E2E-AGC-004)", async ({ page, mockApi }, testInfo) => {
    const a = await test_step("open the static page", async () => {
      await page.goto("/poa.html");
      return capture(page);
    });

    const b = await test_step("refuse the site read and open it again", async () => {
      mockApi.failOn("/rest/v1/public_agency_sites", 503);
      await page.reload();
      return capture(page);
    });

    await attach(testInfo, a, b);

    await test_step("both renders are the same page", async () => {
      expectSame(a, b);
    });
  });

  // Without this the gate could pass on a page that never shows a database value.
  test("a value changed in the database reaches the page (E2E-AGC-005)", async ({ page, mockApi }) => {
    await test_step("give agency 1's site another phone number", async () => {
      const [site] = agency1ContentRows().get("public_agency_sites") ?? [];
      expect(site, "the seed has no public_agency_sites row").toBeTruthy();
      mockApi.setTable("public_agency_sites", [{ ...site, phone_display: "050-000-0000" }]);
    });

    await test_step("open the home page", async () => {
      await gotoApp(page, "/");
    });

    await test_step("the footer shows the database's number", async () => {
      await expect(page.locator("footer").getByText("050-000-0000")).toBeVisible();
    });
  });
});
