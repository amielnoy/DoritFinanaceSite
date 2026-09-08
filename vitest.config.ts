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
    setupFiles: ["tests/setup/testing-library.ts"],
    // e2e lives under e2e/ and is run by Playwright, never by Vitest.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    // Default is node; files needing a DOM opt in with a
    // `@vitest-environment jsdom` docblock (see tests/unit/auth-return-to).
    environment: "node",
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/vitest-junit.xml" },
    clearMocks: true,
    restoreMocks: true,
  },
});
