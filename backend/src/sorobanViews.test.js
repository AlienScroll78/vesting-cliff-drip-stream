/**
 * sorobanViews.test.js
 *
 * Verifies that each view wrapper:
 *   - returns the cached value on a cache hit (no RPC call)
 *   - calls the RPC on a cache miss and stores the result
 *   - invalidateRecipient clears the cache so the next call is a miss
 *   - cache metrics (hit/miss counters) are correct
 *
 * The Stellar SDK is fully mocked via vi.mock.
 * The cache layer uses the real in-process Map fallback (no Redis).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoist mock functions so they can be referenced inside vi.mock factories ───
// vi.mock calls are hoisted to the top of the file by vitest; any variables
// they reference must also be hoisted with vi.hoisted().

const { mockSimulateTransaction, mockScValToNative, mockAddressFromString } = vi.hoisted(() => ({
  mockSimulateTransaction: vi.fn(),
  mockScValToNative:       vi.fn(),
  mockAddressFromString:   vi.fn((addr) => ({
    toScVal: () => ({ type: "scval", addr }),
  })),
}));

// ── Environment stubs ─────────────────────────────────────────────────────────
process.env.HORIZON_URL        = "https://horizon.example.com";
process.env.NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
process.env.CONTRACT_ID        = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.ADMIN_API_KEY      = "test-admin-key";
process.env.SPONSOR_SECRET_KEY = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.SOROBAN_RPC_URL    = "https://soroban-rpc.example.com";
delete process.env.REDIS_URL;

// ── Stellar SDK mock ──────────────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", () => {
  const Keypair = {
    random: vi.fn(() => ({ publicKey: () => "GFAKEKEY" })),
  };
  const Account = vi.fn((_pk, _seq) => ({}));
  const Contract = vi.fn(() => ({
    call: vi.fn(() => ({ type: "operation" })),
  }));
  const TransactionBuilder = vi.fn(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout:   vi.fn().mockReturnThis(),
    build:        vi.fn(() => ({ type: "tx" })),
  }));
  const SorobanRpc = {
    Server: vi.fn(() => ({ simulateTransaction: mockSimulateTransaction })),
    Api: { isSimulationError: vi.fn(() => false) },
  };

  const sdkObj = {
    Keypair,
    Account,
    Contract,
    TransactionBuilder,
    SorobanRpc,
    BASE_FEE: "100",
    Address: { fromString: mockAddressFromString },
    scValToNative: (...args) => mockScValToNative(...args),
  };

  return { default: sdkObj, ...sdkObj };
});

// ── Module under test ─────────────────────────────────────────────────────────

import {
  getSchedule,
  claimableAmount,
  isCliffPassed,
  getMinDeposit,
  invalidateRecipient,
  invalidateMinDeposit,
} from "./sorobanViews.js";

import { resetCacheMetrics, getCacheMetrics, cacheInvalidate } from "./cache.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RECIPIENT = "GRECIPIENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function clearAll() {
  await cacheInvalidate(RECIPIENT);
  await cacheInvalidate("__global__");
  resetCacheMetrics();
}

// ── getSchedule ───────────────────────────────────────────────────────────────

describe("getSchedule", () => {
  beforeEach(async () => {
    await clearAll();
    mockSimulateTransaction.mockReset();
    mockScValToNative.mockReset();
  });

  it("cache miss: calls RPC and returns result", async () => {
    const fakeSchedule = { start_ledger: 100, cliff_ledger: 200, end_ledger: 300 };
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { type: "scval" } },
    });
    mockScValToNative.mockReturnValueOnce(fakeSchedule);

    const result = await getSchedule(RECIPIENT);
    expect(result).toEqual(fakeSchedule);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(getCacheMetrics().misses).toBe(1);
    expect(getCacheMetrics().hits).toBe(0);
  });

  it("cache hit: returns cached value without calling RPC", async () => {
    const fakeSchedule = { start_ledger: 1, cliff_ledger: 2, end_ledger: 3 };
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { type: "scval" } },
    });
    mockScValToNative.mockReturnValue(fakeSchedule);

    await getSchedule(RECIPIENT);        // populate cache (miss)
    mockSimulateTransaction.mockClear();
    resetCacheMetrics();

    const result = await getSchedule(RECIPIENT);  // should hit
    expect(result).toEqual(fakeSchedule);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
    expect(getCacheMetrics().hits).toBe(1);
    expect(getCacheMetrics().misses).toBe(0);
  });

  it("returns null when contract has no schedule for recipient", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: null } });
    const result = await getSchedule(RECIPIENT);
    expect(result).toBeNull();
  });

  it("invalidateRecipient clears cache — next call is a miss", async () => {
    const fakeSchedule = { start_ledger: 1 };
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { type: "scval" } },
    });
    mockScValToNative.mockReturnValue(fakeSchedule);

    await getSchedule(RECIPIENT);        // warm up
    await invalidateRecipient(RECIPIENT);
    mockSimulateTransaction.mockClear();
    resetCacheMetrics();

    await getSchedule(RECIPIENT);        // should miss
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(getCacheMetrics().misses).toBe(1);
  });
});

// ── claimableAmount ───────────────────────────────────────────────────────────

describe("claimableAmount", () => {
  beforeEach(async () => {
    await clearAll();
    mockSimulateTransaction.mockReset();
  });

  it("cache miss: calls RPC and returns bigint", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { value: () => 500 } },
    });

    const result = await claimableAmount(RECIPIENT);
    expect(result).toBe(500n);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(getCacheMetrics().misses).toBe(1);
  });

  it("cache hit: returns cached bigint without calling RPC", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { value: () => 999 } },
    });

    await claimableAmount(RECIPIENT);    // warm up
    mockSimulateTransaction.mockClear();
    resetCacheMetrics();

    const result = await claimableAmount(RECIPIENT);  // hit
    expect(result).toBe(999n);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
    expect(getCacheMetrics().hits).toBe(1);
  });

  it("returns 0n when retval is null", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: null } });
    expect(await claimableAmount(RECIPIENT)).toBe(0n);
  });
});

// ── isCliffPassed ─────────────────────────────────────────────────────────────

describe("isCliffPassed", () => {
  beforeEach(async () => {
    await clearAll();
    mockSimulateTransaction.mockReset();
    mockScValToNative.mockReset();
  });

  it("cache miss (cliff not passed): calls RPC and returns false", async () => {
    // is_cliff_passed call returns false
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { value: () => false } },
    });
    // getSchedule inner call (for TTL computation) — no schedule
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: null } });
    mockScValToNative.mockReturnValueOnce(null);

    const result = await isCliffPassed(RECIPIENT, 100);
    expect(result).toBe(false);
    expect(mockSimulateTransaction).toHaveBeenCalled();
    expect(getCacheMetrics().misses).toBeGreaterThanOrEqual(1);
  });

  it("cache hit (cliff passed): returns true without calling RPC", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { value: () => true } },
    });
    await isCliffPassed(RECIPIENT);

    mockSimulateTransaction.mockClear();
    resetCacheMetrics();

    const result = await isCliffPassed(RECIPIENT);
    expect(result).toBe(true);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
    expect(getCacheMetrics().hits).toBe(1);
  });

  it("returns false when retval is null", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: null } });
    // getSchedule inner call
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: null } });
    mockScValToNative.mockReturnValueOnce(null);

    expect(await isCliffPassed(RECIPIENT, 50)).toBe(false);
  });
});

// ── getMinDeposit ─────────────────────────────────────────────────────────────

describe("getMinDeposit", () => {
  beforeEach(async () => {
    await clearAll();
    mockSimulateTransaction.mockReset();
  });

  it("cache miss: calls RPC and returns bigint", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: { value: () => 200 } },
    });

    const result = await getMinDeposit();
    expect(result).toBe(200n);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(getCacheMetrics().misses).toBe(1);
  });

  it("cache hit: returns cached value without calling RPC", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { value: () => 150 } },
    });

    await getMinDeposit();               // warm up
    mockSimulateTransaction.mockClear();
    resetCacheMetrics();

    const result = await getMinDeposit();  // hit
    expect(result).toBe(150n);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
    expect(getCacheMetrics().hits).toBe(1);
  });

  it("returns 100n (default) when retval is null", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: null } });
    expect(await getMinDeposit()).toBe(100n);
  });

  it("invalidateMinDeposit clears cache — next call is a miss", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { value: () => 50 } },
    });

    await getMinDeposit();               // warm up
    await invalidateMinDeposit();        // evict
    mockSimulateTransaction.mockClear();
    resetCacheMetrics();

    await getMinDeposit();               // miss
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(getCacheMetrics().misses).toBe(1);
  });
});

// ── getCacheMetrics ───────────────────────────────────────────────────────────

describe("getCacheMetrics", () => {
  beforeEach(async () => {
    await clearAll();
    mockSimulateTransaction.mockReset();
  });

  it("returns zero totals after reset", () => {
    const m = getCacheMetrics();
    expect(m.total).toBe(0);
    expect(m.hitRate).toBe(0);
    expect(m.hits).toBe(0);
    expect(m.misses).toBe(0);
  });

  it("hitRate is 0 after only misses", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { value: () => 1 } },
    });
    await claimableAmount(RECIPIENT);

    const m = getCacheMetrics();
    expect(m.hits).toBe(0);
    expect(m.misses).toBe(1);
    expect(m.hitRate).toBe(0);
  });

  it("hitRate is 1 after only hits on a warm cache", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { value: () => 42 } },
    });

    await claimableAmount(RECIPIENT);   // miss (populates cache)
    resetCacheMetrics();

    await claimableAmount(RECIPIENT);   // hit

    const m = getCacheMetrics();
    expect(m.hits).toBe(1);
    expect(m.misses).toBe(0);
    expect(m.hitRate).toBe(1);
  });

  it("hitRate reflects mixed hit/miss ratio", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { value: () => 10 } },
    });

    // 1 miss then 3 hits → 75% hit rate
    await claimableAmount(RECIPIENT);
    await claimableAmount(RECIPIENT);
    await claimableAmount(RECIPIENT);
    await claimableAmount(RECIPIENT);

    const m = getCacheMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(3);
    expect(m.hitRate).toBeCloseTo(0.75);
  });
});
