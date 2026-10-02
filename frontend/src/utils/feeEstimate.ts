/** Estimate XLM transaction fee via Horizon simulation. */

const XLM_USD_FALLBACK = 0.12; // fallback price if CoinGecko unreachable
const HORIZON_BASE = "https://horizon-testnet.stellar.org";

export interface FeeEstimate {
  xlm: string;       // e.g. "0.00010"
  usd: string | null; // e.g. "$0.000012" or null if price unavailable
}

/** Fetch the current p90 base fee from Horizon fee_stats. */
async function fetchBaseFeeLumens(): Promise<number> {
  const res = await fetch(`${HORIZON_BASE}/fee_stats`);
  if (!res.ok) throw new Error("fee_stats unavailable");
  const json = await res.json();
  // fee_charged is in stroops; 1 XLM = 10_000_000 stroops
  const stroops = parseInt(json.fee_charged?.p90 ?? json.last_ledger_base_fee, 10);
  return stroops / 10_000_000;
}

/** Fetch XLM/USD price from CoinGecko (best-effort). */
async function fetchXlmUsd(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    { signal: AbortSignal.timeout(4000) }
  );
  if (!res.ok) return XLM_USD_FALLBACK;
  const json = await res.json();
  return json?.stellar?.usd ?? XLM_USD_FALLBACK;
}

/**
 * Estimate the fee for a single Stellar transaction.
 * Returns null if simulation fails (caller should show a warning).
 */
export async function estimateFee(): Promise<FeeEstimate | null> {
  try {
    const [feeXlm, xlmUsd] = await Promise.all([fetchBaseFeeLumens(), fetchXlmUsd()]);
    const usdValue = feeXlm * xlmUsd;
    return {
      xlm: feeXlm.toFixed(5),
      usd: `$${usdValue.toFixed(6)}`,
    };
  } catch {
    return null;
  }
}
