import { BLOG_POSTS } from "../fixtures/data";
import { collectPageErrors, expect, gotoApp, test, test_step } from "../fixtures/app";

test.describe("Blog — sanity", () => {
  test("lists only published posts", async ({ page, mockApi }) => {
    await test_step("seed the backend with one published post and one draft", async () => {
      mockApi.setEntity("BlogPost", [
        ...BLOG_POSTS,
        { ...BLOG_POSTS[0], id: "draft", title: "טיוטה שלא פורסמה", published: false },
      ]);
    });

    await test_step("open the blog list and let it load the posts", async () => {
      await gotoApp(page, "/blog");
      await mockApi.waitForRequest("/entities/BlogPost");
    });

    await test_step("the published post is listed and the draft is not", async () => {
      await expect(page.getByText(BLOG_POSTS[0].title)).toBeVisible();
      await expect(page.getByText("טיוטה שלא פורסמה")).toHaveCount(0);
    });
  });

  test("filters server-side on the published flag", async ({ page, mockApi }) => {
    const req = await test_step("open the blog list and capture its query", async () => {
      await gotoApp(page, "/blog");
      return mockApi.waitForRequest("/entities/BlogPost");
    });

    await test_step("the published filter is sent to the backend, not applied in the browser", async () => {
      const q = new URL(req.url).searchParams.get("q");
      expect(q, "the list must be filtered by the backend, not in the browser").not.toBeNull();
      expect(JSON.parse(q!)).toEqual({ published: true });
    });
  });

  test("opens a post and renders its markdown body", async ({ page }) => {
    await test_step(`open the post "${BLOG_POSTS[0].title}"`, async () => {
      await gotoApp(page, `/blog/${BLOG_POSTS[0].id}`);
    });

    await test_step("the post title is the page heading", async () => {
      await expect(page.getByRole("heading", { name: BLOG_POSTS[0].title })).toBeVisible();
    });

    await test_step("the markdown body is rendered as headings and lists", async () => {
      await expect(page.getByRole("heading", { name: "מה חשוב לבדוק" })).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: "דמי ניהול מהפקדה" })).toBeVisible();
    });
  });

  test("shows a friendly not-found for a missing post", async ({ page }) => {
    const { errors } = collectPageErrors(page);

    await test_step("open a post id that does not exist", async () => {
      await gotoApp(page, "/blog/does-not-exist");
    });

    await test_step("the reader gets an explanation and a way back", async () => {
      await expect(page.getByText("המאמר לא נמצא")).toBeVisible();
      await expect(page.getByRole("link", { name: /חזרה לבלוג/ })).toBeVisible();
    });

    await test_step("the missing post raised no client-side error", async () => {
      expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
    });
  });

  test("share buttons point at real share endpoints", async ({ page }) => {
    await test_step("open a published post", async () => {
      await gotoApp(page, `/blog/${BLOG_POSTS[0].id}`);
      await expect(page.getByRole("heading", { name: BLOG_POSTS[0].title })).toBeVisible();
    });

    await test_step("the post offers at least one working share link", async () => {
      const shareLinks = page.locator('a[href*="wa.me"], a[href*="facebook.com"], a[href*="linkedin.com"], a[href*="twitter.com"], a[href*="x.com"]');
      expect(await shareLinks.count()).toBeGreaterThan(0);
    });
  });

  test("degrades gracefully when the blog backend errors", async ({ page, mockApi }) => {
    const { errors } = collectPageErrors(page);

    await test_step("make the blog endpoint fail with a 500", async () => {
      mockApi.failOn("/entities/BlogPost", 500, { error: "boom" });
    });

    await test_step("open the blog list against the broken backend", async () => {
      await gotoApp(page, "/blog");
    });

    await test_step("the page still renders and throws nothing", async () => {
      await expect(page.locator("#root")).not.toBeEmpty();
      expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
    });
  });
});
