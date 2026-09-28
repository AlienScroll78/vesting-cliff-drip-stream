import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.js", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      lines: 90,
      functions: 85,
      branches: 80,
      statements: 90,
      include: ["src/**/*.ts", "src/**/*.js"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.js", "src/tracing.js"],
    },
  },
});
