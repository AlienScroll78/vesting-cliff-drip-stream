import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    // Run against the built app served locally.  In CI, set CYPRESS_BASE_URL.
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:4173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    // Keep artifacts for debugging
    screenshotsFolder: "cypress/screenshots",
    videosFolder: "cypress/videos",
    // Performance target: all 6 specs must finish in < 2 minutes
    defaultCommandTimeout: 8_000,
    responseTimeout: 15_000,
    // Viewport consistent with the app's mobile-first breakpoint
    viewportWidth: 1280,
    viewportHeight: 800,
    // Retry flaky tests once before failing (helps with async rendering)
    retries: {
      runMode: 1,
      openMode: 0,
    },
    // Attach coverage data if instrumentation is enabled
    env: {
      codeCoverage: {
        url: "/api/__coverage__",
      },
    },
    setupNodeEvents(on, config) {
      // Coverage collection (requires @cypress/code-coverage plugin)
      // Enabled automatically when the plugin is installed in CI
      return config;
    },
  },
  component: {
    devServer: {
      framework: "react",
      bundler: "vite",
    },
  },
});
