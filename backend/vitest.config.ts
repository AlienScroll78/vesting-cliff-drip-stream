import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Default test suite: exclude pact provider tests (they need a live mock
    // server started by beforeAll) to keep `npm test` fast.
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.pact.provider.test.ts"],
  },
});
