import { defineConfig } from "vitest/config";

/**
 * Vitest config for WebSocket E2E tests (#788).
 *
 * Intentionally separate from the main vitest.config.ts so that:
 *   - Coverage thresholds for the main suite are not affected.
 *   - The WS E2E suite can be run independently in CI on every PR.
 *   - No database or Redis services are required (publishEvent() is called
 *     directly; @stellar/stellar-sdk and config/network are vi.mock()'d).
 *
 * Usage:
 *   cd backend && npx vitest run --config vitest.ws-e2e.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/ws-e2e/**/*.test.ts"],
    testTimeout: 15000,   // generous timeout for the 50-client scenario
    hookTimeout: 10000,
    // Run scenarios sequentially so each has its own clean server instance.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
