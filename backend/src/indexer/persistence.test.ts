/**
 * Test suite for persistence.ts — Stream event indexer persistence layer
 *
 * Tests cover:
 *   - Cursor read/write operations
 *   - Event upsert idempotency (ON CONFLICT DO NOTHING)
 *   - StreamDrained event state transitions
 *   - StreamCancelled event state transitions
 *   - Transaction rollback on errors
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import {
  readCursor,
  writeCursor,
  upsertStreamEvents,
} from "./persistence.js";
import type { DecodedStreamEvent } from "./types.js";

// Mock Pool and Client
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: vi.fn(),
} as unknown as Pool;

describe("persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cursor operations", () => {
    it("should read cursor from indexer_cursors", async () => {
      const mockCursor = "test-cursor-abc123";
      mockPool.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cursor: mockCursor }] });

      const cursor = await readCursor(mockPool);

      expect(cursor).toBe(mockCursor);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT cursor FROM indexer_cursors")
      );
    });

    it("should return empty string when no cursor exists", async () => {
      mockPool.query = vi.fn().mockResolvedValueOnce({ rows: [] });

      const cursor = await readCursor(mockPool);

      expect(cursor).toBe("");
    });

    it("should write cursor to indexer_cursors", async () => {
      mockPool.query = vi.fn().mockResolvedValueOnce({});

      await writeCursor(mockPool, "new-cursor-xyz789");

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE indexer_cursors"),
        ["new-cursor-xyz789"]
      );
    });
  });

  describe("event upsert", () => {
    it("should insert events in a transaction", async () => {
      const events: DecodedStreamEvent[] = [
        {
          event_type: "StreamCreated",
          recipient: "GABC123",
          sponsor: "GXYZ789",
          token: "CTOKEN01",
          amount: "1000000",
          ledger_sequence: 100,
          transaction_hash: "hash001",
        },
      ];

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
        .mockResolvedValueOnce({}); // COMMIT

      const inserted = await upsertStreamEvents(mockPool, events);

      expect(inserted).toBe(1);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO stream_events"),
        expect.arrayContaining([
          "StreamCreated",
          "GABC123",
          "GXYZ789",
          "CTOKEN01",
          "1000000",
        ])
      );
    });

    it("should handle duplicate events idempotently (ON CONFLICT DO NOTHING)", async () => {
      const events: DecodedStreamEvent[] = [
        {
          event_type: "TokensClaimed",
          recipient: "GABC123",
          sponsor: "",
          token: "",
          amount: "50000",
          ledger_sequence: 200,
          transaction_hash: "hash002",
        },
      ];

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }) // INSERT (duplicate, no rows inserted)
        .mockResolvedValueOnce({}); // COMMIT

      const inserted = await upsertStreamEvents(mockPool, events);

      expect(inserted).toBe(0); // No rows inserted due to conflict
    });

    it("should rollback on transaction error", async () => {
      const events: DecodedStreamEvent[] = [
        {
          event_type: "StreamCancelled",
          recipient: "GABC123",
          sponsor: "",
          token: "",
          amount: "100000",
          ledger_sequence: 150,
          transaction_hash: "hash003",
        },
      ];

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error("DB error")) // INSERT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(upsertStreamEvents(mockPool, events)).rejects.toThrow(
        "DB error"
      );

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    });

    it("should update stream status for StreamDrained events", async () => {
      const events: DecodedStreamEvent[] = [
        {
          event_type: "StreamDrained",
          recipient: "GABC123",
          sponsor: "GDRAIN001",
          token: "CTOKEN01",
          amount: "500000",
          ledger_sequence: 300,
          transaction_hash: "hash_drain_001",
        },
      ];

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // INSERT event
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE vesting_streams status
        .mockResolvedValueOnce({}); // COMMIT

      const inserted = await upsertStreamEvents(mockPool, events);

      expect(inserted).toBe(1);

      // Verify UPDATE was called for StreamDrained
      const updateCalls = mockClient.query.mock.calls.filter((call: any) =>
        call[0]?.includes("UPDATE vesting_streams")
      );
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][0]).toContain("status = 'drained'");
    });

    it("should handle empty event batch", async () => {
      const inserted = await upsertStreamEvents(mockPool, []);

      expect(inserted).toBe(0);
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it("should return count of actually inserted rows", async () => {
      const events: DecodedStreamEvent[] = [
        {
          event_type: "StreamCreated",
          recipient: "GABC123",
          sponsor: "GSPONS01",
          token: "CTOKEN01",
          amount: "1000000",
          ledger_sequence: 100,
          transaction_hash: "hash_new_001",
        },
        {
          event_type: "StreamCreated",
          recipient: "GABC124",
          sponsor: "GSPONS02",
          token: "CTOKEN02",
          amount: "2000000",
          ledger_sequence: 101,
          transaction_hash: "hash_new_002",
        },
      ];

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // First INSERT
        .mockResolvedValueOnce({ rowCount: 1 }) // Second INSERT
        .mockResolvedValueOnce({}); // COMMIT

      const inserted = await upsertStreamEvents(mockPool, events);

      expect(inserted).toBe(2);
    });
  });

  describe("StreamDrained state transitions", () => {
    it("should mark stream as drained and record drain details", async () => {
      const drainEvent: DecodedStreamEvent = {
        event_type: "StreamDrained",
        recipient: "GRECIPIENT01",
        sponsor: "GDRAIN_CALLER",
        token: "CTOKEN01",
        amount: "750000",
        ledger_sequence: 500,
        transaction_hash: "drain_tx_hash_001",
      };

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // INSERT into stream_events
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE vesting_streams
        .mockResolvedValueOnce({}); // COMMIT

      const inserted = await upsertStreamEvents(mockPool, [drainEvent]);

      expect(inserted).toBe(1);

      // Verify the UPDATE query sets all drain fields correctly
      const updateQuery = mockClient.query.mock.calls.find((call: any) =>
        call[0]?.includes("UPDATE vesting_streams")
      );

      expect(updateQuery).toBeDefined();
      expect(updateQuery[0]).toContain("status = 'drained'");
      expect(updateQuery[0]).toContain("drained_at = now()");
      expect(updateQuery[0]).toContain("drain_amount = $1");
      expect(updateQuery[0]).toContain("drain_tx_hash = $2");
      expect(updateQuery[0]).toContain("drained_by = $3");

      // Check parameters
      expect(updateQuery[1]).toEqual([
        "750000", // amount
        "drain_tx_hash_001", // tx_hash
        "GDRAIN_CALLER", // drained_by (sponsor field)
        "GRECIPIENT01", // recipient_address
      ]);
    });

    it("should be idempotent for duplicate drain events", async () => {
      const drainEvent: DecodedStreamEvent = {
        event_type: "StreamDrained",
        recipient: "GRECIPIENT02",
        sponsor: "GDRAIN_CALLER",
        token: "CTOKEN01",
        amount: "1000000",
        ledger_sequence: 510,
        transaction_hash: "drain_tx_hash_002",
      };

      mockClient.query = vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }) // INSERT into stream_events (duplicate)
        .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE vesting_streams (already drained)
        .mockResolvedValueOnce({}); // COMMIT

      const inserted = await upsertStreamEvents(mockPool, [drainEvent]);

      expect(inserted).toBe(0); // No new events inserted (idempotent)
    });
  });
});
