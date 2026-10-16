import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The clearinghouse pipeline in the build CI makes — dark, as it ships.
 * The enabled flow is covered in-process (tests/component, tests/integration);
 * PR B's e2e works one request end to end once the switch can be on in a test build.
 */
test.describe("Clearinghouse — dark by default", () => {
  test("the client page says the service is unavailable, offers no form, and is not indexed", async ({ page }) => {
    const functionCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/functions/v1/")) functionCalls.push(r.url());
    });
    await test_step("open a client's link", async () => {
      await gotoApp(page, `/masleka#t=${"Ab3_-".repeat(8)}xyz`);
    });
    await test_step("the page is the unavailable notice, and nothing else", async () => {
      await expect(page.getByRole("heading", { name: "השירות אינו זמין כרגע" })).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    });
    await test_step("the token is gone from the address bar", async () => {
      await expect(page).toHaveURL(/\/masleka$/);
    });
    await test_step("the page is noindex and called no function", async () => {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      expect(functionCalls).toEqual([]);
    });
  });

  test("the staff board does not exist in a dark build", async ({ page }) => {
    await gotoApp(page, "/admin/masleka");
    await expect(page.getByTestId("not-found")).toBeVisible();
  });
});
