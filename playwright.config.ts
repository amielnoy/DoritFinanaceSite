import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

/**
 * Sanity e2e suite: UI, API, security and accessibility, run across desktop web,
 * iOS (WebKit / iPhone) and Android (Chromium / Pixel).
 *
 * There is no native app in this repo — "iOS" and "Android" mean the mobile web
 * experience, exercised through Playwright's real device descriptors (viewport,
 * user agent, touch, DPR) on the matching engine: WebKit for Safari on iOS,
 * Chromium for Chrome on Android.
 *
 * The suite is hermetic: the Base44 backend is stubbed at the network layer by
 * e2e/fixtures/app.ts, so it runs without `base44 link`, without credentials and
 * without touching production data. Point PLAYWRIGHT_BASE_URL at a running
 * `base44 dev` if you want to drive the real backend instead.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
// `||`, not `??`: docker compose passes unset variables through as empty
// strings, and an empty baseURL makes every page.goto() fail as an invalid URL.
const EXTERNAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "";
const baseURL = EXTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;
// The runner script and CI build once up front and set SKIP_BUILD=1 so the
// preview server does not rebuild the same bundle a second time.
const skipBuild = process.env.SKIP_BUILD === "1";

const builtInReporters: ReporterDescription[] = process.env.CI
  ? [["github"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/e2e-junit.xml" }]]
  : [["list"], ["html", { open: "never" }]];

// Allure runs alongside the built-in reporters on every run: it turns each
// test_step() message (see e2e/fixtures/steps.ts) into a named, timed step with
// its own status, screenshots and error, and keeps history across runs.
//   npm run test:e2e && npm run allure:open
const allureReporter: ReporterDescription = [
  "allure-playwright",
  {
    resultsDir: "allure-results",
    // Shown on the report's "Environment" widget, so a report tells you what it
    // was run against — local preview or a deployment.
    environmentInfo: {
      base_url: baseURL,
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      ci: process.env.CI ? "true" : "false",
    },
  },
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [...builtInReporters, allureReporter],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  },

  projects: [
    {
      name: "web-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "web-webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
    {
      // iOS Safari — WebKit with the iPhone 14 device descriptor.
      name: "ios-safari",
      use: { ...devices["iPhone 14"] },
    },
    {
      // Android Chrome — Chromium with the Pixel 7 device descriptor.
      name: "android-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],

  // Serve the real production build, so the e2e run also proves the bundle boots.
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        // --host 127.0.0.1: vite preview otherwise binds ::1 only, which the
        // baseURL health check cannot reach.
        command: [
          skipBuild ? null : "npm run build",
          `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
        ]
          .filter(Boolean)
          .join(" && "),
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          // The stubbed backend keys off this id; it never reaches a real app.
          VITE_BASE44_APP_ID: process.env.VITE_BASE44_APP_ID || "e2e-sanity-app",
        },
      },
});
