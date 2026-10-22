"use client";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Custom fallback; receives reset callback. Defaults to ErrorFallback. */
  fallback?: (reset: () => void, error: Error) => ReactNode;
}

interface State {
  error: Error | null;
  correlationId: string | null;
}

function makeCorrelationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Top-level error boundary. Catches render-phase errors, logs them to the
 * console (and optionally Sentry if NEXT_PUBLIC_SENTRY_DSN is set), and
 * shows a fallback UI with a "Try Again" reset button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, correlationId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, correlationId: makeCorrelationId() };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const correlationId = this.state.correlationId;
    console.error("[ErrorBoundary] Uncaught error:", { correlationId, error, componentStack: info.componentStack });

    // Optional Sentry integration — only active when DSN env var is present.
    if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import("@sentry/react")
        .then(({ captureException }) => captureException(error, { tags: { correlationId: correlationId ?? "unknown" }, extra: { ...info, correlationId } }))
        .catch(() => {/* Sentry unavailable — fail silently */});
    }
  }

  reset = () => this.setState({ error: null, correlationId: null });

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback
        ? this.props.fallback(this.reset, error)
        : <DefaultFallback reset={this.reset} error={error} correlationId={this.state.correlationId} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ reset, error, correlationId }: { reset: () => void; error: Error; correlationId: string | null }) {
  return (
    <div role="alert" style={styles.container}>
      <h1 style={styles.heading}>Something went wrong</h1>
      <p style={styles.body}>
        An unexpected error occurred. Reload the page to continue.
      </p>
      {correlationId && <small>Reference: {correlationId}</small>}
      {process.env.NODE_ENV !== "production" && (
        <details><summary>Error details</summary><pre>{error.message}</pre></details>
      )}
      <button type="button" onClick={() => window.location.reload()} style={styles.button}>
        Reload
      </button>
      <a href="/" style={styles.link}>Go to home page</a>
    </div>
  );
}

const styles = {
  container: {
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    gap: "16px",
    padding: "32px",
    textAlign: "center" as const,
  },
  heading: { fontSize: "1.5rem", margin: 0 },
  body: { color: "var(--text, #666)", margin: 0 },
  button: {
    padding: "10px 24px",
    background: "var(--accent, #7c3aed)",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  link: { color: "var(--accent, #7c3aed)", fontSize: "0.875rem" },
} as const;
