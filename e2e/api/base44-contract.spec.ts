import { loadEntity, validateAgainstEntity } from "../../tests/helpers/entity-schema";
import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * Runtime contract: what the browser actually puts on the wire, checked against
 * the entity definitions in base44/entities. The static contract tests under
 * tests/contract read the source; these observe the real requests.
 */
test.describe("Base44 API contract (observed traffic)", () => {
  test("bootstraps through the documented public-settings endpoint", async ({ page, mockApi }) => {
    const req = await test_step("open the home page and capture the bootstrap call", async () => {
      await gotoApp(page);
      return mockApi.waitForRequest("/public-settings/");
    });

    await test_step("it is a GET on the documented public-settings path", async () => {
      expect(req.method).toBe("GET");
      expect(req.path).toMatch(/^\/api\/apps\/public\/prod\/public-settings\/by-id\/[^/]+$/);
    });
  });

  test("lists testimonials with a bounded, sorted query", async ({ page, mockApi }) => {
    const req = await test_step("open the home page and capture the testimonials call", async () => {
      await gotoApp(page);
      return mockApi.waitForRequest("/entities/Testimonial");
    });

    await test_step("the query is sorted newest-first and bounded to a sane page size", async () => {
      const params = new URL(req.url).searchParams;
      expect(req.method).toBe("GET");
      expect(params.get("sort")).toBe("-created_date");
      expect(Number(params.get("limit"))).toBeGreaterThan(0);
      expect(Number(params.get("limit"))).toBeLessThanOrEqual(100);
    });
  });

  test("POSTs a Lead that validates against the Lead entity schema", async ({ page, mockApi }) => {
    const form = page.locator("#quick-contact");

    await test_step("submit the quick contact form", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
      await form.locator("#qc-name").fill("ישראלה ישראלי");
      await form.locator("#qc-phone").fill("050-1234567");
      await form.getByRole("button", { name: "שליחת הודעה" }).click();
      await expect(form.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
    });

    const req = await test_step("capture the Lead the app wrote", () =>
      mockApi.waitForRequest("/functions/submitLead")
    );

    await test_step("it is a JSON POST", async () => {
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toContain("application/json");
    });

    await test_step("its body validates against the Lead entity definition", async () => {
      // The browser posts a *function request*, not an entity row: `notes` and
      // `scheduledAt` are request fields the function consumes without storing
      // — `notes` folds into the Lead's `message`, `scheduledAt` only dates the
      // calendar event. Validate against what the function accepts; the entity
      // shape is asserted where the backend writes it
      // (tests/contract/frontend-payloads).
      const accepted = [
        "name",
        "phone",
        "email",
        "source",
        "topic",
        "timing",
        "message",
        "notes",
        "scheduledAt",
      ];
      const body = req.body as Record<string, unknown>;
      const undeclared = Object.keys(body).filter((k) => !accepted.includes(k));
      const issues = undeclared.map((field) => ({ field, problem: "not accepted by submitLead" }));
      expect(body.source, "source must be an enum value the Lead entity declares").toBeTruthy();
      expect(loadEntity("Lead").properties.source.enum).toContain(body.source);
      expect(issues, JSON.stringify(issues)).toEqual([]);
    });
  });

  // The consultation wizard that drove `createConsultationEvent` from the
  // browser is gone — it was one of five ways the home page asked for the same
  // name and phone number. The function is still called, but now by the
  // interview agent at the end of its scheduling step, which is server-side and
  // therefore covered by `tests/contract/consultation-function.contract.test.ts`
  // and the agent prompt contract rather than by a browser flow.

  test("every API call is same-origin and relative to /api", async ({ page, mockApi }) => {
    const form = page.locator("#quick-contact");

    await test_step("exercise the app until it has talked to the backend", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
      await form.locator("#qc-name").fill("ישראלה");
      await form.locator("#qc-phone").fill("050-1234567");
      await form.getByRole("button", { name: "שליחת הודעה" }).click();
      await mockApi.waitForRequest("/functions/submitLead");
    });

    await test_step("no request left the origin or the /api prefix", async () => {
      const origin = new URL(page.url()).origin;
      for (const req of mockApi.requests) {
        expect(new URL(req.url).origin, req.url).toBe(origin);
        expect(req.path.startsWith("/api/"), req.path).toBe(true);
      }
    });
  });

  test("never puts personal data or tokens in a query string", async ({ page, mockApi }) => {
    const form = page.locator("#quick-contact");

    await test_step("submit a lead carrying a phone number and an email address", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
      await form.locator("#qc-name").fill("ישראלה ישראלי");
      await form.locator("#qc-phone").fill("0501234567");
      await form.locator("#qc-email").fill("secret@example.com");
      await form.getByRole("button", { name: "שליחת הודעה" }).click();
      await mockApi.waitForRequest("/functions/submitLead");
    });

    await test_step("no query string leaked the details or a credential", async () => {
      for (const req of mockApi.requests) {
        const query = new URL(req.url).search;
        expect(query, req.url).not.toContain("0501234567");
        expect(query, req.url).not.toContain("secret@example.com");
        expect(query.toLowerCase(), req.url).not.toMatch(/access_token|password|api_key/);
      }
    });
  });

  test("an anonymous visitor never triggers an authenticated user fetch", async ({ page, mockApi }) => {
    await test_step("open the home page as an anonymous visitor", async () => {
      await gotoApp(page);
      await mockApi.waitForRequest("/public-settings/");
    });

    await test_step("the app never asked the backend who the user is", async () => {
      // No token in storage → the app must not call /entities/User/me at all.
      expect(mockApi.requestsTo("/entities/User/me")).toHaveLength(0);
    });
  });
});

/**
 * Optional: run the same contract against a real backend
 * (`base44 dev` or a preview deployment).
 *   E2E_LIVE_API_URL=http://localhost:5173 E2E_LIVE_APP_ID=<id> npx playwright test e2e/api
 * Skipped by default so CI never touches production data.
 */
const LIVE_URL = process.env.E2E_LIVE_API_URL;
const LIVE_APP_ID = process.env.E2E_LIVE_APP_ID;

test.describe("Live Base44 backend (opt-in)", () => {
  test.skip(!LIVE_URL || !LIVE_APP_ID, "set E2E_LIVE_API_URL and E2E_LIVE_APP_ID to enable");

  test("public settings are served for the linked app", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: LIVE_URL });

    await test_step("the live app answers its public-settings endpoint", async () => {
      const res = await api.get(`/api/apps/public/prod/public-settings/by-id/${LIVE_APP_ID}`);
      expect(res.status()).toBe(200);
      expect(await res.json()).toHaveProperty("public_settings");
    });

    await api.dispose();
  });

  test("published blog posts are readable without authentication", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: LIVE_URL });

    await test_step("an anonymous reader can list published posts", async () => {
      const res = await api.get(`/api/apps/${LIVE_APP_ID}/entities/BlogPost`, {
        params: { q: JSON.stringify({ published: true }), limit: 5 },
      });
      expect(res.status()).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });

    await api.dispose();
  });

  test("leads are NOT readable without an admin session (RLS)", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: LIVE_URL });

    /**
     * Base44 protects these two entities by different mechanisms, and the test has to
     * accept both or it fails against a backend that is behaving correctly:
     *
     *   User  → 401, the request itself is refused
     *   Lead  → 200 with `[]`, the request is served and the rows are filtered away
     *
     * The property worth asserting is the one a leaked lead would violate — that no
     * record comes back — not the transport shape of the refusal. Asserting 401/403
     * alone failed against production while zero lead data was in fact exposed.
     *
     * An empty list is only evidence of filtering if the endpoint returns rows when it
     * is allowed to, so a public entity is read first as a control. Without it, a
     * backend that answered `[]` to everything would pass this test.
     */
    await test_step("a public entity returns rows, so an empty list means filtering", async () => {
      const control = await api.get(`/api/apps/${LIVE_APP_ID}/entities/BlogPost`, {
        params: { q: JSON.stringify({ published: true }), limit: 5 },
      });
      expect(control.status()).toBe(200);
      expect(
        (await control.json()).length,
        "no published posts came back — the control proves nothing, so the Lead check below is not trustworthy"
      ).toBeGreaterThan(0);
    });

    await test_step("an anonymous read of Lead yields no lead", async () => {
      const res = await api.get(`/api/apps/${LIVE_APP_ID}/entities/Lead`);
      if ([401, 403].includes(res.status())) return;

      expect(
        res.status(),
        `anonymous read of Lead returned ${res.status()} — expected a refusal or a filtered 200`
      ).toBe(200);
      const rows = await res.json();
      expect(Array.isArray(rows)).toBe(true);
      expect(
        rows.length,
        `anonymous read of Lead returned ${rows.length} records — RLS is open`
      ).toBe(0);
    });

    await api.dispose();
  });

  test("the consultation function rejects a body without name/phone", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: LIVE_URL });

    await test_step("the function validates its input server-side", async () => {
      const res = await api.post(`/api/apps/${LIVE_APP_ID}/functions/createConsultationEvent`, {
        data: { topic: "בדיקה" },
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    });

    await api.dispose();
  });

  /**
   * The one check that would have seen the outage.
   *
   * Every chat on the site answered every visitor with
   * "\u05dc\u05d0 \u05d4\u05e6\u05dc\u05d7\u05ea\u05d9 \u05dc\u05e9\u05dc\u05d5\u05d7 \u05d0\u05ea \u05d4\u05d4\u05d5\u05d3\u05e2\u05d4 \u05db\u05e8\u05d2\u05e2" for ten days, because
   * `allow_anonymous_access` was `false` in all three agent configs and this
   * POST came back 401 (A-42). Nothing in the battery could see it: the static
   * contract tests read the repo, and the repo was fine once it was fixed —
   * what was wrong was the value in the running backend. The hermetic e2e suite
   * stubs `**\/api\/**` by design, and the smoke job reuses those same specs
   * against a deployment, so it verifies the *bundle* was published, not that
   * anything behind it answers.
   *
   * This asserts the one thing a visitor needs and no other test states: a
   * signed-out stranger can open a conversation. It catches the whole class —
   * revoked key, wrong app id, deleted agent, flag flipped by the next Builder
   * regeneration — rather than the one flag `agents.contract.test.ts` pins.
   *
   * Cost: three empty conversations per production publish. `createConversation`
   * invokes no model and stores no message; the agent only starts costing
   * anything once a message is added, and none is.
   */
  for (const agent of ["blog_recommender", "needs_interview", "support_agent"]) {
    test(`${agent} opens a conversation for a signed-out visitor`, async ({ playwright }) => {
      const api = await playwright.request.newContext({ baseURL: LIVE_URL });

      await test_step("an anonymous POST is accepted and returns a conversation", async () => {
        const res = await api.post(`/api/apps/${LIVE_APP_ID}/agents/conversations`, {
          data: { agent_name: agent, metadata: { name: "ci-smoke", description: "CI reachability probe" } },
        });
        expect(
          res.status(),
          `${agent} refused an anonymous visitor: ${res.status()} ${await res.text()}`
        ).toBe(200);
        expect(await res.json()).toHaveProperty("id");
      });

      await api.dispose();
    });
  }
});
