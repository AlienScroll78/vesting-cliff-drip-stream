/** Estimate XLM transaction fee via Horizon simulation. */

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

/** Fetch XLM/USD price from CoinGecko. Returns null rather than guessing a price. */
async function fetchXlmUsd(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const price = json?.stellar?.usd;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

/**
 * Estimate the fee for a single Stellar transaction.
 * Returns null if the base fee cannot be read (caller should show a warning).
 * `usd` is null when the XLM price is unavailable, so no guessed price is shown.
 */
export async function estimateFee(): Promise<FeeEstimate | null> {
  let feeXlm: number;
  try {
    feeXlm = await fetchBaseFeeLumens();
  } catch {
    return null;
  }
  const xlmUsd = await fetchXlmUsd();
  return {
    xlm: feeXlm.toFixed(5),
    usd: xlmUsd === null ? null : `$${(feeXlm * xlmUsd).toFixed(6)}`,
  };
}
