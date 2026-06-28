"use client";
import { useEffect, useRef, useState } from "react";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";
import { trapFocus } from "@/utils/focusTrap";

interface Props {
  claimableAmount: number;
  tokenSymbol: string;
  onClaim: () => Promise<void>;
  onClose: () => void;
}

export function ClaimBottomSheet({ claimableAmount, tokenSymbol, onClaim, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [fee, setFee] = useState<FeeEstimate | null | "loading">("loading");
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Fetch fee estimate on mount
  useEffect(() => {
    estimateFee().then(setFee);
  }, []);

  // Swipe-down to dismiss
  function handleTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const endY = e.changedTouches[0]?.clientY;
    if (startY.current !== null && endY !== undefined && endY - startY.current > 60) {
      onClose();
    }
    startY.current = null;
  }

  // Close on backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape + focus trap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus trap inside modal
  useEffect(() => {
    if (!sheetRef.current) return;
    return trapFocus(sheetRef.current);
  }, []);

  // Auto-focus sheet on open
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  async function handleClaim() {
    setLoading(true);
    try { await onClaim(); } finally { setLoading(false); }
  }

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
        outline-style="none"
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <h2 className="bottom-sheet-title">Claim Tokens</h2>
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

        {/* Fee estimate row */}
        <div
          data-testid="fee-estimate"
          style={{
            fontSize: "0.82rem",
            color: fee === null ? "var(--color-cancelled, #b91c1c)" : "#6b7280",
            marginBottom: "0.5rem",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
          aria-live="polite"
        >
          {fee === "loading" && (
            <span data-testid="fee-loading">⏳ Estimating fee…</span>
          )}
          {fee === null && (
            <span data-testid="fee-unknown">
              ⚠️ Fee estimate unavailable — transaction will still proceed
            </span>
          )}
          {fee !== null && fee !== "loading" && (
            <span data-testid="fee-value">
              Estimated fee: <strong>{fee.xlm} XLM</strong>
              {fee.usd && <> ({fee.usd})</>}
            </span>
          )}
        </div>

        <button
          className="btn btn-primary btn-full"
          onClick={handleClaim}
          disabled={loading || claimableAmount === 0}
          data-testid="claim-button"
        >
          {loading ? "Claiming…" : "Claim"}
        </button>
        <button className="btn btn-ghost btn-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
