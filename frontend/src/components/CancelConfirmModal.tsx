"use client";
import { useEffect, useId, useRef, useState, KeyboardEvent } from "react";
import { VestingStream } from "@/types";
import { formatAmount } from "@/utils/formatAmount";
import { trapFocus } from "@/utils/focusTrap";

// ── Shared dialog shell ───────────────────────────────────────────────────────

interface DialogShellProps {
  titleId: string;
  onClose: () => void;
  borderColor?: string;
  children: React.ReactNode;
}

function DialogShell({ titleId, onClose, borderColor = "var(--color-cancelled)", children }: DialogShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    if (!containerRef.current) return;
    return trapFocus(containerRef.current);
  }, []);

  // Escape → dismiss.  Enter does NOT confirm (keyboard rule #378).
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      // Suppress Enter from accidentally triggering the primary button
      // when focus is on the backdrop/wrapper (not an interactive element).
      if (e.key === "Enter" && e.target === document.body) e.preventDefault();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
      }}
      onClick={handleBackdropClick}
      aria-hidden="false"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: "var(--color-surface)",
          borderRadius: "var(--radius)",
          border: `1.5px solid ${borderColor}`,
          width: "100%",
          maxWidth: "28rem",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          animation: "fadeScaleIn 0.18s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Cancel Stream dialog ──────────────────────────────────────────────────────

interface CancelAmounts {
  recipientAmount: number;
  sponsorRefund: number;
  cliffReached: boolean;
}

interface CancelStreamProps {
  stream: VestingStream;
  amounts: CancelAmounts;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function CancelConfirmModal({ stream, amounts, onConfirm, onClose }: CancelStreamProps) {
  const [loading, setLoading] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Move focus to confirm button (NOT auto-focused to prevent Enter-key accidents)
  useEffect(() => {
    // Focus the "Keep Stream" / dismiss button first — safer default
    const cancelBtn = document.getElementById("cancel-stream-keep-btn");
    cancelBtn?.focus();
  }, []);

  async function handleConfirm() {
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); }
  }

  // Block Enter on confirm button itself to prevent accidental submission
  function handleConfirmKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter") { e.preventDefault(); }
  }

  return (
    <DialogShell titleId={titleId} onClose={onClose} borderColor="var(--color-cancelled)">
      <div>
        <h2
          id={titleId}
          style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-cancelled)", margin: 0 }}
        >
          Cancel Stream
        </h2>
        <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.25rem" }}>
          This action is permanent and cannot be undone.
        </p>
      </div>

      {/* Recipient */}
      <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>
        Recipient:{" "}
        <span style={{ fontFamily: "monospace", color: "var(--color-text)" }}>{stream.recipient}</span>
      </p>

      {/* Cliff not reached warning */}
      {!amounts.cliffReached && (
        <div
          role="status"
          style={{
            padding: "0.75rem",
            borderRadius: "var(--radius)",
            background: "#fef2f2",
            border: "1px solid var(--color-cancelled)",
            fontSize: "0.85rem",
            lineHeight: 1.5,
          }}
        >
          ⚠️ <strong>Cliff not reached</strong> — the full deposit will be refunded to the sponsor.
          The recipient will receive nothing.
        </div>
      )}

      {/* Explicit amount breakdown */}
      <dl
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "0.875rem 1rem",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "0.5rem 1rem",
          fontSize: "0.9rem",
          margin: 0,
        }}
      >
        <dt style={{ color: "#6b7280" }}>Recipient receives</dt>
        <dd style={{ fontWeight: 700, textAlign: "right", color: amounts.cliffReached ? "var(--color-completed)" : "#9ca3af" }}>
          {formatAmount(amounts.recipientAmount)} {stream.token}
        </dd>
        <dt style={{ color: "#6b7280" }}>Sponsor refund</dt>
        <dd style={{ fontWeight: 700, textAlign: "right", color: "var(--color-active)" }}>
          {formatAmount(amounts.sponsorRefund)} {stream.token}
        </dd>
      </dl>

      <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: 0 }} />

      {/* Actions — dismiss is the safe/primary focus default */}
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button
          id="cancel-stream-keep-btn"
          className="btn btn-outline"
          onClick={onClose}
          disabled={loading}
          data-testid="cancel-keep-btn"
          autoFocus
        >
          Keep Stream
        </button>
        <button
          ref={confirmBtnRef}
          className="btn btn-primary"
          style={{ background: "var(--color-cancelled)", borderColor: "var(--color-cancelled)" }}
          disabled={loading}
          onClick={handleConfirm}
          onKeyDown={handleConfirmKeyDown}
          data-testid="cancel-confirm-btn"
        >
          {loading ? "Cancelling…" : "Cancel Stream"}
        </button>
      </div>
    </DialogShell>
  );
}

// ── Disconnect Wallet dialog ──────────────────────────────────────────────────

interface DisconnectWalletProps {
  hasPendingTransactions?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DisconnectWalletDialog({ hasPendingTransactions = false, onConfirm, onClose }: DisconnectWalletProps) {
  const titleId = useId();

  function handleConfirmKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter") e.preventDefault();
  }

  return (
    <DialogShell titleId={titleId} onClose={onClose} borderColor="var(--color-pre-cliff)">
      <div>
        <h2
          id={titleId}
          style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-pre-cliff)", margin: 0 }}
        >
          Disconnect Wallet
        </h2>
        <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.25rem" }}>
          You will be signed out of your current session.
        </p>
      </div>

      {/* Pending tx warning */}
      {hasPendingTransactions && (
        <div
          role="alert"
          style={{
            padding: "0.75rem",
            borderRadius: "var(--radius)",
            background: "#fffbeb",
            border: "1px solid var(--color-pre-cliff)",
            fontSize: "0.85rem",
            lineHeight: 1.5,
          }}
        >
          ⚠️ <strong>You have pending transactions.</strong> Disconnecting now may leave them in
          an incomplete state. Wait for them to confirm before disconnecting.
        </div>
      )}

      <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0, lineHeight: 1.6 }}>
        Your on-chain data will not be affected. You can reconnect your wallet at any time.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button
          className="btn btn-outline"
          onClick={onClose}
          data-testid="disconnect-keep-btn"
          autoFocus
        >
          Stay Connected
        </button>
        <button
          className="btn btn-primary"
          style={{ background: "var(--color-pre-cliff)", borderColor: "var(--color-pre-cliff)" }}
          onClick={onConfirm}
          onKeyDown={handleConfirmKeyDown}
          data-testid="disconnect-confirm-btn"
        >
          Disconnect Wallet
        </button>
      </div>
    </DialogShell>
  );
}

// ── Batch Cancel dialog ───────────────────────────────────────────────────────

export interface BatchCancelStream {
  id: string;
  recipient: string;
  token: string;
  recipientAmount: number;
  sponsorRefund: number;
  cliffReached: boolean;
}

interface BatchCancelProps {
  streams: BatchCancelStream[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function BatchCancelDialog({ streams, onConfirm, onClose }: BatchCancelProps) {
  const [loading, setLoading] = useState(false);
  const titleId = useId();

  // Aggregate totals (assumes same token for simplicity; multi-token aggregated separately)
  const totalRecipient = streams.reduce((s, x) => s + x.recipientAmount, 0);
  const totalRefund = streams.reduce((s, x) => s + x.sponsorRefund, 0);
  const token = streams[0]?.token ?? "";

  async function handleConfirm() {
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); }
  }

  function handleConfirmKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter") e.preventDefault();
  }

  return (
    <DialogShell titleId={titleId} onClose={onClose} borderColor="var(--color-cancelled)">
      <div>
        <h2
          id={titleId}
          style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-cancelled)", margin: 0 }}
        >
          Cancel {streams.length} Stream{streams.length !== 1 ? "s" : ""}
        </h2>
        <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.25rem" }}>
          This action is permanent and will cancel all selected streams.
        </p>
      </div>

      {/* Aggregate impact */}
      <dl
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "0.875rem 1rem",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "0.5rem 1rem",
          fontSize: "0.9rem",
          margin: 0,
        }}
      >
        <dt style={{ color: "#6b7280" }}>Streams affected</dt>
        <dd style={{ fontWeight: 700, textAlign: "right" }}>{streams.length}</dd>
        <dt style={{ color: "#6b7280" }}>Total released to recipients</dt>
        <dd style={{ fontWeight: 700, textAlign: "right", color: "var(--color-completed)" }}>
          {formatAmount(totalRecipient)} {token}
        </dd>
        <dt style={{ color: "#6b7280" }}>Total refunded to you</dt>
        <dd style={{ fontWeight: 700, textAlign: "right", color: "var(--color-active)" }}>
          {formatAmount(totalRefund)} {token}
        </dd>
      </dl>

      {/* Per-stream breakdown (scrollable if long) */}
      <div
        style={{
          maxHeight: "10rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          fontSize: "0.8rem",
        }}
      >
        {streams.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "0.5rem",
              padding: "0.4rem 0.5rem",
              background: "var(--color-bg)",
              borderRadius: "0.25rem",
              border: "1px solid var(--color-border)",
            }}
          >
            <span style={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.recipient}
            </span>
            <span style={{ flexShrink: 0, color: "#6b7280" }}>
              {s.cliffReached
                ? `${formatAmount(s.recipientAmount)} → recipient`
                : "full refund to sponsor"}
            </span>
          </div>
        ))}
      </div>

      <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: 0 }} />

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button
          className="btn btn-outline"
          onClick={onClose}
          disabled={loading}
          data-testid="batch-cancel-keep-btn"
          autoFocus
        >
          Keep All Streams
        </button>
        <button
          className="btn btn-primary"
          style={{ background: "var(--color-cancelled)", borderColor: "var(--color-cancelled)" }}
          disabled={loading}
          onClick={handleConfirm}
          onKeyDown={handleConfirmKeyDown}
          data-testid="batch-cancel-confirm-btn"
        >
          {loading ? "Cancelling…" : `Cancel ${streams.length} Stream${streams.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </DialogShell>
  );
}
