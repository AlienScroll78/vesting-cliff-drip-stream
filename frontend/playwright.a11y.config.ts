import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.A11Y_PORT ?? 4321);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /accessibility-audit\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : [["list"], ["json", { outputFile: "test-results/a11y-summary.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
