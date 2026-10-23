"use client";

import { useMemo } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

/** ~5 s per ledger on Stellar mainnet/testnet */
const LEDGERS_PER_DAY = 17_280;

/**
 * i128::MAX — the on-chain arithmetic ceiling for the total deposit.
 * Using BigInt because this exceeds Number.MAX_SAFE_INTEGER.
 * Written as BigInt() call (not literal) for ES2017 TS target compatibility.
 */
const I128_MAX = BigInt("170141183460469231731687303715884105727");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepositCalculatorProps {
  /** Tokens released per ledger (must be > 0 for meaningful output). */
  rate: number;
  /** Number of ledgers in the cliff period. */
  cliffLedgers: number;
  /** Total number of ledgers in the stream. */
  totalLedgers: number;
  /**
   * Warning banner is shown when totalDeposit exceeds this value.
   * Defaults to 10,000,000.
   */
  warningThreshold?: number;
}

/** Human-readable calculation result. */
interface CalcResult {
  totalDeposit: bigint;
  cliffAccrual: bigint;
  postCliffDrip: bigint;
  totalDays: number;
  cliffDays: number;
  postCliffDays: number;
  isOverflow: boolean;
  isWarning: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ledgersToDays(ledgers: number): number {
  return ledgers / LEDGERS_PER_DAY;
}

/** Format a BigInt with comma separators. */
function formatBigInt(value: bigint): string {
  return value.toLocaleString();
}

function formatDays(days: number): string {
  if (days === 0) return "0 days";
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) return `${(hours * 60).toFixed(1)} min`;
    return `${hours.toFixed(2)} hrs`;
  }
  return `${days.toLocaleString(undefined, { maximumFractionDigits: 2 })} days`;
}

/** Build the plain-text export content. */
function buildExportText(props: DepositCalculatorProps, result: CalcResult): string {
  const lines = [
    "Deposit Cost Calculator — Summary",
    "=".repeat(40),
    `Generated: ${new Date().toISOString()}`,
    "",
    "Inputs",
    "-".repeat(20),
    `Rate:           ${props.rate.toLocaleString()} tokens/ledger`,
    `Cliff ledgers:  ${props.cliffLedgers.toLocaleString()}  (≈ ${formatDays(result.cliffDays)})`,
    `Total ledgers:  ${props.totalLedgers.toLocaleString()}  (≈ ${formatDays(result.totalDays)})`,
    "",
    "Results",
    "-".repeat(20),
    `Total deposit:     ${formatBigInt(result.totalDeposit)} tokens`,
    `Cliff accrual:     ${formatBigInt(result.cliffAccrual)} tokens  (instantly claimable at cliff)`,
    `Post-cliff drip:   ${formatBigInt(result.postCliffDrip)} tokens  (released linearly after cliff)`,
    "",
    "Notes",
    "-".repeat(20),
    `Ledger rate: ${LEDGERS_PER_DAY.toLocaleString()} ledgers/day (≈ 5 s/ledger)`,
  ];

  if (result.isOverflow) {
    lines.push("⚠  OVERFLOW: totalDeposit exceeds i128::MAX — this stream cannot be created.");
  }
  if (result.isWarning && !result.isOverflow) {
    lines.push(`⚠  WARNING: totalDeposit exceeds the configured threshold.`);
  }

  return lines.join("\n");
}

/** Trigger a browser file download with the given text content. */
function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * DepositCalculator
 *
 * Displays a real-time breakdown of the token deposit required for a vesting
 * stream: total deposit, cliff-period accrual, and post-cliff drip amount.
 * Warns when the deposit exceeds a configurable threshold and detects i128
 * overflow before the on-chain transaction is attempted.
 */
export function DepositCalculator({
  rate,
  cliffLedgers,
  totalLedgers,
  warningThreshold = 10_000_000,
}: DepositCalculatorProps) {
  const result = useMemo<CalcResult>(() => {
    const r = BigInt(Math.max(0, Math.floor(rate)));
    const cl = BigInt(Math.max(0, Math.floor(cliffLedgers)));
    const tl = BigInt(Math.max(0, Math.floor(totalLedgers)));

    const totalDeposit = r * tl;
    const cliffAccrual = r * cl;
    const postCliffDrip = r * (tl > cl ? tl - cl : BigInt(0));

    const isOverflow = totalDeposit > I128_MAX;
    const isWarning = !isOverflow && totalDeposit > BigInt(Math.floor(warningThreshold));

    const totalDays = ledgersToDays(totalLedgers);
    const cliffDays = ledgersToDays(cliffLedgers);
    const postCliffDays = ledgersToDays(Math.max(0, totalLedgers - cliffLedgers));

    return {
      totalDeposit,
      cliffAccrual,
      postCliffDrip,
      totalDays,
      cliffDays,
      postCliffDays,
      isOverflow,
      isWarning,
    };
  }, [rate, cliffLedgers, totalLedgers, warningThreshold]);

  function handleExport() {
    const text = buildExportText(
      { rate, cliffLedgers, totalLedgers, warningThreshold },
      result,
    );
    downloadText("deposit-calculator-summary.txt", text);
  }

  const isUsable = rate > 0 && totalLedgers > 0;

  return (
    <div
      data-testid="deposit-calculator"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--dc-gap, 0.75rem)",
        padding: "var(--dc-padding, 1rem)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        background: "var(--color-surface)",
        fontSize: "var(--dc-font-size, 0.875rem)",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "var(--dc-heading-size, 1rem)",
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        Deposit Calculator
      </h3>

      {/* ── Overflow error (highest priority) ── */}
      {result.isOverflow && (
        <div
          role="alert"
          data-testid="overflow-error"
          style={{
            padding: "var(--dc-alert-padding, 0.6rem 0.9rem)",
            background: "var(--dc-overflow-bg, #fef2f2)",
            border: "1px solid var(--color-cancelled)",
            borderRadius: "var(--radius)",
            color: "var(--color-cancelled)",
            fontWeight: 600,
          }}
        >
          ⚠ Overflow: total deposit exceeds i128::MAX and cannot be stored
          on-chain. Reduce the rate or duration.
        </div>
      )}

      {/* ── Warning banner ── */}
      {result.isWarning && (
        <div
          role="alert"
          data-testid="warning-banner"
          style={{
            padding: "var(--dc-alert-padding, 0.6rem 0.9rem)",
            background: "var(--dc-warning-bg, #fffbeb)",
            border: "1px solid var(--color-pre-cliff)",
            borderRadius: "var(--radius)",
            color: "var(--color-pre-cliff)",
            fontWeight: 600,
          }}
        >
          ⚠ Large deposit: total deposit exceeds{" "}
          {warningThreshold.toLocaleString()} tokens. Double-check your inputs
          before proceeding.
        </div>
      )}

      {/* ── Live result table ── */}
      <div
        role="status"
        aria-live="polite"
        aria-label="Deposit calculation results"
        data-testid="calc-results"
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
            {/* Total deposit */}
            <dt
              style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}
            >
              Total deposit
            </dt>
            <dd
              data-testid="total-deposit"
              style={{ margin: 0, color: "var(--color-text)" }}
            >
              {formatBigInt(result.totalDeposit)}{" "}
              <span style={{ color: "var(--dc-muted, #6b7280)" }}>
                tokens
              </span>
              <span
                data-testid="total-deposit-days"
                style={{
                  marginLeft: "0.5rem",
                  color: "var(--dc-muted, #6b7280)",
                  fontSize: "0.8em",
                }}
              >
                ({formatDays(result.totalDays)})
              </span>
            </dd>

            {/* Cliff accrual */}
            <dt
              style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}
            >
              Cliff accrual
            </dt>
            <dd
              data-testid="cliff-accrual"
              style={{ margin: 0, color: "var(--color-text)" }}
            >
              {formatBigInt(result.cliffAccrual)}{" "}
              <span style={{ color: "var(--dc-muted, #6b7280)" }}>
                tokens
              </span>
              <span
                data-testid="cliff-accrual-days"
                style={{
                  marginLeft: "0.5rem",
                  color: "var(--dc-muted, #6b7280)",
                  fontSize: "0.8em",
                }}
              >
                ({formatDays(result.cliffDays)})
              </span>
            </dd>

            {/* Post-cliff drip */}
            <dt
              style={{ fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap" }}
            >
              Post-cliff drip
            </dt>
            <dd
              data-testid="post-cliff-drip"
              style={{ margin: 0, color: "var(--color-text)" }}
            >
              {formatBigInt(result.postCliffDrip)}{" "}
              <span style={{ color: "var(--dc-muted, #6b7280)" }}>
                tokens
              </span>
              <span
                data-testid="post-cliff-drip-days"
                style={{
                  marginLeft: "0.5rem",
                  color: "var(--dc-muted, #6b7280)",
                  fontSize: "0.8em",
                }}
              >
                ({formatDays(result.postCliffDays)})
              </span>
            </dd>
          </dl>
        ) : (
          <p
            data-testid="calc-placeholder"
            style={{ margin: 0, color: "var(--dc-muted, #6b7280)" }}
          >
            Enter a rate and total duration to see the deposit breakdown.
          </p>
        )}
      </div>

      {/* ── Ledger rate note ── */}
      <p
        style={{
          margin: 0,
          color: "var(--dc-muted, #6b7280)",
          fontSize: "0.8em",
        }}
      >
        Conversion: {LEDGERS_PER_DAY.toLocaleString()} ledgers ≈ 1 day (5 s/ledger)
      </p>

      {/* ── Export button ── */}
      <button
        type="button"
        data-testid="export-button"
        onClick={handleExport}
        disabled={!isUsable}
        style={{
          alignSelf: "flex-start",
          padding: "var(--dc-btn-padding, 0.4rem 0.9rem)",
          background: isUsable ? "var(--color-active)" : "var(--color-border)",
          color: isUsable ? "#fff" : "var(--dc-muted, #6b7280)",
          border: "none",
          borderRadius: "var(--radius)",
          cursor: isUsable ? "pointer" : "not-allowed",
          fontWeight: 600,
          fontSize: "0.85rem",
          transition: "opacity 0.15s",
        }}
        aria-label="Export calculation summary as plain text"
      >
        Export summary
      </button>
    </div>
  );
}
