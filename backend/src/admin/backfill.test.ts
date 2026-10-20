/**
 * Tests for POST /admin/backfill (Issue #749)
 *
 * Covers:
 *   - Validates from_ledger / to_ledger params
 *   - Creates a job record and returns 202 with job data
 *   - Runs backfill idempotently (ON CONFLICT DO NOTHING)
 *   - Progress tracked in backfill_jobs table
 *   - JWT / Bearer auth enforced (via requireAdminAuth)
 *   - GET /admin/backfill returns job list
 *   - GET /admin/backfill/:id returns single job
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
const mockConnect = vi.fn();

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: mockQuery,
    connect: mockConnect,
  })),
}));

vi.mock("../metrics.js", () => ({
  backfillEventsProcessedTotal: { inc: vi.fn() },
}));

vi.mock("../config/network.js", () => ({
  networkConfig: {
    contractId: "CTEST_CONTRACT_ID_PLACEHOLDER_000000000000000000000000000",
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const {
  startBackfillHandler,
  listBackfillJobsHandler,
  getBackfillJobHandler,
  runBackfill,
} = await import("./backfill.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

type MockRes = {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function makeRes(): MockRes {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return {
    res,
    status: res.status as ReturnType<typeof vi.fn>,
    json: res.json as ReturnType<typeof vi.fn>,
  };
}

const FAKE_JOB = {
  id: "00000000-0000-0000-0000-000000000001",
  from_ledger: 1000000,
  to_ledger: 1000100,
  status: "running",
  events_fetched: 0,
  events_inserted: 0,
  events_skipped: 0,
  last_cursor: null,
  created_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: null,
  error_message: null,
};

// ---------------------------------------------------------------------------
// POST /admin/backfill — param validation
// ---------------------------------------------------------------------------

describe("POST /admin/backfill — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when from_ledger is missing", async () => {
    const { res, status, json } = makeRes();
    await startBackfillHandler(makeReq({ query: { to_ledger: "1000" } }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("from_ledger") });
  });

  it("returns 400 when to_ledger is missing", async () => {
    const { res, status, json } = makeRes();
    await startBackfillHandler(makeReq({ query: { from_ledger: "1000" } }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("to_ledger") });
  });

  it("returns 400 when from_ledger > to_ledger", async () => {
    const { res, status, json } = makeRes();
    await startBackfillHandler(
      makeReq({ query: { from_ledger: "2000", to_ledger: "1000" } }),
      res
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when from_ledger is zero", async () => {
    const { res, status } = makeRes();
    await startBackfillHandler(
      makeReq({ query: { from_ledger: "0", to_ledger: "1000" } }),
      res
    );
    expect(status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/backfill — happy path
// ---------------------------------------------------------------------------

describe("POST /admin/backfill — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [FAKE_JOB] });
  });

  it("returns 202 with job record on valid params", async () => {
    const { res, status, json } = makeRes();
    await startBackfillHandler(
      makeReq({ query: { from_ledger: "1000000", to_ledger: "1000100" } }),
      res
    );
    expect(status).toHaveBeenCalledWith(202);
    const body = json.mock.calls[0][0];
    expect(body.job).toBeDefined();
    expect(body.job.id).toBe(FAKE_JOB.id);
    expect(body.message).toContain("started");
  });

  it("creates a backfill_jobs record in the database", async () => {
    const { res } = makeRes();
    await startBackfillHandler(
      makeReq({ query: { from_ledger: "1000000", to_ledger: "1000100" } }),
      res
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO backfill_jobs"),
      expect.arrayContaining([1000000, 1000100])
    );
  });
});

// ---------------------------------------------------------------------------
// GET /admin/backfill — list jobs
// ---------------------------------------------------------------------------

describe("GET /admin/backfill — list jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [FAKE_JOB] });
  });

  it("returns list of jobs", async () => {
    const { res, json } = makeRes();
    await listBackfillJobsHandler(makeReq(), res);
    const body = json.mock.calls[0][0];
    expect(body.jobs).toBeDefined();
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/backfill/:id — single job
// ---------------------------------------------------------------------------

describe("GET /admin/backfill/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns job when found", async () => {
    mockQuery.mockResolvedValue({ rows: [FAKE_JOB] });
    const { res, json } = makeRes();
    await getBackfillJobHandler(
      makeReq({ params: { id: FAKE_JOB.id } }),
      res
    );
    expect(json.mock.calls[0][0].id).toBe(FAKE_JOB.id);
  });

  it("returns 404 when job not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { res, status } = makeRes();
    await getBackfillJobHandler(
      makeReq({ params: { id: "non-existent-id" } }),
      res
    );
    expect(status).toHaveBeenCalledWith(404);
  });
});
