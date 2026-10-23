import React, { useState, useCallback } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Toast",
  parameters: {
    docs: {
      description: {
        component:
          "Toast notification region. Fixed position in the bottom-right corner. " +
          "Four severity variants: success (green), warning (yellow), danger (red), info (blue). " +
          "Success and info toasts use role='status' (polite); warning and danger toasts use role='alert' (assertive). " +
          "Error toasts include a 'Copy error details' action for user support.",
      },
    },
  },
};
export default meta;

// ── Icons (inline SVG to avoid external deps) ────────────────────────────────
const SuccessIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden="true">
    <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const WarningIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden="true">
    <path d="M8 2L1 14h14L8 2z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 7v3M8 12v.5" strokeLinecap="round" />
  </svg>
);
const DangerIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="8" r="7" />
    <path d="M8 4v5M8 11.5v.5" strokeLinecap="round" />
  </svg>
);
const InfoIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="8" r="7" />
    <path d="M8 7v4M8 5v.5" strokeLinecap="round" />
  </svg>
);
const CopyIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="11" height="11" aria-hidden="true">
    <rect x="5" y="5" width="8" height="8" rx="1" />
    <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" strokeLinecap="round" />
  </svg>
);

const ICONS = {
  success: <SuccessIcon />,
  warning: <WarningIcon />,
  danger: <DangerIcon />,
  info: <InfoIcon />,
};

type ToastVariant = "success" | "warning" | "danger" | "info";

interface ToastProps {
  variant: ToastVariant;
  title: string;
  message?: string;
  errorCode?: number;
  errorName?: string;
  onDismiss?: () => void;
  onCopyError?: () => void;
  onRetry?: () => void;
  durationMs?: number;
}

// ── Toast component (presentational) ─────────────────────────────────────────
function Toast({
  variant,
  title,
  message,
  errorCode,
  errorName,
  onDismiss,
  onCopyError,
  onRetry,
  durationMs,
}: ToastProps) {
  const role = variant === "danger" || variant === "warning" ? "alert" : "status";
  const showErrorActions = variant === "danger" && (errorCode !== undefined || onCopyError);

  return (
    <div
      className={`ds-toast ds-toast--${variant}`}
      role={role}
      style={{ position: "relative" }}
    >
      {/* Progress bar for auto-dismiss */}
      {durationMs && (
        <div
          className="ds-toast__progress"
          style={{ width: "100%" }}
          aria-hidden="true"
        />
      )}

      <span className="ds-toast__icon">{ICONS[variant]}</span>

      <div className="ds-toast__content">
        <span className="ds-toast__title">{title}</span>
        {message && <span className="ds-toast__message">{message}</span>}

        {showErrorActions && (
          <div className="ds-toast__actions">
            {onCopyError && (
              <button
                type="button"
                className="ds-toast__action-btn"
                onClick={onCopyError}
                aria-label="Copy error details to clipboard for support"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
              >
                <CopyIcon /> Copy error details
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="ds-toast__action-btn"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          className="ds-toast__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

export const AllVariants: StoryObj = {
  name: "All Variants",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast variant="success" title="Claim confirmed on-chain" message="12 450 USDC claimed on ledger #48 291 774." />
      <Toast variant="warning" title="Transaction pending" message="Waiting for network confirmation." />
      <Toast variant="danger" title="Transaction failed" message="The transfer couldn't be completed." onRetry={() => {}} />
      <Toast variant="info" title="Stream created" message="Stream #42 created successfully." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Claim confirmed on-chain")).toBeInTheDocument();
    expect(canvas.getByRole("alert")).toBeInTheDocument();
  },
};

export const SuccessToast: StoryObj = {
  name: "Success",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast variant="success" title="Claim confirmed on-chain" message="12 450 USDC claimed on ledger #48 291 774." onDismiss={() => {}} />
    </div>
  ),
};

export const WarningToast: StoryObj = {
  name: "Warning",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast variant="warning" title="Transaction pending" message="Waiting for network confirmation. This may take a few seconds." />
    </div>
  ),
};

export const ErrorToast: StoryObj = {
  name: "Error",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast variant="danger" title="Transaction failed" message="The transfer couldn't be completed. Your tokens are safe." onRetry={() => {}} />
    </div>
  ),
};

export const InfoToast: StoryObj = {
  name: "Info",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast variant="info" title="Stream #42 created" message="The vesting schedule is now active." />
    </div>
  ),
};

// ── Copy Error Details feature ──────────────────────────────────────────────
export const CopyErrorDetails: StoryObj = {
  name: "Copy Error Details (contract error)",
  render: () => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
      const details = JSON.stringify({
        errorCode: 2,
        errorName: "CliffNotReached",
        timestamp: new Date().toISOString(),
        contract: "VestingDrips",
      }, null, 2);
      // In a real app: navigator.clipboard.writeText(details)
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, []);

    return (
      <div className="ds-toast-region" style={{ position: "static" }}>
        <Toast
          variant="danger"
          title="Your cliff date hasn't arrived yet"
          message="Tokens unlock in a single release once the cliff date passes."
          errorCode={2}
          errorName="CliffNotReached"
          onCopyError={handleCopy}
          onRetry={() => {}}
        />
        {copied && (
          <Toast variant="info" title="Error details copied to clipboard" message="Paste into a support message to help diagnose the issue." />
        )}
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copyBtn = canvas.getByText("Copy error details");
    expect(copyBtn).toBeInTheDocument();
    await userEvent.click(copyBtn);
  },
};

// ── Error toast with VestingError code mapping ──────────────────────────────
export const ErrorWithErrorCode: StoryObj = {
  name: "Error with VestingError code",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast
        variant="danger"
        title="That deposit is too large"
        message="Rate multiplied by duration would exceed the maximum amount the contract can track."
        errorCode={5}
        errorName="DepositOverflow"
        onCopyError={() => {}}
      />
    </div>
  ),
};

// ── Auto-dismiss progress bar ────────────────────────────────────────────────
export const AutoDismiss: StoryObj = {
  name: "Auto-dismiss (progress bar)",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <Toast
        variant="success"
        title="Claim confirmed on-chain"
        message="12 450 USDC claimed on ledger #48 291 774."
        durationMs={5000}
        onDismiss={() => {}}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Success toasts auto-dismiss after 5 seconds with a progress bar showing the remaining time. " +
          "Error and warning toasts persist until manually dismissed (no auto-dismiss).",
      },
    },
  },
};

// ── Interactive: dismissable toast ──────────────────────────────────────────
export const InteractiveDismiss: StoryObj = {
  name: "Interactive (dismiss)",
  render: () => {
    const [visible, setVisible] = useState(true);
    return (
      <>
        {!visible && (
          <button className="btn btn--secondary" onClick={() => setVisible(true)}>
            Show toast
          </button>
        )}
        {visible && (
          <div className="ds-toast-region" style={{ position: "static" }}>
            <Toast
              variant="info"
              title="Welcome to VestingDrips"
              message="Your dashboard is ready. Click dismiss to hide this message."
              onDismiss={() => setVisible(false)}
            />
          </div>
        )}
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Welcome to VestingDrips")).toBeInTheDocument();
    const dismissBtn = canvas.getByLabelText("Dismiss notification");
    await userEvent.click(dismissBtn);
    expect(canvas.queryByText("Welcome to VestingDrips")).not.toBeInTheDocument();
  },
};
