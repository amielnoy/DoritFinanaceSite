/**
 * The environment the e2e bundle is built with — production's configuration,
 * pointed at a Supabase that does not exist.
 *
 * The one place it is spelled. `npm run build:e2e` (scripts/build-e2e.mjs)
 * builds with it, and every e2e build goes through that script:
 * playwright.config.ts's webServer, scripts/run-tests.sh and CI's build job.
 * The preview server gets it too (playwright.config.ts), for the one value
 * read at serve time rather than inlined: VITE_BASE44_APP_BASE_URL.
 *
 * Loaded by Node directly (scripts/build-e2e.mjs, scripts/published-articles.mjs),
 * so only erasable TypeScript here: no enums, no namespaces, no parameter
 * properties.
 */

/**
 * Where the e2e bundle thinks Supabase is. `.invalid` is reserved (RFC 2606):
 * it never resolves, so a request e2e/fixtures/app.ts does not answer fails
 * instead of reaching a real project.
 */
export const E2E_SUPABASE_URL = "https://supabase.e2e.invalid";

/** A publishable key that unlocks nothing anywhere. */
export const E2E_SUPABASE_PUBLISHABLE_KEY = "e2e-publishable-key";

/** The one article the prerender prebuilds in the e2e build — scripts/published-articles.mjs. */
export const E2E_ARTICLES_FIXTURE = "e2e/fixtures/prerender-articles.json";

/**
 * Every value is set, empty ones included: Vite lets the process environment
 * override `.env.local` only for a variable that exists, so an unset one would
 * take whatever a developer's `.env.local` says.
 */
export const E2E_BUILD_ENV = {
  // ── The backend: Supabase, at a host only the fixture answers ──────────
  VITE_SUPABASE_URL: E2E_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: E2E_SUPABASE_PUBLISHABLE_KEY,

  // ── Production's provider switches (Vercel, verified 2026-10-17) ───────
  VITE_LEAD_FUNCTIONS: "supabase",
  VITE_CONTENT_WRITES: "supabase",
  VITE_UPLOAD_PROVIDER: "supabase",
  VITE_CONTENT_IMAGES: "supabase",
  VITE_CHAT_AGENTS: "needs_interview,support_agent,procedures_agent,blog_recommender",
  // On in production; reachable only behind a staff sign-in, which no spec has.
  VITE_MEETINGS_STAFF: "true",
  // On in production, and off here: e2e/ui/masleka.spec.ts asserts the dark
  // build, and tests/contract/masleka-dark-launch.contract.test.ts requires that
  // nothing in the repository turns it on.
  VITE_MASLEKA_ENABLED: "",
  // Off in production too, until the privacy wording is approved.
  VITE_MEETINGS_CLIENT: "",

  // ── Base44: the SDK still boots, and must reach nothing ────────────────
  // The SDK is still in the bundle and keys its paths off this id. Nothing in a
  // passing run reaches /api any more; e2e/fixtures/app.ts fails a test that does.
  VITE_BASE44_APP_ID: "e2e-sanity-app",
  // Holds the preview server's /api proxy off, whatever `.env.local` says
  // (README: setting it points a local preview at the live Base44 backend).
  VITE_BASE44_APP_BASE_URL: "",
  VITE_BASE44_SERVER_URL: "",

  // ── The prerender's article list ───────────────────────────────────────
  PRERENDER_ARTICLES_FIXTURE: E2E_ARTICLES_FIXTURE,
} as const satisfies Record<string, string>;
