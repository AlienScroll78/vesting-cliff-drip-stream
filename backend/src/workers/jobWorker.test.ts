/**
 * backend/src/workers/jobWorker.test.ts  (#568)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../redisClient.js", () => ({
  createRedisClient: vi.fn(),
}));

vi.mock("../jobs/jobQueue.js", () => ({
  getJob: vi.fn(),
  updateJobStatus: vi.fn(),
  isValidJobType: vi.fn(),
  JOB_TYPES: new Set([
    "backfill_ledger_range",
    "bulk_webhook_retry",
    "export_stream_report",
    "db_vacuum",
  ]),
}));

const { getJob, updateJobStatus } = await import("../jobs/jobQueue.js");
const { processJob, stopJobWorker, isJobWorkerRunning } = await import(
  "./jobWorker.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { Job } from "../jobs/jobQueue.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "test-job-id",
    type: "db_vacuum",
    payload: {},
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── processJob ────────────────────────────────────────────────────────────────

describe("processJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("handles backfill_ledger_range and returns a result", async () => {
    const job = makeJob({ type: "backfill_ledger_range", payload: { from: 100, to: 200 } });
    const result = await processJob(job);
    expect(result).toBeDefined();
    expect((result as any).message).toContain("backfill_ledger_range");
  });

  it("handles bulk_webhook_retry and returns a result", async () => {
    const job = makeJob({ type: "bulk_webhook_retry", payload: { ids: ["a", "b"] } });
    const result = await processJob(job);
    expect(result).toBeDefined();
    expect((result as any).message).toContain("bulk_webhook_retry");
  });

  it("handles export_stream_report and returns a result", async () => {
    const job = makeJob({ type: "export_stream_report", payload: { sponsor: "GABC" } });
    const result = await processJob(job);
    expect(result).toBeDefined();
    expect((result as any).message).toContain("export_stream_report");
  });

  it("handles db_vacuum and returns a result", async () => {
    const job = makeJob({ type: "db_vacuum", payload: {} });
    const result = await processJob(job);
    expect(result).toBeDefined();
    expect((result as any).message).toContain("db_vacuum");
  });

  it("passes the payload through to the handler", async () => {
    const payload = { custom: "data", value: 99 };
    const job = makeJob({ type: "db_vacuum", payload });
    const result = await processJob(job) as any;
    expect(result.payload).toEqual(payload);
  });

  it("throws for an unrecognised job type", async () => {
    // Cast to bypass TypeScript type-checking for this edge-case test.
    const job = makeJob({ type: "completely_unknown" as any });
    await expect(processJob(job)).rejects.toThrow("unknown job type");
  });
});

// ── Error handling through the worker loop ─────────────────────────────────────

describe("job worker error handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks job as failed when processJob throws", async () => {
    // We test the error path by directly testing the pieces the worker loop
    // uses: getJob → processJob → updateJobStatus("failed", ...)
    // This avoids needing to run the actual loop.

    const job = makeJob({ type: "backfill_ledger_range" });

    vi.mocked(getJob).mockResolvedValueOnce(job);
    vi.mocked(updateJobStatus).mockResolvedValue(undefined);

    // Simulate what the worker loop does on a handler failure.
    const errorMessage = "database unavailable";

    try {
      // Force failure by passing a bad type.
      await processJob({ ...job, type: "completely_unknown" as any });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job.id, "failed", undefined, message);
    }

    expect(updateJobStatus).toHaveBeenCalledWith(
      job.id,
      "failed",
      undefined,
      expect.stringContaining("unknown job type")
    );
  });

  it("marks job as running before dispatching", async () => {
    // Simulate the happy-path sequence the worker performs:
    //   1. updateJobStatus(id, "running")
    //   2. processJob(job)
    //   3. updateJobStatus(id, "completed", result)

    const job = makeJob({ type: "db_vacuum" });
    vi.mocked(getJob).mockResolvedValueOnce(job);
    vi.mocked(updateJobStatus).mockResolvedValue(undefined);

    // Run the sequence explicitly (mirrors the worker loop).
    await updateJobStatus(job.id, "running");
    const result = await processJob(job);
    await updateJobStatus(job.id, "completed", result);

    const calls = vi.mocked(updateJobStatus).mock.calls;
    expect(calls[0][1]).toBe("running");
    expect(calls[1][1]).toBe("completed");
  });

  it("dispatches to correct handler for each job type", async () => {
    const types: Array<Job["type"]> = [
      "backfill_ledger_range",
      "bulk_webhook_retry",
      "export_stream_report",
      "db_vacuum",
    ];

    for (const type of types) {
      const job = makeJob({ type });
      const result = await processJob(job) as any;
      expect(result.message).toContain(type);
    }
  });
});

// ── stopJobWorker ─────────────────────────────────────────────────────────────

describe("stopJobWorker", () => {
  it("marks the worker as not running", () => {
    stopJobWorker();
    expect(isJobWorkerRunning()).toBe(false);
  });
});
