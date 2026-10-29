import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { readVercelConfig, sourcePattern } from "../helpers/vercel-routes";

/**
 * D-18, manual test 2026-10-14: the site's pages answered
 * `access-control-allow-origin: *` — Vercel's default for static files, set
 * nowhere in vercel.json — and there was no /.well-known/security.txt.
 * vercel.json cannot remove a default header, but a rule of its own replaces
 * it; this pins that rule, and the file.
 */
const { headers } = readVercelConfig();
const SITE = "https://govari-fin.co.il";

/** The last matching rule's value wins on Vercel; null when no rule sets it. */
const allowOrigin = (path: string): string | null => {
  let value: string | null = null;
  for (const rule of headers)
    if (sourcePattern(rule.source).test(path))
      for (const h of rule.headers) if (h.key.toLowerCase() === "access-control-allow-origin") value = h.value;
  return value;
};

describe("pages name the site as their only allowed origin", () => {
  it.each(["/", "/faq", "/blog/horadat-dmei-nihul", "/admin/leads", "/llms.txt", "/.well-known/security.txt"])("%s", (path) => {
    expect(allowOrigin(path)).toBe(SITE);
  });

  it("no rule anywhere hands out the wildcard", () => {
    for (const rule of headers)
      for (const h of rule.headers)
        if (h.key.toLowerCase() === "access-control-allow-origin") expect(h.value, rule.source).not.toBe("*");
  });

  it.each(["/api/csp-report", "/api/og/blog"])("leaves %s to answer for itself", (path) => {
    // The og/csp functions set their own CORS.
    expect(allowOrigin(path)).toBeNull();
  });
});

describe("/.well-known/security.txt (RFC 9116)", () => {
  const file = join(REPO_ROOT, "public/.well-known/security.txt");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const field = (name: string) => text.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];

  it("exists, with a contact on the site's own domain", () => {
    expect(field("Contact")).toMatch(/^mailto:[^@]+@govari-fin\.co\.il$/);
  });

  // This fails when the date passes, on purpose: an expired security.txt
  // tells a reporter the contact may be stale. Renew it a year out.
  it("has an Expires in the future and no more than a year out, as the RFC asks", () => {
    const expires = Date.parse(field("Expires") ?? "");
    expect(Number.isFinite(expires)).toBe(true);
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires - Date.now()).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
  });

  it("names its canonical address", () => {
    expect(field("Canonical")).toBe(`${SITE}/.well-known/security.txt`);
  });
});
