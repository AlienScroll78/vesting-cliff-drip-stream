/**
 * useWalletBalances — fetches Stellar Horizon account balances for a given
 * wallet address and refreshes them every 30 seconds (issue #1022).
 *
 * Returns the raw WalletBalance array, a loading flag, and an error string.
 * Automatically clears state when `address` becomes null (wallet disconnect).
 */
import { useState, useEffect, useCallback } from "react";
import { WalletBalance } from "@/types";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

/** How often balances are re-fetched in milliseconds. */
export const BALANCE_REFRESH_INTERVAL_MS = 30_000;

/** Shape of a single balance entry returned by Horizon /accounts/:id */
export interface HorizonBalance {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

/**
 * Pure mapping function (exported for unit testing without React).
 * Filters out liquidity_pool_shares and normalises native XLM entries.
 */
export function mapHorizonBalances(raw: HorizonBalance[]): WalletBalance[] {
  return raw
    .filter((b) => b.asset_type !== "liquidity_pool_shares")
    .map((b) => ({
      assetCode: b.asset_type === "native" ? "XLM" : b.asset_code!,
      contractAddress:
        b.asset_type === "native" ? "native" : `${b.asset_code}:${b.asset_issuer}`,
      balance: b.balance,
    }));
}

export function useWalletBalances(address: string | null): {
  balances: WalletBalance[];
  loading: boolean;
  error: string | null;
  /** Call to force an immediate refresh outside the normal 30-second cycle. */
  refresh: () => void;
} {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [tick, setTick]         = useState(0);

  /** Trigger a manual refresh by bumping the tick counter. */
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!address) {
      setBalances([]);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchBalances() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${HORIZON_URL}/accounts/${address}`);
        if (!resp.ok) throw new Error(`Horizon ${resp.status}`);
        const data = (await resp.json()) as { balances: HorizonBalance[] };
        if (!cancelled) {
          setBalances(mapHorizonBalances(data.balances));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch balances");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchBalances();

    // Auto-refresh every 30 seconds
    const timer = setInterval(() => {
      if (!cancelled) void fetchBalances();
    }, BALANCE_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  // `tick` is intentionally included so manual `refresh()` calls re-run the effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tick]);

  return { balances, loading, error, refresh };
}
