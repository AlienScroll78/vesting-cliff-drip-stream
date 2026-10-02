import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Run sequentially to avoid vite/esbuild worker crash on Windows
    // (pre-existing environment issue — esbuild binary crashes under concurrent transforms)
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
