import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { E2E_SUPABASE_URL } from "../build-env";
import { AGAINST_A_DEPLOYMENT, STUBS_UNREACHABLE, expect, gotoApp, openQuickContact, test, test_step } from "../fixtures/app";

/**
 * Runtime contract: what the browser actually puts on the wire, checked
 * against what the backend accepts. The static contract tests under
 * tests/contract read the source; these observe the real requests.
 *
 * The backend is Supabase: PostgREST reads, and the Edge Functions in
 * supabase/functions. What a function accepts is read from its own source, so
 * a field added on one side and not the other fails here.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** The fields submit-lead reads off the request body — its own destructuring. */
function submitLeadFields(): string[] {
  const handler = read("supabase/functions/submit-lead/handler.ts");
  const destructured = /const \{([^}]+)\} = body \|\| \{\};/.exec(handler)?.[1];
  if (!destructured) throw new Error("submit-lead/handler.ts no longer destructures its body as `const { … } = body || {}`");
  return destructured.split(",").map((f) => f.trim()).filter(Boolean);
}

/** The values `leads.source` may hold — its CHECK in the initial schema. */
function leadSources(): string[] {
  const schema = read("supabase/migrations/20260921000000_initial_schema.sql");
  const check = /^\s*source\s+text check \(source in \(([^)]+)\)\),$/m.exec(schema.slice(schema.indexOf("create table public.leads")))?.[1];
  if (!check) throw new Error("the leads.source CHECK was not found in the initial schema");
  return check.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

/** Every request the page starts, from any origin, for the lifetime of the test. */
function recordAll(page: Page): URL[] {
  const seen: URL[] = [];
  page.on("request", (r) => seen.push(new URL(r.url())));
  return seen;
}

async function submitQuickContact(page: Page, details: { name: string; phone: string; email?: string }) {
  const form = page.locator("#quick-contact");
  await gotoApp(page);
  await openQuickContact(page);
  await form.locator("#qc-name").fill(details.name);
  await form.locator("#qc-phone").fill(details.phone);
  if (details.email) await form.locator("#qc-email").fill(details.email);
  await form.getByRole("button", { name: "שליחת הודעה" }).click();
  await expect(form.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
}

test.describe("Backend contract (observed traffic)", () => {
  test("lists testimonials with a bounded, sorted query", async ({ page, mockApi }) => {
    test.skip(AGAINST_A_DEPLOYMENT, STUBS_UNREACHABLE);
    const req = await test_step("open the home page and capture the testimonials read", async () => {
      await gotoApp(page);
      return mockApi.waitForRequest("/rest/v1/testimonials");
    });

    await test_step("the query is sorted newest-first and bounded to a sane page size", async () => {
      const params = new URL(req.url).searchParams;
      expect(req.method).toBe("GET");
      expect(params.get("order")).toBe("created_at.desc");
      expect(Number(params.get("limit"))).toBeGreaterThan(0);
      expect(Number(params.get("limit"))).toBeLessThanOrEqual(100);
    });

    await test_step("it asks for the site's agency, and only for columns anon may read", async () => {
      const params = new URL(req.url).searchParams;
      // VITE_AGENCY_CONTENT is on in the e2e build (e2e/build-env.ts); on localhost the site is agency 1's.
      expect(params.get("agency_id")).toBe("eq.00000000-0000-0000-0000-000000000001");
      // R6: anon is granted the public columns only, so naming a consent column would fail the whole read.
      expect(params.get("select")).toBeTruthy();
      expect(params.get("select")).not.toContain("consent_confirmed");
    });

    await test_step("it is the anonymous read: the publishable key, as apikey and as the bearer", async () => {
      const key = req.headers["apikey"];
      expect(key, "no apikey header").toBeTruthy();
      expect(req.headers["authorization"]).toBe(`Bearer ${key}`);
    });
  });

  test("POSTs a lead that submit-lead accepts", async ({ page, mockApi }) => {
    await test_step("submit the quick contact form", async () => {
      await submitQuickContact(page, { name: "ישראלה ישראלי", phone: "050-1234567" });
    });

    const req = await test_step("capture the lead the app sent", () => mockApi.waitForRequest("/functions/v1/submit-lead"));

    await test_step("it is a JSON POST", async () => {
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toContain("application/json");
    });

    await test_step("its body is within what submit-lead reads, and its source is one leads.source allows", async () => {
      // The browser posts a *function request*, not a row: `notes` and
      // `scheduledAt` are fields the function consumes without storing. So the
      // check is against what the function reads off the body; the row it
      // writes is asserted in tests/integration.
      const accepted = submitLeadFields();
      const body = req.body as Record<string, unknown>;
      const undeclared = Object.keys(body).filter((k) => !accepted.includes(k));
      expect(undeclared, `not read by submit-lead: ${undeclared.join(", ")}`).toEqual([]);
      expect(body.source, "source must be a value the leads table allows").toBeTruthy();
      expect(leadSources()).toContain(body.source);
    });
  });

  // The consultation wizard that drove `createConsultationEvent` from the
  // browser is gone — it was one of five ways the home page asked for the same
  // name and phone number. Ids are not reused (API-CTR-004).

  test("every request stays on the site, its Supabase host and the allowed third parties", async ({ page, mockApi }) => {
    // Against a deployment the hosts are production's configuration, not this build's.
    test.skip(AGAINST_A_DEPLOYMENT, STUBS_UNREACHABLE);
    const seen = recordAll(page);

    await test_step("exercise the app until it has talked to the backend", async () => {
      await submitQuickContact(page, { name: "ישראלה", phone: "050-1234567" });
      await mockApi.waitForRequest("/functions/v1/submit-lead");
    });

    await test_step("no request went anywhere else", async () => {
      const site = new URL(page.url()).origin;
      const allowed = new Set([site, new URL(E2E_SUPABASE_URL).origin]);
      // Requested, and aborted by the fixture.
      const thirdParty = /(^|\.)(googletagmanager|google-analytics)\.com$/;
      const elsewhere = seen
        .filter((u) => u.protocol !== "data:" && u.protocol !== "blob:")
        .filter((u) => !allowed.has(u.origin) && !thirdParty.test(u.hostname))
        .map((u) => u.href);
      expect(elsewhere).toEqual([]);
    });

    await test_step("and nothing went to an /api route the site does not serve", async () => {
      // The fixture fails any such request at teardown too; this names it here.
      const unknownApi = seen.filter(
        (u) =>
          u.pathname.startsWith("/api/") &&
          !/^\/api\/(og\/|csp-report)/.test(u.pathname),
      );
      expect(unknownApi.map((u) => u.href)).toEqual([]);
    });
  });

  test("never puts personal data or tokens in a query string", async ({ page, mockApi }) => {
    const seen = recordAll(page);

    await test_step("submit a lead carrying a phone number and an email address", async () => {
      await submitQuickContact(page, { name: "ישראלה ישראלי", phone: "0501234567", email: "secret@example.com" });
      await mockApi.waitForRequest("/functions/v1/submit-lead");
    });

    await test_step("no query string, to any host, leaked the details or a credential", async () => {
      expect(seen.length, "no request was observed at all").toBeGreaterThan(0);
      for (const url of seen) {
        expect(url.search, url.href).not.toContain("0501234567");
        expect(url.search, url.href).not.toContain("secret@example.com");
        expect(url.search.toLowerCase(), url.href).not.toMatch(/access_token|password|api_?key|apikey/);
      }
    });
  });

  test("an anonymous visitor never triggers an authenticated user fetch", async ({ page, mockApi }) => {
    test.skip(AGAINST_A_DEPLOYMENT, STUBS_UNREACHABLE);
    await test_step("open the home page as an anonymous visitor", async () => {
      await gotoApp(page);
      await mockApi.waitForRequest("/rest/v1/testimonials");
    });

    await test_step("the app never asked who the user is", async () => {
      // No session in storage → no `auth.getUser()` and no read of `profiles`.
      expect(mockApi.requestsTo("/auth/v1/")).toHaveLength(0);
      expect(mockApi.requestsTo("/rest/v1/profiles")).toHaveLength(0);
    });
  });
});
