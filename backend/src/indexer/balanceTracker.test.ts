/**
 * backend/src/indexer/balanceTracker.test.ts  (#996)
 *
 * Unit tests for the stream balance tracker.
 * Uses mocked pg Pool/PoolClient to avoid needing a real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock pg ───────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockClient = { query: mockQuery, release: mockRelease };
const mockConnect = vi.fn(async () => mockClient);

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
    connect: mockConnect,
    end: vi.fn(),
  })),
}));

// Import after mock is set up
import {
  incrementClaimedTotal,
  initStreamBalance,
  getStreamBalance,
  recomputeBalance,
} from "./balanceTracker.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

const STREAM_ID = "GABC2222RECIP000000000000000000000000000000000000000000000";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("incrementClaimedTotal", () => {
  it("upserts the balance row with the claim amount", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ claimed_total: "750", remaining: "4250" }],
      rowCount: 1,
    });

    const result = await incrementClaimedTotal(
      mockClient as any,
      STREAM_ID,
      "750",
    );

    expect(result.stream_id).toBe(STREAM_ID);
    expect(result.claimed_total).toBe("750");
    expect(result.remaining).toBe("4250");

    // Verify the SQL contains ON CONFLICT for idempotent upsert
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("stream_balances");
  });
});

describe("initStreamBalance", () => {
  it("inserts a new balance row with total_deposit and raw fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await initStreamBalance(
      mockClient as any,
      STREAM_ID,
      "5000",
      "10",
      500,
    );

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO stream_balances");
    expect(sql).toContain("ON CONFLICT");
    expect(params).toEqual([STREAM_ID, "5000", "10", 500]);
  });
});

describe("getStreamBalance", () => {
  it("returns null when no balance row exists", async () => {
    const mockPool = { query: vi.fn(async () => ({ rows: [] })) };

    const result = await getStreamBalance(mockPool as any, STREAM_ID);
    expect(result).toBeNull();
  });

  it("returns the balance when a row exists", async () => {
    const mockPool = {
      query: vi.fn(async () => ({
        rows: [
          {
            stream_id: STREAM_ID,
            total_deposit: "5000",
            claimed_total: "750",
            remaining: "4250",
            rate: "10",
            total_duration: 500,
            updated_at: "2026-01-15T10:30:00Z",
          },
        ],
      })),
    };

    const result = await getStreamBalance(mockPool as any, STREAM_ID);

    expect(result).not.toBeNull();
    expect(result!.stream_id).toBe(STREAM_ID);
    expect(result!.total_deposit).toBe("5000");
    expect(result!.claimed_total).toBe("750");
    expect(result!.remaining).toBe("4250");
    expect(result!.rate).toBe("10");
    expect(result!.total_duration).toBe(500);
  });
});

describe("recomputeBalance", () => {
  it("recomputes from stream_events and updates the balance row", async () => {
    const mockPool = {
      query: vi.fn(),
    };

    // 1. Sum of vc_claim events
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total_claimed: "1500" }] })
      // 2. Fetch total_deposit from balance row
      .mockResolvedValueOnce({ rows: [{ total_deposit: "5000" }] })
      // 3. Update the balance row
      .mockResolvedValueOnce({ rows: [] })
      // 4. Read back the result
      .mockResolvedValueOnce({
        rows: [{ claimed_total: "1500", remaining: "3500" }],
      });

    const result = await recomputeBalance(mockPool as any, STREAM_ID);

    expect(result).not.toBeNull();
    expect(result!.stream_id).toBe(STREAM_ID);
    expect(result!.claimed_total).toBe("1500");
    expect(result!.remaining).toBe("3500");

    // Verify the sum query was called with the recipient
    const sumCall = mockPool.query.mock.calls[0];
    expect(sumCall[0]).toContain("SUM(amount::numeric)");
    expect(sumCall[1]).toEqual([STREAM_ID]);
  });

  it("creates a balance row when none exists", async () => {
    const mockPool = {
      query: vi.fn(),
    };

    // 1. Sum of vc_claim events
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total_claimed: "300" }] })
      // 2. No balance row exists
      .mockResolvedValueOnce({ rows: [] })
      // 3. INSERT ... ON CONFLICT to create the row
      .mockResolvedValueOnce({ rows: [] })
      // 4. Read back the result
      .mockResolvedValueOnce({
        rows: [{ claimed_total: "300", remaining: "-300" }],
      });

    const result = await recomputeBalance(mockPool as any, STREAM_ID);

    expect(result).not.toBeNull();
    expect(result!.claimed_total).toBe("300");
  });
});
