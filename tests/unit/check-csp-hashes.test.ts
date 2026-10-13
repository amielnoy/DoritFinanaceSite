import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs build script, untyped.
import { enforcedPolicy, missingInlineHashes } from "../../scripts/check-csp-hashes.mjs";

const hashOf = (text: string) => `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;

describe("scripts/check-csp-hashes", () => {
  const gtag = "window.dataLayer = window.dataLayer || [];";
  const logger = 'if (window.self === window.top) { const appId = "abc"; }';
  const policy = `default-src 'self'; script-src 'self' '${hashOf(gtag)}' '${hashOf(logger)}'`;

  it("passes a page whose inline scripts are all allowed by hash", () => {
    const html = `<script>${gtag}</script><script type="module">${logger}</script>`;
    expect(missingInlineHashes(html, policy)).toEqual([]);
  });

  it("names the hash of an inline script the policy does not allow", () => {
    const changed = logger.replace('"abc"', '"def"'); // a different app id baked in
    const missing = missingInlineHashes(`<script type="module">${changed}</script>`, policy);
    expect(missing).toEqual([{ hash: hashOf(changed), start: changed.slice(0, 60) }]);
  });

  it("ignores external scripts and data blocks", () => {
    const html = [
      `<script async src="https://www.googletagmanager.com/gtag/js"></script>`,
      `<script type="module" crossorigin src="/assets/index.js"></script>`,
      `<script type="application/ld+json">{"@type":"Person"}</script>`,
    ].join("");
    expect(missingInlineHashes(html, policy)).toEqual([]);
  });

  it("reads the enforced policy from vercel.json, not the report-only one", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    const enforced = enforcedPolicy(config);
    expect(enforced).toMatch(/^default-src 'self'; script-src /);
    expect(enforced).not.toMatch(/require-trusted-types-for/);
  });

  it("allows index.html's own gtag snippet as it stands", () => {
    const enforced = enforcedPolicy(JSON.parse(readFileSync("vercel.json", "utf8")));
    expect(missingInlineHashes(readFileSync("index.html", "utf8"), enforced)).toEqual([]);
  });
});
