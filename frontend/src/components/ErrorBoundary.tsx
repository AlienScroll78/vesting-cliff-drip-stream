"use client";
/**
 * ErrorBoundary — error boundary components (#769)
 *
 * Exports:
 *  - `ErrorBoundary`             — root-level boundary; full-page fallback with
 *                                   Reload + Report buttons, Sentry integration
 *  - `RouteErrorBoundary`        — route-level boundary; shows friendly page with
 *                                   navigation options, resets on route change
 *  - `StreamCardErrorBoundary`   — per-card boundary; inline compact fallback
 *  - `logError`                  — abstracted error reporter (console + Sentry)
 *
 * Sentry integration: set VITE_SENTRY_DSN and import @sentry/react.
 * Errors are always reported synchronously via captureException so the
 * event-id is available immediately to render the "Report this issue" button.
 */

import React, {
  Component,
  ReactNode,
  ErrorInfo,
  useEffect,
  useRef,
  useState,
  useId,
} from "react";
import * as Sentry from "@sentry/react";

// ─── Sentry event-id tracking ─────────────────────────────────────────────────

/**
 * Report an error to Sentry and return the event-id (or null when Sentry is
 * not configured / unavailable).
 */
export function captureToSentry(
  error: Error,
  errorInfo: ErrorInfo | { componentStack?: string | null } | null,
  extra?: Record<string, unknown>,
): string | null {
  try {
    const eventId = Sentry.captureException(error, {
      extra: {
        ...(errorInfo ?? {}),
        ...(extra ?? {}),
      },
    });
    return eventId ?? null;
  } catch {
    return null;
  }
}

/**
 * Log an error to the console (always) and to Sentry when a DSN is
 * configured. Returns the Sentry event-id if captured, otherwise null.
 */
export function logError(
  error: Error,
  errorInfo: ErrorInfo | { componentStack?: string | null } | null,
  context?: Record<string, unknown>,
): string | null {
  // Always surface to console
  console.error(
    "[ErrorBoundary] Uncaught error:",
    error,
    "\nComponent stack:",
    errorInfo?.componentStack ?? "(unavailable)",
    ...(context ? ["\nContext:", context] : []),
  );

  return captureToSentry(error, errorInfo, context);
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const styles = {
  primaryBtn: {
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

  secondaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
    padding: "0.5rem 1.25rem",
    background: "transparent",
    color: "var(--color-active, #1d6ae5)",
    border: "1px solid var(--color-active, #1d6ae5)",
    borderRadius: "var(--radius, 0.5rem)",
    fontWeight: 600,
    fontSize: "1rem",
    cursor: "pointer",
  } as React.CSSProperties,

  details: {
    marginTop: "0.75rem",
    textAlign: "left" as const,
    width: "100%",
    maxWidth: "640px",
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

// ─── Collapsible technical details ────────────────────────────────────────────

interface ErrorDetailsProps {
  error: Error;
  componentStack?: string | null;
}

function ErrorDetails({ error, componentStack }: ErrorDetailsProps) {
  return (
    <details style={styles.details}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "0.8125rem",
          color: "var(--color-cancelled, #b91c1c)",
          fontWeight: 600,
          userSelect: "none",
          listStyle: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
        }}
      >
        ▶ Show technical details
      </summary>
      <pre style={styles.pre}>
        <strong>
          {error.name}: {error.message}
        </strong>
        {error.stack ? `\n\n${error.stack}` : ""}
        {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
      </pre>
    </details>
  );
}

// ─── Root-level ErrorBoundary ─────────────────────────────────────────────────

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
  sentryEventId: string | null;
}

/**
 * Root-level error boundary — wrap the entire app or large page sections.
 *
 * Fallback UI:
 *  - Accessible `role="main"` container labelled by the heading (aria-labelledby)
 *  - Heading with `tabIndex={-1}` for programmatic focus
 *  - "Reload the page" button
 *  - "Report this issue" button (shown after Sentry captures the event)
 *  - Collapsible technical details
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: null,
    sentryEventId: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const sentryEventId = logError(error, info);
    this.setState({
      componentStack: info.componentStack ?? null,
      sentryEventId,
    });
  }

  reset = (): void =>
    this.setState({ error: null, componentStack: null, sentryEventId: null });

  render(): ReactNode {
    const { error, componentStack, sentryEventId } = this.state;

    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(this.reset, error);
      }
      return (
        <RootFallback
          error={error}
          componentStack={componentStack}
          sentryEventId={sentryEventId}
          reset={this.reset}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

// ─── Root fallback UI ─────────────────────────────────────────────────────────

interface RootFallbackProps {
  error: Error;
  componentStack: string | null;
  sentryEventId: string | null;
  reset: () => void;
}

function RootFallback({
  error,
  componentStack,
  sentryEventId,
  reset,
}: RootFallbackProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the heading so screen-reader users are informed immediately
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleReload() {
    window.location.reload();
  }

  function handleReport() {
    if (sentryEventId) {
      Sentry.showReportDialog({ eventId: sentryEventId });
    }
  }

  return (
    <main
      role="main"
      aria-labelledby={headingId}
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
      <span aria-hidden="true" style={{ fontSize: "3rem", lineHeight: 1 }}>
        ⚠️
      </span>

      <h1
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          margin: 0,
          color: "var(--color-text, #111827)",
          outline: "none",
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={handleReload}
          style={styles.primaryBtn}
        >
          Reload the page
        </button>

        {sentryEventId && (
          <button
            type="button"
            onClick={handleReport}
            style={styles.secondaryBtn}
          >
            Report this issue
          </button>
        )}
      </div>

      <ErrorDetails error={error} componentStack={componentStack} />
    </main>
  );
}

// ─── RouteErrorBoundary ───────────────────────────────────────────────────────

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /** Route key — when this changes the boundary resets automatically */
  routeKey?: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  sentryEventId: string | null;
  lastRouteKey: string | undefined;
}

/**
 * Route-level error boundary — wraps individual route pages.
 *
 * Automatically clears the caught error when `routeKey` changes (i.e. the
 * user navigates to a different route), preventing stale error UIs.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    error: null,
    componentStack: null,
    sentryEventId: null,
    lastRouteKey: undefined,
  };

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    // Clear error when the route changes
    if (props.routeKey !== state.lastRouteKey) {
      return {
        error: null,
        componentStack: null,
        sentryEventId: null,
        lastRouteKey: props.routeKey,
      };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const sentryEventId = logError(error, info, { context: "RouteErrorBoundary" });
    this.setState({
      componentStack: info.componentStack ?? null,
      sentryEventId,
    });
  }

  reset = (): void =>
    this.setState({ error: null, componentStack: null, sentryEventId: null });

  render(): ReactNode {
    const { error, componentStack, sentryEventId } = this.state;

    if (error) {
      return (
        <RouteFallback
          error={error}
          componentStack={componentStack}
          sentryEventId={sentryEventId}
          reset={this.reset}
        />
      );
    }

    return this.props.children;
  }
}

// ─── Route fallback UI ────────────────────────────────────────────────────────

interface RouteFallbackProps {
  error: Error;
  componentStack: string | null;
  sentryEventId: string | null;
  reset: () => void;
}

function RouteFallback({
  error,
  componentStack,
  sentryEventId,
  reset,
}: RouteFallbackProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleReport() {
    if (sentryEventId) {
      Sentry.showReportDialog({ eventId: sentryEventId });
    }
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "40vh",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "2.5rem", lineHeight: 1 }}>
        ⚠️
      </span>

      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        style={{
          fontSize: "1.25rem",
          fontWeight: 700,
          margin: 0,
          color: "var(--color-text, #111827)",
          outline: "none",
        }}
      >
        This page encountered an error
      </h2>

      <p
        style={{
          margin: 0,
          color: "var(--color-text, #111827)",
          opacity: 0.7,
          maxWidth: "380px",
        }}
      >
        Something went wrong loading this page. Try refreshing, or navigate to
        a different section.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button type="button" onClick={reset} style={styles.primaryBtn}>
          Try again
        </button>
        <a
          href="/"
          style={{
            color: "var(--color-active, #1d6ae5)",
            fontSize: "0.875rem",
            textDecoration: "underline",
          }}
        >
          Go to dashboard
        </a>
        {sentryEventId && (
          <button
            type="button"
            onClick={handleReport}
            style={{ ...styles.secondaryBtn, fontSize: "0.875rem", minHeight: "36px" }}
          >
            Report this issue
          </button>
        )}
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
 * Per-card error boundary — wrap individual stream cards so a single broken
 * card cannot crash the entire dashboard.
 *
 * Shows a compact inline banner with a Retry button.
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
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}
        >
          <span aria-hidden="true" style={{ fontSize: "1.1rem", flexShrink: 0 }}>
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

// ─── Convenience hook: useErrorBoundaryReset ──────────────────────────────────

/**
 * Returns a `resetKey` string that updates on route-pathname changes.
 * Pass this as `routeKey` to `RouteErrorBoundary` so it auto-resets on navigation.
 *
 * ```tsx
 * const routeKey = useRouteResetKey();
 * <RouteErrorBoundary routeKey={routeKey}>…</RouteErrorBoundary>
 * ```
 */
export function useRouteResetKey(): string {
  const [key, setKey] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );

  useEffect(() => {
    // Listen to popstate (back/forward) and custom pushstate events
    function onLocationChange() {
      setKey(window.location.pathname);
    }

    window.addEventListener("popstate", onLocationChange);

    // Intercept history.pushState / replaceState
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    history.pushState = function (...args) {
      origPush(...args);
      onLocationChange();
    };
    history.replaceState = function (...args) {
      origReplace(...args);
      onLocationChange();
    };

    return () => {
      window.removeEventListener("popstate", onLocationChange);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  return key;
}
