/**
 * backend/src/indexer/terminalEventHandlers.test.ts  (#997)
 *
 * Unit tests for StreamCancelled and StreamClawedBack terminal event handlers.
 * Uses mocked pg PoolClient to avoid needing a real DB.
 *
 * Tests cover:
 *   - Normal status transition (active → cancelled / clawedback)
 *   - Idempotency: terminal event on already-terminal stream (skips)
 *   - Out-of-order arrival: event for unknown recipient (defers)
 *   - Dispatch function routing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────────────

// We need to mock streamStatusService before importing terminalEventHandlers.
// The handlers use transitionStreamStatus which does a SELECT + UPDATE on pg.
// We mock it to simulate various scenarios.

const mockTransitionStreamStatus = vi.fn();
const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery } as any;

vi.mock("../streamStatusService.js", () => ({
  transitionStreamStatus: (...args: any[]) => mockTransitionStreamStatus(...args),
  StatusTransitionError: class StatusTransitionError extends Error {
    constructor(
      public readonly from: string,
      public readonly to: string,
    ) {
      super(`Invalid stream status transition: ${from} → ${to}`);
      this.name = "StatusTransitionError";
    }
  },
  StreamNotFoundError: class StreamNotFoundError extends Error {
    constructor(public readonly recipientAddress: string) {
      super(`Stream not found for recipient: ${recipientAddress}`);
      this.name = "StreamNotFoundError";
    }
  },
}));

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  })),
}));

// Import after mock is set up
import {
  handleStreamCancelled,
  handleStreamClawedBack,
  handleTerminalEvent,
} from "./terminalEventHandlers.js";
import type { DecodedStreamEvent } from "./types.js";

// ── Test data ─────────────────────────────────────────────────────────────────

const RECIPIENT = "GABC2222RECIP000000000000000000000000000000000000000000000";
const SPONSOR = "GABC1111SPONSOR000000000000000000000000000000000000000000";
const TX_HASH = "abc123def456abc123def456abc123def456abc123def456abc123def456abcd";

function makeCancelledEvent(amount = "3000"): DecodedStreamEvent {
  return {
    event_type: "StreamCancelled",
    recipient: RECIPIENT,
    sponsor: SPONSOR,
    token: "",
    amount,
    ledger_sequence: 1002,
    transaction_hash: TX_HASH,
  };
}

function makeClawedBackEvent(amount = "2500"): DecodedStreamEvent {
  return {
    event_type: "StreamClawedBack",
    recipient: RECIPIENT,
    sponsor: SPONSOR,
    token: "",
    amount,
    ledger_sequence: 1003,
    transaction_hash: TX_HASH,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the UPDATE queries in the handler succeed
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleStreamCancelled", () => {
  it("transitions active → cancelled and records details", async () => {
    mockTransitionStreamStatus.mockResolvedValueOnce({
      recipientAddress: RECIPIENT,
      fromStatus: "active",
      toStatus: "cancelled",
      statusUpdatedAt: new Date("2026-01-15T10:30:00Z"),
    });

    const ev = makeCancelledEvent("3000");
    const result = await handleStreamCancelled(mockClient, ev);

    expect(result.event_type).toBe("StreamCancelled");
    expect(result.status_changed).toBe(true);
    expect(result.from_status).toBe("active");
    expect(result.to_status).toBe("cancelled");

    // Verify transitionStreamStatus was called with correct params
    expect(mockTransitionStreamStatus).toHaveBeenCalledTimes(1);
    const callArgs = mockTransitionStreamStatus.mock.calls[0][0];
    expect(callArgs.recipientAddress).toBe(RECIPIENT);
    expect(callArgs.toStatus).toBe("cancelled");
    expect(callArgs.triggeringEvent).toBe("StreamCancelled");
    expect(callArgs.ledgerSequence).toBe(1002);

    // Verify the UPDATE query was executed
    expect(mockClientQuery).toHaveBeenCalled();
    const updateCall = mockClientQuery.mock.calls[0];
    expect(updateCall[0]).toContain("UPDATE vesting_streams");
    expect(updateCall[0]).toContain("cancelled_at");
    expect(updateCall[0]).toContain("cancelled_at_ledger");
    expect(updateCall[0]).toContain("refunded_amount");
  });

  it("skips idempotently when stream is already terminal", async () => {
    // Simulate the DB trigger / status service rejecting the transition
    const { StatusTransitionError } = await import("../streamStatusService.js");
    mockTransitionStreamStatus.mockRejectedValueOnce(
      new StatusTransitionError("cancelled", "cancelled"),
    );

    const ev = makeCancelledEvent();
    const result = await handleStreamCancelled(mockClient, ev);

    expect(result.status_changed).toBe(false);
    expect(result.from_status).toBe(null);
    // The UPDATE should NOT have been called since the transition failed
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("defers transition for out-of-order arrival (unknown recipient)", async () => {
    const { StreamNotFoundError } = await import("../streamStatusService.js");
    mockTransitionStreamStatus.mockRejectedValueOnce(
      new StreamNotFoundError(RECIPIENT),
    );

    const ev = makeCancelledEvent();
    const result = await handleStreamCancelled(mockClient, ev);

    expect(result.status_changed).toBe(false);
    // Event is still "handled" (returns a result, not throws)
    expect(result.event_type).toBe("StreamCancelled");
    // No UPDATE should have been called
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("re-throws unexpected errors", async () => {
    mockTransitionStreamStatus.mockRejectedValueOnce(new Error("DB connection lost"));

    const ev = makeCancelledEvent();
    await expect(handleStreamCancelled(mockClient, ev)).rejects.toThrow("DB connection lost");
  });
});

describe("handleStreamClawedBack", () => {
  it("transitions active → clawedback and records details", async () => {
    mockTransitionStreamStatus.mockResolvedValueOnce({
      recipientAddress: RECIPIENT,
      fromStatus: "active",
      toStatus: "clawedback",
      statusUpdatedAt: new Date("2026-01-15T11:00:00Z"),
    });

    const ev = makeClawedBackEvent("2500");
    const result = await handleStreamClawedBack(mockClient, ev);

    expect(result.event_type).toBe("StreamClawedBack");
    expect(result.status_changed).toBe(true);
    expect(result.from_status).toBe("active");
    expect(result.to_status).toBe("clawedback");

    expect(mockTransitionStreamStatus).toHaveBeenCalledTimes(1);
    const callArgs = mockTransitionStreamStatus.mock.calls[0][0];
    expect(callArgs.toStatus).toBe("clawedback");
    expect(callArgs.triggeringEvent).toBe("StreamClawedBack");

    // Verify the UPDATE query includes clawback columns
    expect(mockClientQuery).toHaveBeenCalled();
    const updateCall = mockClientQuery.mock.calls[0];
    expect(updateCall[0]).toContain("UPDATE vesting_streams");
    expect(updateCall[0]).toContain("clawed_at_ledger");
    expect(updateCall[0]).toContain("clawback_sponsor");
    expect(updateCall[0]).toContain("clawback_amount");
    expect(updateCall[0]).toContain("clawback_tx_hash");
  });

  it("skips idempotently when stream is already clawedback", async () => {
    const { StatusTransitionError } = await import("../streamStatusService.js");
    mockTransitionStreamStatus.mockRejectedValueOnce(
      new StatusTransitionError("clawedback", "clawedback"),
    );

    const ev = makeClawedBackEvent();
    const result = await handleStreamClawedBack(mockClient, ev);

    expect(result.status_changed).toBe(false);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("defers transition for out-of-order arrival", async () => {
    const { StreamNotFoundError } = await import("../streamStatusService.js");
    mockTransitionStreamStatus.mockRejectedValueOnce(
      new StreamNotFoundError(RECIPIENT),
    );

    const ev = makeClawedBackEvent();
    const result = await handleStreamClawedBack(mockClient, ev);

    expect(result.status_changed).toBe(false);
    expect(result.event_type).toBe("StreamClawedBack");
  });
});

describe("handleTerminalEvent dispatch", () => {
  it("routes StreamCancelled to handleStreamCancelled", async () => {
    mockTransitionStreamStatus.mockResolvedValueOnce({
      recipientAddress: RECIPIENT,
      fromStatus: "active",
      toStatus: "cancelled",
      statusUpdatedAt: new Date(),
    });

    const ev = makeCancelledEvent();
    const result = await handleTerminalEvent(mockClient, ev);

    expect(result).not.toBeNull();
    expect(result!.event_type).toBe("StreamCancelled");
  });

  it("routes StreamClawedBack to handleStreamClawedBack", async () => {
    mockTransitionStreamStatus.mockResolvedValueOnce({
      recipientAddress: RECIPIENT,
      fromStatus: "active",
      toStatus: "clawedback",
      statusUpdatedAt: new Date(),
    });

    const ev = makeClawedBackEvent();
    const result = await handleTerminalEvent(mockClient, ev);

    expect(result).not.toBeNull();
    expect(result!.event_type).toBe("StreamClawedBack");
  });

  it("returns null for non-terminal events", async () => {
    const ev: DecodedStreamEvent = {
      event_type: "TokensClaimed",
      recipient: RECIPIENT,
      sponsor: "",
      token: "",
      amount: "500",
      ledger_sequence: 1001,
      transaction_hash: TX_HASH,
    };

    const result = await handleTerminalEvent(mockClient, ev);
    expect(result).toBeNull();
  });
});
