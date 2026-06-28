"use client";
import { useEffect, useRef, useState } from "react";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";
import { trapFocus } from "@/utils/focusTrap";
import { type FeeEstimate, estimateFee } from "@/utils/feeEstimate";

interface Props {
  stream: VestingStream;
  currentLedger?: number;
  onClaim: () => Promise<void>;
  onClose: () => void;
}

export function ClaimBottomSheet({ stream, currentLedger, onClaim, onClose }: Props) {
  const { claimableAmount, tokenSymbol: _ts, token: tokenSymbol, status } = { ...stream, tokenSymbol: stream.token };
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [optimisticAmount, setOptimisticAmount] = useState(claimableAmount);
  const [fee, setFee] = useState<FeeEstimate | null | "loading">("loading");
  const [txError, setTxError] = useState<string | null>(null);
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const isPreCliff = status === "pre-cliff";

  // Cliff countdown
  const ledgersUntilCliff =
    isPreCliff && stream.cliffLedger && currentLedger
      ? Math.max(0, stream.cliffLedger - currentLedger)
      : null;

  // Progress: vested / total
  const vestedPct =
    stream.totalDeposit && stream.totalDeposit > 0
      ? Math.min(100, ((stream.totalVested ?? 0) / stream.totalDeposit) * 100)
      : null;

  useEffect(() => {
    estimateFee().then(setFee);
  }, []);

  function handleTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const endY = e.changedTouches[0]?.clientY;
    if (startY.current !== null && endY !== undefined && endY - startY.current > 60) onClose();
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

  useEffect(() => {
    if (!sheetRef.current) return;
    return trapFocus(sheetRef.current);
  }, []);

  useEffect(() => { sheetRef.current?.focus(); }, []);

  async function handleClaim() {
    setLoading(true);
    setTxError(null);
    // Optimistic update
    setOptimisticAmount(0);
    setClaimed(true);
    try {
      await onClaim();
    } catch (err) {
      // Roll back optimistic update
      setOptimisticAmount(claimableAmount);
      setClaimed(false);
      const msg = err instanceof Error ? err.message : "Claim failed";
      // Handle CliffNotReached gracefully
      if (msg.toLowerCase().includes("cliff")) {
        setTxError("Cliff not reached yet. Come back after the cliff date.");
      } else {
        setTxError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const canClaim = !isPreCliff && optimisticAmount > 0 && !claimed;

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
        tabIndex={-1}
        style={{ outline: "none" }}
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <h2 className="bottom-sheet-title">Claim Tokens</h2>

        {/* Cliff banner */}
        {isPreCliff && (
          <div
            role="status"
            data-testid="cliff-countdown"
            style={{
              padding: "0.75rem 1rem",
              background: "#fffbeb",
              border: "1px solid var(--color-pre-cliff)",
              borderRadius: "var(--radius)",
              marginBottom: "0.75rem",
              fontSize: "0.875rem",
            }}
          >
            <strong style={{ color: "var(--color-pre-cliff)" }}>🔒 Cliff not reached</strong>
            {ledgersUntilCliff !== null ? (
              <p style={{ margin: "0.25rem 0 0" }}>
                Tokens unlock in approximately{" "}
                <strong>{ledgersToHuman(ledgersUntilCliff)}</strong>{" "}
                ({ledgersUntilCliff.toLocaleString()} ledgers remaining)
              </p>
            ) : (
              <p style={{ margin: "0.25rem 0 0" }}>Your tokens are still locked until the cliff.</p>
            )}
          </div>
        )}

        {/* Claimable amount */}
        <div className="claimable-amount" data-testid="claimable-amount">
          <span
            className="amount-value"
            title={formatAmount(optimisticAmount)}
            aria-label={`${formatAmount(optimisticAmount)} ${tokenSymbol}`}
          >
            {abbreviateAmount(optimisticAmount)}
          </span>
          <span className="amount-token">{tokenSymbol}</span>
        </div>

        {/* Schedule info */}
        {(stream.totalDeposit || stream.totalVested !== undefined) && (
          <dl
            data-testid="schedule-info"
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "0.25rem 1rem",
              fontSize: "0.8rem",
              color: "#6b7280",
              marginBottom: "0.75rem",
            }}
          >
            {stream.totalVested !== undefined && (
              <>
                <dt>Total vested</dt>
                <dd data-testid="total-vested">
                  {formatAmount(stream.totalVested)} {tokenSymbol}
                </dd>
              </>
            )}
            {stream.totalDeposit && (
              <>
                <dt>Total deposit</dt>
                <dd>{formatAmount(stream.totalDeposit)} {tokenSymbol}</dd>
              </>
            )}
          </dl>
        )}

        {/* Progress bar */}
        {vestedPct !== null && (
          <div
            role="progressbar"
            aria-valuenow={Math.round(vestedPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${Math.round(vestedPct)}% vested`}
            data-testid="vesting-progress"
            style={{
              height: 8,
              background: "var(--color-border)",
              borderRadius: 999,
              marginBottom: "0.75rem",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${vestedPct}%`,
                background: "var(--color-active)",
                borderRadius: 999,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        )}

        {/* Fee estimate */}
        <div
          data-testid="fee-estimate"
          style={{
            fontSize: "0.82rem",
            color: fee === null ? "var(--color-cancelled)" : "#6b7280",
            marginBottom: "0.5rem",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
          aria-live="polite"
        >
          {fee === "loading" && <span data-testid="fee-loading">⏳ Estimating fee…</span>}
          {fee === null && (
            <span data-testid="fee-unknown">⚠️ Fee estimate unavailable</span>
          )}
          {fee !== null && fee !== "loading" && (
            <span data-testid="fee-value">
              Estimated fee: <strong>{fee.xlm} XLM</strong>
              {fee.usd && <> ({fee.usd})</>}
            </span>
          )}
        </div>

        {/* Tx error */}
        {txError && (
          <p
            role="alert"
            style={{ fontSize: "0.8rem", color: "var(--color-cancelled)", marginBottom: "0.5rem" }}
          >
            {txError}
          </p>
        )}

        {/* Success */}
        {claimed && !loading && !txError && (
          <p
            role="status"
            data-testid="claim-success"
            style={{ fontSize: "0.875rem", color: "var(--color-completed)", marginBottom: "0.5rem" }}
          >
            ✓ Claim submitted!
          </p>
        )}

        <button
          className="btn btn-primary btn-full"
          onClick={handleClaim}
          disabled={loading || !canClaim}
          data-testid="claim-button"
          aria-disabled={!canClaim}
        >
          {loading ? "Claiming…" : isPreCliff ? "Cliff not reached" : claimed ? "Claimed" : "Claim"}
        </button>
        <button className="btn btn-ghost btn-full" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
