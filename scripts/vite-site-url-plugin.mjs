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
 */
export const DEFAULT_SITE_URL = "https://safe-arch-plan.base44.app";

/** Files copied from `public/` that spell the origin out. */
export const HOST_BEARING_ASSETS = ["sitemap.xml", "robots.txt", "llms.txt"];

const trimTrailingSlashes = (value) => value.replace(/\/+$/, "");

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
