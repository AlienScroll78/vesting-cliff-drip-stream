/**
 * TxStatusModal — transaction status modal with live feedback (#763)
 *
 * Shows the current phase of a Stellar transaction:
 *   ⏳ Submitting to network...
 *   ⏳ Waiting for ledger inclusion...
 *   ✅ Confirmed in ledger #XXXXXX
 *   ❌ Failed: [user-friendly error message]
 *
 * Features:
 * - Confetti burst on success (uses existing ConfettiBurst component)
 * - Dismiss button (only available after terminal phase)
 * - Accessible: focus-trapped, labelled dialog, live region for status updates
 * - Stellar Expert explorer link on success
 */

import React, { useEffect, useRef, useState } from "react";
import { TxPhase, TxStatus } from "@/hooks/useTxStatus";
import { ConfettiBurst } from "@/components/ConfettiBurst";

// ── Phase display config ──────────────────────────────────────────────────────

interface PhaseConfig {
  icon: string;
  label: string;
  description: string;
  done: boolean;
}

function getPhaseConfig(
  phase: TxPhase,
  ledger: number | null,
  errorMessage: string | null,
  amountClaimed: number | null,
): PhaseConfig {
  switch (phase) {
    case "submitting":
      return {
        icon: "⏳",
        label: "Submitting to network",
        description: "Your transaction is being signed and sent to the Stellar network…",
        done: false,
      };
    case "pending":
      return {
        icon: "⏳",
        label: "Waiting for ledger inclusion",
        description: "Your transaction has been submitted. Waiting for it to be included in a ledger…",
        done: false,
      };
    case "confirmed":
      return {
        icon: "✅",
        label: `Confirmed in ledger #${ledger ?? "—"}`,
        description: amountClaimed !== null
          ? `Successfully claimed ${amountClaimed.toLocaleString()} tokens.`
          : "Your transaction was confirmed on the Stellar network.",
        done: true,
      };
    case "failed":
      return {
        icon: "❌",
        label: "Transaction failed",
        description: errorMessage ?? "Your transaction could not be processed.",
        done: true,
      };
    default:
      return {
        icon: "⏳",
        label: "Processing",
        description: "Please wait…",
        done: false,
      };
  }
}

// ── Progress steps ────────────────────────────────────────────────────────────

type StepState = "done" | "active" | "pending" | "error";

interface Step {
  id: string;
  label: string;
  state: StepState;
}

function buildSteps(phase: TxPhase): Step[] {
  const isFailed = phase === "failed";

  return [
    {
      id: "submitting",
      label: "Submitting to network",
      state: phaseToStepState("submitting", phase, isFailed),
    },
    {
      id: "pending",
      label: "Waiting for ledger inclusion",
      state: phaseToStepState("pending", phase, isFailed),
    },
    {
      id: "confirmed",
      label: "Confirmed",
      state: phaseToStepState("confirmed", phase, isFailed),
    },
  ];
}

const PHASE_ORDER: TxPhase[] = ["submitting", "pending", "confirmed", "failed"];

function phaseToStepState(
  stepPhase: TxPhase,
  currentPhase: TxPhase,
  isFailed: boolean,
): StepState {
  const stepIdx = PHASE_ORDER.indexOf(stepPhase);
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);

  if (stepPhase === "confirmed" && isFailed) return "error";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

// ── Stellar Expert URL ────────────────────────────────────────────────────────

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/tx";

function explorerUrl(hash: string): string {
  return `${STELLAR_EXPERT_BASE}/${hash}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface TxStatusModalProps {
  /** Current transaction status from useTxStatus. */
  status: TxStatus;
  /** Called when the user dismisses the modal (only available at terminal state). */
  onClose: () => void;
  /** Whether the modal is visible. */
  open: boolean;
  /** Network for Stellar Expert link. Defaults to "testnet". */
  network?: "testnet" | "mainnet" | "pubnet";
}

/**
 * TxStatusModal renders a modal dialog showing the live status of a Stellar
 * transaction, with phase steps, explorer link, and confetti on success.
 */
export function TxStatusModal({
  status,
  onClose,
  open,
  network = "testnet",
}: TxStatusModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [confettiDone, setConfettiDone] = useState(false);

  const { phase, hash, ledger, errorMessage, amountClaimed } = status;
  const config = getPhaseConfig(phase, ledger, errorMessage, amountClaimed);
  const steps = buildSteps(phase);
  const isTerminal = phase === "confirmed" || phase === "failed";

  // Move focus into the dialog when it opens
  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open]);

  // Close on Escape (only when terminal so users don't accidentally dismiss)
  useEffect(() => {
    if (!open || !isTerminal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, isTerminal, onClose]);

  if (!open) return null;

  const explorerLink =
    hash
      ? `https://stellar.expert/explorer/${network === "pubnet" ? "public" : network}/tx/${hash}`
      : null;

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 900,
          backdropFilter: "blur(2px)",
        }}
        aria-hidden="true"
        onClick={isTerminal ? onClose : undefined}
      />

      {/* Confetti on success */}
      {phase === "confirmed" && (
        <ConfettiBurst
          active={!confettiDone}
          onDone={() => setConfettiDone(true)}
        />
      )}

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Transaction status"
        tabIndex={-1}
        style={{
          position: "fixed",
          inset: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 901,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "var(--color-surface, #fff)",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: "var(--radius-lg, 1rem)",
            padding: "2rem",
            maxWidth: 440,
            width: "calc(100vw - 2rem)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          {/* Header */}
          <div style={{ textAlign: "center" }}>
            <span
              aria-hidden="true"
              style={{
                fontSize: "2.5rem",
                display: "block",
                marginBottom: "0.5rem",
                animation: isTerminal ? "none" : "pulse 1.5s ease-in-out infinite",
              }}
            >
              {config.icon}
            </span>
            <h2
              style={{
                fontSize: "1.125rem",
                fontWeight: 700,
                margin: 0,
                color: phase === "failed"
                  ? "var(--color-cancelled, #b91c1c)"
                  : "var(--color-text, #111827)",
              }}
            >
              {config.label}
            </h2>
            {/* Live region so screen-readers announce updates */}
            <p
              aria-live="polite"
              aria-atomic="true"
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.875rem",
                color: "var(--color-text-muted, #6b7280)",
                lineHeight: 1.5,
              }}
            >
              {config.description}
            </p>
          </div>

          {/* Phase steps */}
          <ol
            aria-label="Transaction phases"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {steps.map((step) => (
              <li
                key={step.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  fontSize: "0.875rem",
                }}
              >
                <StepIcon state={step.state} />
                <span
                  style={{
                    color: step.state === "pending"
                      ? "var(--color-text-muted, #6b7280)"
                      : "var(--color-text, #111827)",
                    fontWeight: step.state === "active" ? 600 : 400,
                  }}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ol>

          {/* Transaction hash */}
          {hash && (
            <div
              style={{
                padding: "0.625rem 0.875rem",
                background: "var(--color-bg, #f9fafb)",
                border: "1px solid var(--color-border, #e5e7eb)",
                borderRadius: "var(--radius, 0.5rem)",
                fontSize: "0.75rem",
                fontFamily: "monospace",
                wordBreak: "break-all",
                color: "var(--color-text-muted, #6b7280)",
              }}
            >
              <strong style={{ fontFamily: "inherit" }}>Tx: </strong>
              {hash}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {explorerLink && isTerminal && (
              <a
                href={explorerLink}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  fontSize: "0.875rem",
                  color: "var(--color-active, #1d6ae5)",
                  textDecoration: "underline",
                }}
              >
                View on Stellar Expert ↗
              </a>
            )}

            {isTerminal && (
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "40px",
                  padding: "0.5rem 1.25rem",
                  background: "var(--color-active, #1d6ae5)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius, 0.5rem)",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  cursor: "pointer",
                }}
              >
                {phase === "confirmed" ? "Done" : "Dismiss"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Step icon ─────────────────────────────────────────────────────────────────

function StepIcon({ state }: { state: StepState }) {
  const icons: Record<StepState, { icon: string; color: string }> = {
    done: { icon: "✓", color: "var(--color-success, #15803d)" },
    active: { icon: "●", color: "var(--color-active, #1d6ae5)" },
    pending: { icon: "○", color: "var(--color-text-muted, #9ca3af)" },
    error: { icon: "✗", color: "var(--color-cancelled, #b91c1c)" },
  };

  const { icon, color } = icons[state];

  return (
    <span
      aria-hidden="true"
      style={{
        width: "1.25rem",
        height: "1.25rem",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        fontSize: "0.75rem",
        fontWeight: 700,
        flexShrink: 0,
        color,
        animation: state === "active" ? "pulse 1.5s ease-in-out infinite" : "none",
      }}
    >
      {icon}
    </span>
  );
}

export default TxStatusModal;
