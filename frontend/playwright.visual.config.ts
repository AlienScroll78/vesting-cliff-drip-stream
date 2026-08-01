/**
 * Playwright configuration for visual regression tests.
 *
 * Separate from the main playwright.config.ts so visual tests run
 * independently from functional e2e tests and don't require the Freighter
 * extension.
 *
 * Run:
 *   npm run test:visual              # compare against committed baselines
 *   npm run test:visual:update       # regenerate baselines (intentional changes)
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/visual",

  // Visual tests are inherently order-independent; run in parallel for speed
  fullyParallel: true,

  // Never allow .only() to slip into CI
  forbidOnly: !!process.env.CI,

  // No retries for visual tests – a flaky snapshot means the test is fragile
  retries: 0,

  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "off",

    // Disable animations so screenshots are deterministic
    reducedMotion: "reduce",
  },

  // ── Snapshot settings ──────────────────────────────────────────────────────
  // Fail CI when any pixel differs more than 0.1 % of total pixels.
  // maxDiffPixelRatio is 0–1 (fraction of total pixels); 0.001 = 0.1 %.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      // Allow up to 5 per-pixel colour delta (0–255 per channel) before
      // counting a pixel as "different".  Avoids false positives from
      // sub-pixel anti-aliasing while still catching real changes.
      threshold: 0.05,
      animations: "disabled",
    },
  },

  // Snapshot files live alongside the spec, namespaced by project
  snapshotPathTemplate:
    "{testDir}/__snapshots__/{testFilePath}/{projectName}/{arg}{ext}",

  projects: [
    // ── Desktop: 1280 × 800 (Chromium) ────────────────────────────────────
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        // Chromium-only: consistent font rendering across CI runners
        launchOptions: {
          args: [
            "--font-render-hinting=none",
            "--disable-skia-runtime-opts",
          ],
        },
      },
    },
    // ── Mobile: 375 × 667 (Chromium device emulation) ─────────────────────
    // Using Chromium for mobile emulation rather than WebKit to avoid
    // WebKit-specific launch flag incompatibilities in headless mode.
    // The viewport and touch emulation faithfully represent iPhone SE.
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        // Same font-rendering flags as desktop
        launchOptions: {
          args: [
            "--font-render-hinting=none",
            "--disable-skia-runtime-opts",
          ],
        },
      },
    },
  ],

  webServer: {
    // The React app is served by the Vite dev server.
    // In CI the workflow pre-builds and starts `npm run preview` (port 4173);
    // set BASE_URL=http://localhost:4173 to reuse that server.
    // Locally `npm run dev` is used (port 3000).
    command: "npm run dev",
    url: process.env.BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
