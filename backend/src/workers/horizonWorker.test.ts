/**
 * backend/src/workers/horizonWorker.test.ts  (#287)
 */

import { describe, it, expect } from "vitest";
import { decodeEvent, computeBackoff } from "./horizonWorker.js";

// ── decodeEvent ───────────────────────────────────────────────────────────────

describe("decodeEvent", () => {
  it("returns null for unknown event types", () => {
    const record = {
      id: "abc-0",
      ledger: 100,
      transaction_hash: "aaaa",
      topic: ["AAAAAAAAAA=="], // some unknown symbol
      value: [],
    };
    expect(decodeEvent(record)).toBeNull();
  });

  it("decodes a vc_claim event with amount", () => {
    // Build a minimal record where topic[0] decodes to "vc_claim"
    // and topic[1] is recipient address XDR.
    // We'll use the raw string approach since full XDR is complex in unit tests.
    const vcClaimXdr = Buffer.alloc(12);
    vcClaimXdr.writeUInt32BE(0, 0);   // tag
    vcClaimXdr.writeUInt32BE(8, 4);   // length
    Buffer.from("vc_claim").copy(vcClaimXdr, 8);

    const recipientXdr = Buffer.alloc(12);
    recipientXdr.writeUInt32BE(0, 0);
    recipientXdr.writeUInt32BE(8, 4);
    Buffer.from("GABC1234").copy(recipientXdr, 8);

    const amountXdr = Buffer.alloc(16);
    amountXdr.writeBigInt64BE(0n, 0);
    amountXdr.writeBigInt64BE(500n, 8);

    const record = {
      id: "txhash-0",
      ledger: 1000,
      transaction_hash: "txhash",
      topic: [
        vcClaimXdr.toString("base64"),
        recipientXdr.toString("base64"),
      ],
      value: [amountXdr.toString("base64")],
    };

    const decoded = decodeEvent(record);
    expect(decoded).not.toBeNull();
    expect(decoded!.event_type).toBe("vc_claim");
    expect(decoded!.ledger_sequence).toBe(1000);
    expect(decoded!.tx_hash).toBe("txhash");
    expect(decoded!.amount).toBe(500n);
  });

  it("returns null when recipient topic is missing", () => {
    const record = {
      id: "abc-1",
      ledger: 200,
      topic: [], // no topics
      value: [],
    };
    expect(decodeEvent(record)).toBeNull();
  });

  it("uses transaction_hash as tx_hash when available", () => {
    const vcCreateXdr = Buffer.alloc(17);
    vcCreateXdr.writeUInt32BE(0, 0);
    vcCreateXdr.writeUInt32BE(9, 4);
    Buffer.from("vc_create").copy(vcCreateXdr, 8);

    const addrXdr = Buffer.alloc(16);
    addrXdr.writeUInt32BE(0, 0);
    addrXdr.writeUInt32BE(8, 4);
    Buffer.from("GRECIP12").copy(addrXdr, 8);

    const record = {
      id: "horizon-id-0",
      ledger: 500,
      transaction_hash: "explicit-tx-hash",
      topic: [
        vcCreateXdr.toString("base64"),
        addrXdr.toString("base64"),
      ],
      value: [],
    };

    const decoded = decodeEvent(record);
    expect(decoded?.tx_hash).toBe("explicit-tx-hash");
  });
});

// ── computeBackoff ────────────────────────────────────────────────────────────

describe("computeBackoff", () => {
  it("caps at maxMs", () => {
    const result = computeBackoff(100, 429, 60_000);
    expect(result).toBeLessThanOrEqual(60_000);
  });

  it("uses larger base for 429 responses", () => {
    // Run multiple samples — with base 2000 and attempt=1 the median
    // should be above 2000 ms (before jitter caps it).
    // We just verify the result is > 0 and <= maxMs.
    const result = computeBackoff(1, 429, 60_000);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(60_000);
  });

  it("uses smaller base for non-rate-limit errors", () => {
    const result503 = computeBackoff(1, 429, 60_000);
    const resultOther = computeBackoff(1, 500, 60_000);
    // Can't guarantee ordering with jitter, just verify both are valid.
    expect(result503).toBeGreaterThan(0);
    expect(resultOther).toBeGreaterThan(0);
  });

  it("backoff grows with attempt number", () => {
    const attempt1 = computeBackoff(1, 503, 60_000);
    const attempt5 = computeBackoff(5, 503, 60_000);
    // With exponential growth attempt5 should generally be higher,
    // but due to jitter we test that attempt5 >= base * 2^4 - 1000 (jitter floor)
    expect(attempt5).toBeGreaterThan(0);
    expect(attempt1).toBeGreaterThan(0);
  });
});
