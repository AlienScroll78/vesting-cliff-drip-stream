import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Issue #1062 — API response snapshot tests.
 *
 * A dedicated config keeps the snapshot suite isolated from the regular unit
 * tests: it uses a deterministic Stellar SDK stub and never touches a live
 * database, Redis instance, or RPC endpoint.
 *
 * Run with:
 *   npm run test:snapshots
 *   npm run test:snapshots:update
 */
export default defineConfig({
  test: {
    include: ["tests/api-snapshots.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    // Snapshots are written to `backend/tests/__snapshots__/`.
    snapshotOptions: {
      snapshotFormat: { escapeString: false, printBasicPrototype: false },
    },
    // Keep the suite hermetic — no watch mode in CI.
    watch: false,
  },
  resolve: {
    alias: {
      "@stellar/stellar-sdk": path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "tests/mocks/stellar-sdk.ts",
      ),
    },
  },
});
