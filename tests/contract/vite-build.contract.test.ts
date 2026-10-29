import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

describe("a test run cannot leave behind a bundle that preview will serve", () => {
  /**
   * The e2e build inlines the fake Supabase host and leaves the result in
   * `dist/`, which is the same directory `vite preview` serves. A preview
   * started after a test run therefore sends every call to a host that does not
   * exist, and the screen shows one line — "מצטערת, לא הצלחתי לשלוח את ההודעה
   * כרגע" — identical to the one a real outage produces, which is how it went
   * unnoticed.
   */
  it("rebuilds before previewing, so a stale bundle is never served", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.preview).toMatch(/\bnpm run build\b.*&&.*\bvite preview\b/);
  });

  it("discards the e2e bundle once the e2e suite has run", () => {
    // Guarded by the same flag that decides whether this script built at all —
    // a run against PLAYWRIGHT_BASE_URL, or one handed SKIP_BUILD=1, must not
    // delete a dist it did not write.
    const sh = read("scripts/run-tests.sh");
    expect(sh).toMatch(/BUILT_SENTINEL_DIST=1/);
    expect(sh).toMatch(/rm -rf dist/);
  });
});

describe("the analytics beacon is mounted only where its endpoint exists", () => {
  /**
   * `<Analytics />` posts to `/_vercel/insights/*` — a path Vercel's edge
   * synthesises and no other host serves. Mounted anywhere else it finds
   * nothing and spends a failed request on every page load to report data
   * nobody can read; the prerenderer once captured the injected <script> into
   * every route file, where it resolved to the SPA shell and the browser refused
   * to execute an HTML document as a script (A-43).
   *
   * The flag is derived from `VERCEL`, which Vercel sets itself, rather than
   * from a `VITE_` variable set per environment: a hand-set flag fails by being
   * left on where the endpoint does not exist.
   */
  it("derives the flag from Vercel's own environment, not a variable someone sets", () => {
    const config = read("vite.config.js");
    expect(config).toMatch(
      /'import\.meta\.env\.VITE_VERCEL_ANALYTICS':\s*JSON\.stringify\(process\.env\.VERCEL === '1'\)/,
    );
  });

  it("mounts the component behind that flag rather than unconditionally", () => {
    const app = read("src/App.jsx");
    expect(app, "<Analytics /> is still mounted unconditionally").not.toMatch(/^\s*<Analytics \/>/m);
    expect(app).toMatch(/import\.meta\.env\.VITE_VERCEL_ANALYTICS \? <Analytics beforeSend=\{stripFragment\} \/> : null/);
  });
});
