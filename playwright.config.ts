import { defineConfig, devices, type ReporterDescription } from "@playwright/test";
import { E2E_BUILD_ENV } from "./e2e/build-env";

/**
 * Sanity e2e suite: UI, API, security and accessibility, run across desktop web,
 * iOS (WebKit / iPhone) and Android (Chromium / Pixel).
 *
 * There is no native app in this repo — "iOS" and "Android" mean the mobile web
 * experience, exercised through Playwright's real device descriptors (viewport,
 * user agent, touch, DPR) on the matching engine: WebKit for Safari on iOS,
 * Chromium for Chrome on Android.
 *
 * The suite is hermetic: the bundle is built with production's configuration
 * (e2e/build-env.ts) but pointed at a Supabase host that does not exist, and
 * e2e/fixtures/app.ts answers that host at the network layer — so it runs
 * without credentials and without touching production data. Point
 * PLAYWRIGHT_BASE_URL at a deployment to smoke-test it instead.
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
  // Two workers in CI, and this number is measured rather than chosen.
  //
  // Four was tried on 2026-09-13 and was worse on every leg: web-webkit went
  // 9m22 → 11m52 and then failed, ios-safari 8m15 → 9m50, web-chromium
  // 4m20 → 4m44. A standard GitHub runner has two cores, so a third and fourth
  // browser do not get a core — they get a share of one, and everything slows
  // down together.
  //
  // The failure that followed is worth recognising: an a11y test timed out
  // waiting 10s for `#root` to stop being empty, on all three attempts. That is
  // not a broken assertion, it is the app not finishing its boot inside the
  // budget because four WebKit instances were fighting for two cores.
  //
  // "Then give it more cores" was tested too, and does not rescue it. On a
  // 12-core machine on 2026-09-15, web-chromium ran:
  //
  //   2 workers  35.7s     8 workers  25.1s
  //   4 workers  23.0s    10 workers  31.8s
  //   6 workers  23.6s    12 workers  34.2s
  //
  // The curve bottoms out at 4–6 and climbs from there, with six cores still
  // idle. These tests are not CPU-bound — they are a browser waiting on a page
  // — and crowding them makes every one of them slower. So this number is not
  // the lever it looks like, in CI or out of it.
  //
  // The lever that does work is more runners, not more workers per runner: CI
  // splits each platform with `--shard`, which buys two real cores per shard.
  // See the sharding note in .github/workflows/ci.yml.
  //
  // `undefined` locally means Playwright's own default, half the core count —
  // 6 on a 12-core machine, which is where the curve above already bottoms out.
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

  // A block that belongs to one kind of device is tagged, and the other kind
  // never collects it. It used to be `test.skip(({ isMobile }) => …)` at the top
  // of the describe, which Playwright runs as a hook: allure-playwright reports
  // every such skip as a failed hook, and the report carried 38 "Global Errors"
  // reading "skip modifier failed: Test is skipped: mobile projects only".
  //
  // Only web-chromium is `default`, so a bare `npx playwright test` is the
  // quick local loop. The other three run only when selected: every
  // `npm run test:e2e*` script and scripts/run-tests.sh pass `--project=*` (or
  // name theirs), and CI's matrix passes `--project` on every leg.
  projects: [
    {
      name: "web-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      grepInvert: /@mobile-only/,
    },
    {
      name: "web-webkit",
      default: false,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
      grepInvert: /@mobile-only/,
    },
    {
      // iOS Safari — WebKit with the iPhone 14 device descriptor.
      name: "ios-safari",
      default: false,
      use: { ...devices["iPhone 14"] },
      grepInvert: /@desktop-only/,
    },
    {
      // Android Chrome — Chromium with the Pixel 7 device descriptor.
      name: "android-chrome",
      default: false,
      use: { ...devices["Pixel 7"] },
      grepInvert: /@desktop-only/,
    },
  ],

  // Serve the real production build, so the e2e run also proves the bundle boots.
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        // --host 127.0.0.1: vite preview otherwise binds ::1 only, which the
        // baseURL health check cannot reach.
        command: [
          skipBuild ? null : "npm run build:e2e",
          `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
        ]
          .filter(Boolean)
          .join(" && "),
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        // The build's environment is e2e/build-env.ts, applied by `npm run
        // build:e2e`. Given to the preview server as well, so it sees the same
        // environment as the build. This suite is hermetic because e2e/fixtures/app.ts answers the
        // fake Supabase host the bundle calls; a request that slipped past it
        // has to fail, not create a real lead and send real email.
        //
        // Once SKIP_BUILD=1 (scripts/run-tests.sh, CI) the bundle is already
        // sealed — Vite inlines `import.meta.env.*` at build time — and nothing
        // here can change what it calls.
        env: { ...E2E_BUILD_ENV },
      },
});
