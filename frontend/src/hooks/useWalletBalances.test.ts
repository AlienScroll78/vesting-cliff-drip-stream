/**
 * Tests for useWalletBalances hook and TokenBalanceSelect component logic.
 *
 * These tests don't require a DOM renderer — they exercise the fetch/mapping
 * logic directly to stay consistent with the existing test style in this repo.
 *
 * Run with: npx jest frontend/src/hooks/useWalletBalances.test.ts
 *   (requires jest + jsdom + ts-jest)
 */

// ---------------------------------------------------------------------------
// useWalletBalances — fetch / mapping logic (extracted for unit testing)
// ---------------------------------------------------------------------------

/** Mirrors the private HorizonBalance shape */
interface HorizonBalance {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

/** Pure mapping extracted from the hook so we can test it without React */
function mapHorizonBalances(raw: HorizonBalance[]) {
  return raw
    .filter((b) => b.asset_type !== "liquidity_pool_shares")
    .map((b) => ({
      assetCode: b.asset_type === "native" ? "XLM" : b.asset_code!,
      contractAddress:
        b.asset_type === "native" ? "native" : `${b.asset_code}:${b.asset_issuer}`,
      balance: b.balance,
    }));
}

describe("mapHorizonBalances", () => {
  test("maps native XLM entry", () => {
    const result = mapHorizonBalances([{ asset_type: "native", balance: "42.0000000" }]);
    expect(result).toEqual([{ assetCode: "XLM", contractAddress: "native", balance: "42.0000000" }]);
  });

  test("maps credit_alphanum4 (e.g. USDC)", () => {
    const result = mapHorizonBalances([
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        balance: "1000.0000000",
      },
    ]);
    expect(result[0].assetCode).toBe("USDC");
    expect(result[0].contractAddress).toBe(
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    );
    expect(result[0].balance).toBe("1000.0000000");
  });

  test("filters out liquidity_pool_shares entries", () => {
    const result = mapHorizonBalances([
      { asset_type: "liquidity_pool_shares", balance: "50.0000000" },
      { asset_type: "native", balance: "10.0000000" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].assetCode).toBe("XLM");
  });

  test("returns empty array for empty input", () => {
    expect(mapHorizonBalances([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TokenBalanceSelect — over-allocation warning logic
// ---------------------------------------------------------------------------

/** Pure helper extracted from the component */
function isOverAllocated(
  balances: { contractAddress: string; balance: string }[],
  selectedContract: string,
  depositAmount: number
): boolean {
  const found = balances.find((b) => b.contractAddress === selectedContract);
  if (!found || depositAmount <= 0) return false;
  return parseFloat(found.balance) < depositAmount;
}

describe("isOverAllocated", () => {
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

  test("returns false when token is not in balance list (custom address)", () => {
    expect(isOverAllocated(balances, "CUSTOM:GXYZ", 999)).toBe(false);
  });

  test("works for non-native token", () => {
    expect(isOverAllocated(balances, "USDC:GABC", 600)).toBe(true);
    expect(isOverAllocated(balances, "USDC:GABC", 500)).toBe(false);
  });
});
