import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * A measuring tape, not a test suite: how much a phone visitor has to scroll.
 *
 *   npx playwright test -c playwright.measure.config.ts
 *
 * Same hermetic build and stubs as the e2e suite (it reuses its webServer and
 * the fixtures in e2e/fixtures/app.ts), but its own directory and file suffix,
 * so `npm run test:e2e` never collects it and CI never runs it. It prints the
 * numbers and writes them to MEASURE_OUT when set; SHOTS_DIR, when set, gets
 * screenshots of /faq at 390 and 1440.
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/measure",
  testMatch: /.*\.measure\.ts$/,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "measure-chromium" }],
});
