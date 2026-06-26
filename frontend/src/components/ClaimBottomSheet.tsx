"use client";
import { useEffect, useRef, useState } from "react";

interface Props {
  claimableAmount: number;
  tokenSymbol: string;
  onClaim: () => Promise<void>;
  onClose: () => void;
}

export function ClaimBottomSheet({ claimableAmount, tokenSymbol, onClaim, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Swipe-down to dismiss
  function handleTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 60) {
      onClose();
    }
    startY.current = null;
  }

  // Close on backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <h2 className="bottom-sheet-title">Claim Tokens</h2>
        <div className="claimable-amount" data-testid="claimable-amount">
          <span className="amount-value">{claimableAmount.toLocaleString()}</span>
          <span className="amount-token">{tokenSymbol}</span>
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
