import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Keep the canonical host in the static files in step with `VITE_SITE_URL`.
 *
 * `src/lib/seo.ts` already resolves the runtime canonical from that variable, but
 * `public/` ships three files Vite copies verbatim — the sitemap, robots.txt and
 * llms.txt — each with the host written out in full. Moving hosts used to mean
 * editing four places and noticing all of them; a sitemap left pointing at the old
 * origin tells search engines the new site is a copy of it.
 *
 * The checked-in files keep a real, working URL rather than a placeholder token, so
 * they are still correct on their own and readable in a diff. This rewrites the
 * emitted copies when — and only when — a different origin is configured.
 *
 * The default is the production domain, and was the old Base44 host until
 * 2026-10-14: a builder without the variable (the Base44 Builder, whose
 * environment is set only in its dashboard) shipped a copy that called itself
 * canonical. `src/lib/seo.ts` names the same default.
 */
export const DEFAULT_SITE_URL = "https://govari-fin.co.il";

/**
 * Emitted files that spell the origin out, by their path in the build output.
 *
 * Three of these are copied verbatim from `public/`. The fourth is `index.html`,
 * which is the document every visitor and every link scraper actually receives —
 * and it was missing. Moving the host rewrote the sitemap and left the served
 * HTML advertising the old origin in four places: `rel="canonical"`, `og:url`,
 * and two static JSON-LD blocks.
 *
 * `applySeo` repairs the first two at runtime, which hides the problem from a
 * browser and from nobody else: a social or search crawler reads the response
 * body, and `clearRouteScoped` only removes `script[data-seo-jsonld]`, so the
 * two JSON-LD blocks were never touched at all. That is precisely the
 * half-happened host move this plugin exists to prevent.
 */
export const HOST_BEARING_ASSETS = ["index.html", "sitemap.xml", "robots.txt", "llms.txt"];

/**
 * Where each emitted file comes from, for the tests that check the checked-in
 * copy still names the host. Everything not listed here lives in `public/`.
 */
export const ASSET_SOURCES = { "index.html": "index.html" };

const trimTrailingSlashes = (value) => value.replace(/\/+$/, "");

/**
 * Search Console's and Bing Webmaster Tools' ownership tags, from the build's
 * env. Emitted as <meta> by Vite's HTML transform rather than written into
 * index.html, so a build without the variables carries no empty tag. They
 * are not scripts, so the enforced CSP is untouched. Every prerendered page is
 * a snapshot of this document and carries them too.
 */
const VERIFICATION = [
  ["VITE_GOOGLE_SITE_VERIFICATION", "google-site-verification"],
  ["VITE_BING_SITE_VERIFICATION", "msvalidate.01"],
];
const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

export function verificationTags(env = {}) {
  const tags = [];
  for (const [variable, name] of VERIFICATION) {
    const value = (env[variable] ?? "").trim();
    if (!value) continue;
    if (!VERIFICATION_TOKEN.test(value)) {
      throw new Error(
        `${variable} must be only the content value of the verification tag (letters, digits, "_" and "-"), ` +
          "not the whole <meta> tag.",
      );
    }
    tags.push({ tag: "meta", attrs: { name, content: value }, injectTo: "head" });
  }
  return tags;
}

export function siteUrl({ env: override } = {}) {
  /**
   * Read the origin from Vite's own resolved env, not from `process.env`.
   *
   * `seo.ts` sees `import.meta.env.VITE_SITE_URL`, which Vite assembles from the shell
   * *and* from `.env` files. `process.env` only has the first of those. Reading it meant
   * a `.env.production` moved the canonical tag while leaving the sitemap on the old
   * host — precisely the split this plugin exists to prevent, and invisible because each
   * half looked right on its own. Taking the value from the same place the application
   * takes it is what makes them unable to disagree.
   */
  let resolved = override;
  const outDirOf = (config) => config?.build?.outDir ?? "dist";
  let outDir = "dist";

  return {
    name: "site-url",
    apply: "build",
    configResolved(config) {
      resolved = override ?? config.env;
      outDir = outDirOf(config);
    },
    transformIndexHtml() {
      return verificationTags(resolved ?? {});
    },
    async closeBundle() {
      const configured = trimTrailingSlashes(resolved?.VITE_SITE_URL ?? "");
      if (!configured || configured === DEFAULT_SITE_URL) return;

      for (const asset of HOST_BEARING_ASSETS) {
        const path = join(outDir, asset);
        let contents;
        try {
          contents = await readFile(path, "utf8");
        } catch {
          // An asset that is not in this build is not an error — it is one fewer
          // place the old host can survive.
          continue;
        }
        const rewritten = contents.replaceAll(DEFAULT_SITE_URL, configured);
        if (rewritten !== contents) await writeFile(path, rewritten);
      }
      this.info?.(`site-url: canonical host set to ${configured}`);
    },
  };
}

export default siteUrl;
