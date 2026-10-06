import { expect, gotoApp, test, test_step } from "../fixtures/app";

/** The personal area is behind a sign-in, like the admin pages. */
test.describe("Personal area", () => {
  test("bounces an anonymous visitor to login, and back afterwards", async ({ page }) => {
    await test_step("open /account without a session", async () => {
      await gotoApp(page, "/account");
    });
    await test_step("the visitor is sent to the login screen", async () => {
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
