"use client";
/**
 * ErrorBoundary — enhanced error boundaries (#275)
 *
 * Exports:
 *  - `logError`              — abstracted error reporter (console + optional Sentry)
 *  - `ErrorBoundary`         — top-level boundary; full-page fallback with details
 *  - `StreamCardErrorBoundary` — lightweight per-card boundary; inline fallback
 *
 * Sentry integration is opt-in: set NEXT_PUBLIC_SENTRY_DSN in your environment
 * and `@sentry/react` will be dynamically imported and used automatically.
 * No Sentry package is required when the DSN is absent.
 */

import React, { Component, ReactNode, ErrorInfo } from "react";

// ─── Abstracted error logger (Sentry hook-ready) ──────────────────────────────

/**
 * Log an error to the browser console (always) and to Sentry when
 * `NEXT_PUBLIC_SENTRY_DSN` is present in the environment.
 *
 * Pass `context` for any structured extra data you want to attach.
 */
export function logError(
  error: Error,
  errorInfo: ErrorInfo | { componentStack?: string } | null,
  context?: Record<string, unknown>,
): void {
  // Always log to console with full stack trace
  console.error(
    "[ErrorBoundary] Uncaught error:",
    error,
    "\nComponent stack:",
    errorInfo?.componentStack ?? "(unavailable)",
    ...(context ? ["\nContext:", context] : []),
  );

  // Optional Sentry integration — dynamically imported only when DSN is set
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SENTRY_DSN
  ) {
    import("@sentry/react")
      .then(({ captureException }) =>
        captureException(error, {
          extra: { ...(errorInfo ?? {}), ...context },
        }),
      )
      .catch(() => {
        /* Sentry unavailable — fail silently so the app keeps running */
      });
  }
}

// ─── Shared styles (CSS custom properties from globals.css) ───────────────────

const sharedStyles = {
  retryBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
    padding: "0.5rem 1.25rem",
    background: "var(--color-active, #1d6ae5)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius, 0.5rem)",
    fontWeight: 600,
    fontSize: "1rem",
    cursor: "pointer",
  } as React.CSSProperties,

  homeLink: {
    color: "var(--color-active, #1d6ae5)",
    fontSize: "0.875rem",
    textDecoration: "underline",
  } as React.CSSProperties,

  details: {
    marginTop: "0.75rem",
    textAlign: "left" as const,
    width: "100%",
    maxWidth: "640px",
  } as React.CSSProperties,

  detailsSummary: {
    cursor: "pointer",
    fontSize: "0.8125rem",
    color: "var(--color-cancelled, #b91c1c)",
    fontWeight: 600,
    userSelect: "none" as const,
    listStyle: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
  } as React.CSSProperties,

  pre: {
    marginTop: "0.5rem",
    padding: "0.75rem",
    background: "var(--color-surface, #fff)",
    border: "1px solid var(--color-border, #e5e7eb)",
    borderRadius: "var(--radius, 0.5rem)",
    fontSize: "0.75rem",
    lineHeight: 1.5,
    overflow: "auto",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    color: "var(--color-text, #111827)",
    maxHeight: "200px",
  } as React.CSSProperties,
} as const;

// ─── Collapsible error details ────────────────────────────────────────────────

interface ErrorDetailsProps {
  error: Error;
  componentStack?: string | null;
}

function ErrorDetails({ error, componentStack }: ErrorDetailsProps) {
  return (
    <details style={sharedStyles.details}>
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <summary style={sharedStyles.detailsSummary}>
        ▶ Show technical details
      </summary>
      <pre style={sharedStyles.pre}>
        <strong>{error.name}: {error.message}</strong>
        {error.stack ? `\n\n${error.stack}` : ""}
        {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
      </pre>
    </details>
  );
}

// ─── Top-level ErrorBoundary ──────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional custom fallback renderer. Receives `(reset, error)` so callers
   * can build their own UI while delegating reset logic to the boundary.
   */
  fallback?: (reset: () => void, error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Top-level error boundary — wrap the entire app (or large page sections).
 *
 * Shows a full-page fallback with:
 *  - Accessible `role="alert"` container
 *  - Error message
 *  - Collapsible technical details (`<details>`)
 *  - "Retry" button that resets boundary state
 *  - "Go to home page" link
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    logError(error, info);
  }

  reset = (): void => this.setState({ error: null, componentStack: null });

  render(): ReactNode {
    const { error, componentStack } = this.state;

    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(this.reset, error);
      }
      return (
        <TopLevelFallback
          error={error}
          componentStack={componentStack}
          reset={this.reset}
        />
      );
    }

    return this.props.children;
  }
}

// ─── Top-level fallback UI ────────────────────────────────────────────────────

interface TopLevelFallbackProps {
  error: Error;
  componentStack: string | null;
  reset: () => void;
}

function TopLevelFallback({
  error,
  componentStack,
  reset,
}: TopLevelFallbackProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      {/* Decorative error icon — hidden from screen readers */}
      <span aria-hidden="true" style={{ fontSize: "3rem", lineHeight: 1 }}>
        ⚠️
      </span>

      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          margin: 0,
          color: "var(--color-text, #111827)",
        }}
      >
        Something went wrong
      </h1>

      <p
        style={{
          margin: 0,
          color: "var(--color-text, #111827)",
          opacity: 0.7,
          maxWidth: "420px",
        }}
      >
        An unexpected error occurred. If the problem persists, please contact
        support.
      </p>

      <div
        style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}
      >
        <button type="button" onClick={reset} style={sharedStyles.retryBtn}>
          Retry
        </button>
        <a href="/" style={sharedStyles.homeLink}>
          Go to home page
        </a>
      </div>

      <ErrorDetails error={error} componentStack={componentStack} />
    </div>
  );
}

// ─── StreamCardErrorBoundary ──────────────────────────────────────────────────

interface StreamCardErrorBoundaryProps {
  children: ReactNode;
  /** Shown in the inline error banner as context. Defaults to "This stream". */
  streamLabel?: string;
}

interface StreamCardErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Lightweight per-card error boundary — wrap individual stream cards so a
 * single broken card cannot crash the entire list.
 *
 * Shows a compact inline error banner with:
 *  - Accessible `role="alert"` container
 *  - Short error summary
 *  - Collapsible `<details>` for the full stack trace
 *  - "Retry" button to reset this card's boundary
 */
export class StreamCardErrorBoundary extends Component<
  StreamCardErrorBoundaryProps,
  StreamCardErrorBoundaryState
> {
  state: StreamCardErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<StreamCardErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    logError(error, info, {
      context: "StreamCardErrorBoundary",
      streamLabel: this.props.streamLabel,
    });
  }

  reset = (): void => this.setState({ error: null, componentStack: null });

  render(): ReactNode {
    const { error, componentStack } = this.state;

    if (error) {
      const label = this.props.streamLabel ?? "This stream";
      return (
        <StreamCardFallback
          error={error}
          componentStack={componentStack}
          label={label}
          reset={this.reset}
        />
      );
    }

    return this.props.children;
  }
}

// ─── Per-card fallback UI ─────────────────────────────────────────────────────

interface StreamCardFallbackProps {
  error: Error;
  componentStack: string | null;
  label: string;
  reset: () => void;
}

function StreamCardFallback({
  error,
  componentStack,
  label,
  reset,
}: StreamCardFallbackProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="stream-card"
      style={{
        borderColor: "var(--color-cancelled, #b91c1c)",
        background: "var(--color-surface, #fff)",
        padding: "0.875rem 1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.625rem",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{ fontSize: "1.1rem", flexShrink: 0 }}
          >
            ⚠️
          </span>
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-cancelled, #b91c1c)",
            }}
          >
            {label} failed to render
          </span>
        </div>

        <button
          type="button"
          onClick={reset}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "36px",
            padding: "0.25rem 0.875rem",
            background: "var(--color-active, #1d6ae5)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius, 0.5rem)",
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Retry
        </button>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: "0.8125rem",
          color: "var(--color-text, #111827)",
          opacity: 0.7,
        }}
      >
        {error.message || "An unexpected error occurred."}
      </p>

      <ErrorDetails error={error} componentStack={componentStack} />
    </div>
  );
}
