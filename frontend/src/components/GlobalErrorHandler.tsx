"use client";

import { useEffect, useState } from "react";

interface ErrorToast {
  id: string;
  message: string;
  correlationId: string;
}

function makeCorrelationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "An unexpected network or application error occurred.";
}

export function GlobalErrorHandler() {
  const [toasts, setToasts] = useState<ErrorToast[]>([]);

  useEffect(() => {
    const report = (reason: unknown) => {
      const correlationId = makeCorrelationId();
      const message = errorMessage(reason);
      const error = reason instanceof Error ? reason : new Error(message);
      console.error("[GlobalErrorHandler]", { correlationId, error });

      if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
        void import("@sentry/react").then(({ captureException }) => {
          captureException(error, { tags: { correlationId }, extra: { correlationId } });
        }).catch(() => {});
      }

      const toast = { id: correlationId, message, correlationId };
      setToasts((current) => [...current.slice(-2), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== correlationId));
      }, 7000);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => report(event.reason);
    const onError = (event: ErrorEvent) => report(event.error ?? event.message);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div aria-live="assertive" aria-relevant="additions" style={styles.stack}>
      {toasts.map((toast) => (
        <div key={toast.id} role="alert" style={styles.toast}>
          <span>{toast.message}</span>
          <small>Reference: {toast.correlationId}</small>
          <button
            type="button"
            aria-label="Dismiss error notification"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            style={styles.dismiss}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  stack: { position: "fixed", right: "1rem", bottom: "1rem", zIndex: 1000, display: "grid", gap: "0.5rem", maxWidth: "min(28rem, calc(100vw - 2rem))" },
  toast: { position: "relative", display: "grid", gap: "0.35rem", padding: "0.9rem 2.5rem 0.9rem 1rem", background: "var(--color-surface, #fff)", border: "1px solid var(--color-cancelled, #b91c1c)", borderRadius: "0.5rem", boxShadow: "0 4px 16px rgba(0,0,0,0.15)" },
  dismiss: { position: "absolute", top: "0.5rem", right: "0.5rem", border: 0, background: "transparent", fontSize: "1.2rem", cursor: "pointer" },
};