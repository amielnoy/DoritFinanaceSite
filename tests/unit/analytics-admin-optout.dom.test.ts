// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { GA4_MEASUREMENT_ID, isUnmeasuredPath, measureRoute } from "@/lib/analytics";

/*
 * GA4 is switched off on /admin (review 2026-10-15, item 21): the history page
 * views the tag sends by itself ignore send_page_view and page_location, and
 * admin URLs carry searches and record ids. Google's own opt-out flag is the
 * switch — set per route by the app, and by index.html for a page that loads
 * on /admin.
 */
const FLAG = `ga-disable-${GA4_MEASUREMENT_ID}`;
const flag = () => (window as unknown as Record<string, unknown>)[FLAG];

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[FLAG];
});

describe("GA4 on the admin area", () => {
  it.each(["/admin", "/admin/leads", "/admin/users", "/admin/masleka/analysis/abc"])("does not measure %s", (path) => {
    expect(isUnmeasuredPath(path)).toBe(true);
  });

  it.each(["/", "/administration", "/blog/admin", "/en/claims", "/account"])("measures %s", (path) => {
    expect(isUnmeasuredPath(path)).toBe(false);
  });

  it("switches the tag off on entering /admin and on again on leaving it", () => {
    measureRoute("/admin/users");
    expect(flag()).toBe(true);
    measureRoute("/claims");
    expect(flag()).toBe(false);
  });

  it("is switched off by index.html, before the tag is configured, for a page that loads on /admin", () => {
    const html = readFileSync("index.html", "utf8");
    const script = /<script>\s*(window\.dataLayer[\s\S]*?)<\/script>/.exec(html)![1];
    // Since VITE_GA_CONSENT the script names the id once (`var id`) and builds the flag from it.
    expect(FLAG).toBe(`ga-disable-${/var id = '([^']+)'/.exec(script)![1]}`);
    const optOut = script.indexOf("window['ga-disable-' + id] = true");
    expect(optOut).toBeGreaterThan(-1);
    expect(optOut).toBeLessThan(script.indexOf("gtag('config'"));
    // The page's own copy of the rule, run on the paths above.
    const rule = new RegExp(/if \(\/(.+)\/\.test\(location\.pathname\)\)/.exec(script)![1]);
    for (const path of ["/admin", "/admin/leads", "/", "/administration", "/blog/admin"]) {
      expect(rule.test(path), path).toBe(isUnmeasuredPath(path));
    }
  });
});
