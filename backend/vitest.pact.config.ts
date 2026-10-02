/**
 * Vitest config for Pact provider verification.
 *
 * The provider test starts a real HTTP server in beforeAll/afterAll, so we
 * run in a single fork with a generous timeout.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.pact.provider.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
