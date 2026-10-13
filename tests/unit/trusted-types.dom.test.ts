/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Rules = {
  createHTML?: (s: string) => string;
  createScript?: (s: string) => string;
  createScriptURL?: (s: string) => string;
};

/** A stand-in for the browser's `trustedTypes`, recording the policies made. */
function fakeTrustedTypes() {
  const policies = new Map<string, Rules>();
  return {
    policies,
    createPolicy(name: string, rules: Rules) {
      if (policies.has(name)) throw new TypeError(`policy ${name} exists`);
      policies.set(name, rules);
      return {
        createHTML: rules.createHTML && ((s: string) => ({ trusted: rules.createHTML!(s) })),
        createScript: rules.createScript && ((s: string) => ({ trusted: rules.createScript!(s) })),
      };
    },
  };
}

async function load() {
  vi.resetModules();
  return import("@/lib/trusted-types");
}

afterEach(() => {
  delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
});

describe("trusted-types", () => {
  it("accepts a same-origin script URL — the one Vercel Analytics injects", async () => {
    const { sameOriginScriptUrl } = await load();
    expect(sameOriginScriptUrl("/_vercel/insights/script.js", "https://govari-fin.co.il")).toBe(
      "/_vercel/insights/script.js",
    );
  });

  it("refuses a script URL from any other origin", async () => {
    const { sameOriginScriptUrl } = await load();
    expect(() => sameOriginScriptUrl("https://evil.example/x.js", "https://govari-fin.co.il")).toThrow(
      /refused by Trusted Types: https:\/\/evil\.example/,
    );
    expect(() => sameOriginScriptUrl("//evil.example/x.js", "https://govari-fin.co.il")).toThrow();
  });

  it("installs a default policy for script URLs only, and a named one for the freshness HTML", async () => {
    const tt = fakeTrustedTypes();
    (globalThis as { trustedTypes?: unknown }).trustedTypes = tt;
    const { installTrustedTypes, freshnessHtml } = await load();

    installTrustedTypes();

    const def = tt.policies.get("default")!;
    expect(Object.keys(def)).toEqual(["createScriptURL"]); // no HTML or script text through `default`
    expect(def.createScriptURL!(`${window.location.origin}/a.js`)).toBe(`${window.location.origin}/a.js`);
    expect(() => def.createScriptURL!("https://evil.example/a.js")).toThrow();
    expect(freshnessHtml("<html></html>")).toEqual({ trusted: "<html></html>" });
  });

  it("vouches only for JSON it serialised itself, for ld+json blocks", async () => {
    const tt = fakeTrustedTypes();
    (globalThis as { trustedTypes?: unknown }).trustedTypes = tt;
    const { installTrustedTypes, jsonLdText } = await load();
    installTrustedTypes();

    expect(Object.keys(tt.policies.get("jsonld")!)).toEqual(["createScript"]);
    // A string comes back as a JSON string literal, never as script text.
    expect(jsonLdText("alert(1)")).toEqual({ trusted: '"alert(1)"' });
    expect(jsonLdText({ "@type": "Person" })).toEqual({ trusted: '{"@type":"Person"}' });
  });

  it("is safe to call twice, and never throws when a policy cannot be made", async () => {
    const tt = fakeTrustedTypes();
    (globalThis as { trustedTypes?: unknown }).trustedTypes = tt;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    tt.policies.set("default", {}); // someone else got there first
    const { installTrustedTypes, freshnessHtml } = await load();

    expect(() => installTrustedTypes()).not.toThrow();
    expect(() => installTrustedTypes()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(freshnessHtml("<p>x</p>")).toBe("<p>x</p>"); // falls back to the plain string
    warn.mockRestore();
  });

  it("without Trusted Types, does nothing and passes strings through", async () => {
    const { installTrustedTypes, freshnessHtml } = await load();
    expect(() => installTrustedTypes()).not.toThrow();
    expect(freshnessHtml("<p>x</p>")).toBe("<p>x</p>");
  });

  it("without Trusted Types, jsonLdText is plain JSON.stringify", async () => {
    const { jsonLdText } = await load();
    expect(jsonLdText({ a: 1 })).toBe('{"a":1}');
  });
});
