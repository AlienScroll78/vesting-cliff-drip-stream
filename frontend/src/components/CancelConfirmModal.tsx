"use client";
import { useEffect, useId, useRef, useState } from "react";
import { VestingStream } from "@/types";
import { formatAmount } from "@/utils/formatAmount";

interface CancelAmounts {
  recipientAmount: number; // tokens already accrued (0 if cliff not reached)
  sponsorRefund: number;   // remainder back to sponsor
  cliffReached: boolean;
}

interface Props {
  stream: VestingStream;
  amounts: CancelAmounts;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const CONFIRM_WORD = "CANCEL";

export function CancelConfirmModal({ stream, amounts, onConfirm, onClose }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // Focus input on open; close on Escape
  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleConfirm() {
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); }
  }

  const confirmed = input === CONFIRM_WORD;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
      }}
    >
      <div
        style={{
          background: "var(--color-surface)", borderRadius: "var(--radius)",
          border: "1.5px solid var(--color-cancelled)", width: "100%", maxWidth: "26rem",
          padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-cancelled)" }}>
          Cancel Stream
        </h2>

        {/* Recipient row */}
        <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
          Recipient: <span style={{ fontFamily: "monospace" }}>{stream.recipient}</span>
        </p>

        {/* Cliff warning */}
        {!amounts.cliffReached && (
          <div
            role="status"
            style={{
              padding: "0.6rem 0.75rem", borderRadius: "var(--radius)",
              background: "#fef2f2", border: "1px solid var(--color-cancelled)", fontSize: "0.85rem",
            }}
          >
            ⚠️ Cliff not yet reached — full deposit will be refunded to the sponsor.
          </div>
        )}

        {/* Amount breakdown */}
        <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.4rem 1rem", fontSize: "0.9rem", margin: 0 }}>
          <dt style={{ color: "#6b7280" }}>Released to recipient</dt>
          <dd style={{ fontWeight: 700, textAlign: "right" }}>
            {formatAmount(amounts.recipientAmount)} {stream.token}
          </dd>
          <dt style={{ color: "#6b7280" }}>Refunded to sponsor</dt>
          <dd style={{ fontWeight: 700, textAlign: "right" }}>
            {formatAmount(amounts.sponsorRefund)} {stream.token}
          </dd>
        </dl>

        <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: 0 }} />

        {/* Confirmation input */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label htmlFor="cancel-confirm-input" style={{ fontSize: "0.875rem" }}>
            Type <strong>{CONFIRM_WORD}</strong> to confirm
          </label>
          <input
            id="cancel-confirm-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="cancel-confirm-hint"
            style={{
              padding: "0.5rem 0.75rem", borderRadius: "var(--radius)",
              border: `1.5px solid ${confirmed ? "var(--color-cancelled)" : "var(--color-border)"}`,
              fontFamily: "monospace", fontSize: "0.95rem", outline: "none",
            }}
          />
          <span id="cancel-confirm-hint" className="sr-only">
            This action is irreversible. Type CANCEL to enable the button.
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Go back
          </button>
          <button
            className="btn btn-primary"
            style={{ background: "var(--color-cancelled)", borderColor: "var(--color-cancelled)" }}
            disabled={!confirmed || loading}
            onClick={handleConfirm}
            data-testid="cancel-confirm-btn"
          >
            {loading ? "Cancelling…" : "Cancel Stream"}
          </button>
        </div>
      </div>
    </div>
  );
}
