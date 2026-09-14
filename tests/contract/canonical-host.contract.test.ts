import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_URL, HOST_BEARING_ASSETS } from "../../scripts/vite-site-url-plugin.mjs";

/**
 * One origin, written in one place.
 *
 * The canonical host appeared in five places: `seo.ts` (behind `VITE_SITE_URL`), a
 * share link, and three static files under `public/`. Moving hosts then meant editing
 * four of them and noticing all four — and a sitemap left on the old origin tells a
 * search engine the new site is a copy of the old one.
 *
 * These tests do not forbid the host from being written down. They forbid it being
 * written down anywhere the build cannot reach when the origin changes.
 */

const REPO_ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("the canonical host has a single source", () => {
  it("resolves the runtime origin from VITE_SITE_URL", () => {
    const seo = read("src/lib/seo.ts");
    expect(seo).toContain("VITE_SITE_URL");
    expect(seo).toContain(DEFAULT_SITE_URL);
  });

  it("names the same default in the build plugin as in the runtime", () => {
    // Two defaults that drifted apart would move the sitemap and the canonical tag
    // to different origins — the worst of both.
    expect(read("src/lib/seo.ts")).toContain(DEFAULT_SITE_URL);
  });

  it("rewrites every static file that spells the origin out", () => {
    for (const asset of HOST_BEARING_ASSETS) {
      const contents = read(join("public", asset));
      expect(contents, `public/${asset} no longer mentions the canonical host`).toContain(
        DEFAULT_SITE_URL
      );
    }
  });

  it("leaves no public asset naming the host that the build does not rewrite", () => {
    const covered = new Set(HOST_BEARING_ASSETS);
    const stragglers = readdirSync(join(REPO_ROOT, "public"))
      .filter((name) => !covered.has(name))
      .filter((name) => statSync(join(REPO_ROOT, "public", name)).isFile())
      .filter((name) => /\.(txt|xml|json|webmanifest)$/.test(name))
      .filter((name) => read(join("public", name)).includes(DEFAULT_SITE_URL));

    expect(
      stragglers,
      "add these to HOST_BEARING_ASSETS, or the host change will half-happen"
    ).toEqual([]);
  });

  it("keeps the origin out of application source, which cannot be rewritten at build time", () => {
    const offenders = [...sourceFiles("src")]
      .filter((f) => relative("src/lib", f) !== "seo.ts")
      .filter((f) => f !== join("src", "lib", "seo.ts"))
      .filter((f) => read(f).includes(DEFAULT_SITE_URL));

    expect(
      offenders,
      "import SITE_URL from @/lib/seo instead of writing the origin out"
    ).toEqual([]);
  });

  it("still points the API rewrite at Base44, which is a backend address and not the canonical host", () => {
    /* vercel.json forwards /api to Base44. That destination is deliberately *not*
       governed by VITE_SITE_URL: it names where the backend lives, which is a
       different question from where the site is served, and the two separate
       exactly when a Python backend starts taking paths over. */
    const vercel = JSON.parse(read("vercel.json"));
    const apiRewrite = vercel.rewrites.find((r: { source: string }) => r.source === "/api/:path*");
    expect(apiRewrite.destination).toContain("base44.app");
  });
});
