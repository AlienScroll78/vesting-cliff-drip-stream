"use client";
/**
 * Issue #757 — Stream Dashboard Client Component
 *
 * Displays a recipient's vesting schedule with:
 *  - Wallet connection gate (Freighter / LOBSTR / xBull via WalletModal)
 *  - Stream data fetched from GET /api/streams/:recipient
 *  - Cliff date displayed in user's local timezone
 *  - Linear progress bar (start → end ledger)
 *  - Claimable now amount with token symbol
 *  - Total vested vs total remaining
 *  - Claim Tokens button → build-claim-tx → wallet sign → submit → toast
 *  - Auto-refresh every 10 seconds
 *  - WebSocket subscription for real-time push updates
 *  - Error states: no stream, cliff not reached, wallet not connected
 *  - WCAG 2.1 AA accessible
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { WalletButton } from "@/components/WalletButton";
import { StreamDetailSkeleton } from "@/components/Skeletons";
import { StatusBadge } from "@/components/StatusBadge";
import { formatAmount } from "@/utils/formatAmount";
import { WebSocketManager } from "@/utils/websocket";
import type { VestingStream } from "@/types";
import styles from "./StreamDashboard.module.css";

// ── Constants ────────────────────────────────────────────────────────────────

/** Approximate seconds per Stellar ledger */
const SECONDS_PER_LEDGER = 5;

/** Polling interval for claimable balance refresh */
const REFRESH_INTERVAL_MS = 10_000;

/** Approximate current ledger (production: fetch from Horizon) */
const BASE_LEDGER = 51_200_000;
const BASE_TIMESTAMP_MS = Date.now();

// ── Helpers ──────────────────────────────────────────────────────────────────

function ledgerToDate(ledger: number): Date {
  const deltaSecs = (ledger - BASE_LEDGER) * SECONDS_PER_LEDGER;
  return new Date(BASE_TIMESTAMP_MS + deltaSecs * 1000);
}

function formatLedgerDate(ledger: number): string {
  return ledgerToDate(ledger).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZoneName: "short",
  });
}

function cliffNotReached(stream: VestingStream, currentLedger: number): boolean {
  return (stream.cliffLedger ?? 0) > currentLedger;
}

function progressPercent(stream: VestingStream, currentLedger: number): number {
  const start = stream.startLedger ?? currentLedger;
  const end = stream.endLedger ?? currentLedger;
  if (end <= start) return 100;
  const clamped = Math.max(start, Math.min(currentLedger, end));
  return Math.round(((clamped - start) / (end - start)) * 100);
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function fetchStream(
  recipient: string,
  signal?: AbortSignal
): Promise<VestingStream | null> {
  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(recipient)}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as VestingStream;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return null;
    throw err;
  }
}

async function buildClaimTx(recipient: string): Promise<{ xdr: string }> {
  const res = await fetch(
    `/api/streams/${encodeURIComponent(recipient)}/build-claim-tx`,
    { method: "POST", headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Build claim TX failed (${res.status})`);
  }
  return res.json() as Promise<{ xdr: string }>;
}

async function submitTx(signedXdr: string): Promise<{ hash: string }> {
  const res = await fetch("/api/tx/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdr: signedXdr }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Submit TX failed (${res.status})`);
  }
  return res.json() as Promise<{ hash: string }>;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

type ToastKind = "success" | "error" | "info";

interface ToastState {
  message: string;
  kind: ToastKind;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StreamDashboardClient() {
  const { address, connect, openModal } = useWallet();

  const [stream, setStream] = useState<VestingStream | null | undefined>(
    undefined
  );
  const [currentLedger, setCurrentLedger] = useState(BASE_LEDGER);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const wsRef = useRef<WebSocketManager | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Toast helpers ───────────────────────────────────────────────────────

  const showToast = useCallback((message: string, kind: ToastKind) => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Ledger poll ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    fetch("https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1", {
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json())
      .then((json: { _embedded: { records: Array<{ sequence: number }> } }) => {
        if (!cancelled) {
          setCurrentLedger(json._embedded.records[0]?.sequence ?? BASE_LEDGER);
        }
      })
      .catch(() => {/* use BASE_LEDGER fallback */});
    return () => { cancelled = true; };
  }, []);

  // ── Stream fetch ────────────────────────────────────────────────────────

  const loadStream = useCallback(
    async (recipient: string, signal?: AbortSignal) => {
      try {
        const data = await fetchStream(recipient, signal);
        setStream(data);
        setFetchError(null);
      } catch (err) {
        if (!signal?.aborted) {
          setFetchError(err instanceof Error ? err.message : "Failed to load stream");
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!address) {
      setStream(undefined);
      return;
    }
    const controller = new AbortController();
    loadStream(address, controller.signal);
    return () => controller.abort();
  }, [address, loadStream]);

  // ── Auto-refresh every 10s ──────────────────────────────────────────────

  useEffect(() => {
    if (!address) return;
    refreshTimerRef.current = setInterval(() => {
      loadStream(address);
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [address, loadStream]);

  // ── WebSocket subscription ──────────────────────────────────────────────

  useEffect(() => {
    if (!address) return;

    const wsUrl = (
      (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001") +
      `/ws/streams/${encodeURIComponent(address)}`
    );

    wsRef.current = new WebSocketManager({
      url: wsUrl,
      onMessage: (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            stream?: VestingStream;
          };
          if (msg.type === "stream_update" && msg.stream) {
            setStream(msg.stream);
          }
        } catch {/* ignore malformed messages */}
      },
    });
    wsRef.current.connect();

    return () => {
      wsRef.current?.destroy();
      wsRef.current = null;
    };
  }, [address]);

  // ── Claim flow ──────────────────────────────────────────────────────────

  const handleClaim = useCallback(async () => {
    if (!address || !stream) return;
    setClaiming(true);
    try {
      // 1. Build unsigned transaction
      const { xdr } = await buildClaimTx(address);

      // 2. Request wallet signature via Freighter
      const { signTransaction } = await import("@stellar/freighter-api");
      const result = await signTransaction(xdr, {
        networkPassphrase:
          process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
          "Test SDF Network ; September 2015",
      });
      if ("error" in result && result.error) {
        throw new Error(String(result.error));
      }
      const signedXdr =
        "signedTxXdr" in result ? result.signedTxXdr : (result as { signedXdr?: string }).signedXdr ?? xdr;

      // 3. Submit to Stellar RPC
      const { hash } = await submitTx(signedXdr);
      showToast(`Tokens claimed! Tx: ${hash.slice(0, 12)}…`, "success");

      // Refresh stream data after successful claim
      await loadStream(address);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Claim failed. Please try again.";
      showToast(message, "error");
    } finally {
      setClaiming(false);
    }
  }, [address, stream, showToast, loadStream]);

  // ── Render helpers ──────────────────────────────────────────────────────

  const progress = stream ? progressPercent(stream, currentLedger) : 0;
  const isPreCliff = stream ? cliffNotReached(stream, currentLedger) : false;
  const totalRemaining = stream
    ? (stream.totalDeposit ?? 0) - (stream.totalVested ?? 0)
    : 0;

  // ── Render: wallet not connected ────────────────────────────────────────

  if (!address) {
    return (
      <main className={styles.page} id="main-content">
        <div className={styles.connectGate} role="region" aria-label="Connect wallet">
          <h1 className={styles.heading}>Your Vesting Stream</h1>
          <p className={styles.connectDescription}>
            Connect your wallet to view your vesting schedule and claim tokens.
          </p>
          <WalletButton />
        </div>
      </main>
    );
  }

  // ── Render: loading ─────────────────────────────────────────────────────

  if (stream === undefined) {
    return (
      <main className={styles.page} id="main-content" aria-busy="true" aria-label="Loading stream data">
        <StreamDetailSkeleton />
      </main>
    );
  }

  // ── Render: fetch error ─────────────────────────────────────────────────

  if (fetchError) {
    return (
      <main className={styles.page} id="main-content">
        <div className={styles.errorState} role="alert" aria-live="assertive">
          <h1 className={styles.heading}>Error loading stream</h1>
          <p className={styles.errorMessage}>{fetchError}</p>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => loadStream(address)}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  // ── Render: no stream found ─────────────────────────────────────────────

  if (stream === null) {
    return (
      <main className={styles.page} id="main-content">
        <div className={styles.emptyState} role="region" aria-label="No stream found">
          <h1 className={styles.heading}>No Vesting Stream Found</h1>
          <p className={styles.emptyDescription}>
            No active vesting stream was found for address{" "}
            <code className={styles.address}>{address}</code>.
          </p>
          <p className={styles.emptyHint}>
            If you believe this is a mistake, please contact your stream sponsor.
          </p>
        </div>
      </main>
    );
  }

  // ── Render: cliff not reached ───────────────────────────────────────────

  if (isPreCliff) {
    return (
      <main className={styles.page} id="main-content">
        <div className={styles.card} role="region" aria-label="Stream details">
          <header className={styles.cardHeader}>
            <h1 className={styles.heading}>Vesting Stream</h1>
            <StatusBadge status={stream.status} />
          </header>

          <div
            className={styles.cliffNotice}
            role="status"
            aria-live="polite"
            aria-label="Cliff not yet reached"
          >
            <span className={styles.cliffIcon} aria-hidden="true">🔒</span>
            <div>
              <strong>Cliff not yet reached</strong>
              <p className={styles.cliffDate}>
                Tokens unlock on{" "}
                <time dateTime={ledgerToDate(stream.cliffLedger!).toISOString()}>
                  {formatLedgerDate(stream.cliffLedger!)}
                </time>
              </p>
            </div>
          </div>

          <StreamDetails stream={stream} progress={progress} totalRemaining={totalRemaining} />
        </div>
      </main>
    );
  }

  // ── Render: active stream ───────────────────────────────────────────────

  return (
    <main className={styles.page} id="main-content">
      {/* Toast notification */}
      {toast && (
        <div
          className={`${styles.toast} ${styles[`toast_${toast.kind}`]}`}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {toast.message}
        </div>
      )}

      <div className={styles.card} role="region" aria-label="Vesting stream dashboard">
        <header className={styles.cardHeader}>
          <h1 className={styles.heading}>Vesting Stream</h1>
          <StatusBadge status={stream.status} />
        </header>

        {/* Claimable balance */}
        <section
          className={styles.claimableSection}
          aria-label="Claimable balance"
        >
          <div>
            <div
              className={styles.claimableLabel}
              id="claimable-label"
            >
              Claimable now
            </div>
            <div
              className={styles.claimableAmount}
              aria-labelledby="claimable-label"
              aria-live="polite"
              aria-atomic="true"
            >
              {formatAmount(stream.claimableAmount)}{" "}
              <span className={styles.tokenSymbol}>{stream.token}</span>
            </div>
          </div>

          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleClaim}
            disabled={
              claiming ||
              stream.claimableAmount === 0 ||
              stream.status === "completed" ||
              stream.status === "cancelled"
            }
            aria-busy={claiming}
            aria-label={
              claiming
                ? "Claim in progress…"
                : `Claim ${formatAmount(stream.claimableAmount)} ${stream.token}`
            }
          >
            {claiming ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Claiming…
              </>
            ) : (
              "Claim Tokens"
            )}
          </button>
        </section>

        {/* Progress bar */}
        <section aria-label="Vesting progress">
          <div className={styles.progressMeta}>
            <span>Start</span>
            <span>{progress}% vested</span>
            <span>End</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Vesting progress: ${progress}%`}
          >
            <div
              className={styles.progressFill}
              style={{ width: `${progress}%` }}
            />
            {/* Cliff marker */}
            {stream.startLedger && stream.endLedger && stream.cliffLedger && (
              <div
                className={styles.cliffMarker}
                style={{
                  left: `${progressPercent(
                    { ...stream, endLedger: stream.endLedger },
                    stream.cliffLedger
                  )}%`,
                }}
                aria-label={`Cliff at ${formatLedgerDate(stream.cliffLedger)}`}
                title={`Cliff: ${formatLedgerDate(stream.cliffLedger)}`}
              />
            )}
          </div>
          <div className={styles.dateMeta}>
            {stream.startLedger && (
              <time dateTime={ledgerToDate(stream.startLedger).toISOString()}>
                {formatLedgerDate(stream.startLedger)}
              </time>
            )}
            {stream.endLedger && (
              <time dateTime={ledgerToDate(stream.endLedger).toISOString()}>
                {formatLedgerDate(stream.endLedger)}
              </time>
            )}
          </div>
        </section>

        <StreamDetails stream={stream} progress={progress} totalRemaining={totalRemaining} />
      </div>
    </main>
  );
}

// ── StreamDetails sub-component ───────────────────────────────────────────────

function StreamDetails({
  stream,
  progress: _progress,
  totalRemaining,
}: {
  stream: VestingStream;
  progress: number;
  totalRemaining: number;
}) {
  return (
    <section className={styles.detailsGrid} aria-label="Stream details">
      <dl>
        {stream.cliffLedger && (
          <>
            <div className={styles.detailRow}>
              <dt>Cliff date</dt>
              <dd>
                <time dateTime={ledgerToDate(stream.cliffLedger).toISOString()}>
                  {formatLedgerDate(stream.cliffLedger)}
                </time>
              </dd>
            </div>
          </>
        )}
        <div className={styles.detailRow}>
          <dt>Total vested</dt>
          <dd>
            {formatAmount(stream.totalVested ?? 0)} {stream.token}
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Total remaining</dt>
          <dd>
            {formatAmount(totalRemaining)} {stream.token}
          </dd>
        </div>
        {stream.totalDeposit !== undefined && (
          <div className={styles.detailRow}>
            <dt>Total deposit</dt>
            <dd>
              {formatAmount(stream.totalDeposit)} {stream.token}
            </dd>
          </div>
        )}
        <div className={styles.detailRow}>
          <dt>Drip rate</dt>
          <dd>
            {formatAmount(stream.rate)} {stream.token} / ledger
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Sponsor</dt>
          <dd>
            <code className={styles.address}>{stream.sponsor}</code>
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Status</dt>
          <dd>{stream.status}</dd>
        </div>
      </dl>
    </section>
  );
}
