/**
 * Tests for issue #1022:
 *   - SACTokenSelector pure helpers (truncateAddress, validateSACAddress,
 *     readPersistedToken, persistToken)
 *   - Updated useWalletBalances mapping + refresh-interval constant
 *
 * All tests are pure functions or fetch mocks — no React required.
 * Run with: cd frontend && npx vitest run src/components/SACTokenSelector.test.ts
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  truncateAddress,
  validateSACAddress,
  readPersistedToken,
  persistToken,
} from "./SACTokenSelector";
import {
  mapHorizonBalances,
  BALANCE_REFRESH_INTERVAL_MS,
} from "@/hooks/useWalletBalances";

// ── truncateAddress ───────────────────────────────────────────────────────────

describe("truncateAddress", () => {
  test("returns short addresses unchanged", () => {
    expect(truncateAddress("native")).toBe("native");
  });

  test("truncates long addresses with ellipsis in the middle", () => {
    const addr = "CABC123456789DEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFG";
    const result = truncateAddress(addr, 6);
    expect(result).toMatch(/^.{6}….{6}$/);
  });

  test("starts with first 6 chars of input", () => {
    const addr = "CABC123456789XXXXXYYYYY";
    const result = truncateAddress(addr, 6);
    expect(result.startsWith("CABC12")).toBe(true);
  });

  test("ends with last 6 chars of input", () => {
    const addr = "CABC123456789XXXXXYYYYY";
    const result = truncateAddress(addr, 6);
    expect(result.endsWith("YYYYY")).toBe(true);
  });

  test("uses default 6-char width", () => {
    const addr = "G".repeat(56); // typical Stellar pubkey length
    const result = truncateAddress(addr);
    expect(result).toBe("GGGGGG…GGGGGG");
  });

  test("contains the ellipsis character", () => {
    const addr = "C" + "A".repeat(50);
    const result = truncateAddress(addr, 4);
    expect(result).toContain("…");
  });

  test("custom chars=4 truncates correctly", () => {
    const addr = "ABCDEFGHIJKLMNOP";
    const result = truncateAddress(addr, 4);
    expect(result).toBe("ABCD…MNOP");
  });
});

// ── validateSACAddress ────────────────────────────────────────────────────────

describe("validateSACAddress", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns true when API responds { valid: true }", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true }),
    } as Response);

    const result = await validateSACAddress("CABC123", "http://api");
    expect(result).toBe(true);
  });

  test("returns false when API responds { valid: false }", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false }),
    } as Response);

    const result = await validateSACAddress("NOT_A_SAC", "http://api");
    expect(result).toBe(false);
  });

  test("returns false when API returns non-ok status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const result = await validateSACAddress("CABC123", "http://api");
    expect(result).toBe(false);
  });

  test("returns false on network error", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));
    const result = await validateSACAddress("CABC123", "http://api");
    expect(result).toBe(false);
  });

  test("returns false for empty string without calling fetch", async () => {
    const result = await validateSACAddress("", "http://api");
    expect(result).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("returns false for whitespace-only input without calling fetch", async () => {
    const result = await validateSACAddress("   ", "http://api");
    expect(result).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("encodes the contract address in the query string", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true }),
    } as Response);

    await validateSACAddress("C/SPECIAL+ADDR", "http://api");
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain(encodeURIComponent("C/SPECIAL+ADDR"));
  });

  test("uses the provided apiBase", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true }),
    } as Response);

    await validateSACAddress("CABC", "https://custom.api");
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(calledUrl.startsWith("https://custom.api")).toBe(true);
  });
});

// ── readPersistedToken / persistToken ─────────────────────────────────────────

describe("persistToken / readPersistedToken", () => {
  const STORAGE_KEY = "sac_token_selector_last_token";

  beforeEach(() => {
    localStorage.clear();
  });

  test("persistToken saves value to localStorage", () => {
    persistToken("CABC:GDEF");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("CABC:GDEF");
  });

  test("readPersistedToken retrieves the saved value", () => {
    localStorage.setItem(STORAGE_KEY, "USDC:GISSUER");
    expect(readPersistedToken()).toBe("USDC:GISSUER");
  });

  test("readPersistedToken returns null when nothing is stored", () => {
    expect(readPersistedToken()).toBeNull();
  });

  test("persistToken does NOT store empty string", () => {
    persistToken("");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("persistToken does NOT store the __custom__ sentinel", () => {
    persistToken("__custom__");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("overwrites a previously saved value", () => {
    persistToken("FIRST:GAAA");
    persistToken("SECOND:GBBB");
    expect(readPersistedToken()).toBe("SECOND:GBBB");
  });
});

// ── mapHorizonBalances (re-tested here to confirm the exported function) ──────

describe("mapHorizonBalances (useWalletBalances export)", () => {
  test("maps native XLM", () => {
    const result = mapHorizonBalances([{ asset_type: "native", balance: "42.0" }]);
    expect(result).toEqual([{ assetCode: "XLM", contractAddress: "native", balance: "42.0" }]);
  });

  test("maps credit_alphanum4 token", () => {
    const result = mapHorizonBalances([
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        balance: "500.0",
      },
    ]);
    expect(result[0]!.assetCode).toBe("USDC");
    expect(result[0]!.contractAddress).toBe(
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );
  });

  test("maps credit_alphanum12 token", () => {
    const result = mapHorizonBalances([
      {
        asset_type: "credit_alphanum12",
        asset_code: "LONGTOKEN",
        asset_issuer: "GBBB",
        balance: "100.0",
      },
    ]);
    expect(result[0]!.assetCode).toBe("LONGTOKEN");
    expect(result[0]!.contractAddress).toBe("LONGTOKEN:GBBB");
  });

  test("filters out liquidity_pool_shares", () => {
    const result = mapHorizonBalances([
      { asset_type: "liquidity_pool_shares", balance: "1.0" },
      { asset_type: "native", balance: "5.0" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.assetCode).toBe("XLM");
  });

  test("returns empty array for empty input", () => {
    expect(mapHorizonBalances([])).toEqual([]);
  });
});

// ── BALANCE_REFRESH_INTERVAL_MS ───────────────────────────────────────────────

describe("BALANCE_REFRESH_INTERVAL_MS", () => {
  test("is exactly 30,000 ms (30 seconds)", () => {
    expect(BALANCE_REFRESH_INTERVAL_MS).toBe(30_000);
  });
});

// ── isOverAllocated (pure logic extracted for testing) ────────────────────────

/** Pure extraction of the over-allocation check from SACTokenSelector */
function isOverAllocated(
  balances: { contractAddress: string; balance: string }[],
  selectedContract: string,
  depositAmount: number,
): boolean {
  const found = balances.find((b) => b.contractAddress === selectedContract);
  if (!found || depositAmount <= 0) return false;
  return parseFloat(found.balance) < depositAmount;
}

describe("over-allocation guard (SACTokenSelector)", () => {
  const balances = [
    { contractAddress: "native", balance: "100.0000000" },
    { contractAddress: "USDC:GABC", balance: "500.0000000" },
  ];

  test("returns false when deposit is within balance", () => {
    expect(isOverAllocated(balances, "native", 50)).toBe(false);
  });

  test("returns true when deposit exceeds balance", () => {
    expect(isOverAllocated(balances, "native", 200)).toBe(true);
  });

  test("returns false when deposit equals balance exactly", () => {
    expect(isOverAllocated(balances, "native", 100)).toBe(false);
  });

  test("returns false when deposit is 0", () => {
    expect(isOverAllocated(balances, "native", 0)).toBe(false);
  });

  test("returns false for an unknown custom address", () => {
    expect(isOverAllocated(balances, "CUSTOM:GXYZ", 999)).toBe(false);
  });

  test("works for non-native token", () => {
    expect(isOverAllocated(balances, "USDC:GABC", 600)).toBe(true);
    expect(isOverAllocated(balances, "USDC:GABC", 500)).toBe(false);
  });
});
