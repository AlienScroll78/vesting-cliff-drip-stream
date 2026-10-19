import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const baseOrigin = new URL(baseURL).origin;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseOrigin,
          localStorage: [
            { name: "vesting_intro_complete", value: "true" },
            { name: "vesting_onboarding_complete", value: "true" },
          ],
        },
      ],
    },
  },
  projects: [
    // ── Chromium with Freighter extension (requires real extension & seed) ──
    {
      name: "chromium-freighter",
      // Only run extension tests when FREIGHTER_SEED is set
      testMatch: ["**/wallet.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        // Load Freighter extension from fixture path
        launchOptions: {
          args: [
            `--disable-extensions-except=${process.env.FREIGHTER_EXT_PATH ?? "./e2e/fixtures/freighter"}`,
            `--load-extension=${process.env.FREIGHTER_EXT_PATH ?? "./e2e/fixtures/freighter"}`,
          ],
          headless: false, // Extensions require headed mode; use --headless=new via env
        },
        contextOptions: {
          // Grant clipboard permissions used by Freighter
          permissions: ["clipboard-read", "clipboard-write"],
        },
      },
    },

    // ── Chromium without extension – wallet mocked via addInitScript ────────
    // All lifecycle tests and walletMock-based tests run here.
    {
      name: "chromium-mock",
      testMatch: [
        "**/lifecycle*.spec.ts",
        "**/claim-sheet.spec.ts",
        "**/badges.spec.ts",
        "**/create-wizard.spec.ts",
        "**/onboarding.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // --headless=new is compatible with Playwright and works in CI
          args: process.env.CI ? ["--headless=new"] : [],
        },
        contextOptions: {
          permissions: ["clipboard-read", "clipboard-write"],
        },
      },
    },

    // ── Mobile viewports (no extension needed – UI tests only) ──────────────
    {
      name: "iphone-se",
      testMatch: ["**/claim-sheet.spec.ts", "**/badges.spec.ts"],
      use: { ...devices["iPhone SE"] },
    },
    {
      name: "galaxy-s21",
      testMatch: ["**/claim-sheet.spec.ts"],
      use: { ...devices["Galaxy S21"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
