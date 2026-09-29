import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/resilience/**/*.test.ts"],
  },
});
