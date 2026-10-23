"use strict";

/**
 * Tests for contract-version.js — issue #567
 *
 * Covers:
 *  - getContractVersion returns a ledger-{sequence} string
 *  - checkContractVersion: version match passes
 *  - checkContractVersion: mismatch throws when ALLOW_VERSION_MISMATCH is false
 *  - checkContractVersion: mismatch is allowed when ALLOW_VERSION_MISMATCH is true
 *  - checkContractVersion: skips check when EXPECTED_CONTRACT_VERSION is not set
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk (via lib.js) before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("./lib.js", () => {
  const getLatestLedger = vi.fn().mockResolvedValue({ sequence: 42000 });
  return {
    StellarSdk: {
      SorobanRpc: {
        Server: vi.fn().mockImplementation(() => ({ getLatestLedger })),
      },
    },
    loadConfig: vi.fn(),
  };
});

// Import the lib mock so we can reconfigure getLatestLedger per test.
const libMock = await import("./lib.js");
const mockGetLatestLedger = libMock.StellarSdk.SorobanRpc.Server.mock.results[0]?.value?.getLatestLedger
  ?? vi.fn().mockResolvedValue({ sequence: 42000 });

// Helper: rebuild a fresh Server instance mock each test
function setLedgerSequence(seq) {
  // Every `new StellarSdk.SorobanRpc.Server(...)` call returns an object
  // whose getLatestLedger we control via mockImplementation on the class.
  libMock.StellarSdk.SorobanRpc.Server.mockImplementation(() => ({
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: seq }),
  }));
}

// Import after mocks are set up.
const { getContractVersion, checkContractVersion, _resetCache } = await import("./contract-version.js");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides = {}) {
  return {
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    expectedContractVersion: "",
    allowVersionMismatch: false,
    ...overrides,
  };
}

function makeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getContractVersion", () => {
  beforeEach(() => {
    _resetCache();
    setLedgerSequence(42000);
  });

  it("returns a ledger-{sequence} string", async () => {
    const version = await getContractVersion(makeConfig());
    expect(version).toBe("ledger-42000");
  });

  it("caches the result within the TTL window", async () => {
    const first = await getContractVersion(makeConfig());

    // Change the sequence so we can detect whether a new RPC call was made.
    setLedgerSequence(99999);

    const second = await getContractVersion(makeConfig());
    expect(second).toBe(first); // served from cache
  });
});

describe("checkContractVersion", () => {
  beforeEach(() => {
    _resetCache();
    setLedgerSequence(55000);
  });

  it("returns the version string when expectedContractVersion is empty (check skipped)", async () => {
    const config = makeConfig({ expectedContractVersion: "" });
    const logger = makeLogger();
    const result = await checkContractVersion(config, logger);
    expect(result).toBe("ledger-55000");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns the version string when versions match", async () => {
    const config = makeConfig({ expectedContractVersion: "ledger-55000" });
    const logger = makeLogger();
    const result = await checkContractVersion(config, logger);
    expect(result).toBe("ledger-55000");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws when versions mismatch and allowVersionMismatch is false", async () => {
    const config = makeConfig({
      expectedContractVersion: "ledger-11111",
      allowVersionMismatch: false,
    });
    const logger = makeLogger();
    await expect(checkContractVersion(config, logger)).rejects.toThrow(
      /Contract version mismatch/,
    );
    expect(logger.error).toHaveBeenCalledOnce();
    const [obj, msg] = logger.error.mock.calls[0];
    expect(obj.event).toBe("contract_version_mismatch");
    expect(obj.expected).toBe("ledger-11111");
    expect(obj.actual).toBe("ledger-55000");
    expect(msg).toMatch(/mismatch/i);
  });

  it("returns the actual version and warns when mismatch but allowVersionMismatch is true", async () => {
    const config = makeConfig({
      expectedContractVersion: "ledger-11111",
      allowVersionMismatch: true,
    });
    const logger = makeLogger();
    const result = await checkContractVersion(config, logger);
    expect(result).toBe("ledger-55000");
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
    const [obj] = logger.warn.mock.calls[0];
    expect(obj.event).toBe("contract_version_mismatch");
  });

  it("supports legacy uppercase config keys (EXPECTED_CONTRACT_VERSION)", async () => {
    // Some callers may pass the raw process.env-shaped object.
    const config = {
      SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
      EXPECTED_CONTRACT_VERSION: "ledger-55000",
      ALLOW_VERSION_MISMATCH: false,
    };
    const logger = makeLogger();
    const result = await checkContractVersion(config, logger);
    expect(result).toBe("ledger-55000");
    expect(logger.error).not.toHaveBeenCalled();
  });
});
