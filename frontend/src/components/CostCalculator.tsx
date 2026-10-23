"use client";

import { useMemo } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

/** ~5 s per ledger on Stellar mainnet/testnet. */
export const SECONDS_PER_LEDGER = 5;

/** 86,400 s in a day ÷ 5 s per ledger. */
export const LEDGERS_PER_DAY = 17_280;

/** Default admin-controlled minimum total deposit (see `set_min_deposit`). */
export const DEFAULT_MIN_DEPOSIT = 100;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CostCalculatorProps {
  /** Tokens released per ledger (must be > 0 for a meaningful preview). */
  rate: number;
  /** Total number of ledgers in the stream. */
  totalDuration: number;
  /** Number of ledgers before the cliff. Used for the cliff-date preview. */
  cliffDuration?: number;
  /** Minimum deposit threshold below which the stream is rejected. */
  minDeposit?: number;
  /** Token symbol shown next to the amounts. */
  tokenSymbol?: string;
  /** Reference point for the cliff/end date previews. Defaults to now. */
  startDate?: Date;
}

export interface CostBreakdown {
  /** rate × totalDuration. */
  totalDeposit: number;
  /** totalDuration converted to whole/humanised days. */
  durationDays: number;
  /** Absolute date at which the cliff unlocks. */
  cliffDate: Date;
  /** Absolute date at which the stream completes. */
  endDate: Date;
  /** True when the total deposit is below the configured minimum. */
  belowMinDeposit: boolean;
  /** The effective minimum-deposit threshold that was applied. */
  minDeposit: number;
  /** False when the inputs are not usable (missing/zero/negative). */
  isUsable: boolean;
}

// ── Pure calculation (exported for direct unit testing) ───────────────────────

export function calculateStreamCost({
  rate,
  totalDuration,
  cliffDuration = 0,
  minDeposit = DEFAULT_MIN_DEPOSIT,
  startDate = new Date(),
}: {
  rate: number;
  totalDuration: number;
  cliffDuration?: number;
  minDeposit?: number;
  startDate?: Date;
}): CostBreakdown {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const safeTotal = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 0;
  const safeCliff = Number.isFinite(cliffDuration) && cliffDuration > 0 ? cliffDuration : 0;

  const totalDeposit = safeRate * safeTotal;
  const durationDays = safeTotal / LEDGERS_PER_DAY;

  const msPerLedger = SECONDS_PER_LEDGER * 1_000;
  const cliffDate = new Date(startDate.getTime() + safeCliff * msPerLedger);
  const endDate = new Date(startDate.getTime() + safeTotal * msPerLedger);

  return {
    totalDeposit,
    durationDays,
    cliffDate,
    endDate,
    belowMinDeposit: safeRate > 0 && safeTotal > 0 && totalDeposit < minDeposit,
    minDeposit,
    isUsable: safeRate > 0 && safeTotal > 0,
  };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function formatAmount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

export function formatDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "0 days";
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) return `${(hours * 60).toFixed(1)} min`;
    return `${hours.toFixed(2)} hrs`;
  }
  return `${days.toLocaleString(undefined, { maximumFractionDigits: 2 })} days`;
}

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Sponsor cost calculator.
 *
 * Live, read-only preview of the total token deposit a sponsor must lock when
 * creating a vesting stream, plus the estimated duration in days and the
 * cliff/end dates. Driven entirely by props, so it updates on every keystroke
 * as the create-stream wizard mutates its schedule values.
 */
export function CostCalculator({
  rate,
  totalDuration,
  cliffDuration = 0,
  minDeposit = DEFAULT_MIN_DEPOSIT,
  tokenSymbol = "tokens",
  startDate,
}: CostCalculatorProps) {
  const breakdown = useMemo(
    () => calculateStreamCost({ rate, totalDuration, cliffDuration, minDeposit, startDate }),
    [rate, totalDuration, cliffDuration, minDeposit, startDate],
  );

  const { isUsable, totalDeposit, durationDays, cliffDate, endDate, belowMinDeposit, minDeposit: min } =
    breakdown;

  return (
    <div
      data-testid="cost-calculator"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        padding: "1rem",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        background: "var(--color-surface)",
        fontSize: "0.875rem",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "1rem",
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        Cost preview
      </h3>

      {/* ── Min-deposit warning ── */}
      {belowMinDeposit && (
        <div
          role="alert"
          data-testid="min-deposit-warning"
          style={{
            padding: "0.6rem 0.9rem",
            background: "var(--color-warning-bg, #fffbeb)",
            border: "1px solid var(--color-pre-cliff)",
            borderRadius: "var(--radius)",
            color: "var(--color-pre-cliff)",
            fontWeight: 600,
          }}
        >
          ⚠ Below minimum: total deposit ({formatAmount(totalDeposit)} {tokenSymbol}) is under
          the minimum of {formatAmount(min)} {tokenSymbol}. Increase the rate or duration.
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        aria-label="Cost calculation preview"
        data-testid="cost-breakdown"
      >
        {isUsable ? (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "0.4rem 1rem",
              margin: 0,
            }}
          >
            <dt style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}>
              Total deposit
            </dt>
            <dd data-testid="cost-total-deposit" style={{ margin: 0, color: "var(--color-text)" }}>
              {formatAmount(totalDeposit)}{" "}
              <span style={{ color: "var(--color-text-muted, #6b7280)" }}>{tokenSymbol}</span>
            </dd>

            <dt style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}>
              Estimated duration
            </dt>
            <dd data-testid="cost-duration-days" style={{ margin: 0, color: "var(--color-text)" }}>
              {formatDays(durationDays)}
              <span style={{ color: "var(--color-text-muted, #6b7280)", marginLeft: "0.4rem" }}>
                ({formatAmount(totalDuration)} ledgers ÷ {formatAmount(LEDGERS_PER_DAY)}/day)
              </span>
            </dd>

            <dt style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}>
              Cliff date
            </dt>
            <dd data-testid="cost-cliff-date" style={{ margin: 0, color: "var(--color-text)" }}>
              {formatDate(cliffDate)}
            </dd>

            <dt style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}>
              End date
            </dt>
            <dd data-testid="cost-end-date" style={{ margin: 0, color: "var(--color-text)" }}>
              {formatDate(endDate)}
            </dd>
          </dl>
        ) : (
          <p
            data-testid="cost-placeholder"
            style={{ margin: 0, color: "var(--color-text-muted, #6b7280)" }}
          >
            Enter a rate and total duration to preview the required deposit.
          </p>
        )}
      </div>
    </div>
  );
}

export default CostCalculator;
