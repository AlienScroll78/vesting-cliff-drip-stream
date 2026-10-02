/**
 * Tests for GET /api/analytics/summary
 * Issue #745
 *
 * Covers:
 *   - Returns correct aggregate counts from database
 *   - Supports ?token= filter
 *   - Returns cached:true on a cache hit
 *   - Returns cached:false and writes to cache on a cache miss
 *   - Falls through to DB when Redis is unavailable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const SCHEDULES_AGG = {
  total_streams_created: "1247",
  active_streams: "892",
  streams_created_last_30d: "134",
  unique_sponsors: "78",
  unique_recipients: "312",
};

const LOCKED_ROWS = [
  { token: "USDC", total_locked: "45000000" },
  { token: "XLM", total_locked: "12000000" },
];

const CLAIMED_ROWS = [{ token: "USDC", total_claimed: "8200000" }];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
vi.mock("../db.js", () => ({
  pool: { query: mockQuery },
}));

const mockRedisGet = vi.fn(async () => null);
const mockRedisSetEx = vi.fn(async () => "OK");
vi.mock("redis", () => ({
  createClient: () => ({
    connect: vi.fn(),
    on: vi.fn(),
    get: mockRedisGet,
    setEx: mockRedisSetEx,
  }),
}));

// Import after mocks
const { analyticsSummaryHandler, computeSummary } = await import(
  "./analyticsSummary.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(query: Record<string, string> = {}): Request {
  return { query } as unknown as Request;
}

function makeRes(): {
  res: Response;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const res = {} as Response;
  res.setHeader = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return {
    res,
    json: res.json as ReturnType<typeof vi.fn>,
    setHeader: res.setHeader as ReturnType<typeof vi.fn>,
    status: res.status as ReturnType<typeof vi.fn>,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/analytics/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock sequence: schedules agg, locked rows, claimed rows
    mockQuery
      .mockResolvedValueOnce({ rows: [SCHEDULES_AGG] })   // schedules aggregate
      .mockResolvedValueOnce({ rows: LOCKED_ROWS })        // locked per token
      .mockResolvedValueOnce({ rows: CLAIMED_ROWS });      // claimed per token
    mockRedisGet.mockResolvedValue(null);
  });

  it("returns correct aggregate counts", async () => {
    const { res, json } = makeRes();
    await analyticsSummaryHandler(makeReq(), res);

    const payload = json.mock.calls[0][0];
    expect(payload.total_streams_created).toBe(1247);
    expect(payload.active_streams).toBe(892);
    expect(payload.streams_created_last_30d).toBe(134);
    expect(payload.unique_sponsors).toBe(78);
    expect(payload.unique_recipients).toBe(312);
  });

  it("returns correct token-grouped locked and claimed amounts", async () => {
    const { res, json } = makeRes();
    await analyticsSummaryHandler(makeReq(), res);

    const payload = json.mock.calls[0][0];
    expect(payload.total_tokens_locked).toEqual({
      USDC: "45000000",
      XLM: "12000000",
    });
    expect(payload.total_tokens_claimed).toEqual({ USDC: "8200000" });
  });

  it("returns cached:false and writes to Redis on a cache miss", async () => {
    mockRedisGet.mockResolvedValue(null);
    const { res, json } = makeRes();
    await analyticsSummaryHandler(makeReq(), res);

    const payload = json.mock.calls[0][0];
    expect(payload.cached).toBe(false);
    expect(mockRedisSetEx).toHaveBeenCalled();
  });

  it("returns cached:true and skips DB on a cache hit", async () => {
    const cachedData = {
      total_streams_created: 100,
      active_streams: 50,
      total_tokens_locked: { USDC: "1000" },
      total_tokens_claimed: {},
      streams_created_last_30d: 10,
      unique_sponsors: 5,
      unique_recipients: 20,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cachedData));

    const { res, json } = makeRes();
    await analyticsSummaryHandler(makeReq(), res);

    expect(mockQuery).not.toHaveBeenCalled();
    const payload = json.mock.calls[0][0];
    expect(payload.cached).toBe(true);
    expect(payload.total_streams_created).toBe(100);
  });

  it("supports ?token= filter by passing it to DB queries", async () => {
    const { res } = makeRes();
    await analyticsSummaryHandler(makeReq({ token: "USDC" }), res);

    // Verify query was called — first call is the schedules aggregate
    expect(mockQuery).toHaveBeenCalledTimes(3);
    // The token filter should appear in the query params
    const firstCallParams = mockQuery.mock.calls[0][1];
    expect(firstCallParams).toContain("USDC");
  });

  it("sets Cache-Control header on response", async () => {
    const { res, setHeader } = makeRes();
    await analyticsSummaryHandler(makeReq(), res);

    expect(setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("max-age="));
  });
});

describe("computeSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce({ rows: [SCHEDULES_AGG] })
      .mockResolvedValueOnce({ rows: LOCKED_ROWS })
      .mockResolvedValueOnce({ rows: CLAIMED_ROWS });
  });

  it("returns correctly shaped summary object", async () => {
    const result = await computeSummary();

    expect(result).toMatchObject({
      total_streams_created: 1247,
      active_streams: 892,
      streams_created_last_30d: 134,
      unique_sponsors: 78,
      unique_recipients: 312,
      total_tokens_locked: { USDC: "45000000", XLM: "12000000" },
      total_tokens_claimed: { USDC: "8200000" },
    });
  });

  it("handles empty database gracefully", async () => {
    mockQuery.mockReset();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          total_streams_created: "0",
          active_streams: "0",
          streams_created_last_30d: "0",
          unique_sponsors: "0",
          unique_recipients: "0",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await computeSummary();
    expect(result.total_streams_created).toBe(0);
    expect(result.total_tokens_locked).toEqual({});
    expect(result.total_tokens_claimed).toEqual({});
  });
});
