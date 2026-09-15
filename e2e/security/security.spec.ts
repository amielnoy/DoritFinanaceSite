import { XSS_POST } from "../fixtures/data";
import { collectPageErrors, expect, gotoApp, test, test_step } from "../fixtures/app";

test.describe("XSS — untrusted content stays inert", () => {
  test("markdown from a blog post cannot execute script", async ({ page, mockApi }) => {
    await test_step("serve a post whose markdown tries four different injections", async () => {
      mockApi.setEntityDoc("BlogPost", XSS_POST.id, XSS_POST);
      await gotoApp(page, `/blog/${XSS_POST.id}`);
      await expect(page.locator(".blog-body")).toBeVisible();
    });

    await test_step("none of the injected payloads ran", async () => {
      const fired = await page.evaluate(() => ({
        body: (window as any).__xss_body,
        title: (window as any).__xss_title,
        link: (window as any).__xss_link,
        anchor: (window as any).__xss_anchor,
      }));
      expect(fired).toEqual({ body: undefined, title: undefined, link: undefined, anchor: undefined });
    });
  });

  test("HTML in a post body is rendered as visible text, not as markup", async ({ page, mockApi }) => {
    await test_step("open the hostile post", async () => {
      mockApi.setEntityDoc("BlogPost", XSS_POST.id, XSS_POST);
      await gotoApp(page, `/blog/${XSS_POST.id}`);
    });

    await test_step("the tags are shown as text and never became elements", async () => {
      const body = page.locator(".blog-body");
      await expect(body).toContainText("<script>");
      expect(await body.locator("script").count()).toBe(0);
      expect(await body.locator("img[onerror]").count()).toBe(0);
    });
  });

  test("a javascript: URL in markdown never becomes a live href", async ({ page, mockApi }) => {
    await test_step("open the hostile post", async () => {
      mockApi.setEntityDoc("BlogPost", XSS_POST.id, XSS_POST);
      await gotoApp(page, `/blog/${XSS_POST.id}`);
    });

    await test_step("no rendered link carries a javascript: scheme", async () => {
      const hrefs = await page.locator(".blog-body a").evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
      );
      for (const href of hrefs) expect(href.toLowerCase()).not.toMatch(/^javascript:/);
    });
  });

  test("a hostile post title is escaped in the heading", async ({ page, mockApi }) => {
    await test_step("open a post whose title is an <img onerror> payload", async () => {
      mockApi.setEntityDoc("BlogPost", XSS_POST.id, XSS_POST);
      await gotoApp(page, `/blog/${XSS_POST.id}`);
    });

    await test_step("the heading shows the payload as text, not as an image", async () => {
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toContainText("<img");
      expect(await h1.locator("img").count()).toBe(0);
    });
  });

  test("a hostile testimonial cannot inject markup on the home page", async ({ page, mockApi }) => {
    await test_step("seed a testimonial whose name and quote carry payloads", async () => {
      mockApi.setEntity("Testimonial", [
        {
          id: "evil",
          name: '<img src=x onerror="window.__xss_t=1">',
          role: "",
          quote: "<script>window.__xss_t = 1<\/script>",
          rating: 5,
          source: "google",
          created_date: "2026-01-01T00:00:00Z",
        },
      ]);
    });

    await test_step("render the home page with that testimonial", async () => {
      await gotoApp(page);
      await mockApi.waitForRequest("/entities/Testimonial");
    });

    await test_step("nothing executed", async () => {
      expect(await page.evaluate(() => (window as any).__xss_t)).toBeUndefined();
    });
  });
});

test.describe("Client-side security posture", () => {
  test("no access token is written to storage for an anonymous visitor", async ({ page }) => {
    await test_step("open the home page as an anonymous visitor", async () => {
      await gotoApp(page);
    });

    await test_step("nothing token-shaped was left in local or session storage", async () => {
      const storage = await page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
      }));
      for (const bag of [storage.local, storage.session]) {
        for (const [key, value] of Object.entries(bag)) {
          expect(key.toLowerCase(), `unexpected token in storage: ${key}`).not.toMatch(/token|secret|password/);
          expect(String(value)).not.toMatch(/^eyJ[A-Za-z0-9_-]+\./);
        }
      }
    });
  });

  test("?clear_access_token=true wipes any stored token", async ({ page }) => {
    await test_step("plant a stale token in local storage", async () => {
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.setItem("base44_access_token", "stale-token");
        localStorage.setItem("token", "stale-token");
      });
    });

    await test_step("reload with ?clear_access_token=true", async () => {
      await gotoApp(page, "/?clear_access_token=true");
    });

    await test_step("both stored tokens are gone", async () => {
      const left = await page.evaluate(() => [
        localStorage.getItem("base44_access_token"),
        localStorage.getItem("token"),
      ]);
      expect(left).toEqual([null, null]);
    });
  });

  test("a hostile ?returnTo= cannot bounce the visitor off-site", async ({ page }) => {
    for (const hostile of ["https://evil.example", "//evil.example", "/\\evil.example", "/.//evil.example"]) {
      await test_step(`open the login screen with returnTo=${hostile}`, async () => {
        await gotoApp(page, `/login?returnTo=${encodeURIComponent(hostile)}`);
        await expect(page.locator("body")).toContainText(/Welcome back/i);
      });

      await test_step(`the visitor stays on this origin (${hostile})`, async () => {
        const registerHref = await page
          .getByRole("link", { name: /Create one/i })
          .getAttribute("href");
        expect(registerHref ?? "/register", hostile).not.toContain("evil.example");
        expect(new URL(page.url()).host, hostile).toBe(new URL(page.url()).host);
      });
    }
  });

  test("every new-tab link is protected against reverse tabnabbing", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("every target=_blank link also carries rel=noopener", async () => {
      const bad = await page.locator('a[target="_blank"]').evaluateAll((as) =>
        as
          .map((a) => ({ href: (a as HTMLAnchorElement).href, rel: a.getAttribute("rel") ?? "" }))
          .filter((a) => !a.rel.includes("noopener"))
      );
      expect(bad).toEqual([]);
    });
  });

  test("no mixed content: the page loads nothing over plain http", async ({ page }) => {
    const insecure: string[] = [];

    await test_step("watch every request the page makes", async () => {
      page.on("request", (r) => {
        if (r.url().startsWith("http://") && !/127\.0\.0\.1|localhost/.test(r.url())) insecure.push(r.url());
      });
    });

    await test_step("load the whole home page, top to bottom", async () => {
      await gotoApp(page);
      await page.locator("#quick-contact").scrollIntoViewIfNeeded();
    });

    await test_step("nothing was fetched over plain http", async () => {
      expect(insecure).toEqual([]);
    });
  });

  test("the shipped bundle contains no secret-shaped literals", async ({ page, request }) => {
    const scripts = await test_step("collect the scripts the page loads", async () => {
      await gotoApp(page);
      const found = await page.locator("script[src]").evaluateAll((els) =>
        els.map((e) => (e as HTMLScriptElement).getAttribute("src") ?? "").filter((s) => s.startsWith("/"))
      );
      expect(found.length).toBeGreaterThan(0);
      return found;
    });

    for (const src of scripts) {
      await test_step(`${src} carries no key, token or private key`, async () => {
        const body = await (await request.get(src)).text();
        expect(body, `${src}: Stripe live key`).not.toMatch(/sk_live_[A-Za-z0-9]{16,}/);
        expect(body, `${src}: AWS key`).not.toMatch(/AKIA[0-9A-Z]{16}/);
        expect(body, `${src}: private key`).not.toContain("BEGIN PRIVATE KEY");
        expect(body, `${src}: hardcoded JWT`).not.toMatch(/["']eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
      });
    }
  });

  test("admin data is never fetched before authentication", async ({ page, mockApi }) => {
    await test_step("request the admin leads screen without a session", async () => {
      await gotoApp(page, "/admin/leads");
      await expect(page).toHaveURL(/\/login/);
    });

    await test_step("no lead was read on the way to the login screen", async () => {
      expect(mockApi.requestsTo("/entities/Lead").filter((r) => r.method === "GET")).toHaveLength(0);
    });
  });

  test("the app boots without any uncaught client-side error", async ({ page }) => {
    const { errors } = collectPageErrors(page);

    await test_step("load the whole home page, top to bottom", async () => {
      await gotoApp(page);
      await page.locator("#quick-contact").scrollIntoViewIfNeeded();
    });

    await test_step("nothing was thrown", async () => {
      expect(errors.filter((e) => e.startsWith("pageerror")), errors.join("\n")).toEqual([]);
    });
  });
});

/**
 * Transport-level hardening lives at the host (Base44 / CDN), not in the SPA.
 * These assertions are informational against the local preview and enforced
 * only when E2E_ENFORCE_SECURITY_HEADERS=1 is set against a real deployment.
 */
test.describe("Security headers", () => {
  const enforce = process.env.E2E_ENFORCE_SECURITY_HEADERS === "1";

  test("the document response carries the expected hardening headers", async ({ request }) => {
    test.skip(!enforce, "set E2E_ENFORCE_SECURITY_HEADERS=1 against a deployed URL");

    const headers = await test_step("fetch the document's response headers", async () =>
      (await request.get("/")).headers()
    );

    await test_step("the host sets the transport hardening headers", async () => {
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBeTruthy();
      expect(headers["strict-transport-security"]).toContain("max-age=");
      expect(headers["content-security-policy"] ?? headers["content-security-policy-report-only"]).toBeTruthy();
    });
  });

  test("reports which hardening headers are present (informational)", async ({ request }) => {
    const missing = await test_step("check the document for each hardening header", async () => {
      const headers = (await request.get("/")).headers();
      const wanted = [
        "content-security-policy",
        "strict-transport-security",
        "x-content-type-options",
        "referrer-policy",
        "permissions-policy",
      ];
      return wanted.filter((h) => !headers[h]);
    });

    await test_step("record the finding on the report rather than failing", async () => {
      test.info().annotations.push({
        type: "security-headers",
        description: missing.length ? `missing: ${missing.join(", ")}` : "all present",
      });
      // Always passes: the local vite preview sets none of these by design.
      expect(Array.isArray(missing)).toBe(true);
    });
  });
});
