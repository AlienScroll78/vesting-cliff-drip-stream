import { describe, it, expect } from "vitest";
import { isDepositOverflow, ledgersToDuration, I128_MAX } from "./useWizard";

describe("isDepositOverflow", () => {
  it("returns false for small values", () => {
    expect(isDepositOverflow(10, 172_800)).toBe(false);
  });

  it("returns false for a value well within i128 range", () => {
    // rate=10, total=1_000_000 → 10M, trivially within i128
    expect(isDepositOverflow(10, 1_000_000)).toBe(false);
  });

  it("returns true when rate * total exceeds i128::MAX", () => {
    // Use a rate that forces overflow with a large total
    // i128::MAX ≈ 1.7e38; two large numbers easily overflow
    const bigRate  = Number(I128_MAX) / 2 + 1;
    const bigTotal = 3;
    expect(isDepositOverflow(bigRate, bigTotal)).toBe(true);
  });

  it("returns false for zero rate", () => {
    expect(isDepositOverflow(0, 172_800)).toBe(false);
  });

  it("returns false for zero duration", () => {
    expect(isDepositOverflow(10, 0)).toBe(false);
  });
});

describe("ledgersToDuration", () => {
  it("converts seconds", () => {
    expect(ledgersToDuration(10)).toBe("50s"); // 10 / 0.2 = 50s
  });

  it("converts minutes", () => {
    expect(ledgersToDuration(120)).toBe("10m"); // 120 / 0.2 = 600s = 10m
  });

  it("converts hours", () => {
    expect(ledgersToDuration(720)).toBe("1h"); // 720 / 0.2 = 3600s = 1h
  });

  it("converts days (~1 day = 17280 ledgers)", () => {
    expect(ledgersToDuration(17_280)).toBe("1d");
  });

  it("converts years (~1 year = 6307200 ledgers)", () => {
    // 365 * 86400 / 5 = 6307200
    const oneYear = Math.round((365 * 86400) / 5);
    const result = ledgersToDuration(oneYear);
    expect(result).toMatch(/yr/);
  });
});
