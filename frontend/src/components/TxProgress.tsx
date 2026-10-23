/**
 * TxProgress — 4-step transaction confirmation stepper.
 *
 * Steps (in order):
 *   1. signed      — wallet has signed the transaction
 *   2. submitted   — transaction sent to the Soroban RPC node
 *   3. confirming  — waiting for ledger inclusion (1–5 s on Stellar mainnet)
 *   4. confirmed   — transaction landed; hash is available
 *
 * The active step is determined by the `currentStep` prop.  All steps before
 * the active step are rendered as "done"; the active step shows a spinner
 * (unless it is "confirmed"); steps after are "pending" (greyed out).
 *
 * If `failed` is true the active step is shown in the error state instead.
 *
 * Accessibility
 * ─────────────
 * • The stepper is a `<ol>` (ordered list) so screen readers convey the step
 *   count and position automatically.
 * • An `aria-live="polite"` status region announces the current step label to
 *   assistive technology whenever it changes, without interrupting other speech.
 * • The spinner is `aria-hidden` (motion is conveyed via the status region).
 * • Data attributes (`data-done`, `data-active`, `data-pending`, `data-failed`)
 *   drive all state styling — no JS class manipulation required.
 */

"use client";

import { useId, type ReactNode } from "react";
import styles from "./Skeletons.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TxStep = "signed" | "submitted" | "confirming" | "confirmed";

export interface TxProgressProps {
  /** The step currently in progress (or just completed if failed=false). */
  currentStep: TxStep;
  /** If true, the active step is rendered in the error / failed state. */
  failed?: boolean;
  /** Optional transaction hash shown beneath the "confirmed" step. */
  txHash?: string;
  /** Optional Stellar Expert base URL (defaults to testnet explorer). */
  explorerBaseUrl?: string;
  /** Extra class for the outer `<section>` wrapper. */
  className?: string;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

interface StepDef {
  id: TxStep;
  label: string;
  description: string;
  activeDescription: string;
  doneDescription: string;
}

const STEPS: StepDef[] = [
  {
    id: "signed",
    label: "Signed",
    description: "Waiting for your wallet signature…",
    activeDescription: "Your wallet is signing the transaction.",
    doneDescription: "Transaction signed by your wallet.",
  },
  {
    id: "submitted",
    label: "Submitted",
    description: "Waiting for submission to the network…",
    activeDescription: "Sending the transaction to the Soroban RPC node.",
    doneDescription: "Transaction submitted to the network.",
  },
  {
    id: "confirming",
    label: "Confirming",
    description: "Waiting for ledger confirmation…",
    activeDescription: "Transaction is being included in the ledger (usually 5–10 s).",
    doneDescription: "Transaction included in the ledger.",
  },
  {
    id: "confirmed",
    label: "Confirmed",
    description: "Waiting for confirmation…",
    activeDescription: "Transaction confirmed on the Stellar network.",
    doneDescription: "Transaction confirmed on the Stellar network.",
  },
];

const STEP_ORDER: TxStep[] = STEPS.map((s) => s.id);

function stepIndex(step: TxStep): number {
  return STEP_ORDER.indexOf(step);
}

// ─── Step icon ────────────────────────────────────────────────────────────────

function StepIcon({
  isDone,
  isActive,
  isFailed,
  isPending,
}: {
  isDone: boolean;
  isActive: boolean;
  isFailed: boolean;
  isPending: boolean;
}) {
  if (isDone)    return <span aria-hidden="true">✓</span>;
  if (isFailed)  return <span aria-hidden="true">✕</span>;
  if (isActive)  return <span aria-hidden="true">●</span>;
  return <span aria-hidden="true">○</span>;
}

// ─── TxProgress component ─────────────────────────────────────────────────────

const STELLAR_EXPERT_TESTNET = "https://stellar.expert/explorer/testnet/tx";

export function TxProgress({
  currentStep,
  failed = false,
  txHash,
  explorerBaseUrl = STELLAR_EXPERT_TESTNET,
  className,
}: TxProgressProps) {
  const statusId = useId();
  const currentIndex = stepIndex(currentStep);

  // Human-readable status for aria-live region
  const liveStatus = failed
    ? `Transaction failed at step: ${STEPS[currentIndex].label}.`
    : currentStep === "confirmed"
    ? "Transaction confirmed on the Stellar network."
    : `Step ${currentIndex + 1} of ${STEPS.length}: ${STEPS[currentIndex].activeDescription}`;

  return (
    <section
      className={className}
      aria-label="Transaction progress"
      data-testid="tx-progress"
    >
      {/* Hidden live region announces step changes to screen readers */}
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {liveStatus}
      </span>

      <ol className={styles.txProgress} aria-label="Transaction steps">
        {STEPS.map((step, idx) => {
          const isDone    = !failed && idx < currentIndex;
          const isActive  = idx === currentIndex && !failed;
          const isFailed  = idx === currentIndex && failed;
          const isPending = idx > currentIndex;
          const isConfirmedStep = step.id === "confirmed" && isActive;

          const description = isDone
            ? step.doneDescription
            : isActive || isFailed
            ? step.activeDescription
            : step.description;

          return (
            <li
              key={step.id}
              className={styles.txStep}
              data-done={isDone || undefined}
              data-active={isActive || undefined}
              data-failed={isFailed || undefined}
              data-pending={isPending || undefined}
              data-testid={`tx-step-${step.id}`}
            >
              {/* Step icon */}
              <div className={styles.txStepIcon} aria-hidden="true">
                <StepIcon
                  isDone={isDone}
                  isActive={isActive}
                  isFailed={isFailed}
                  isPending={isPending}
                />
              </div>

              {/* Step body */}
              <div className={styles.txStepBody}>
                <span className={styles.txStepLabel}>
                  {step.label}
                  {isActive && !isConfirmedStep && (
                    <span
                      className={styles.txStepSpinner}
                      aria-hidden="true"
                      data-testid={`tx-step-spinner-${step.id}`}
                    />
                  )}
                </span>
                <span className={styles.txStepDescription}>
                  {description}
                </span>

                {/* Tx hash link — only shown on the confirmed step */}
                {isConfirmedStep && txHash && (
                  <a
                    href={`${explorerBaseUrl}/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="tx-progress-hash-link"
                    style={{
                      fontSize: "0.78rem",
                      fontFamily: "monospace",
                      color: "var(--color-brand-primary, #7c3aed)",
                      marginTop: "0.2rem",
                      display: "inline-block",
                      wordBreak: "break-all",
                    }}
                  >
                    {txHash.slice(0, 12)}…{txHash.slice(-8)} ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─── Convenience hook ─────────────────────────────────────────────────────────

/**
 * Minimal hook to manage TxProgress state when used standalone (outside
 * TxProvider).  For most use cases prefer the existing `useTx()` hook from
 * TxDrawer.tsx and map its status to a `TxStep`.
 */
import { useState, useCallback } from "react";

export interface TxProgressState {
  currentStep: TxStep;
  failed: boolean;
  txHash?: string;
}

export function useTxProgress() {
  const [state, setState] = useState<TxProgressState>({
    currentStep: "signed",
    failed: false,
  });

  const advance = useCallback((step: TxStep, hash?: string) => {
    setState({ currentStep: step, failed: false, txHash: hash });
  }, []);

  const fail = useCallback(() => {
    setState((s) => ({ ...s, failed: true }));
  }, []);

  const reset = useCallback(() => {
    setState({ currentStep: "signed", failed: false });
  }, []);

  return { ...state, advance, fail, reset };
}
