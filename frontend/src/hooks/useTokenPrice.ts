/**
 * useTokenPrice — token price feed integration (#762)
 *
 * Fetches USD prices for supported tokens from the CoinGecko API and caches
 * them with a 60-second stale time. Gracefully degrades: if the price feed is
 * unavailable, `price` is null so callers can fall back to token-only display.
 *
 * Supported tokens: XLM, USDC, USDT — extend TOKEN_IDS for additional SAC
 * tokens with known CoinGecko IDs.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Token → CoinGecko ID mapping ──────────────────────────────────────────────

/** Map of token symbol (uppercase) → CoinGecko coin ID */
export const TOKEN_IDS: Record<string, string> = {
  XLM: "stellar",
  USDC: "usd-coin",
  USDT: "tether",
};

/** Returns true if we have a known price feed for this token symbol. */
export function hasPriceFeed(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOKEN_IDS, symbol.toUpperCase());
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TokenPriceState {
  /** USD price per token, or null when unavailable / unknown token. */
  price: number | null;
  /** ISO timestamp of the last successful fetch, or null. */
  fetchedAt: string | null;
  /** Whether a fetch is currently in progress. */
  loading: boolean;
  /** Whether the cached price is stale (older than 5 minutes). */
  stale: boolean;
  /** Human-readable error, or null. */
  error: string | null;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  price: number;
  fetchedAt: number; // unix ms
}

const STALE_MS = 60_000;       // 60 s — refresh price
const STALE_INDICATOR_MS = 5 * 60_000; // 5 min — show staleness badge

const priceCache = new Map<string, CacheEntry>();

function getCached(coinId: string): CacheEntry | null {
  const entry = priceCache.get(coinId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > STALE_MS) return null; // expired
  return entry;
}

// ── CoinGecko fetch ───────────────────────────────────────────────────────────

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/**
 * Fetch the current USD price for a CoinGecko coin ID.
 * Returns null on any error so callers can degrade gracefully.
 */
async function fetchPrice(coinId: string): Promise<number | null> {
  const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    throw new Error(`CoinGecko returned ${res.status}`);
  }

  const data = (await res.json()) as Record<string, { usd?: number }>;
  return data[coinId]?.usd ?? null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * `useTokenPrice(symbol)` — returns the current USD price for a token symbol.
 *
 * - Refreshes automatically every 60 seconds.
 * - Returns `price: null` for unknown tokens (no USD display shown).
 * - `stale: true` when the price is older than 5 minutes.
 *
 * ```tsx
 * const { price, stale, loading } = useTokenPrice("XLM");
 * // price = 0.124 | null
 * ```
 */
export function useTokenPrice(symbol: string): TokenPriceState {
  const coinId = TOKEN_IDS[symbol?.toUpperCase() ?? ""];

  const [state, setState] = useState<TokenPriceState>(() => {
    if (!coinId) {
      return { price: null, fetchedAt: null, loading: false, stale: false, error: null };
    }
    const cached = getCached(coinId);
    return {
      price: cached?.price ?? null,
      fetchedAt: cached ? new Date(cached.fetchedAt).toISOString() : null,
      loading: !cached,
      stale: false,
      error: null,
    };
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(async () => {
    if (!coinId) return;

    // Check in-memory cache first (shared across hook instances)
    const cached = getCached(coinId);
    if (cached) {
      const stale = Date.now() - cached.fetchedAt > STALE_INDICATOR_MS;
      setState((s) => ({
        ...s,
        price: cached.price,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        loading: false,
        stale,
        error: null,
      }));
      return;
    }

    // Abort any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const price = await fetchPrice(coinId);

      if (price !== null) {
        const now = Date.now();
        priceCache.set(coinId, { price, fetchedAt: now });
        setState({
          price,
          fetchedAt: new Date(now).toISOString(),
          loading: false,
          stale: false,
          error: null,
        });
      } else {
        setState((s) => ({ ...s, loading: false, price: null, error: null }));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Price feed unavailable";
      setState((s) => ({
        ...s,
        loading: false,
        error: msg,
      }));
    }
  }, [coinId]);

  useEffect(() => {
    if (!coinId) {
      setState({ price: null, fetchedAt: null, loading: false, stale: false, error: null });
      return;
    }

    void doFetch();

    // Refresh every 60 seconds
    intervalRef.current = setInterval(() => {
      void doFetch();
    }, STALE_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [coinId, doFetch]);

  return state;
}

// ── Bulk price hook ───────────────────────────────────────────────────────────

export type BulkPriceMap = Record<string, number | null>;

/**
 * `useTokenPrices(symbols)` — batch version of `useTokenPrice`.
 * Returns a map of symbol → USD price (or null).
 */
export function useTokenPrices(symbols: string[]): {
  prices: BulkPriceMap;
  loading: boolean;
  stale: boolean;
} {
  const [prices, setPrices] = useState<BulkPriceMap>({});
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);

  const uniqueCoinIds = [...new Set(
    symbols
      .map((s) => s?.toUpperCase())
      .filter((s) => hasPriceFeed(s))
      .map((s) => TOKEN_IDS[s]!),
  )];

  useEffect(() => {
    if (uniqueCoinIds.length === 0) return;

    let cancelled = false;

    async function fetchAll() {
      setLoading(true);

      const results = await Promise.allSettled(
        uniqueCoinIds.map(async (coinId) => {
          const cached = getCached(coinId);
          if (cached) return { coinId, price: cached.price, fetchedAt: cached.fetchedAt };
          const price = await fetchPrice(coinId);
          if (price !== null) {
            priceCache.set(coinId, { price, fetchedAt: Date.now() });
          }
          return { coinId, price, fetchedAt: Date.now() };
        }),
      );

      if (cancelled) return;

      const map: BulkPriceMap = {};
      let anyStale = false;

      for (const res of results) {
        if (res.status === "fulfilled") {
          // Find symbol for this coinId
          const sym = Object.entries(TOKEN_IDS).find(([, id]) => id === res.value.coinId)?.[0];
          if (sym) {
            map[sym] = res.value.price;
            if (Date.now() - res.value.fetchedAt > STALE_INDICATOR_MS) anyStale = true;
          }
        }
      }

      setPrices(map);
      setStale(anyStale);
      setLoading(false);
    }

    void fetchAll();

    const interval = setInterval(() => void fetchAll(), STALE_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueCoinIds.join(",")]);

  return { prices, loading, stale };
}
