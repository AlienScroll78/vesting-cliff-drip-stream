"use client";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useReducer,
  type ReactNode,
} from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type TxStatus = "pending" | "confirmed" | "failed";

export interface TxState {
  status: TxStatus;
  hash?: string;
  errorMessage?: string;
}

type Action =
  | { type: "PENDING" }
  | { type: "CONFIRMED"; hash: string }
  | { type: "FAILED"; errorMessage: string }
  | { type: "DISMISS" };

// ── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: TxState | null, action: Action): TxState | null {
  switch (action.type) {
    case "PENDING":    return { status: "pending" };
    case "CONFIRMED":  return { status: "confirmed", hash: action.hash };
    case "FAILED":     return { status: "failed", errorMessage: action.errorMessage };
    case "DISMISS":    return null;
    default:           return state;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

interface TxContextValue {
  tx: TxState | null;
  setPending: () => void;
  setConfirmed: (hash: string) => void;
  setFailed: (message: string) => void;
  dismiss: () => void;
}

const TxContext = createContext<TxContextValue | null>(null);

export function TxProvider({ children }: { children: ReactNode }) {
  const [tx, dispatch] = useReducer(reducer, null);

  const setPending   = useCallback(() => dispatch({ type: "PENDING" }), []);
  const setConfirmed = useCallback((hash: string) => dispatch({ type: "CONFIRMED", hash }), []);
  const setFailed    = useCallback((msg: string)  => dispatch({ type: "FAILED", errorMessage: msg }), []);
  const dismiss      = useCallback(() => dispatch({ type: "DISMISS" }), []);

  return (
    <TxContext.Provider value={{ tx, setPending, setConfirmed, setFailed, dismiss }}>
      {children}
      <TxDrawer />
    </TxContext.Provider>
  );
}

export function useTx() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTx must be used inside <TxProvider>");
  return ctx;
}

// ── Drawer UI ────────────────────────────────────────────────────────────────

const STELLAR_EXPERT = "https://stellar.expert/explorer/testnet/tx";

function TxDrawer() {
  const { tx, dismiss } = useTx();
  const titleId = useId();

  if (!tx) return null;

  const { status, hash, errorMessage } = tx;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      data-testid="tx-drawer"
      style={{
        position: "fixed",
        bottom: "1.25rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 200,
        minWidth: "18rem",
        maxWidth: "calc(100vw - 2rem)",
        background: "var(--color-surface, #fff)",
        border: `1.5px solid ${borderColor(status)}`,
        borderRadius: "0.75rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        padding: "0.875rem 1rem",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
      }}
    >
      {/* Icon */}
      <span aria-hidden="true" style={{ fontSize: "1.4rem", lineHeight: 1, marginTop: "1px" }}>
        {icon(status)}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          id={titleId}
          style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--color-text, #111827)" }}
        >
          {title(status)}
        </p>

        {status === "confirmed" && hash && (
          <a
            href={`${STELLAR_EXPERT}/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.8rem",
              fontFamily: "monospace",
              color: "var(--color-active, #1d6ae5)",
              wordBreak: "break-all",
            }}
          >
            {hash.slice(0, 12)}…{hash.slice(-8)} ↗
          </a>
        )}

        {status === "failed" && errorMessage && (
          <p style={{ fontSize: "0.82rem", color: "var(--color-cancelled, #b91c1c)", marginTop: "0.2rem" }}>
            {errorMessage}
          </p>
        )}
      </div>

      {/* Retry / dismiss */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem" }}>
        {status === "pending" && (
          <Spinner />
        )}
        {(status === "confirmed" || status === "failed") && (
          <button
            onClick={dismiss}
            aria-label="Dismiss transaction notification"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1.1rem",
              color: "#6b7280",
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function borderColor(status: TxStatus) {
  return status === "confirmed"
    ? "var(--color-completed, #15803d)"
    : status === "failed"
    ? "var(--color-cancelled, #b91c1c)"
    : "var(--color-border, #e5e7eb)";
}

function icon(status: TxStatus) {
  if (status === "confirmed") return "✅";
  if (status === "failed")    return "❌";
  return "⏳";
}

function title(status: TxStatus) {
  if (status === "confirmed") return "Transaction confirmed";
  if (status === "failed")    return "Transaction failed";
  return "Transaction pending…";
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      data-testid="tx-spinner"
      style={{
        display: "inline-block",
        width: "1.1rem",
        height: "1.1rem",
        border: "2px solid var(--color-border, #e5e7eb)",
        borderTopColor: "var(--color-active, #1d6ae5)",
        borderRadius: "50%",
        animation: "tx-spin 0.7s linear infinite",
      }}
    />
  );
}
