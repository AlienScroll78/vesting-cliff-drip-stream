"use client";
/**
 * HorizonStatusBanner (#278)
 *
 * Displays a prominent banner when the Horizon API is unreachable or degraded,
 * preventing users from attempting transactions that will fail.
 *
 * Behaviour:
 * - Polls Horizon every 30 s (configurable via HORIZON_URL env var)
 * - "Degraded" state: response time > 3 000 ms
 * - "Offline"  state: request fails / times-out (10 s)
 * - Dismiss button snoozes for 5 minutes
 * - Banner re-checks even while snoozed so state stays accurate
 * - role="alert" so screen readers announce changes immediately
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Horizon endpoint to probe.  Falls back to the public test-net. */
const HORIZON_URL =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_HORIZON_URL
    ? process.env.NEXT_PUBLIC_HORIZON_URL
    : "https://horizon-testnet.stellar.org";

const CHECK_INTERVAL_MS = 30_000; // re-check every 30 s
const SLOW_THRESHOLD_MS  = 3_000; // > 3 s → Degraded
const TIMEOUT_MS         = 10_000; // no response in 10 s → Offline
const SNOOZE_DURATION_MS = 5 * 60_000; // 5-minute dismiss snooze
const STELLAR_STATUS_URL = "https://status.stellar.org";

// ── Types ──────────────────────────────────────────────────────────────────────

type HorizonStatus = "ok" | "degraded" | "offline";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fetch Horizon root and return the measured latency.
 * Throws on network error or timeout.
 */
async function checkHorizon(): Promise<{ status: HorizonStatus; latencyMs: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const start = performance.now();
  try {
    const res = await fetch(HORIZON_URL, {
      method: "GET",
      signal: controller.signal,
      // Avoid caching — we need a live probe every time
      cache: "no-store",
    });
    const latencyMs = performance.now() - start;

    if (!res.ok) return { status: "offline", latencyMs };
    if (latencyMs > SLOW_THRESHOLD_MS) return { status: "degraded", latencyMs };
    return { status: "ok", latencyMs };
  } catch {
    return { status: "offline", latencyMs: TIMEOUT_MS };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

function useHorizonStatus() {
  const [status, setStatus] = useState<HorizonStatus>("ok");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const run = useCallback(async () => {
    const result = await checkHorizon();
    setStatus(result.status);
    setLatencyMs(result.latencyMs < TIMEOUT_MS ? result.latencyMs : null);
    setLastChecked(new Date());
  }, []);

  useEffect(() => {
    // Initial check immediately, then every 30 s
    void run();
    const id = setInterval(() => void run(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [run]);

  return { status, latencyMs, lastChecked, recheck: run };
}

// ── Banner styles ──────────────────────────────────────────────────────────────

const BANNER_STYLES: Record<"degraded" | "offline", React.CSSProperties> = {
  degraded: {
    background: "#fffbeb",
    borderBottom: "1px solid #fde68a",
    color: "#92400e",
  },
  offline: {
    background: "#fef2f2",
    borderBottom: "1px solid #fecaca",
    color: "#991b1b",
  },
};

const ICON: Record<"degraded" | "offline", string> = {
  degraded: "⚠️",
  offline: "🔴",
};

const LABEL: Record<"degraded" | "offline", string> = {
  degraded: "Degraded",
  offline: "Offline",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function HorizonStatusBanner() {
  const { status, latencyMs, lastChecked, recheck } = useHorizonStatus();
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  const announceRef = useRef<string>("");

  // Clear snooze if status returns to ok
  useEffect(() => {
    if (status === "ok") setSnoozeUntil(null);
  }, [status]);

  // Determine visibility: show when not ok AND not snoozed
  const isSnoozed = snoozeUntil !== null && Date.now() < snoozeUntil;
  const isVisible = status !== "ok" && !isSnoozed;

  // Build the announcement string so screen readers get the update
  const announcement = isVisible
    ? `Horizon API ${LABEL[status as "degraded" | "offline"]}: ${
        status === "degraded"
          ? `Response is slow (${Math.round(latencyMs ?? 0)} ms). Transactions may be delayed.`
          : "Cannot reach Horizon. Transactions are currently unavailable."
      }`
    : "";

  // Only fire a live-region update when the announcement actually changes
  if (announcement !== announceRef.current) {
    announceRef.current = announcement;
  }

  function handleDismiss() {
    setSnoozeUntil(Date.now() + SNOOZE_DURATION_MS);
  }

  if (!isVisible) return null;

  const s = status as "degraded" | "offline";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="horizon-status-banner"
      style={{
        ...BANNER_STYLES[s],
        position: "sticky",
        top: 0,
        zIndex: 60,
        width: "100%",
        padding: "0.6rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        fontSize: "0.875rem",
        fontWeight: 500,
      }}
    >
      {/* Left: icon + message */}
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span aria-hidden="true">{ICON[s]}</span>
        <strong>Horizon API {LABEL[s]}</strong>
        <span>
          {s === "degraded"
            ? `Response is slow (${Math.round(latencyMs ?? 0)} ms). Transactions may be delayed.`
            : "Cannot reach Horizon. Transactions are currently unavailable."}
        </span>
        {lastChecked && (
          <span style={{ fontSize: "0.78rem", opacity: 0.75 }}>
            Last checked: {lastChecked.toLocaleTimeString()}
          </span>
        )}
      </span>

      {/* Right: status page link + recheck + dismiss */}
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
        <a
          href={STELLAR_STATUS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "inherit",
            textDecoration: "underline",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
          aria-label="View Stellar network status page (opens in new tab)"
        >
          Status page ↗
        </a>

        <button
          type="button"
          onClick={() => void recheck()}
          aria-label="Re-check Horizon API status"
          title="Re-check now"
          style={{
            background: "transparent",
            border: "1px solid currentColor",
            borderRadius: "0.25rem",
            padding: "0.2rem 0.5rem",
            fontSize: "0.78rem",
            cursor: "pointer",
            color: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          ↺ Recheck
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss this banner for 5 minutes"
          title="Dismiss for 5 minutes"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "1rem",
            lineHeight: 1,
            padding: "0.1rem 0.25rem",
            color: "inherit",
            borderRadius: "0.25rem",
          }}
        >
          ✕
        </button>
      </span>
    </div>
  );
}
