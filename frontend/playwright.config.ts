// playwright.config.ts
// Cross-browser Playwright configuration (closes #364)
//
// Runs all core user journeys against Chromium, Firefox, and WebKit.
// CI matrix is expected to run all three browsers in parallel.
// Flaky tests auto-retry up to 2 times before marking as failed.
// Target total run time: < 10 minutes across all browsers.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",

  /* Run each test file in parallel within a project */
  fullyParallel: true,

  /* Fail the build on CI if test.only is accidentally left in source */
  forbidOnly: !!process.env.CI,

  /* Auto-retry flaky tests up to 2 times before marking as failed (#364) */
  retries: process.env.CI ? 2 : 0,

  /* Limit parallel workers to keep CI run time under 10 minutes */
  workers: process.env.CI ? 4 : undefined,

  /* Reporters */
  reporter: [
    ["list"],
    // Always emit an HTML report; in CI, also emit JUnit for the test matrix
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ...(process.env.CI
      ? [["junit", { outputFile: "test-results/results.xml" }] as const]
      : []),
  ],

  /* Shared settings for all projects */
  use: {
    /* Base URL so tests can use `page.goto('/')` */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",

    /* Collect traces on first retry to aid flaky-test diagnosis */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video on first retry */
    video: "on-first-retry",
  },

  /* Artifact output directory */
  outputDir: "test-results",

  // ── Browser projects (#364) ───────────────────────────────────────────────

  projects: [
    // ── Setup project (shared auth / wallet state) ─────────────────────────
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    // ── Chromium ───────────────────────────────────────────────────────────
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Persist auth state between tests in the same project
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // ── Firefox ────────────────────────────────────────────────────────────
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // ── WebKit (Safari) ───────────────────────────────────────────────────
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // ── Mobile Chrome (for accessibility mobile-viewport scan, #362) ───────
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
