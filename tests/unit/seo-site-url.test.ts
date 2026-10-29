import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "@/lib/seo";

// `SITE_URL` is resolved once, at module load, from two environments: Vite's
// (`import.meta.env`, inlined into the browser bundle) and the server's
// (`process.env`, all a Vercel function under api/ has). These pin the order on
// the pure resolver: under Vitest `import.meta.env` mirrors process.env's VITE_*
// keys, so the two cannot be told apart through the module. The end-to-end case
// (bundled, no import.meta.env) is in og-blog-handler.test.ts.

const OLD = "https://safe-arch-plan.base44.app";
const PROD = "https://govari-fin.co.il";

describe("resolveSiteUrl — where the canonical origin comes from", () => {
  it("takes Vite's VITE_SITE_URL first, over the server's", () => {
    expect(resolveSiteUrl({ VITE_SITE_URL: PROD }, { VITE_SITE_URL: "https://other.example" })).toBe(PROD);
  });

  it("falls back to the server's VITE_SITE_URL when Vite's env lacks it — a Vercel function", () => {
    expect(resolveSiteUrl(undefined, { VITE_SITE_URL: PROD })).toBe(PROD);
    expect(resolveSiteUrl({}, { VITE_SITE_URL: PROD })).toBe(PROD);
  });

  it("falls back to the production domain when neither names one — never the old Base44 host", () => {
    // A build without the variable must name production as canonical, never
    // the host the site first ran on.
    expect(resolveSiteUrl(undefined, undefined)).toBe(PROD);
    expect(resolveSiteUrl({}, {})).toBe(PROD);
    expect(resolveSiteUrl(undefined, undefined)).not.toBe(OLD);
  });

  it("treats a blank value as unset, as the build plugin does", () => {
    expect(resolveSiteUrl({ VITE_SITE_URL: "" }, { VITE_SITE_URL: PROD })).toBe(PROD);
    expect(resolveSiteUrl({ VITE_SITE_URL: "  " }, { VITE_SITE_URL: "" })).toBe(PROD);
  });

  it("strips trailing slashes from whichever source wins", () => {
    expect(resolveSiteUrl({ VITE_SITE_URL: `${PROD}//` }, undefined)).toBe(PROD);
    expect(resolveSiteUrl(undefined, { VITE_SITE_URL: `${PROD}/` })).toBe(PROD);
  });
});
