/**
 * backend/src/routes/jobs.test.ts  (#568)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../redisClient.js", () => ({
  createRedisClient: vi.fn(),
}));

vi.mock("../jobs/jobQueue.js", () => ({
  enqueueJob: vi.fn(),
  getJob: vi.fn(),
  isValidJobType: vi.fn((v: unknown) => {
    const valid = new Set([
      "backfill_ledger_range",
      "bulk_webhook_retry",
      "export_stream_report",
      "db_vacuum",
    ]);
    return typeof v === "string" && valid.has(v);
  }),
}));

const { enqueueJob, getJob } = await import("../jobs/jobQueue.js");

// We test the router handlers by calling them directly through a minimal
// Express app to avoid spinning up a real server.
import express from "express";
import request from "supertest";
import { jobsRouter } from "./jobs.js";

const app = express();
app.use(express.json());
app.use(jobsRouter);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sampleJob(id: string, overrides = {}) {
  return {
    id,
    type: "db_vacuum",
    payload: {},
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── POST /jobs ─────────────────────────────────────────────────────────────────

describe("POST /jobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 201 with jobId for a valid type", async () => {
    vi.mocked(enqueueJob).mockResolvedValue("test-uuid-1234");

    const res = await request(app)
      .post("/jobs")
      .send({ type: "db_vacuum", payload: { tables: ["streams"] } })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body.jobId).toBe("test-uuid-1234");
    expect(enqueueJob).toHaveBeenCalledWith("db_vacuum", { tables: ["streams"] });
  });

  it("returns 201 with jobId for all valid job types", async () => {
    const types = [
      "backfill_ledger_range",
      "bulk_webhook_retry",
      "export_stream_report",
      "db_vacuum",
    ];

    for (const type of types) {
      vi.mocked(enqueueJob).mockResolvedValue(`job-${type}`);

      const res = await request(app)
        .post("/jobs")
        .send({ type, payload: {} })
        .set("Content-Type", "application/json");

      expect(res.status).toBe(201);
      expect(res.body.jobId).toBe(`job-${type}`);
    }
  });

  it("returns 400 when type is missing", async () => {
    const res = await request(app)
      .post("/jobs")
      .send({ payload: {} })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required field: type/i);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid job type", async () => {
    const res = await request(app)
      .post("/jobs")
      .send({ type: "invalid_type", payload: {} })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid job type/i);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("returns 400 for a null type", async () => {
    const res = await request(app)
      .post("/jobs")
      .send({ type: null, payload: {} })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("returns 500 when enqueueJob throws", async () => {
    vi.mocked(enqueueJob).mockRejectedValue(new Error("Redis down"));

    const res = await request(app)
      .post("/jobs")
      .send({ type: "db_vacuum", payload: {} })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to enqueue job/i);
  });

  it("enqueues with null payload when payload is not provided", async () => {
    vi.mocked(enqueueJob).mockResolvedValue("no-payload-id");

    const res = await request(app)
      .post("/jobs")
      .send({ type: "db_vacuum" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(enqueueJob).toHaveBeenCalledWith("db_vacuum", null);
  });
});

// ── GET /jobs/:id ─────────────────────────────────────────────────────────────

describe("GET /jobs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with the job object when found", async () => {
    const job = sampleJob("found-id", { status: "completed" });
    vi.mocked(getJob).mockResolvedValue(job as any);

    const res = await request(app).get("/jobs/found-id");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("found-id");
    expect(res.body.status).toBe("completed");
    expect(getJob).toHaveBeenCalledWith("found-id");
  });

  it("returns 404 when the job does not exist", async () => {
    vi.mocked(getJob).mockResolvedValue(null);

    const res = await request(app).get("/jobs/no-such-id");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns the full job object including all fields", async () => {
    const now = new Date().toISOString();
    const job = sampleJob("full-job", {
      type: "export_stream_report",
      status: "running",
      payload: { sponsor: "GABC" },
      createdAt: now,
      updatedAt: now,
    });
    vi.mocked(getJob).mockResolvedValue(job as any);

    const res = await request(app).get("/jobs/full-job");

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("export_stream_report");
    expect(res.body.status).toBe("running");
    expect(res.body.payload).toEqual({ sponsor: "GABC" });
  });

  it("returns 500 when getJob throws", async () => {
    vi.mocked(getJob).mockRejectedValue(new Error("Redis unavailable"));

    const res = await request(app).get("/jobs/error-id");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to retrieve job/i);
  });
});
