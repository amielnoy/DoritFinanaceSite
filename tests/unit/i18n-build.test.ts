import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRANSLATED_ROUTES, translatedRoutes } from "@/i18n/locales";
import { SITE_NAME, siteNameIn } from "@/lib/seo";
// @ts-expect-error — plain .mjs build scripts, untyped
import { buildSitemap } from "../../scripts/seo-files.mjs";
// @ts-expect-error — plain .mjs build scripts, untyped
import { hebrewTitledLocalePages } from "../../scripts/published-articles.mjs";

/**
 * English and French in the build (slice 6): the pages prerendered under /en
 * and /fr and listed in the sitemap — only for the languages VITE_LOCALES
 * names, so with it unset the build is what it was.
 */
const ROOT = join(__dirname, "..", "..");
const template = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");

describe("English and French in the build", () => {
  it("lists the translated pages only for the languages the build serves", () => {
    expect(translatedRoutes(["he"])).toEqual([]);
    expect(translatedRoutes(["he", "en"])).toEqual(["/en", "/en/tools", "/en/pension-check", "/en/claims", "/en/faq", "/en/atzmaim-31-12"]);
    expect(translatedRoutes(["he", "en", "fr"])).toHaveLength(12);
  });

  it("names exactly the pages App.jsx routes under /en and /fr", () => {
    const app = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
    const block = app.slice(app.indexOf("ENABLED_LOCALES.filter"), app.indexOf('<Route path="*"', app.indexOf("ENABLED_LOCALES.filter")));
    const routed = [...block.matchAll(/<Route (index|path="([^"]+)")/g)].map((m) => (m[1] === "index" ? "/" : `/${m[2]}`));
    expect([...routed].sort()).toEqual([...TRANSLATED_ROUTES].sort());
  });

  it("leaves the sitemap byte for byte as it was when no language is added", () => {
    expect(buildSitemap(template, [])).toBe(template);
    expect(buildSitemap(template, [], [])).toBe(template);
  });

  it("adds one entry per English and French page, inside the urlset", () => {
    const xml = buildSitemap(template, [], translatedRoutes(["he", "en", "fr"]));
    const origin = /<loc>(https:\/\/[^<]+?)\/?<\/loc>/.exec(template)![1].replace(/\/$/, "");
    for (const route of translatedRoutes(["he", "en", "fr"])) expect(xml).toContain(`<loc>${origin}${route}</loc>`);
    expect(xml.match(/<url>/g)!.length - template.match(/<url>/g)!.length).toBe(12);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("flags an English or French page with any Hebrew in its title, and nothing else", () => {
    expect(
      hebrewTitledLocalePages([
        { route: "/en/tools", title: "Self-check tools | דורית גוב ארי" },
        { route: "/fr", title: "Dorit Gov Ari | Planificatrice financière" },
        { route: "/tools", title: "כלים לבדיקה עצמית" },
        { route: "/english-guide", title: "מדריך" },
      ]).map((r: { route: string }) => r.route),
    ).toEqual(["/en/tools"]);
  });

  it("names the site in each language, Hebrew as it always was", () => {
    expect(siteNameIn("he")).toBe(SITE_NAME);
    for (const l of ["en", "fr"] as const) expect(siteNameIn(l)).not.toMatch(/[֐-׿]/);
  });
});
