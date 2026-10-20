"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export const LEDGERS_PER_SECOND = 5;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const ONE_WEEK_SECONDS = 7 * SECONDS_PER_DAY;
const LAST_HOUR_SECONDS = SECONDS_PER_HOUR;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const ONE_SECOND_MS = 1000;

export interface CliffCountdownProps {
  cliffLedger: number;
  currentLedger: number;
  onReached?: () => void;
  onClaim?: () => void | Promise<void>;
  claimableAmount?: number;
  tokenSymbol?: string;
}

function validLedger(value: number): number {
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
    const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / 60);
    return `${days} days ${hours} hours ${minutes} minutes remaining`;
  }
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / 60);
  const remaining = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")} until cliff`;
}

export function CliffCountdown({
  cliffLedger,
  currentLedger,
  onReached,
  onClaim,
  claimableAmount,
  tokenSymbol,
}: CliffCountdownProps) {
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState<number | null>(null);
  const [claimPending, setClaimPending] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const anchorRef = useRef<{ ledger: number; timestamp: number } | null>(null);
  const reachedRef = useRef(false);

  useEffect(() => {
    const timestamp = Date.now();
    anchorRef.current = { ledger: validLedger(currentLedger), timestamp };
    reachedRef.current = false;
    setNow(timestamp);
  }, [cliffLedger, currentLedger]);

  const cliff = validLedger(cliffLedger);
  const current = validLedger(currentLedger);
  const initialSeconds = Math.max(0, (cliff - current) * LEDGERS_PER_SECOND);
  const elapsedSeconds = anchorRef.current && now !== null
    ? Math.max(0, (now - anchorRef.current.timestamp) / 1000)
    : 0;
  const remainingSeconds = Math.max(0, Math.ceil(initialSeconds - elapsedSeconds));
  const reached = remainingSeconds === 0;
  const intervalMs = countdownIntervalMs(remainingSeconds);

  useEffect(() => {
    if (reached || typeof window === "undefined") return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, reached]);

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
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "Claim failed");
    } finally {
      setClaimPending(false);
    }
  }

  if (reached) {
    return (
      <>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="cliff-countdown"
          style={{ padding: "0.75rem 1rem", background: "var(--color-pre-cliff, #fef3c7)18", border: "1px solid var(--color-completed, #10b981)", borderRadius: "var(--radius, 0.5rem)", marginTop: "0.75rem", fontSize: "0.875rem", width: "100%", animation: reducedMotion ? "none" : "cliff-unlocked 700ms ease-out" }}
        >
          <strong style={{ color: "var(--color-completed, #10b981)" }}>🎉 Your tokens are now unlocked!</strong>
          {claimableAmount !== undefined && (
            <p style={{ margin: "0.25rem 0 0" }}>
              Claimable balance: {claimableAmount.toLocaleString()}{tokenSymbol ? ` ${tokenSymbol}` : ""}
            </p>
          )}
          {onClaim && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleClaim}
              disabled={claimPending || claimableAmount === 0}
              data-testid="cliff-claim-button"
              style={{ marginTop: "0.75rem", minHeight: 44 }}
            >
              {claimPending ? "Claiming…" : "Claim Tokens →"}
            </button>
          )}
          {claimError && <p role="alert" style={{ color: "var(--color-cancelled, #dc2626)", margin: "0.5rem 0 0" }}>{claimError}</p>}
        </div>
        <style>{`@keyframes cliff-unlocked { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      </>
    );
  }

  const value = formatCountdown(remainingSeconds);
  return (
    <div
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Time remaining until cliff: ${value}`}
      data-testid="cliff-countdown"
      style={{ padding: "0.75rem 1rem", background: "var(--color-pre-cliff, #fef3c7)18", border: "1px solid var(--color-pre-cliff, #d97706)", borderRadius: "var(--radius, 0.5rem)", marginTop: "0.75rem", fontSize: "0.875rem", width: "100%" }}
    >
      <strong style={{ color: "var(--color-pre-cliff, #d97706)" }}>🔒 Cliff not reached</strong>
      <p data-testid="cliff-countdown-value" style={{ margin: "0.25rem 0 0" }}>{value}</p>
    </div>
  );
}
