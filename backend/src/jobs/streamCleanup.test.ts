import { describe, it, expect } from "vitest";
import { runStreamCleanup } from "../jobs/streamCleanup.js";

describe("runStreamCleanup", () => {
  it("returns rowsArchived=0 when there are no stale streams", async () => {
    const result = await runStreamCleanup();
    expect(result.rowsArchived).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a numeric durationMs", async () => {
    const result = await runStreamCleanup();
    expect(typeof result.durationMs).toBe("number");
  });
});
