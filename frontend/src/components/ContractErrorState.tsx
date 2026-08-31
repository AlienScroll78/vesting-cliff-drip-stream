"use client";

import { getErrorInfo } from "@/errorMessages";
import { ErrorStateIllustration } from "@/components/ErrorStateIllustration";

interface ContractErrorStateProps {
  /** VestingError code (1–11). Unknown codes fall back to "unexpected" category. */
  code: number;
  /** Called when the user clicks "Try Again". Only shown for retryable errors. */
  onRetry?: () => void;
  /** Extra CSS class to apply to the root element. */
  className?: string;
}

/**
 * Full error state for a VestingError code.
 *
 * Renders:
 *   - A category illustration (network / auth / contract / unexpected)
 *   - A user-friendly title and explanation
 *   - An action hint
 *   - A "Try Again" button for retryable / network errors (requires onRetry)
 *   - A docs / support link for unexpected errors
 *   - An FAQ link when available
 */
export function ContractErrorState({
  code,
  onRetry,
  className,
}: ContractErrorStateProps) {
  const info = getErrorInfo(code);
  const isNetwork = info.category === "network";
  const isUnexpected = info.category === "unexpected";
  const showRetry = info.retryable && onRetry;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={className}
      style={styles.container}
    >
      {/* Illustration */}
      <div style={styles.illustration}>
        <ErrorStateIllustration category={info.category} size={80} />
      </div>

      {/* Text */}
      <div style={styles.textBlock}>
        <h2 style={styles.title}>{info.title}</h2>
        <p style={styles.explanation}>{info.explanation}</p>
        <p style={styles.action}>{info.action}</p>
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        {/* Retry button — network errors or any retryable error when onRetry provided */}
        {showRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              ...styles.primaryBtn,
              ...(isNetwork ? styles.networkBtn : {}),
            }}
          >
            {isNetwork ? "Try Again" : "Retry"}
          </button>
        )}

        {/* Unexpected error — docs / support link */}
        {isUnexpected && (
          <a
            href="https://github.com/AlienScroll78/vesting-cliff-drip-stream/blob/main/docs/error-handling.md"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.docsLink}
          >
            View documentation ↗
          </a>
        )}

        {/* FAQ link when available */}
        {info.faqUrl && (
          <a
            href={info.faqUrl}
            style={styles.faqLink}
            aria-label={`Learn more: ${info.title}`}
          >
            Learn more
          </a>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-8, 2rem) var(--space-6, 1.5rem)",
    gap: "var(--space-4, 1rem)",
    textAlign: "center" as const,
    background: "var(--color-bg-surface, #1E293B)",
    borderRadius: "var(--radius-lg, 0.75rem)",
    border: "1px solid var(--color-border, #334155)",
    maxWidth: "480px",
    margin: "0 auto",
  },
  illustration: {
    lineHeight: 1,
  },
  textBlock: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "var(--space-2, 0.5rem)",
    maxWidth: "36ch",
  },
  title: {
    fontSize: "var(--font-size-lg, 1.125rem)",
    fontWeight: "var(--font-weight-semibold, 600)" as unknown as number,
    color: "var(--color-text-primary, #F8FAFC)",
    margin: 0,
    lineHeight: "var(--line-height-tight, 1.25)",
  },
  explanation: {
    fontSize: "var(--font-size-sm, 0.875rem)",
    color: "var(--color-text-secondary, #94A3B8)",
    margin: 0,
    lineHeight: "var(--line-height-base, 1.5)",
  },
  action: {
    fontSize: "var(--font-size-sm, 0.875rem)",
    color: "var(--color-text-primary, #F8FAFC)",
    margin: 0,
    lineHeight: "var(--line-height-base, 1.5)",
    fontStyle: "italic",
  },
  actions: {
    display: "flex" as const,
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-3, 0.75rem)",
    marginTop: "var(--space-2, 0.5rem)",
  },
  primaryBtn: {
    padding: "var(--space-2, 0.5rem) var(--space-6, 1.5rem)",
    background: "var(--color-brand-primary, #7C3AED)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius-base, 0.5rem)",
    cursor: "pointer",
    fontSize: "var(--font-size-sm, 0.875rem)",
    fontWeight: 500,
    transition: "opacity 150ms ease",
  },
  networkBtn: {
    background: "var(--color-warning, #F59E0B)",
    color: "#000",
  },
  docsLink: {
    color: "var(--color-text-secondary, #94A3B8)",
    fontSize: "var(--font-size-sm, 0.875rem)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  faqLink: {
    color: "var(--color-accent, #06B6D4)",
    fontSize: "var(--font-size-xs, 0.75rem)",
    textDecoration: "none",
    borderBottom: "1px dashed currentColor",
  },
} as const;
