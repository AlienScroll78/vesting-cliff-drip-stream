/**
 * Unit tests for the feeEstimate utility (issue #71 / #73).
 * Uses vi.spyOn on global fetch for precise control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateFee } from "@/utils/feeEstimate";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FEE_STATS_RESPONSE = {
  last_ledger: "51200000",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.30",
  fee_charged: {
    max: "1500", min: "100", mode: "100",
    p10: "100", p20: "100", p30: "100", p40: "100", p50: "100",
    p60: "100", p70: "100", p80: "200", p90: "1000", p95: "1200", p99: "1500",
  },
};

const COINGECKO_RESPONSE = { stellar: { usd: 0.12 } };

function mockFetch(responses: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const [pattern, body] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        if (body === "__error__") throw new TypeError("fetch failed");
        if (typeof body === "number") {
          return new Response(null, { status: body });
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    throw new TypeError(`Unmocked fetch: ${url}`);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("estimateFee", () => {
  it("returns xlm and usd when both APIs succeed", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": FEE_STATS_RESPONSE,
      "coingecko.com": COINGECKO_RESPONSE,
    });

    const result = await estimateFee();

    expect(result).not.toBeNull();
    // 1000 stroops / 10_000_000 = 0.0001 XLM → toFixed(5) = "0.00010"
    expect(result!.xlm).toBe("0.00010");
    // 0.0001 XLM × $0.12 = $0.000012 → toFixed(6) = "$0.000012"
    expect(result!.usd).toBe("$0.000012");
  });

  it("uses fallback USD price when CoinGecko fails", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": FEE_STATS_RESPONSE,
      "coingecko.com": 503,
    });

    const result = await estimateFee();

    // Should still return a result (using the $0.12 fallback price)
    expect(result).not.toBeNull();
    expect(result!.xlm).toBe("0.00010");
    // 0.0001 × 0.12 = 0.000012
    expect(result!.usd).toMatch(/\$0\.00001[0-9]/);
  });

  it("returns null when Horizon fee_stats returns 503", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": 503,
      "coingecko.com": COINGECKO_RESPONSE,
    });

    const result = await estimateFee();

    expect(result).toBeNull();
  });

  it("returns null when Horizon request throws a network error", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": "__error__",
      "coingecko.com": COINGECKO_RESPONSE,
    });

    const result = await estimateFee();

    expect(result).toBeNull();
  });

  it("xlm field is a formatted string with 5 decimal places", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": FEE_STATS_RESPONSE,
      "coingecko.com": COINGECKO_RESPONSE,
    });

    const result = await estimateFee();

    expect(result!.xlm).toMatch(/^\d+\.\d{5}$/);
  });

  it("usd field starts with '$' when price is available", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": FEE_STATS_RESPONSE,
      "coingecko.com": COINGECKO_RESPONSE,
    });

    const result = await estimateFee();

    expect(result!.usd).toMatch(/^\$/);
  });

  it("usd is non-null when coingecko returns a valid price", async () => {
    mockFetch({
      "horizon-testnet.stellar.org/fee_stats": FEE_STATS_RESPONSE,
      "coingecko.com": COINGECKO_RESPONSE,
    });

    const result = await estimateFee();

    expect(result!.usd).not.toBeNull();
  });
});
