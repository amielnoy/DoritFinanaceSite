import type { APIRequestContext } from "@playwright/test";
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
 * is deployed and allows the site's origin without storing anything, and does
 * the same for `submit-lead` (whose answer says whether Google, the database and
 * the mailer are all reachable) and `log-support-chat`.
 */
const LIVE_URL = process.env.E2E_LIVE_API_URL;
// Google's secrets arrive at rollout step 2, after the merge. Until the repo
// variable LEAD_FUNCTIONS says "supabase", submit-lead's Google readiness is
// not asserted at all.
const EXPECT_GOOGLE = process.env.E2E_EXPECT_GOOGLE === "supabase";

/** The Supabase URL and publishable key the deployed bundle carries. */
async function deployedSupabase(site: APIRequestContext): Promise<{ url: string; key: string }> {
  let url = "";
  let key = "";
  const html = await (await site.get("/")).text();
  const scripts = [...new Set([...html.matchAll(/\/assets\/[^"']+\.js/g)].map((m) => m[0]))];
  for (const path of scripts) {
    const js = await (await site.get(path)).text();
    url ||= js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] ?? "";
    key ||= js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? "";
  }
  return { url, key };
}

test.describe("Live Supabase, with the deployed bundle's key (opt-in)", () => {
  test.skip(!LIVE_URL, "set E2E_LIVE_API_URL to enable");

  test("the deployed key opens the project's public reads and its sign-in", async ({ playwright }) => {
    const site = await playwright.request.newContext({ baseURL: LIVE_URL });
    let url = "";
    let key = "";

    await test_step("the deployed bundle names a Supabase project and a publishable key", async () => {
      ({ url, key } = await deployedSupabase(site));
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
      const body = (await res.json().catch(() => ({}))) as { rid?: string; ready?: { db?: boolean; mailer?: boolean } };
      expect(res.status(), `submit-claim: ${JSON.stringify(body)}`).toBe(400);
      expect(body.rid, "the answer carries no rid").toBeTruthy();
      // Deployed is not enough: a missing secret would save claims and tell nobody.
      expect(body.ready, "submit-claim cannot save a claim — its Supabase key is missing").toMatchObject({ db: true });
      expect(body.ready, "submit-claim cannot mail — set MAILER_URL and MAILER_TOKEN in its secrets").toMatchObject({ mailer: true });
      expect(res.headers()["access-control-allow-origin"], "the site's origin is not allowed").toBe(origin);
    });

    await test_step("the lead function is deployed and can reach everything it writes to", async () => {
      // An empty enquiry: refused for want of a name and phone, but only after
      // the function has said what it could do — the Google key and calendar
      // are set, the database is reachable and the mailer is configured.
      const origin = new URL(LIVE_URL!).origin;
      const res = await supabase.post("/functions/v1/submit-lead", {
        data: {},
        headers: { Origin: origin, Authorization: `Bearer ${key}` },
      });
      const body = (await res.json().catch(() => ({}))) as { ready?: { db?: boolean; mailer?: boolean; google?: boolean } };
      expect(res.status(), `submit-lead: ${JSON.stringify(body)}`).toBe(400);
      expect(body.ready, "submit-lead cannot save a lead — its Supabase key is missing").toMatchObject({ db: true });
      expect(body.ready, "submit-lead cannot mail — set MAILER_URL and MAILER_TOKEN in its secrets").toMatchObject({ mailer: true });
      if (EXPECT_GOOGLE) {
        expect(body.ready, "submit-lead cannot reach Google — set GOOGLE_SERVICE_ACCOUNT_JSON").toMatchObject({ google: true });
      }
    });

    await supabase.dispose();
    await site.dispose();
  });

  test("the support-chat log function is deployed", async ({ playwright }) => {
    const site = await playwright.request.newContext({ baseURL: LIVE_URL });
    const { url, key } = await deployedSupabase(site);
    expect(key, "no sb_publishable_ key in the deployed bundle").not.toBe("");
    const supabase = await playwright.request.newContext({ baseURL: url, extraHTTPHeaders: { apikey: key } });

    await test_step("the support-chat log is deployed", async () => {
      // 200 without SHEET_ID ("not configured"), 400 with it and an empty body:
      // either way the function is deployed and answering, and nothing is written.
      const res = await supabase.post("/functions/v1/log-support-chat", {
        data: {},
        headers: { Origin: new URL(LIVE_URL!).origin, Authorization: `Bearer ${key}` },
      });
      expect([200, 400], `log-support-chat answered ${res.status()}`).toContain(res.status());
    });

    await supabase.dispose();
    await site.dispose();
  });
});
