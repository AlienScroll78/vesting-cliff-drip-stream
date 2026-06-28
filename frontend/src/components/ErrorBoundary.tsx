"use client";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Custom fallback; receives reset callback. Defaults to ErrorFallback. */
  fallback?: (reset: () => void, error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render-phase errors, logs them to the
 * console (and optionally Sentry if NEXT_PUBLIC_SENTRY_DSN is set), and
 * shows a fallback UI with a "Try Again" reset button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);

    // Optional Sentry integration — only active when DSN env var is present.
    if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import("@sentry/react")
        .then(({ captureException }) => captureException(error, { extra: info }))
        .catch(() => {/* Sentry unavailable — fail silently */});
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback
        ? this.props.fallback(this.reset, error)
        : <DefaultFallback reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ reset }: { reset: () => void }) {
  return (
    <div role="alert" style={styles.container}>
      <h1 style={styles.heading}>Something went wrong</h1>
      <p style={styles.body}>
        An unexpected error occurred. Our team has been notified.
      </p>
      <button type="button" onClick={reset} style={styles.button}>
        Try Again
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
