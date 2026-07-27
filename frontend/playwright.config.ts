import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-freighter",
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
    // Mobile viewports (no extension needed – UI tests only)
    { name: "iphone-se",  use: { ...devices["iPhone SE"] } },
    { name: "galaxy-s21", use: { ...devices["Galaxy S21"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
