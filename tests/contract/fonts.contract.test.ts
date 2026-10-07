import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The fonts are self-hosted.
 *
 * They came from Google Fonts, which handed every visitor's IP address to
 * Google on every page — not mentioned in the privacy policy — and left the
 * e2e suite, which blocked Google Fonts to stay hermetic, rendering in CI's
 * fallback faces. A sticky-bar label that fits in the real font wrapped in
 * Linux WebKit's fallback and turned main red. Now one set of files in
 * public/fonts serves visitors and tests alike.
 */
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const SHIPPED = ["index.html", "src", "public"];
const TEXT = /\.(html|css|tsx?|jsx?|mjs|json)$/;

function files(path: string): string[] {
  const abs = join(REPO_ROOT, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return TEXT.test(abs) ? [abs] : [];
  return readdirSync(abs).flatMap((n) => files(join(path, n)));
}

const sheets = { site: read("src/fonts.css"), poa: read("public/fonts/poa.css") };
const urls = (css: string) => [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map((m) => m[1]);
const families = (css: string) => new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));

describe("self-hosted fonts", () => {
  it("nothing that ships asks Google for fonts", () => {
    const hits = SHIPPED.flatMap(files)
      .filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO_ROOT, f));
    expect(hits).toEqual([]);
  });

  it.each(Object.entries(sheets))("every face in the %s sheet points at a file that exists", (_name, css) => {
    const found = urls(css);
    expect(found.length).toBeGreaterThan(0);
    for (const u of found) expect(existsSync(join(REPO_ROOT, "public", u)), u).toBe(true);
  });

  it("declares every named family the site's font stacks use", () => {
    const stacks = [...read("src/index.css").matchAll(/--font-[a-z]+:\s*([^;]+);/g)].map((m) => m[1]);
    const named = new Set(
      stacks.flatMap((s) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1])),
    );
    const declared = families(sheets.site);
    for (const family of named) expect(declared.has(family), family).toBe(true);
  });

  it("covers Hebrew in the faces Hebrew text falls through to", () => {
    for (const family of ["Frank Ruhl Libre", "Noto Serif Hebrew"]) {
      expect(sheets.site, family).toMatch(new RegExp(`'${family}'[^}]*U\\+0590-05FF`));
    }
  });

  it("preloads only files it serves and declares, with crossorigin", () => {
    const html = read("index.html");
    const preloads = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*as="font"[^>]*>/g)].map((m) => m[0]);
    expect(preloads.length).toBeGreaterThan(0);
    for (const tag of preloads) {
      const href = /href="([^"]+)"/.exec(tag)![1];
      expect(tag, href).toMatch(/\bcrossorigin\b/);
      expect(existsSync(join(REPO_ROOT, "public", href)), href).toBe(true);
      expect(urls(sheets.site), href).toContain(href);
    }
  });

  it("ships the OFL licence beside the files", () => {
    const pkgs = new Set(
      readdirSync(join(REPO_ROOT, "public/fonts"))
        .filter((n) => n.endsWith(".woff2"))
        .map((n) => n.replace(/-(hebrew|latin)-\d+-(normal|italic)\.woff2$/, "")),
    );
    for (const pkg of pkgs) {
      const licence = join(REPO_ROOT, "public/fonts", `LICENSE-${pkg}.txt`);
      expect(existsSync(licence), pkg).toBe(true);
      expect(readFileSync(licence, "utf8")).toMatch(/SIL Open Font License/);
    }
  });

  it("caches the font files without letting the document rule swallow them", () => {
    const vercel = JSON.parse(read("vercel.json")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const fontsAt = vercel.headers.findIndex((h) => h.source === "/fonts/(.*)");
    const docsAt = vercel.headers.findIndex((h) => /\(\?!assets\//.test(h.source));
    expect(fontsAt).toBeGreaterThanOrEqual(0);
    expect(vercel.headers[docsAt].source, "the no-cache rule must skip /fonts/").toMatch(/fonts\//);
    expect(
      vercel.headers[fontsAt].headers.find((x) => x.key.toLowerCase() === "cache-control")?.value,
    ).toMatch(/max-age=\d+/);
    expect(read("public/_headers")).toMatch(/\/fonts\/\*\n\s*Cache-Control:\s*public, max-age=\d+/);
  });
});
