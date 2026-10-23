"use client";

import { useEffect, useId, useRef, useState } from "react";
import { trapFocus } from "@/utils/focusTrap";
import { formatAmount } from "@/utils/formatAmount";
import type { VestingStream } from "@/types";

export interface ClawbackStreamModalProps {
  stream: VestingStream;
  onClawback: (stream: VestingStream, reason: string) => Promise<number>;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

export function ClawbackStreamModal({
  stream,
  onClawback,
  onClose,
}: ClawbackStreamModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnedAmount, setReturnedAmount] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const reasonHelpId = useId();
  const amountToRecover = stream.clawbackAmount;

  useEffect(() => {
    if (!containerRef.current) return;
    return trapFocus(containerRef.current);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  async function handleConfirm() {
    if (step !== 3 || !reason.trim() || amountToRecover === undefined || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      setReturnedAmount(await onClawback(stream, reason.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Clawback failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const successMessage =
    returnedAmount === null
      ? null
      : `Clawback complete. ${formatAmount(returnedAmount)} tokens returned to your wallet.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="clawback-stream-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(0,0,0,0.55)",
      }}
    >
      <section
        ref={containerRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          width: "100%",
          maxWidth: "32rem",
          padding: "1.5rem",
          border: "2px solid #b91c1c",
          borderRadius: "0.75rem",
          background: "var(--color-surface, #fff)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <header>
          <h2 id={titleId} style={{ margin: 0, color: "#991b1b" }}>
            Compliance Clawback
          </h2>
          <p style={{ margin: "0.35rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
            Step {step} of 3
          </p>
        </header>

        <div
          role="alert"
          data-testid="clawback-warning"
          style={{
            padding: "0.75rem",
            border: "1px solid #dc2626",
            borderRadius: "0.375rem",
            background: "#fef2f2",
            color: "#7f1d1d",
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          This action is irreversible. All remaining tokens will be returned to you.
        </div>

        {successMessage ? (
          <p role="status" aria-live="polite" data-testid="clawback-success">
            {successMessage}
          </p>
        ) : (
          <>
            {step === 1 && (
              <div>
                <p>
                  Clawback is a compliance action for tokens whose issuer enabled the SAC
                  clawback flag. It permanently ends this stream and returns all remaining
                  tokens to the original sponsor; the recipient will no longer be able to claim
                  them.
                </p>
                <p>
                  Recipient: <code>{stream.recipient}</code>
                </p>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "grid", gap: "0.4rem" }}>
                <label htmlFor={reasonId}>
                  Reason for clawback <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id={reasonId}
                  aria-describedby={reasonHelpId}
                  aria-required="true"
                  maxLength={256}
                  rows={4}
                  value={reason}
                  disabled={submitting}
                  onChange={(event) => setReason(event.target.value)}
                  data-testid="clawback-reason"
                />
                <div
                  id={reasonHelpId}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}
                >
                  <span>A reason is required for this compliance action.</span>
                  <span aria-live="polite" data-testid="clawback-reason-counter">
                    {reason.length}/256
                  </span>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <p>
                  Confirm clawback of{" "}
                  <strong data-testid="clawback-amount">
                    {amountToRecover === undefined
                      ? "Amount unavailable"
                      : `${formatAmount(amountToRecover)} ${stream.token}`}
                  </strong>{" "}
                  from the stream for <code>{stream.recipient}</code>.
                </p>
                <p>This is your final confirmation. The stream cannot be restored.</p>
              </div>
            )}

            {error && (
              <p role="alert" data-testid="clawback-error" style={{ color: "#991b1b" }}>
                {error}
              </p>
            )}

            <footer style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <button type="button" onClick={onClose} disabled={submitting} autoFocus>
                Cancel
              </button>
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((current) => (current - 1) as Step)}
                  disabled={submitting}
                >
                  Back
                </button>
              )}
              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => setStep((current) => (current + 1) as Step)}
                  disabled={
                    submitting ||
                    (step === 2 && !reason.trim())
                  }
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting || amountToRecover === undefined || !reason.trim()}
                  data-testid="clawback-final-confirm"
                >
                  {submitting ? "Processing..." : "Confirm clawback"}
                </button>
              )}
            </footer>
          </>
        )}

        {successMessage && (
          <button type="button" onClick={onClose} autoFocus>
            Done
          </button>
        )}
      </section>
    </div>
  );
}
