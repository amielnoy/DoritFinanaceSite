import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone config — it deliberately does NOT extend vite.config.js, so the
// Base44 Vite plugin (which expects a linked app + dev server) stays out of the
// unit/contract test run. Playwright e2e keeps using the real Vite build.
export default defineConfig({
  resolve: {
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
