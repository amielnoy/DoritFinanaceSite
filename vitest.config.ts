import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone config — it deliberately does NOT extend vite.config.js, so the
// Base44 Vite plugin (which expects a linked app + dev server) stays out of the
// unit/contract test run. Playwright e2e keeps using the real Vite build.
export default defineConfig({
  resolve: {
    // vite.config.js's order: the real pages (.ts/.tsx) before the Base44
    // boilerplate .jsx it restores beside them (AGENTS.md). Without it a test
    // of "@/pages/Login" rendered Base44's English page, not the site's.
    extensions: [".mjs", ".mts", ".ts", ".tsx", ".js", ".jsx", ".json"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // allure-vitest/setup goes first: it installs the per-test hooks the Allure
    // reporter reads, so it has to be in place before any other setup runs.
    setupFiles: ["allure-vitest/setup", "tests/setup/testing-library.ts"],
    // e2e lives under e2e/ and is run by Playwright, never by Vitest.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    // Default is node; files needing a DOM opt in with a
    // `@vitest-environment jsdom` docblock (see tests/unit/auth-return-to).
    environment: "node",
    // Every test run takes the Base44 fallback, as CI always has. Vitest loads
    // .env.local, which holds real Supabase credentials on a developer's
    // machine — without this, a test that lets a call through to a real port
    // (rather than tests/component/services-mock.ts) would read the live
    // Supabase project, and pass or fail on whatever production holds that day. Tests that want a Supabase client
    // mock `@/api/supabaseClient` explicitly. The clearinghouse switch is
    // pinned off the same way: a developer's VITE_MASLEKA_ENABLED=true must not
    // turn on the header's board link (and its role lookup) in every suite.
    // Tests that want it on mock `@/config/masleka`. VITE_AGENCY_CONTENT is
    // pinned off for the same reason: on, every page that shows the agent
    // would ask the database for her, and every test rendering one without a
    // QueryClientProvider would fail. Tests that want it on mock
    // `@/config/agency-content`.
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "", VITE_MASLEKA_ENABLED: "", VITE_AGENCY_CONTENT: "" },
    // Allure results are written on every run, CI or not: they are what the
    // published report and `npm run allure:open` are built from, and without
    // this the report showed only the Playwright legs — the 174 unit,
    // component, contract and security tests were absent from it entirely.
    // Same results directory as allure-playwright writes to, so one `allure
    // generate` covers the whole battery.
    reporters: [
      "default",
      "allure-vitest/reporter",
      ...(process.env.CI ? ["junit" as const] : []),
    ],
    outputFile: { junit: "test-results/vitest-junit.xml" },
    clearMocks: true,
    restoreMocks: true,
  },
});
