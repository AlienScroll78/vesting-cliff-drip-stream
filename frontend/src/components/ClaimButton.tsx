"use client";
import { useId, useRef, useState } from "react";
import { ClaimPhase } from "@/hooks/useClaimVested";
import { formatAmount } from "@/utils/formatAmount";

// ── Tiny inline spinner ───────────────────────────────────────────────────────

function Spinner({ size = "1rem" }: { size?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="claim-btn-spinner"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid rgba(255,255,255,0.4)",
        borderTopColor: "#fff",
        borderRadius: "50%",
        animation: "claim-spin 0.6s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

// ── Tooltip wrapper ───────────────────────────────────────────────────────────

interface DisabledTooltipProps {
  message: string;
  children: React.ReactNode;
}

function DisabledTooltip({ message, children }: DisabledTooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={wrapperRef}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      {/* Invisible overlay so the disabled button still receives pointer events */}
      <span
        aria-describedby={id}
        style={{
          display: "contents",
          cursor: "not-allowed",
        }}
      >
        {children}
      </span>

      {visible && (
        <span
          role="tooltip"
          id={id}
          data-testid="claim-btn-tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--color-surface, #fff)",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: "var(--radius, 0.5rem)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
            color: "var(--color-text, #111827)",
            fontSize: "0.8rem",
            lineHeight: 1.45,
            maxWidth: "18rem",
            padding: "0.5rem 0.75rem",
            pointerEvents: "none",
            whiteSpace: "normal",
            width: "max-content",
            zIndex: 50,
          }}
        >
          {message}
        </span>
      )}
    </span>
  );
}

// ── Derived label / icon helpers ──────────────────────────────────────────────

function phaseLabel(phase: ClaimPhase): string {
  switch (phase) {
    case "signing":  return "Signing…";
    case "pending":  return "Pending…";
    case "success":  return "Claimed ✓";
    case "error":    return "Retry";
    default:         return "Claim";
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ClaimButtonProps {
  /** Current phase from the useClaimVested state machine. */
  phase: ClaimPhase;
  /** Whether the cliff has been reached (disables when false). */
  cliffReached: boolean;
  /** Ledgers until the cliff (used in tooltip when cliff not reached). */
  ledgersUntilCliff?: number;
  /** How many tokens are available to claim (disables when 0). */
  claimableAmount: number;
  /** Token symbol shown in success state. */
  tokenSymbol: string;
  /** Amount that was successfully claimed (used in success label). */
  amountClaimed?: number | null;
  /** Human-readable error message shown below the button on error. */
  errorMessage?: string | null;
  /** Called when the button is clicked in idle or error state. */
  onClick: () => void;
  /** className forwarded to the button element. */
  className?: string;
  /** Inline style forwarded to the button element. */
  style?: React.CSSProperties;
  /** Optional test id override (defaults to "claim-button"). */
  "data-testid"?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * `ClaimButton` — a self-contained button that reflects every phase of the
 * `useClaimVested` state machine:
 *
 * - **idle**    → primary "Claim" button (enabled when cliff passed & amount > 0)
 * - **signing** → spinner + "Signing…" (disabled)
 * - **pending** → spinner + "Pending…" (disabled)
 * - **success** → green "Claimed ✓" with amount (disabled; call reset to reuse)
 * - **error**   → "Retry" (re-enabled) + inline error message
 *
 * Disabled reasons surface as accessible tooltips on hover/focus.
 */
export function ClaimButton({
  phase,
  cliffReached,
  ledgersUntilCliff,
  claimableAmount,
  tokenSymbol,
  amountClaimed,
  errorMessage,
  onClick,
  className,
  style,
  "data-testid": testId = "claim-button",
}: ClaimButtonProps) {
  // Determine the disable reason (null = enabled)
  const isInFlight = phase === "signing" || phase === "pending";
  const isSuccess = phase === "success";

  let disabledReason: string | null = null;

  if (isInFlight || isSuccess) {
    disabledReason = null; // disabled by state, no tooltip needed
  } else if (!cliffReached) {
    disabledReason =
      ledgersUntilCliff != null && ledgersUntilCliff > 0
        ? `Cliff not reached yet — approximately ${ledgersToHuman(ledgersUntilCliff)} remaining (${ledgersUntilCliff.toLocaleString()} ledgers).`
        : "Cliff not reached yet. Your tokens are still locked.";
  } else if (claimableAmount <= 0) {
    disabledReason = "Nothing to claim right now — wait for more tokens to accrue.";
  }

  const isDisabled = isInFlight || isSuccess || disabledReason !== null;
  const showSpinner = isInFlight;

  // Compute button label
  let label: string;
  if (phase === "success" && amountClaimed != null) {
    label = `Claimed ${formatAmount(amountClaimed)} ${tokenSymbol} ✓`;
  } else {
    label = phaseLabel(phase);
  }

  // Button variant colour
  const variantClass =
    phase === "success"
      ? "btn-success"
      : phase === "error"
      ? "btn-primary"
      : "btn-primary";

  const btn = (
    <button
      type="button"
      className={`btn ${variantClass}${className ? ` ${className}` : ""}`}
      onClick={!isDisabled ? onClick : undefined}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={isInFlight}
      aria-live="polite"
      data-testid={testId}
      data-phase={phase}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        opacity: isSuccess ? 0.85 : undefined,
        ...(phase === "success"
          ? { background: "var(--color-completed, #15803d)", color: "#fff", borderColor: "var(--color-completed, #15803d)" }
          : {}),
        ...style,
      }}
    >
      {showSpinner && <Spinner />}
      {label}
    </button>
  );

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "0.3rem" }}>
      {/* Wrap with tooltip only when disabled for a user-visible reason */}
      {disabledReason && !isInFlight && !isSuccess ? (
        <DisabledTooltip message={disabledReason}>{btn}</DisabledTooltip>
      ) : (
        btn
      )}

      {/* Inline error message */}
      {phase === "error" && errorMessage && (
        <span
          role="alert"
          data-testid="claim-btn-error"
          style={{
            fontSize: "0.78rem",
            color: "var(--color-cancelled, #b91c1c)",
            maxWidth: "16rem",
            lineHeight: 1.4,
          }}
        >
          {errorMessage}
        </span>
      )}
    </span>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** ~5 s per ledger — same constant used in ClaimBottomSheet. */
function ledgersToHuman(ledgers: number): string {
  const seconds = ledgers * 5;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

/*
 * Inject the spin keyframe once (idempotent check via dataset).
 * This avoids pulling in a CSS file just for the animation.
 */
if (typeof document !== "undefined" && !document.getElementById("claim-btn-styles")) {
  const style = document.createElement("style");
  style.id = "claim-btn-styles";
  style.textContent = `@keyframes claim-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}
