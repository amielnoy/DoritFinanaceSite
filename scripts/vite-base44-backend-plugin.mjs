import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "vite";

/**
 * Wire a locally built bundle to a real Base44 backend.
 *
 * Base44's own hosting injects `VITE_BASE44_APP_ID` into the build, so the app
 * it serves knows which app to call: the SDK posts to
 * `/api/apps/<appId>/functions/<name>`. Nothing supplies that variable to a
 * build run from a clone, and `import.meta.env` is inlined at build time, so
 * the id resolves to `undefined` and every form on the site posts to
 * `/api/apps/undefined/...`.
 *
 * That failed silently in the worst possible way. The build succeeded, the site
 * looked correct, and the only symptom was a visitor-facing red line under the
 * send button — the same one for a dead backend, a rejected lead and a build
 * that was never pointed at an app. Two things are fixed here:
 *
 *   1. the app id falls back to the app this clone is linked to, and
 *   2. `vite preview` can proxy `/api` the way the deployed site does.
 *
 * Both are inert without local configuration, which is what keeps CI's "build
 * the way the Base44 Builder does" guard meaningful: that step unsets
 * `VITE_BASE44_APP_ID` to prove the build never *requires* it, and a checkout
 * has no `base44/.app.jsonc` to fall back to.
 */

/** Written by `base44 link`, gitignored: which app this clone points at. */
export const APP_POINTER = "base44/.app.jsonc";

/**
 * Read the linked app id.
 *
 * Matched rather than parsed: the file is JSONC, it is written by the CLI and
 * not by us, and the one field that matters has never been worth a comment
 * stripper to reach.
 */
export function readLinkedAppId(root) {
  try {
    const contents = readFileSync(join(root, APP_POINTER), "utf8");
    return contents.match(/"id"\s*:\s*"([^"]+)"/)?.[1] ?? "";
  } catch {
    // No pointer means this is a checkout, not a linked clone. Not an error.
    return "";
  }
}

const trimTrailingSlashes = (value) => value.replace(/\/+$/, "");

export function base44Backend({ env: override } = {}) {
  return {
    name: "base44-backend",
    config(userConfig, { mode }) {
      const root = userConfig.root ?? process.cwd();
      const env = override ?? { ...loadEnv(mode, root, ""), ...process.env };

      const configuredAppId = env.VITE_BASE44_APP_ID ?? "";
      const linkedAppId = configuredAppId ? "" : readLinkedAppId(root);
      // Only ever a fallback. Defining a key Vite is already inlining would put
      // two values in the bundle for one variable.
      const define = linkedAppId
        ? { "import.meta.env.VITE_BASE44_APP_ID": JSON.stringify(linkedAppId) }
        : {};
      if (linkedAppId) {
        console.log(`[base44-backend] App id from ${APP_POINTER}: ${linkedAppId}`);
      }

      /**
       * `vite preview` serves `dist/` as static files and nothing else, so
       * `/api` 404s there even though the deployed site answers it — Vercel
       * rewrites it to Base44, and Base44's own host owns the path outright.
       * The Base44 Vite plugin only fills this gap for `vite dev` (it sets
       * `server.proxy`), which leaves the one server that runs the real
       * production bundle unable to reach a backend.
       *
       * Opt-in, and deliberately so. `npm run test:e2e` serves the site from
       * this same preview server, and its specs are hermetic only because every
       * `/api` call is stubbed by e2e/fixtures/app.ts. A proxy that switched
       * itself on whenever a clone happened to be linked would turn any request
       * the fixture failed to match into a write against the live app — real
       * leads, real email, from a test run. Naming the host is the consent.
       */
      const apiOrigin = trimTrailingSlashes(env.VITE_BASE44_APP_BASE_URL ?? "");
      const preview = apiOrigin
        ? { proxy: { "/api": { target: apiOrigin, changeOrigin: true } } }
        : {};
      if (apiOrigin) {
        console.log(`[base44-backend] Preview proxy: /api -> ${apiOrigin}`);
      }

      return { define, preview };
    },
  };
}

export default base44Backend;
