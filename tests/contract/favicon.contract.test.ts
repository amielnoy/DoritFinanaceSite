import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The site's own icon (review 2026-10-15, item 23): a self-hosted SVG monogram
 * "ד" on the primary colour, in place of Base44's logo in the tab and in the
 * web manifest.
 */
const html = readFileSync("index.html", "utf8");
const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8")) as { icons: { src: string; type: string }[] };

describe("the favicon", () => {
  it("is /favicon.svg in the page and in the manifest, and Base44's logo is nowhere", () => {
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
    expect(manifest.icons.map((i) => [i.src, i.type])).toEqual([["/favicon.svg", "image/svg+xml"]]);
    expect(`${html}${JSON.stringify(manifest)}`).not.toMatch(/base44\.com\/logo/);
  });

  it("is an SVG monogram ד on the site's primary colour", () => {
    expect(existsSync("public/favicon.svg")).toBe(true);
    const svg = readFileSync("public/favicon.svg", "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32"/);
    expect(svg).toMatch(/<title[^>]*>ד — /);
    const primary = /--primary:\s*[^;]+;\s*\/\*\s*(#[0-9a-f]{6})/i.exec(readFileSync("src/index.css", "utf8"))![1];
    expect(svg).toContain(`<rect width="32" height="32" rx="6" fill="${primary}"/>`);
    // Shapes, not text: a favicon cannot load the site's fonts.
    expect(svg).not.toMatch(/<text\b|@import|https?:\/\/(?!www\.w3\.org)/);
  });
});
