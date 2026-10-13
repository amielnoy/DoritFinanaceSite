import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { siteUrl, verificationTags } from "../../scripts/vite-site-url-plugin.mjs";

describe("verification tags", () => {
  it("emits nothing when neither variable is set", () => {
    expect(verificationTags({})).toEqual([]);
  });

  it("emits Google's and Bing's tags from their variables", () => {
    expect(
      verificationTags({ VITE_GOOGLE_SITE_VERIFICATION: "abc_DEF-123456", VITE_BING_SITE_VERIFICATION: "0123456789ABCDEF" }),
    ).toEqual([
      { tag: "meta", attrs: { name: "google-site-verification", content: "abc_DEF-123456" }, injectTo: "head" },
      { tag: "meta", attrs: { name: "msvalidate.01", content: "0123456789ABCDEF" }, injectTo: "head" },
    ]);
  });

  it("ignores a variable that is set but blank", () => {
    expect(verificationTags({ VITE_BING_SITE_VERIFICATION: "  " })).toEqual([]);
  });

  it("refuses a whole pasted <meta> tag and says what to paste", () => {
    expect(() =>
      verificationTags({ VITE_GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="abc" />' }),
    ).toThrow(/only the content value/);
  });

  it("is what the plugin injects into index.html", () => {
    const plugin = siteUrl({ env: { VITE_BING_SITE_VERIFICATION: "0123456789ABCDEF" } });
    plugin.configResolved({ env: {}, build: { outDir: "dist" } });
    expect(plugin.transformIndexHtml()).toEqual(verificationTags({ VITE_BING_SITE_VERIFICATION: "0123456789ABCDEF" }));
  });
});
