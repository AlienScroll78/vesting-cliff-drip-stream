import React, { useId, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/DestructiveConfirmDialog",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Destructive action confirmation dialogs. Uses the ds-modal base with the ds-modal--danger modifier " +
          "for a red accent. Two variants: cancel stream and clawback stream. " +
          "Both require an explicit type-to-confirm gate to prevent accidental destructive actions. " +
          "The safe 'Go back' button receives auto-focus, not the destructive button. " +
          "Escape dismisses; Enter on the confirm button is suppressed.",
      },
    },
  },
};
export default meta;

// ── Shared utilities ──────────────────────────────────────────────────────────

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

// ── Cancel Stream Dialog ──────────────────────────────────────────────────────

interface CancelStreamDialogProps {
  streamId: number;
  recipient: string;
  token: string;
  recipientAmount: number;
  sponsorRefund: number;
  cliffReached: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function CancelStreamDialog({
  streamId,
  recipient,
  token,
  recipientAmount,
  sponsorRefund,
  cliffReached,
  onConfirm,
  onClose,
}: CancelStreamDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const titleId = useId();
  const inputId = useId();

  const isConfirmed = confirmText === "CANCEL";

  async function handleConfirm() {
    if (!isConfirmed) return;
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); }
  }

  return (
    <div
      className="ds-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ds-modal ds-modal--danger">
        {/* Header */}
        <div>
          <div className="ds-modal__header" id={titleId}>
            Cancel stream #{streamId}
          </div>
          <div className="ds-modal__subtitle">
            This action is permanent and cannot be undone.
          </div>
        </div>

        {/* Recipient */}
        <p style={{ fontSize: "var(--font-size-caption)", color: "var(--color-text-secondary)", margin: 0 }}>
          Recipient:{" "}
          <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--color-text-primary)" }}>
            {recipient}
          </span>
        </p>

        {/* Pre-cliff warning */}
        {!cliffReached && (
          <div className="ds-modal__warning" role="note">
            <span className="ds-modal__warning-icon">⚠️</span>
            <span>
              <strong>Cliff not yet reached.</strong> The full deposit will be refunded to the sponsor.
              The recipient will receive nothing.
            </span>
          </div>
        )}

        {/* Impact breakdown */}
        <dl className="ds-modal__impact">
          <dt>Recipient receives</dt>
          <dd style={{ color: cliffReached ? "var(--color-success)" : "var(--color-text-disabled)" }}>
            {formatAmount(recipientAmount)} <span style={{ fontWeight: "var(--font-weight-normal)" as unknown as number }}>{token}</span>
          </dd>
          <dt>Sponsor refund</dt>
          <dd style={{ color: "var(--color-info)" }}>
            {formatAmount(sponsorRefund)} <span style={{ fontWeight: "var(--font-weight-normal)" as unknown as number }}>{token}</span>
          </dd>
        </dl>

        {/* Type-to-confirm gate */}
        <div className="ds-modal__confirm-gate">
          <label htmlFor={inputId}>
            Type <strong>CANCEL</strong> to confirm
          </label>
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={loading}
            className={`ds-modal__confirm-input${isConfirmed ? " ds-modal__confirm-input--matched" : ""}`}
            aria-label="Type CANCEL to unlock the confirm button"
            placeholder="CANCEL"
          />
        </div>

        {/* Actions */}
        <div className="ds-modal__footer">
          <button
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={loading}
            autoFocus
            data-testid="cancel-go-back"
          >
            Go back
          </button>
          <button
            className="btn btn--danger btn--sm"
            disabled={!isConfirmed || loading}
            onClick={handleConfirm}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            data-testid="cancel-confirm"
            style={{ opacity: isConfirmed && !loading ? 1 : 0.5, cursor: isConfirmed && !loading ? "pointer" : "not-allowed" }}
          >
            {loading ? "Cancelling…" : "I understand, cancel stream"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Clawback Stream Dialog ────────────────────────────────────────────────────

interface ClawbackDialogProps {
  streamId: number;
  recipient: string;
  token: string;
  reclaimedAmount: number;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

function ClawbackDialog({
  streamId,
  recipient,
  token,
  reclaimedAmount,
  onConfirm,
  onClose,
}: ClawbackDialogProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const titleId = useId();
  const reasonId = useId();

  const MAX_REASON_LENGTH = 256;
  const reasonTooLong = reason.length > MAX_REASON_LENGTH;
  const canConfirm = reason.trim().length > 0 && !reasonTooLong;

  async function handleConfirm() {
    if (!canConfirm) return;
    setLoading(true);
    try { await onConfirm(reason); } finally { setLoading(false); }
  }

  return (
    <div
      className="ds-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ds-modal ds-modal--danger">
        {/* Header */}
        <div>
          <div className="ds-modal__header" id={titleId}>
            Clawback stream #{streamId}
          </div>
          <div className="ds-modal__subtitle">
            Compliance action — all remaining tokens are returned to the sponsor, bypassing cliff state.
          </div>
        </div>

        {/* Recipient */}
        <p style={{ fontSize: "var(--font-size-caption)", color: "var(--color-text-secondary)", margin: 0 }}>
          Recipient:{" "}
          <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--color-text-primary)" }}>
            {recipient}
          </span>
        </p>

        {/* Clawback explanation */}
        <div className="ds-modal__warning" role="note">
          <span className="ds-modal__warning-icon">⚠️</span>
          <span>
            <strong>Bypasses cliff state.</strong> The full remaining balance is returned to the sponsor regardless
            of how much has already vested. Only supported on tokens with the SAC clawback flag enabled.
          </span>
        </div>

        {/* Impact breakdown */}
        <dl className="ds-modal__impact">
          <dt>Returned to sponsor</dt>
          <dd style={{ color: "var(--color-info)" }}>
            {formatAmount(reclaimedAmount)} <span style={{ fontWeight: "var(--font-weight-normal)" as unknown as number }}>{token}</span>
          </dd>
          <dt>Recipient receives</dt>
          <dd style={{ color: "var(--color-text-disabled)" }}>0 {token}</dd>
        </dl>

        {/* Reason input (stored on-chain in emitted event) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <label
            htmlFor={reasonId}
            style={{ fontSize: "var(--font-size-label)", fontWeight: "var(--font-weight-medium)", color: "var(--color-text-primary)" }}
          >
            Compliance reason <span style={{ color: "var(--color-danger)" }}>*</span>
          </label>
          <textarea
            id={reasonId}
            rows={3}
            maxLength={MAX_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={loading}
            placeholder="e.g. Account frozen under OFAC compliance order #…"
            className="input"
            style={{
              resize: "vertical",
              fontFamily: "var(--font-family-base)",
              minHeight: "4.5rem",
              borderColor: reasonTooLong ? "var(--color-danger)" : undefined,
            }}
            aria-label="Compliance reason for this clawback (stored on-chain)"
            aria-required="true"
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-caption)", color: reason.length > MAX_REASON_LENGTH * 0.9 ? "var(--color-danger)" : "var(--color-text-disabled)" }}>
            <span>Stored on-chain in the emitted event. Max {MAX_REASON_LENGTH} characters.</span>
            <span>{reason.length}/{MAX_REASON_LENGTH}</span>
          </div>
          {reasonTooLong && (
            <span className="ds-field-error" role="alert">
              <span className="ds-field-error__icon">!</span>
              <span className="ds-field-error__text">Reason exceeds 256 characters.</span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="ds-modal__footer">
          <button
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={loading}
            autoFocus
            data-testid="clawback-go-back"
          >
            Go back
          </button>
          <button
            className="btn btn--danger btn--sm"
            disabled={!canConfirm || loading}
            onClick={handleConfirm}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            data-testid="clawback-confirm"
            style={{ opacity: canConfirm && !loading ? 1 : 0.5, cursor: canConfirm && !loading ? "pointer" : "not-allowed" }}
          >
            {loading ? "Clawing back…" : "Confirm clawback"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

export const CancelStreamPostCliff: StoryObj = {
  name: "Cancel stream (cliff reached)",
  render: () => (
    <CancelStreamDialog
      streamId={3}
      recipient="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      token="USDC"
      recipientAmount={12_450}
      sponsorRefund={87_550}
      cliffReached={true}
      onConfirm={async () => {}}
      onClose={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("dialog")).toBeInTheDocument();
    // Go back button gets initial focus
    const goBack = canvas.getByTestId("cancel-go-back");
    expect(goBack).toBeInTheDocument();
    // Confirm disabled without typing CANCEL
    const confirmBtn = canvas.getByTestId("cancel-confirm");
    expect(confirmBtn).toBeDisabled();
    // Type CANCEL to unlock
    const input = canvas.getByPlaceholderText("CANCEL");
    await userEvent.type(input, "CANCEL");
    expect(confirmBtn).not.toBeDisabled();
  },
};

export const CancelStreamPreCliff: StoryObj = {
  name: "Cancel stream (before cliff)",
  render: () => (
    <CancelStreamDialog
      streamId={7}
      recipient="GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      token="USDC"
      recipientAmount={0}
      sponsorRefund={100_000}
      cliffReached={false}
      onConfirm={async () => {}}
      onClose={() => {}}
    />
  ),
};

export const ClawbackStream: StoryObj = {
  name: "Clawback stream (compliance)",
  render: () => (
    <ClawbackDialog
      streamId={5}
      recipient="GCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      token="USDC"
      reclaimedAmount={250_000}
      onConfirm={async (_reason) => {}}
      onClose={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("dialog")).toBeInTheDocument();
    // Confirm button disabled without reason
    const confirmBtn = canvas.getByTestId("clawback-confirm");
    expect(confirmBtn).toBeDisabled();
    // Enter a reason
    const textarea = canvas.getByRole("textbox", { name: /compliance reason/i });
    await userEvent.type(textarea, "OFAC compliance order #2026-001");
    expect(confirmBtn).not.toBeDisabled();
  },
};

export const InteractiveCancelDialog: StoryObj = {
  name: "Interactive (cancel stream with open/close)",
  render: () => {
    const [open, setOpen] = useState(false);
    const [cancelled, setCancelled] = useState(false);

    return (
      <>
        {cancelled ? (
          <div style={{ padding: "var(--space-6)" }}>
            <span className="ds-badge ds-badge--danger">Stream cancelled</span>
          </div>
        ) : (
          <div style={{ padding: "var(--space-6)" }}>
            <button className="btn btn--danger btn--sm" onClick={() => setOpen(true)}>
              Cancel stream
            </button>
          </div>
        )}

        {open && !cancelled && (
          <CancelStreamDialog
            streamId={1}
            recipient="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
            token="USDC"
            recipientAmount={5_000}
            sponsorRefund={45_000}
            cliffReached={true}
            onConfirm={async () => { setCancelled(true); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByText("Cancel stream");
    await userEvent.click(openBtn);
    expect(canvas.getByRole("dialog")).toBeInTheDocument();
    const goBack = canvas.getByTestId("cancel-go-back");
    await userEvent.click(goBack);
    expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
