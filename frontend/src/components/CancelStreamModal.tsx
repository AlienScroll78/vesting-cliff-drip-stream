"use client";
/**
 * CancelStreamModal — #776
 *
 * Full sponsor-confirmation modal for cancelling a vesting stream.
 *
 * Flow:
 *  1. Modal opens, fetches GET /api/streams/:recipient/cancel-preview for impact.
 *  2. Shows tokens recipient will keep and tokens refunded to sponsor.
 *  3. Sponsor must type the recipient address to unlock the cancel button.
 *  4. On confirm, builds tx via POST /api/streams/:recipient/build-cancel-tx,
 *     sends to wallet for signing.
 *  5. Optimistic status update → rollback on failure.
 *  6. Success: stream row shown as "Cancelled".
 */

import { useEffect, useId, useRef, useState, KeyboardEvent } from "react";
import { trapFocus } from "@/utils/focusTrap";
import { formatAmount } from "@/utils/formatAmount";
import { useCancelPreview } from "@/hooks/useCancelPreview";
import type { VestingStream } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CancelStreamModalProps {
  /** The stream to cancel */
  stream: VestingStream;
  /** Called after the transaction succeeds; parent should update stream status */
  onSuccess: (streamId: string) => void;
  /** Called when the modal is dismissed without cancellation */
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build and submit the cancel transaction via the backend. */
async function buildAndSubmitCancelTx(recipient: string): Promise<void> {
  const res = await fetch(`/api/streams/${encodeURIComponent(recipient)}/build-cancel-tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Transaction failed (${res.status})`);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CancelStreamModal({ stream, onSuccess, onClose }: CancelStreamModalProps) {
  const { preview, loading: previewLoading, error: previewError } = useCancelPreview(stream.recipient);

  const [confirmAddress, setConfirmAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();

  // Focus trap
  useEffect(() => {
    if (!containerRef.current) return;
    return trapFocus(containerRef.current);
  }, []);

  // Escape → dismiss
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isAddressConfirmed = confirmAddress.trim() === stream.recipient.trim();

  async function handleConfirm() {
    if (!isAddressConfirmed || submitting) return;

    setSubmitting(true);
    setTxError(null);

    try {
      await buildAndSubmitCancelTx(stream.recipient);
      onSuccess(stream.id);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  function handleConfirmKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // Block Enter on the confirm button — must use pointer click (anti-accidental safeguard)
    if (e.key === "Enter") e.preventDefault();
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const recipientKeeps = preview?.recipientKeeps ?? 0;
  const sponsorRefund = preview?.sponsorRefund ?? 0;
  const cliffReached = preview?.cliffReached ?? false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="cancel-stream-modal"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        style={{
          background: "var(--color-surface, #fff)",
          borderRadius: "var(--radius, 8px)",
          border: "1.5px solid var(--color-cancelled, #dc2626)",
          width: "100%",
          maxWidth: "30rem",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          animation: "cancelModalFadeIn 0.18s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes cancelModalFadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* ── Header ── */}
        <div>
          <h2
            id={titleId}
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "var(--color-cancelled, #dc2626)",
              margin: 0,
            }}
          >
            Cancel Stream
          </h2>
          <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.25rem" }}>
            This action is permanent and cannot be undone.
          </p>
        </div>

        {/* ── Recipient ── */}
        <p
          style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}
          data-testid="cancel-modal-recipient"
        >
          Recipient:{" "}
          <span style={{ fontFamily: "monospace", color: "var(--color-text, #111)" }}>
            {stream.recipient}
          </span>
        </p>

        {/* ── Loading preview ── */}
        {previewLoading && (
          <p style={{ fontSize: "0.85rem", color: "#9ca3af" }} role="status" aria-live="polite">
            Loading impact preview…
          </p>
        )}

        {/* ── Preview error ── */}
        {previewError && (
          <div
            role="alert"
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius, 4px)",
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              fontSize: "0.8rem",
              color: "#991b1b",
            }}
          >
            ⚠️ Could not load cancel preview: {previewError}. Amounts below may be inaccurate.
          </div>
        )}

        {/* ── Cliff warning ── */}
        {!previewLoading && !cliffReached && (
          <div
            role="status"
            data-testid="cancel-modal-no-cliff-warning"
            style={{
              padding: "0.75rem",
              borderRadius: "var(--radius, 4px)",
              background: "#fef2f2",
              border: "1px solid var(--color-cancelled, #dc2626)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            ⚠️ <strong>Cliff not yet reached</strong> — the full deposit will be refunded to you.
            The recipient will receive nothing.
          </div>
        )}

        {/* ── Impact summary ── */}
        {!previewLoading && (
          <dl
            data-testid="cancel-modal-impact"
            style={{
              background: "var(--color-bg, #f9fafb)",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: "var(--radius, 4px)",
              padding: "0.875rem 1rem",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "0.5rem 1rem",
              fontSize: "0.9rem",
              margin: 0,
            }}
          >
            <dt style={{ color: "#6b7280" }}>Recipient keeps (accrued since cliff)</dt>
            <dd
              data-testid="cancel-modal-recipient-amount"
              style={{
                fontWeight: 700,
                textAlign: "right",
                color: cliffReached
                  ? "var(--color-completed, #059669)"
                  : "#9ca3af",
              }}
            >
              {formatAmount(recipientKeeps)}{" "}
              <span style={{ fontWeight: 400, color: "#6b7280" }}>{stream.token}</span>
            </dd>

            <dt style={{ color: "#6b7280" }}>Refunded to you (sponsor)</dt>
            <dd
              data-testid="cancel-modal-sponsor-refund"
              style={{
                fontWeight: 700,
                textAlign: "right",
                color: "var(--color-active, #2563eb)",
              }}
            >
              {formatAmount(sponsorRefund)}{" "}
              <span style={{ fontWeight: 400, color: "#6b7280" }}>{stream.token}</span>
            </dd>
          </dl>
        )}

        {/* ── Irreversible warning ── */}
        <div
          role="status"
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "var(--radius, 4px)",
            background: "#fffbeb",
            border: "1px solid #fbbf24",
            fontSize: "0.825rem",
            lineHeight: 1.5,
          }}
        >
          ⚠️ <strong>Warning: This action is irreversible.</strong> Once cancelled, the stream
          cannot be restarted.
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--color-border, #e5e7eb)", margin: 0 }} />

        {/* ── Address confirmation input ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label
            htmlFor={inputId}
            style={{ fontSize: "0.875rem", color: "#374151" }}
          >
            Type the <strong>recipient address</strong> to confirm cancellation
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={confirmAddress}
            onChange={(e) => setConfirmAddress(e.target.value)}
            disabled={submitting}
            aria-label="Type recipient address to confirm stream cancellation"
            placeholder={stream.recipient}
            data-testid="cancel-modal-address-input"
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius, 4px)",
              border: `1.5px solid ${isAddressConfirmed
                ? "var(--color-cancelled, #dc2626)"
                : "var(--color-border, #e5e7eb)"}`,
              fontFamily: "monospace",
              fontSize: "0.875rem",
              outline: "none",
              transition: "border-color 0.15s",
              background: submitting ? "#f9fafb" : undefined,
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          {confirmAddress.length > 0 && !isAddressConfirmed && (
            <p
              role="alert"
              style={{ fontSize: "0.775rem", color: "#dc2626", margin: 0 }}
              data-testid="cancel-modal-address-mismatch"
            >
              Address does not match recipient
            </p>
          )}
        </div>

        {/* ── Transaction error ── */}
        {txError && (
          <div
            role="alert"
            data-testid="cancel-modal-tx-error"
            style={{
              padding: "0.75rem",
              borderRadius: "var(--radius, 4px)",
              background: "#fef2f2",
              border: "1px solid var(--color-cancelled, #dc2626)",
              fontSize: "0.85rem",
              color: "#991b1b",
            }}
          >
            ❌ {txError}
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button
            className="btn btn-outline"
            onClick={onClose}
            disabled={submitting}
            data-testid="cancel-modal-go-back"
            autoFocus
          >
            Go back
          </button>
          <button
            className="btn btn-primary"
            style={{
              background: "var(--color-cancelled, #dc2626)",
              borderColor: "var(--color-cancelled, #dc2626)",
              opacity: isAddressConfirmed && !submitting ? 1 : 0.5,
              cursor: isAddressConfirmed && !submitting ? "pointer" : "not-allowed",
            }}
            disabled={!isAddressConfirmed || submitting}
            onClick={handleConfirm}
            onKeyDown={handleConfirmKeyDown}
            data-testid="cancel-modal-confirm-btn"
          >
            {submitting ? "Cancelling…" : "Cancel stream"}
          </button>
        </div>
      </div>
    </div>
  );
}
