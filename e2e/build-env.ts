/**
 * The environment the e2e bundle is built with — production's configuration,
 * pointed at a Supabase that does not exist.
 *
 * The one place it is spelled. `npm run build:e2e` (scripts/build-e2e.mjs)
 * builds with it, and every e2e build goes through that script:
 * playwright.config.ts's webServer, scripts/run-tests.sh and CI's build job.
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
  // On in production; reachable only behind a staff sign-in, which no spec has.
  VITE_MEETINGS_STAFF: "true",
  // On in production, and off here: e2e/ui/masleka.spec.ts asserts the dark
  // build, and tests/contract/masleka-dark-launch.contract.test.ts requires that
  // nothing in the repository turns it on.
  VITE_MASLEKA_ENABLED: "",
  // Off in production too, until the privacy wording is approved.
  VITE_MEETINGS_CLIENT: "",
  // Off in production, and on here: the reverse of VITE_MASLEKA_ENABLED. On, so
  // the agency-content read side runs in every spec and its visual gate
  // (e2e/ui/agency-content.spec.ts) can compare the seeded render with the
  // bundled one; production smoke keeps exercising it off. The bundle is sealed
  // at build time, so one run can have only one value.
  VITE_AGENCY_CONTENT: "true",

  // ── The prerender's article list ───────────────────────────────────────
  PRERENDER_ARTICLES_FIXTURE: E2E_ARTICLES_FIXTURE,
} as const satisfies Record<string, string>;
