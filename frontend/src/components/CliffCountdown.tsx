"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

// ── Constants ─────────────────────────────────────────────────────────────────

export const LEDGERS_PER_SECOND = 5;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const ONE_WEEK_SECONDS = 7 * SECONDS_PER_DAY;
const LAST_HOUR_SECONDS = SECONDS_PER_HOUR;

/** How often to poll the Soroban RPC for the current ledger. */
export const POLL_INTERVAL_MS = 5_000;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const ONE_SECOND_MS = 1_000;

// ── Public helpers ────────────────────────────────────────────────────────────

export function validLedger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function countdownIntervalMs(remainingSeconds: number): number {
  if (remainingSeconds <= LAST_HOUR_SECONDS) return ONE_SECOND_MS;
  if (remainingSeconds <= ONE_WEEK_SECONDS) return ONE_MINUTE_MS;
  return ONE_HOUR_MS;
}

export function formatCountdown(remainingSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(remainingSeconds));
  if (seconds > ONE_WEEK_SECONDS) {
    const days = Math.floor(seconds / SECONDS_PER_DAY);
    const hours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
    return `${days} days ${String(hours).padStart(2, "0")} hours remaining`;
  }
  if (seconds > LAST_HOUR_SECONDS) {
    const days = Math.floor(seconds / SECONDS_PER_DAY);
    const hours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
    const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return `${days} days ${hours} hours ${minutes} minutes remaining`;
  }
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const remaining = seconds % SECONDS_PER_MINUTE;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")} until cliff`;
}

/** Formats a ledger number with locale-aware thousands separators. */
export function formatLedger(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

// ── Soroban RPC ledger fetch ───────────────────────────────────────────────────

/**
 * Fetches the current Stellar ledger sequence from the Soroban JSON-RPC endpoint.
 * Returns `null` on any network / parse failure.
 */
async function fetchCurrentLedger(rpcUrl: string): Promise<number | null> {
  // Use AbortController + setTimeout instead of AbortSignal.timeout()
  // so that fake-timer environments (jsdom/vitest) work correctly.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestLedger",
        params: {},
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const seq =
      typeof data === "object" &&
      data !== null &&
      "result" in data &&
      typeof (data as { result: unknown }).result === "object" &&
      (data as { result: { sequence?: unknown } }).result !== null
        ? (data as { result: { sequence?: unknown } }).result.sequence
        : undefined;
    return typeof seq === "number" ? seq : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resolveRpcUrl(): string {
  return (
    (typeof import.meta !== "undefined" &&
      (import.meta as ImportMeta & { env?: Record<string, string> }).env
        ?.VITE_SOROBAN_RPC_URL) ||
    "https://soroban-testnet.stellar.org"
  );
}

// ── useLiveLedger ─────────────────────────────────────────────────────────────

interface UseLiveLedgerOptions {
  /** Override the RPC URL (primarily for tests/Storybook). */
  rpcUrl?: string;
  /** Skip polling when the cliff is already passed. */
  disabled?: boolean;
}

export interface UseLiveLedgerResult {
  currentLedger: number;
  /** True while the very first fetch is still in flight. */
  loading: boolean;
  /** Non-null when the last poll failed. The previous ledger value is kept. */
  error: string | null;
}

export function useLiveLedger(
  initialLedger: number,
  options: UseLiveLedgerOptions = {}
): UseLiveLedgerResult {
  const { rpcUrl = resolveRpcUrl(), disabled = false } = options;

  // Start with the prop value immediately — no spinner on first render.
  const [currentLedger, setCurrentLedger] = useState(() => validLedger(initialLedger));
  // loading is only true while the very first fetch is in flight.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFetchDoneRef = useRef(false);

  // Sync when the initialLedger prop changes (e.g. parent re-renders)
  useEffect(() => {
    setCurrentLedger(validLedger(initialLedger));
    firstFetchDoneRef.current = false;
  }, [initialLedger]);

  const poll = useCallback(async () => {
    if (!firstFetchDoneRef.current) setLoading(true);
    const ledger = await fetchCurrentLedger(rpcUrl);
    if (ledger !== null) {
      setCurrentLedger(ledger);
      setError(null);
    } else {
      setError("Unable to reach Soroban RPC. Showing last known ledger.");
    }
    firstFetchDoneRef.current = true;
    setLoading(false);
  }, [rpcUrl]);

  useEffect(() => {
    if (disabled) return;
    poll();
    const id = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [disabled, poll]);

  return { currentLedger, loading, error };
}

// ── Component props ───────────────────────────────────────────────────────────

export interface CliffCountdownProps {
  /** The ledger at which the cliff is reached. */
  cliffLedger: number;
  /**
   * Starting ledger used as the seed before the first live-poll result
   * arrives. The component immediately shows this value and refines it.
   */
  currentLedger: number;
  /** Override the Soroban RPC URL (primarily for tests/Storybook). */
  rpcUrl?: string;
  /** Called once when the cliff is first detected as reached. */
  onReached?: () => void;
  /** Called when the user presses "Claim Tokens". */
  onClaim?: () => void | Promise<void>;
  /** Amount already claimable, shown in the post-cliff state. */
  claimableAmount?: number;
  /** Token symbol displayed beside the amount. */
  tokenSymbol?: string;
}

// ── CliffCountdown ────────────────────────────────────────────────────────────

export function CliffCountdown({
  cliffLedger,
  currentLedger: initialLedger,
  rpcUrl,
  onReached,
  onClaim,
  claimableAmount,
  tokenSymbol,
}: CliffCountdownProps) {
  const reducedMotion = useReducedMotion();
  const cliff = validLedger(cliffLedger);

  // Live ledger — seeded from the prop, refreshed every 5 s via RPC
  const {
    currentLedger,
    loading: ledgerLoading,
    error: ledgerError,
  } = useLiveLedger(initialLedger, {
    rpcUrl,
    // Disable polling when the cliff is already passed on mount
    disabled: cliff <= validLedger(initialLedger),
  });

  // Wall-clock ticker for smooth sub-ledger countdown animation
  const [now, setNow] = useState<number | null>(null);
  const anchorRef = useRef<{ ledger: number; timestamp: number } | null>(null);
  const reachedRef = useRef(false);
  const [claimPending, setClaimPending] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Re-anchor whenever the live ledger updates
  useEffect(() => {
    anchorRef.current = { ledger: currentLedger, timestamp: Date.now() };
    reachedRef.current = false;
    setNow(Date.now());
  }, [currentLedger]);

  const initialRemainingSeconds = Math.max(0, (cliff - currentLedger) * LEDGERS_PER_SECOND);
  const elapsedSeconds =
    anchorRef.current && now !== null
      ? Math.max(0, (now - anchorRef.current.timestamp) / 1000)
      : 0;
  const remainingSeconds = Math.max(0, Math.ceil(initialRemainingSeconds - elapsedSeconds));
  const reached = remainingSeconds === 0;
  const intervalMs = countdownIntervalMs(remainingSeconds);

  // Wall-clock interval for smooth ticking
  useEffect(() => {
    if (reached || typeof window === "undefined") return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, reached]);

  // Fire onReached exactly once
  useEffect(() => {
    if (!reached || reachedRef.current) return;
    reachedRef.current = true;
    onReached?.();
  }, [onReached, reached]);

  async function handleClaim() {
    if (!onClaim || claimPending) return;
    setClaimPending(true);
    setClaimError(null);
    try {
      await onClaim();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaimPending(false);
    }
  }

  // ── Cliff reached state ─────────────────────────────────────────────────

  if (reached) {
    return (
      <>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="cliff-countdown"
          style={{
            padding: "0.75rem 1rem",
            background: "var(--color-completed-bg, #d1fae5)",
            border: "1px solid var(--color-completed, #10b981)",
            borderRadius: "var(--radius, 0.5rem)",
            marginTop: "0.75rem",
            fontSize: "0.875rem",
            width: "100%",
            animation: reducedMotion ? "none" : "cliff-unlocked 700ms ease-out",
          }}
        >
          <strong style={{ color: "var(--color-completed, #10b981)" }}>
            🎉 Cliff reached! Claim your tokens.
          </strong>

          {/* Ledger reference */}
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.8rem",
              color: "var(--color-muted, #6b7280)",
            }}
          >
            Ledger{" "}
            <span
              data-testid="cliff-ledger-number"
              aria-label={`cliff ledger number ${cliff}`}
            >
              {formatLedger(cliff)}
            </span>{" "}
            reached.
          </p>

          {claimableAmount !== undefined && (
            <p style={{ margin: "0.25rem 0 0" }}>
              Claimable balance:{" "}
              <strong>
                {claimableAmount.toLocaleString()}
                {tokenSymbol ? ` ${tokenSymbol}` : ""}
              </strong>
            </p>
          )}

          {onClaim && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleClaim}
              disabled={claimPending || claimableAmount === 0}
              data-testid="cliff-claim-button"
              aria-busy={claimPending}
              style={{ marginTop: "0.75rem", minHeight: 44 }}
            >
              {claimPending ? "Claiming…" : "Claim Tokens →"}
            </button>
          )}

          {claimError && (
            <p
              role="alert"
              style={{
                color: "var(--color-cancelled, #dc2626)",
                margin: "0.5rem 0 0",
              }}
            >
              {claimError}
            </p>
          )}
        </div>
        <style>{`
          @keyframes cliff-unlocked {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </>
    );
  }

  // ── Countdown state ─────────────────────────────────────────────────────

  const value = formatCountdown(remainingSeconds);
  const ariaLabel = [
    `Time remaining until cliff: ${value}.`,
    `Current ledger: ${formatLedger(currentLedger)}, cliff ledger: ${formatLedger(cliff)}.`,
  ].join(" ");

  const estimatedDays = Math.ceil(remainingSeconds / SECONDS_PER_DAY);

  return (
    <div
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
      data-testid="cliff-countdown"
      style={{
        padding: "0.75rem 1rem",
        background: "var(--color-pre-cliff-bg, #fefce8)",
        border: "1px solid var(--color-pre-cliff, #d97706)",
        borderRadius: "var(--radius, 0.5rem)",
        marginTop: "0.75rem",
        fontSize: "0.875rem",
        width: "100%",
      }}
    >
      <strong style={{ color: "var(--color-pre-cliff, #d97706)" }}>
        🔒 Cliff not reached
      </strong>

      {/* Human-readable time remaining */}
      <p
        data-testid="cliff-countdown-value"
        style={{ margin: "0.25rem 0 0" }}
      >
        {value}
      </p>

      {/* Ledger numbers — e.g. "ledger 1,234,567 → 1,250,000 (~11 days)" */}
      <p
        data-testid="cliff-ledger-display"
        style={{
          margin: "0.25rem 0 0",
          fontSize: "0.8rem",
          color: "var(--color-muted, #6b7280)",
        }}
        aria-label={`Current ledger ${formatLedger(currentLedger)}, cliff ledger ${formatLedger(cliff)}`}
      >
        {ledgerLoading ? (
          <span aria-busy="true">Syncing ledger…</span>
        ) : (
          <>
            ledger{" "}
            <span data-testid="current-ledger-number">
              {formatLedger(currentLedger)}
            </span>
            {" → "}
            <span data-testid="cliff-ledger-number">
              {formatLedger(cliff)}
            </span>{" "}
            (~{estimatedDays} day{estimatedDays !== 1 ? "s" : ""})
          </>
        )}
      </p>

      {/* Non-intrusive note when RPC is unreachable */}
      {ledgerError && (
        <p
          role="status"
          data-testid="ledger-poll-error"
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.75rem",
            color: "var(--color-muted, #6b7280)",
          }}
        >
          {ledgerError}
        </p>
      )}

      {/* Subtle live-polling dot — hidden for reduced-motion users */}
      {!reducedMotion && !reached && (
        <span
          aria-hidden="true"
          title="Polling live ledger every 5 s"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--color-pre-cliff, #d97706)",
            verticalAlign: "middle",
            marginLeft: "0.4rem",
            animation: "pulse-dot 2s ease-in-out infinite",
          }}
        />
      )}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}
