import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Consent before Google Analytics (src/lib/consent.ts), as source. The inline
 * script itself is run under jsdom in tests/unit/ga-consent.dom.test.ts.
 */
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const html = read("index.html");
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

describe("GA4 consent: index.html, the CSP and the prerender", () => {
  it("reads the flag from a meta, so the script's text is the same with it on or off", () => {
    expect(html).toContain('<meta name="ga-consent" content="%VITE_GA_CONSENT%" />');
    for (const s of inline) expect(s).not.toContain("%VITE_");
  });

  it("has no static GA4 tag left: the inline script adds it only when it may", () => {
    expect(html).not.toMatch(/<script[^>]*src="https:\/\/www\.googletagmanager\.com/);
  });

  it("allows every inline script of index.html by hash in vercel.json, so an edit fails here and not only at build", () => {
    const policy = read("vercel.json");
    expect(inline.length).toBeGreaterThan(0);
    for (const s of inline) {
      const hash = `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`;
      expect(policy, s.slice(0, 50)).toContain(`'${hash}'`);
    }
  });

  it("strips the tag the captured DOM carries from every prerendered page", () => {
    const script = read("scripts/prerender.mjs");
    expect(script).toContain("function dropGaTag(html)");
    expect(script).toMatch(/return dropGaTag\(html\.replace\(/);
  });

  it("mounts the banner once, inside the router", () => {
    const app = read("src/App.jsx");
    expect(app.match(/<ConsentBanner \/>/g)).toHaveLength(1);
    expect(app.indexOf("<ConsentBanner />")).toBeGreaterThan(app.indexOf("<Router>"));
  });
});
