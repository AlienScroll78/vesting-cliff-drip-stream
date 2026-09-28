/**
 * backend/src/jobs/jobQueue.test.ts  (#568)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Redis client ─────────────────────────────────────────────────────────

// The mock must be declared before any import of the module under test so
// Vitest's module-level hoisting applies.
vi.mock("../redisClient.js", () => ({
  createRedisClient: vi.fn(),
}));

// Import after mocks are registered.
const { createRedisClient } = await import("../redisClient.js");
const {
  enqueueJob,
  getJob,
  updateJobStatus,
  isValidJobType,
  JOB_TYPES,
} = await import("./jobQueue.js");

// ── Redis mock factory ────────────────────────────────────────────────────────

/** In-memory store used by all mock redis operations in a single test. */
function makeMockRedis() {
  const store = new Map<string, string>();

  return {
    store,
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    lPush: vi.fn(async () => 1),
    brPop: vi.fn(async () => null),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("enqueueJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a non-empty string id", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("db_vacuum", {});
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("stores the job in Redis with the correct type and status", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("export_stream_report", { foo: "bar" });

    // The set call receives (key, serialisedJob, options)
    const setCall = mockRedis.set.mock.calls[0];
    expect(setCall[0]).toBe(`job:${id}`);

    const stored = JSON.parse(setCall[1] as string);
    expect(stored.id).toBe(id);
    expect(stored.type).toBe("export_stream_report");
    expect(stored.status).toBe("pending");
    expect(stored.payload).toEqual({ foo: "bar" });
  });

  it("pushes the job id onto the job_queue list", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("bulk_webhook_retry", null);

    expect(mockRedis.lPush).toHaveBeenCalledWith("job_queue", id);
  });

  it("sets TTL to 604800 seconds", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    await enqueueJob("backfill_ledger_range", {});

    const setCall = mockRedis.set.mock.calls[0];
    // Third argument is { EX: 604800 }
    expect(setCall[2]).toEqual({ EX: 604_800 });
  });
});

describe("getJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for a nonexistent id", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const result = await getJob("does-not-exist");
    expect(result).toBeNull();
  });

  it("returns the stored job when it exists", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("db_vacuum", { tables: ["streams"] });
    const job = await getJob(id);

    expect(job).not.toBeNull();
    expect(job!.id).toBe(id);
    expect(job!.type).toBe("db_vacuum");
    expect(job!.status).toBe("pending");
    expect(job!.payload).toEqual({ tables: ["streams"] });
  });

  it("returns null when Redis returns malformed JSON", async () => {
    const mockRedis = makeMockRedis();
    mockRedis.get = vi.fn(async () => "not-valid-json");
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const result = await getJob("any-id");
    expect(result).toBeNull();
  });
});

describe("updateJobStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the status field of a stored job", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("bulk_webhook_retry", {});
    await updateJobStatus(id, "running");

    const updated = await getJob(id);
    expect(updated!.status).toBe("running");
  });

  it("stores result when provided", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("export_stream_report", {});
    await updateJobStatus(id, "completed", { rows: 42 });

    const updated = await getJob(id);
    expect(updated!.status).toBe("completed");
    expect(updated!.result).toEqual({ rows: 42 });
  });

  it("stores error message when provided", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("db_vacuum", {});
    await updateJobStatus(id, "failed", undefined, "connection refused");

    const updated = await getJob(id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("connection refused");
  });

  it("does not throw when the job does not exist", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    // Should resolve without throwing.
    await expect(
      updateJobStatus("ghost-id", "completed")
    ).resolves.toBeUndefined();
  });

  it("refreshes updatedAt timestamp", async () => {
    const mockRedis = makeMockRedis();
    vi.mocked(createRedisClient).mockResolvedValue(mockRedis as any);

    const id = await enqueueJob("backfill_ledger_range", {});
    const before = (await getJob(id))!.updatedAt;

    // Ensure at least 1 ms passes.
    await new Promise((r) => setTimeout(r, 2));
    await updateJobStatus(id, "running");

    const after = (await getJob(id))!.updatedAt;
    expect(new Date(after) >= new Date(before)).toBe(true);
  });
});

describe("isValidJobType", () => {
  it("returns true for all defined job types", () => {
    for (const type of JOB_TYPES) {
      expect(isValidJobType(type)).toBe(true);
    }
  });

  it("returns false for an unknown string", () => {
    expect(isValidJobType("unknown_type")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isValidJobType(null)).toBe(false);
    expect(isValidJobType(42)).toBe(false);
    expect(isValidJobType(undefined)).toBe(false);
    expect(isValidJobType({})).toBe(false);
  });
});
