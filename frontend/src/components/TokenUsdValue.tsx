/**
 * TokenUsdValue — USD value display for token amounts (#762)
 *
 * Renders the USD equivalent of a token amount next to the raw token value.
 * Shows a staleness indicator when the price is older than 5 minutes.
 * Gracefully degrades: if the price feed is unavailable or the token is
 * unknown, only the token amount is shown (no USD display).
 *
 * Usage:
 * ```tsx
 * <TokenUsdValue amount={45_000} symbol="USDC" />
 * // → "45,000 USDC  ≈ $45,000.00"
 *
 * <TokenUsdValue amount={1_000} symbol="XLM" showSymbol={false} />
 * // → "1,000  ≈ $0.12"
 * ```
 */

import React from "react";
import { useTokenPrice, hasPriceFeed } from "@/hooks/useTokenPrice";

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Format a token amount with up to 7 significant digits. */
function formatToken(amount: number): string {
  if (!isFinite(amount)) return "—";
  return amount.toLocaleString(undefined, { maximumFractionDigits: 7 });
}

/** Format a USD value with 2 decimal places. */
function formatUsd(usd: number): string {
  if (!isFinite(usd)) return "—";
  if (usd >= 1_000_000) {
    return `$${(usd / 1_000_000).toFixed(2)}M`;
  }
  if (usd >= 1_000) {
    return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${usd.toFixed(2)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface TokenUsdValueProps {
  /** Raw token amount (not yet divided by decimals — pass the display amount). */
  amount: number;
  /** Token symbol, e.g. "XLM", "USDC", "USDT". */
  symbol: string;
  /** Whether to show the token symbol after the amount. Default: true. */
  showSymbol?: boolean;
  /** Additional class name for the wrapper span. */
  className?: string;
  /** Inline style overrides for the wrapper span. */
  style?: React.CSSProperties;
}

/**
 * Displays `{amount} {symbol}  ≈ {USD}` where the USD portion is only shown
 * when a live price is available.
 */
export function TokenUsdValue({
  amount,
  symbol,
  showSymbol = true,
  className,
  style,
}: TokenUsdValueProps) {
  const { price, stale, loading } = useTokenPrice(symbol);

  const usdValue = price !== null ? amount * price : null;
  const knownToken = hasPriceFeed(symbol);

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "baseline", gap: "0.25rem", flexWrap: "wrap", ...style }}
    >
      {/* Token amount */}
      <span>
        {formatToken(amount)}
        {showSymbol && symbol ? ` ${symbol}` : ""}
      </span>

      {/* USD equivalent — only shown when price is available */}
      {knownToken && !loading && usdValue !== null && (
        <span
          style={{
            fontSize: "0.875em",
            color: "var(--color-text-muted, #6b7280)",
            whiteSpace: "nowrap",
          }}
          aria-label={`approximately ${formatUsd(usdValue)} US dollars`}
        >
          ≈&nbsp;{formatUsd(usdValue)}
          {stale && (
            <abbr
              title="Price data is more than 5 minutes old"
              style={{
                marginLeft: "0.25rem",
                fontSize: "0.75em",
                color: "var(--color-warning, #d97706)",
                cursor: "help",
                textDecoration: "none",
              }}
            >
              ⚠
            </abbr>
          )}
        </span>
      )}

      {/* Loading spinner (only while first fetch is pending) */}
      {knownToken && loading && (
        <span
          aria-label="Loading price"
          style={{
            fontSize: "0.75em",
            color: "var(--color-text-muted, #6b7280)",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        >
          …
        </span>
      )}
    </span>
  );
}

export default TokenUsdValue;
