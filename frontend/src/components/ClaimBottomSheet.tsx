"use client";
import { useEffect, useRef, useState } from "react";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";
import { trapFocus } from "@/utils/focusTrap";
import { type FeeEstimate, estimateFee } from "@/utils/feeEstimate";
import { VestingStream } from "@/types";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ConfettiBurst } from "@/components/ConfettiBurst";

/** Convert a ledger count to a human-readable duration string (~5 s/ledger). */
function ledgersToHuman(ledgers: number): string {
  const seconds = ledgers * 5;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

/** Trigger haptic feedback on supported mobile devices. */
function triggerHaptic(type: "light" | "medium" | "success" = "medium") {
  try {
    if ("vibrate" in navigator) {
      const pattern = type === "success" ? [30, 20, 30] : type === "medium" ? [20] : [10];
      navigator.vibrate(pattern);
    }
  } catch { /* not supported — ignore */ }
}

interface Props {
  stream: VestingStream;
  currentLedger?: number;
  onClaim: () => Promise<void>;
  onClose: () => void;
}

export function ClaimBottomSheet({ stream, currentLedger, onClaim, onClose }: Props) {
  const { claimableAmount, token: tokenSymbol, status } = stream;
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [justSucceeded, setJustSucceeded] = useState(false);
  const [optimisticAmount, setOptimisticAmount] = useState(claimableAmount);
  const [fee, setFee] = useState<FeeEstimate | null | "loading">("loading");
  const [txError, setTxError] = useState<string | null>(null);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const startTranslate = useRef(0);
  const titleId = "claim-sheet-title";

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

  // ── Touch / drag to dismiss ─────────────────────────────────────────────────

  function handleTouchStart(e: React.TouchEvent) {
    const handle = (e.currentTarget as HTMLElement).querySelector(".bottom-sheet-handle");
    // Allow drag from handle or the top portion of sheet
    const touch = e.touches[0];
    if (!touch) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Only allow drag if touch starts within top 60px
    if (touch.clientY - rect.top > 60) return;
    startY.current = touch.clientY;
    startTranslate.current = translateY;
    setIsDragging(true);
    void handle; // reference used for type narrowing
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (startY.current === null || !isDragging) return;
    const dy = e.touches[0]!.clientY - startY.current;
    if (dy < 0) return; // no drag up beyond original position
    setTranslateY(dy);
  }

  function handleTouchEnd() {
    if (!isDragging) return;
    setIsDragging(false);
    if (translateY > 120) {
      onClose();
    } else {
      // Snap back
      setTranslateY(0);
    }
    startY.current = null;
  }

  // Mouse drag (desktop development convenience)
  function handleMouseDown(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientY - rect.top > 60) return;
    startY.current = e.clientY;
    startTranslate.current = translateY;
    setIsDragging(true);
  }

  useEffect(() => {
    if (!isDragging) return;
    function onMouseMove(e: MouseEvent) {
      if (startY.current === null) return;
      const dy = e.clientY - startY.current;
      if (dy > 0) setTranslateY(dy);
    }
    function onMouseUp() {
      setIsDragging(false);
      if (translateY > 120) {
        onClose();
      } else {
        setTranslateY(0);
      }
      startY.current = null;
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, translateY, onClose]);

  // ── Keyboard / focus ───────────────────────────────────────────────────────

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

  // ── Backdrop click ─────────────────────────────────────────────────────────

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // ── Claim action ───────────────────────────────────────────────────────────

  async function handleClaim() {
    triggerHaptic("medium");
    setLoading(true);
    setTxError(null);
    setOptimisticAmount(0);
    setClaimed(true);
    try {
      await onClaim();
      triggerHaptic("success");
      setJustSucceeded(true);
    } catch (err) {
      setOptimisticAmount(claimableAmount);
      setClaimed(false);
      const msg = err instanceof Error ? err.message : "Claim failed";
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
    <>
      <ConfettiBurst active={justSucceeded} onDone={() => setJustSucceeded(false)} />

      {/* Backdrop — not the dialog, just the overlay */}
      <div
        className="bottom-sheet-backdrop"
        onClick={handleBackdropClick}
        aria-hidden="true"
        style={{
          // Align to bottom, sheet takes 60% of viewport height
          alignItems: "flex-end",
        }}
      >
        {/* Sheet — this is the actual dialog */}
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="bottom-sheet"
          data-testid="claim-bottom-sheet"
          tabIndex={-1}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            outline: "none",
            // 60% of viewport, scrollable if needed
            maxHeight: "60dvh",
            overflowY: "auto",
            // Drag transform
            transform: `translateY(${translateY}px)`,
            transition: isDragging ? "none" : "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
            cursor: isDragging ? "grabbing" : "auto",
            // Slide up on mount
            animation: "slideUpSheet 0.28s cubic-bezier(0.32,0.72,0,1)",
          }}
        >
          {/* Drag handle — tappable for full dismiss */}
          <button
            type="button"
            className="bottom-sheet-handle"
            aria-label="Drag down or tap to close"
            onClick={onClose}
            style={{
              background: "var(--color-border)",
              border: "none",
              cursor: "grab",
              display: "block",
              width: "3rem",
              height: "0.3rem",
              borderRadius: "9999px",
              margin: "0 auto 0.75rem",
              flexShrink: 0,
              padding: 0,
            }}
          />

          <h2 id={titleId} className="bottom-sheet-title">
            Claim Tokens
          </h2>

          {/* Caption */}
          <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: "0.25rem 0 0", alignSelf: "flex-start" }}>
            {isPreCliff ? "Tokens locked until cliff" : "You can claim"}
          </p>

          {/* Pre-cliff banner */}
          {isPreCliff && (
            <div
              role="status"
              data-testid="cliff-countdown"
              style={{
                padding: "0.75rem 1rem",
                background: "var(--color-pre-cliff)" + "18",
                border: "1px solid var(--color-pre-cliff)",
                borderRadius: "var(--radius)",
                marginTop: "0.75rem",
                fontSize: "0.875rem",
                width: "100%",
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

          {/* Claimable amount — prominent */}
          <div
            className="claimable-amount"
            data-testid="claimable-amount"
            style={{ width: "100%", padding: "0.75rem 0 0.5rem" }}
          >
            <span
              className="amount-value"
              title={formatAmount(optimisticAmount)}
              aria-label={`Claimable amount: ${formatAmount(optimisticAmount)} ${tokenSymbol}`}
              style={{ color: isPreCliff ? "#9ca3af" : "var(--color-active)" }}
            >
              <AnimatedNumber value={optimisticAmount} format={abbreviateAmount} />
            </span>
            <span className="amount-token">{tokenSymbol}</span>
          </div>

          {/* Stream progress summary */}
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
                width: "100%",
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
                width: "100%",
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
              width: "100%",
            }}
            aria-live="polite"
          >
            {fee === "loading" && <span data-testid="fee-loading">⏳ Estimating fee…</span>}
            {fee === null && <span data-testid="fee-unknown">⚠️ Fee estimate unavailable</span>}
            {fee !== null && fee !== "loading" && (
              <span data-testid="fee-value">
                Estimated fee: <strong>{fee.xlm} XLM</strong>
                {fee.usd && <> ({fee.usd})</>}
              </span>
            )}
          </div>

          {/* Error */}
          {txError && (
            <p
              role="alert"
              style={{ fontSize: "0.8rem", color: "var(--color-cancelled)", marginBottom: "0.5rem", width: "100%" }}
            >
              {txError}
            </p>
          )}

          {/* Success */}
          {claimed && !loading && !txError && (
            <p
              role="status"
              data-testid="claim-success"
              style={{ fontSize: "0.875rem", color: "var(--color-completed)", marginBottom: "0.5rem", width: "100%" }}
            >
              ✓ Claim submitted!
            </p>
          )}

          {/* Primary CTA — 48px touch target */}
          <button
            className="btn btn-primary btn-full"
            onClick={handleClaim}
            disabled={loading || !canClaim}
            data-testid="claim-button"
            aria-disabled={!canClaim}
            style={{
              minHeight: 48,
              fontSize: "1rem",
              marginTop: "0.5rem",
              background: claimed && !loading && !txError
                ? "var(--color-completed)"
                : isPreCliff
                ? undefined
                : undefined,
            }}
          >
            {loading
              ? <span aria-live="polite">Claiming…</span>
              : isPreCliff
              ? "Cliff not reached"
              : claimed && !txError
              ? "Claimed! ✓"
              : txError
              ? "Retry"
              : "Claim Tokens →"}
          </button>

          {/* Dismiss link */}
          <button
            type="button"
            className="btn btn-ghost btn-full"
            onClick={onClose}
            data-testid="claim-close-btn"
            style={{ marginTop: "0.25rem", color: "#6b7280", fontSize: "0.875rem", minHeight: 44 }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Mount animation */}
      <style>{`
        @keyframes slideUpSheet {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
