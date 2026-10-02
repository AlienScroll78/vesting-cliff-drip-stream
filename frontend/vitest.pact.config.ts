/**
 * Vitest config dedicated to Pact consumer tests.
 *
 * Pact's mock server binds real TCP ports, so tests must run in a Node
 * environment (not jsdom) and sequentially (no parallelism) to avoid port
 * conflicts.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Run pact tests serially — each test starts its own mock provider on a
    // random port; parallel execution can cause port-binding races.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    include: ["src/pact/**/*.pact.test.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
