"use client";
import { useEffect, useRef, useState } from "react";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";
import { estimateFee, type FeeEstimate } from "@/utils/feeEstimate";
import { VestingStream } from "@/types";

interface Props {
  /** Full stream object — used for schedule info and cliff checks. */
  stream: VestingStream;
  /** Current ledger sequence (used for cliff countdown). Optional. */
  currentLedger?: number;
  onClaim: () => Promise<void>;
  onClose: () => void;
  // Legacy scalar props kept for backwards compatibility
  claimableAmount?: number;
  tokenSymbol?: string;
}

export function ClaimBottomSheet({
  stream,
  currentLedger,
  onClaim,
  onClose,
  // fallbacks for legacy callers
  claimableAmount: claimableAmountProp,
  tokenSymbol: tokenSymbolProp,
}: Props) {
  const claimableAmount = claimableAmountProp ?? stream.claimableAmount;
  const tokenSymbol     = tokenSymbolProp     ?? stream.token;

  const [loading,  setLoading]  = useState(false);
  const [claimed,  setClaimed]  = useState(false);
  const [feeState, setFeeState] = useState<"loading" | FeeEstimate | null>("loading");

  const startY   = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // ── Fee estimation (issue #71) ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    estimateFee().then((result) => {
      if (!cancelled) setFeeState(result); // null → simulation failed
    });
    return () => { cancelled = true; };
  }, []);

  // ── Swipe / backdrop / keyboard ────────────────────────────────────────────
  function handleTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const endY = e.changedTouches[0]?.clientY;
    if (startY.current !== null && endY != null && endY - startY.current > 60) {
      onClose();
    }
    startY.current = null;
  }
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Claim handler ──────────────────────────────────────────────────────────
  async function handleClaim() {
    setLoading(true);
    try {
      await onClaim();
      setClaimed(true);
    } finally {
      setLoading(false);
    }
  }

  // ── Cliff countdown ────────────────────────────────────────────────────────
  const cliffLedger = (stream as VestingStream & { cliffLedger?: number }).cliffLedger;
  const isPreCliff  = stream.status === "pre-cliff";
  const ledgersLeft = cliffLedger != null && currentLedger != null
    ? Math.max(0, cliffLedger - currentLedger)
    : null;

  return (
    <div
      className="bottom-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Claim tokens"
      onClick={handleBackdropClick}
    >
      <div
        ref={sheetRef}
        className="bottom-sheet"
        data-testid="claim-bottom-sheet"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <h2 className="bottom-sheet-title">Claim Tokens</h2>

        {/* Claimable amount */}
        <div className="claimable-amount" data-testid="claimable-amount">
          <span
            className="amount-value"
            title={formatAmount(claimableAmount)}
            aria-label={`${formatAmount(claimableAmount)} ${tokenSymbol}`}
          >
            {abbreviateAmount(claimableAmount)}
          </span>
          <span className="amount-token">{tokenSymbol}</span>
        </div>

        {/* Schedule info (issue #73 — exposed for tests) */}
        {(stream.totalVested != null || stream.totalDeposit != null) && (
          <div data-testid="schedule-info" style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "0.5rem" }}>
            {stream.totalVested != null && (
              <span data-testid="total-vested">
                Vested so far: {formatAmount(stream.totalVested)} {tokenSymbol}
              </span>
            )}
          </div>
        )}

        {/* Cliff countdown (issue #70 — matches contract error semantics) */}
        {isPreCliff && (
          <div
            data-testid="cliff-countdown"
            role="alert"
            style={{
              fontSize: "0.82rem",
              color: "var(--color-cancelled, #b91c1c)",
              background: "#fef2f2",
              border: "1px solid var(--color-cancelled, #b91c1c)",
              borderRadius: "0.5rem",
              padding: "0.5rem 0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            Cliff not reached yet.
            {ledgersLeft != null && (
              <> {ledgersLeft.toLocaleString()} ledgers remaining (≈{Math.ceil(ledgersLeft * 5 / 86400)} days).</>
            )}
          </div>
        )}

        {/* ── Fee estimate (issue #71) ────────────────────────────────────── */}
        <div style={{ fontSize: "0.82rem", marginBottom: "0.75rem" }}>
          {feeState === "loading" ? (
            <span data-testid="fee-loading" style={{ color: "#9ca3af" }}>
              ⏳ Estimating network fee…
            </span>
          ) : feeState === null ? (
            <span
              data-testid="fee-unknown"
              role="status"
              style={{
                color: "#d97706",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: "0.375rem",
                padding: "0.35rem 0.6rem",
                display: "inline-block",
              }}
            >
              ⚠️ Fee estimate unavailable — transaction will still proceed.
            </span>
          ) : (
            <span
              data-testid="fee-value"
              style={{ color: "#374151" }}
              aria-label={`Estimated fee: ${feeState.xlm} XLM${feeState.usd ? `, ${feeState.usd}` : ""}`}
            >
              Estimated fee: <strong>{feeState.xlm} XLM</strong>
              {feeState.usd && (
                <span style={{ color: "#6b7280", marginLeft: "0.35rem" }}>
                  ({feeState.usd})
                </span>
              )}
            </span>
          )}
        </div>

        {/* Optimistic success state */}
        {claimed ? (
          <div
            data-testid="claim-success"
            role="status"
            style={{
              padding: "0.75rem 1rem",
              background: "#f0fdf4",
              border: "1px solid var(--color-completed, #15803d)",
              borderRadius: "0.5rem",
              color: "var(--color-completed, #15803d)",
              fontWeight: 600,
              textAlign: "center",
              marginBottom: "0.5rem",
            }}
          >
            ✓ Tokens claimed!
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-full"
          onClick={handleClaim}
          disabled={loading || claimableAmount === 0 || isPreCliff || claimed}
          data-testid="claim-button"
        >
          {loading ? "Claiming…" : claimed ? "Claimed" : "Claim"}
        </button>
        <button className="btn btn-ghost btn-full" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
