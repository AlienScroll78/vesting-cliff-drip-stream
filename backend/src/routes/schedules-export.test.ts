/**
 * Tests for the schedules export handler.
 * Issue #297 — CSV and JSON export endpoints for stream data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SPONSOR = "GSPONSOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const SAMPLE_ROWS = [
  {
    recipient_address: "GREC1111111111XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    token_address: "CTOK1111111111XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    rate_per_ledger: "10",
    cliff_ledger: 1000,
    end_ledger: 10000,
    total_deposit: "90000",
    total_claimed: "4500",
    status: "active",
  },
  {
    recipient_address: "GREC2222222222XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    token_address: "CTOK2222222222XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    rate_per_ledger: "20",
    cliff_ledger: 2000,
    end_ledger: 20000,
    total_deposit: "360000",
    total_claimed: "36000",
    status: "completed",
  },
];

// ── Mocks — must be declared before any imports that use them ─────────────────

const mockDbQuery = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

vi.mock("../db.js", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: mockDbQuery,
      release: vi.fn(),
    })),
  },
}));

vi.mock("../redisClient.js", () => ({
  createRedisClient: vi.fn(async () => ({
    get: mockRedisGet,
    set: mockRedisSet,
  })),
}));

vi.mock("./auth.js", () => ({
  authMiddleware: vi.fn(),
}));

// Dynamic import after mocks are registered
const { exportHandler } = await import("./schedules-export.js");

// ── Test helpers ──────────────────────────────────────────────────────────────

type MockRes = {
  res: Response;
  written: string[];
  statusCode: number;
  headers: Record<string, string>;
  ended: boolean;
};

function makeReq(
  sponsor: string | null,
  query: Record<string, string> = {},
): Request {
  const base: Record<string, unknown> = { query, headers: {} };
  if (sponsor !== null) base.user = { address: sponsor };
  return base as unknown as Request;
}

function makeRes(): MockRes {
  const mock: MockRes = {
    res: {} as Response,
    written: [],
    statusCode: 200,
    headers: {},
    ended: false,
  };

  // status(code) — records the code and returns res for chaining
  mock.res.status = vi.fn(function (this: Response, code: number) {
    mock.statusCode = code;
    return this;
  }) as any;

  // json(body) — records the serialized body
  mock.res.json = vi.fn(function (this: Response, body: unknown) {
    mock.written.push(JSON.stringify(body));
    return this;
  }) as any;

  mock.res.setHeader = vi.fn(function (this: Response, key: string, value: string) {
    mock.headers[key.toLowerCase()] = value;
    return this;
  }) as any;

  mock.res.write = vi.fn(function (this: Response, chunk: string) {
    mock.written.push(chunk);
    return true;
  }) as any;

  mock.res.end = vi.fn(function (this: Response) {
    mock.ended = true;
    return this;
  }) as any;

  return mock;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("exportHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  it("returns 401 when req.user is not set", async () => {
    const mock = makeRes();
    await exportHandler(makeReq(null, { format: "json" }), mock.res);
    expect(mock.statusCode).toBe(401);
    expect(mock.written.join("")).toContain("Unauthorized");
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  it("returns 400 for unknown format", async () => {
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "xml" }), mock.res);
    expect(mock.statusCode).toBe(400);
  });

  it("returns 400 when `from` is not a valid date", async () => {
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json", from: "not-a-date" }), mock.res);
    expect(mock.statusCode).toBe(400);
    expect(mock.written.join("")).toContain("from must be");
  });

  it("returns 400 when `to` is not a valid date", async () => {
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json", to: "not-a-date" }), mock.res);
    expect(mock.statusCode).toBe(400);
    expect(mock.written.join("")).toContain("to must be");
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────────

  it("returns 429 when a rate-limit key exists in Redis", async () => {
    mockRedisGet.mockResolvedValue("1");
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    expect(mock.statusCode).toBe(429);
  });

  it("sets a rate-limit key in Redis after a successful export", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining(SPONSOR),
      "1",
      expect.objectContaining({ EX: 60 }),
    );
  });

  // ── JSON export ───────────────────────────────────────────────────────────────

  it("returns an empty JSON array when there are no rows", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    expect(mock.headers["content-type"]).toMatch(/application\/json/);
    expect(mock.headers["content-disposition"]).toMatch(/attachment/);
    expect(mock.written.join("")).toBe("[]");
  });

  it("returns a populated JSON array for multiple rows", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: SAMPLE_ROWS })
      .mockResolvedValueOnce({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    const output = mock.written.join("");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].recipient_address).toBe(SAMPLE_ROWS[0].recipient_address);
    expect(parsed[1].status).toBe("completed");
  });

  it("Content-Disposition filename ends with .json", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    expect(mock.headers["content-disposition"]).toMatch(/\.json/);
  });

  // ── CSV export ────────────────────────────────────────────────────────────────

  it("returns correct Content-Type for CSV", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "csv" }), mock.res);
    expect(mock.headers["content-type"]).toMatch(/text\/csv/);
  });

  it("CSV output starts with the correct header row", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "csv" }), mock.res);
    const firstLine = mock.written.join("").split("\n")[0];
    expect(firstLine).toBe(
      "recipient_address,token_address,rate_per_ledger,cliff_ledger,end_ledger,total_deposit,total_claimed,status",
    );
  });

  it("CSV output contains one data row per stream", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: SAMPLE_ROWS })
      .mockResolvedValueOnce({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "csv" }), mock.res);
    const lines = mock.written.join("").split("\n").filter(Boolean);
    // header + 2 data rows
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(SAMPLE_ROWS[0].recipient_address);
    expect(lines[2]).toContain(SAMPLE_ROWS[1].total_deposit);
  });

  it("Content-Disposition filename ends with .csv", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "csv" }), mock.res);
    expect(mock.headers["content-disposition"]).toMatch(/\.csv/);
  });

  // ── Date filters ──────────────────────────────────────────────────────────────

  it("passes from/to ISO strings to the DB query", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    await exportHandler(
      makeReq(SPONSOR, { format: "json", from: "2025-01-01", to: "2025-12-31" }),
      makeRes().res,
    );
    const callArgs = mockDbQuery.mock.calls[0][1] as unknown[];
    expect(callArgs[1]).toBe(new Date("2025-01-01").toISOString());
    expect(callArgs[2]).toBe(new Date("2025-12-31").toISOString());
  });

  it("passes null when from/to are absent", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    await exportHandler(makeReq(SPONSOR, { format: "json" }), makeRes().res);
    const callArgs = mockDbQuery.mock.calls[0][1] as unknown[];
    expect(callArgs[1]).toBeNull();
    expect(callArgs[2]).toBeNull();
  });

  // ── Streaming / pagination ────────────────────────────────────────────────────

  it("stops paginating when a batch smaller than BATCH_SIZE is returned", async () => {
    const makeBatch = (size: number) =>
      Array.from({ length: size }, (_, i) => ({ ...SAMPLE_ROWS[0], recipient_address: `R${i}` }));

    // 499 rows < 500 (BATCH_SIZE) → stops after first call, no second call
    mockDbQuery.mockResolvedValueOnce({ rows: makeBatch(499) });

    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(mock.written.join(""));
    expect(parsed).toHaveLength(499);
  });

  it("fetches multiple full batches until an empty batch terminates the loop", async () => {
    const makeBatch = (size: number) =>
      Array.from({ length: size }, (_, i) => ({ ...SAMPLE_ROWS[0], recipient_address: `R${i}` }));

    mockDbQuery
      .mockResolvedValueOnce({ rows: makeBatch(500) }) // full batch → continue
      .mockResolvedValueOnce({ rows: makeBatch(300) }) // partial → stop
      // NOTE: because 300 < BATCH_SIZE, the loop stops here without a 3rd call

    const mock = makeRes();
    await exportHandler(makeReq(SPONSOR, { format: "json" }), mock.res);
    const parsed = JSON.parse(mock.written.join(""));
    expect(parsed).toHaveLength(800);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});
