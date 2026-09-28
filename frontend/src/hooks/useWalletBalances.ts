import { useState, useEffect } from "react";
import { WalletBalance } from "@/types";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

/** Shape of a single balance entry returned by Horizon /accounts/:id */
interface HorizonBalance {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

export function useWalletBalances(address: string | null): {
  balances: WalletBalance[];
  loading: boolean;
  error: string | null;
} {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setBalances([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${HORIZON_URL}/accounts/${address}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Horizon ${r.status}`);
        return r.json() as Promise<{ balances: HorizonBalance[] }>;
      })
      .then(({ balances: raw }) => {
        if (cancelled) return;
        const mapped: WalletBalance[] = raw
          .filter((b) => b.asset_type !== "liquidity_pool_shares")
          .map((b) => ({
            assetCode: b.asset_type === "native" ? "XLM" : b.asset_code!,
            contractAddress:
              b.asset_type === "native" ? "native" : `${b.asset_code}:${b.asset_issuer}`,
            balance: b.balance,
          }));
        setBalances(mapped);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch balances");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { balances, loading, error };
}
