import { expect, test, test_step } from "../fixtures/app";

/**
 * Live Supabase, reached with the key the deployed bundle actually carries.
 *
 * Opt-in, like the "Live Base44 backend" block beside it, and on in the
 * production smoke job, which sets E2E_LIVE_API_URL to PRODUCTION_URL.
 *
 * On 2026-10-11 production shipped with another Supabase project's publishable
 * key. Every Supabase call — the blog, the testimonials, sign-in — answered 401
 * "Invalid API key", and the smoke job went green: it checked that the bundle
 * was served and that Base44 answered, and nothing asked Supabase anything.
 *
 * The URL and key are read from the scripts the site serves rather than from
 * CI's environment, because the bundle is what a visitor runs; a correct value
 * in CI next to a wrong one baked into the build is exactly the case to catch.
 * Only public reads are made — what any anonymous visitor's browser does.
 *
 * It also asks `submit-claim` an empty question, which proves the Edge Function
 * is deployed and allows the site's origin without storing anything.
 */
const LIVE_URL = process.env.E2E_LIVE_API_URL;

test.describe("Live Supabase, with the deployed bundle's key (opt-in)", () => {
  test.skip(!LIVE_URL, "set E2E_LIVE_API_URL to enable");

  test("the deployed key opens the project's public reads and its sign-in", async ({ playwright }) => {
    const site = await playwright.request.newContext({ baseURL: LIVE_URL });
    let url = "";
    let key = "";

    await test_step("the deployed bundle names a Supabase project and a publishable key", async () => {
      const html = await (await site.get("/")).text();
      const scripts = [...new Set([...html.matchAll(/\/assets\/[^"']+\.js/g)].map((m) => m[0]))];
      for (const path of scripts) {
        const js = await (await site.get(path)).text();
        url ||= js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] ?? "";
        key ||= js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? "";
      }
      expect(url, "no Supabase URL in the deployed bundle").not.toBe("");
      expect(key, "no sb_publishable_ key in the deployed bundle").not.toBe("");
    });

    const supabase = await playwright.request.newContext({ baseURL: url, extraHTTPHeaders: { apikey: key } });

    await test_step("the published blog and the testimonials are readable with it", async () => {
      for (const table of ["blog_posts", "testimonials"]) {
        const res = await supabase.get(`/rest/v1/${table}`, { params: { select: "base44_id", limit: "1" } });
        // The body carries Supabase's own reason ("Invalid API key", a grant
        // missing for anon) — the line the person reading a red job needs.
        expect(res.status(), `${table}: ${await res.text()}`).toBe(200);
      }
    });

    await test_step("sign-in's endpoint accepts it", async () => {
      const res = await supabase.get("/auth/v1/settings");
      expect(res.status(), await res.text()).toBe(200);
    });

    await test_step("the claim function is deployed and answers the site", async () => {
      // An empty claim: refused for want of a name and phone, so nothing is
      // stored and nobody is mailed — but only a deployed, reachable function
      // that allows this origin answers it this way.
      const origin = new URL(LIVE_URL!).origin;
      const res = await supabase.post("/functions/v1/submit-claim", {
        data: {},
        headers: { Origin: origin, Authorization: `Bearer ${key}` },
      });
      const body = (await res.json().catch(() => ({}))) as { rid?: string };
      expect(res.status(), `submit-claim: ${JSON.stringify(body)}`).toBe(400);
      expect(body.rid, "the answer carries no rid").toBeTruthy();
      expect(res.headers()["access-control-allow-origin"], "the site's origin is not allowed").toBe(origin);
    });

    await supabase.dispose();
    await site.dispose();
  });
});
