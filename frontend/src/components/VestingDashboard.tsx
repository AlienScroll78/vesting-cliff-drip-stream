"use client";
/**
 * VestingDashboard — displays all active vesting schedules for the connected wallet.
 *
 * Features:
 *  - Cliff progress bar (locked → cliff reached)
 *  - Linear drip progress bar (cliff → end_ledger)
 *  - Auto-refresh every 5 seconds via Horizon ledger polling
 *  - Real-time claimable amount display
 *  - Loading skeleton while fetching
 *  - Responsive layout (mobile / tablet / desktop)
 *  - Graceful empty-state when no streams found
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { StreamListSkeleton } from "@/components/Skeletons";
import { StatusBadge } from "@/components/StatusBadge";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";
import type { VestingStream, StreamStatus } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 5_000;
const HORIZON_TESTNET     = "https://horizon-testnet.stellar.org";

// Mock baseline ledger — replace with real Horizon poll
const BASE_LEDGER = 51_200_000;

// ── Horizon ledger poll ───────────────────────────────────────────────────────

async function fetchCurrentLedger(network: "testnet" | "mainnet" = "testnet"): Promise<number> {
  const base = network === "mainnet"
    ? "https://horizon.stellar.org"
    : HORIZON_TESTNET;
  try {
    const res = await fetch(`${base}/ledgers?order=desc&limit=1`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Horizon ${res.status}`);
    const json = await res.json() as { _embedded: { records: Array<{ sequence: number }> } };
    return json._embedded.records[0]?.sequence ?? BASE_LEDGER;
  } catch {
    return BASE_LEDGER; // graceful fallback
  }
}

// ── Stream data fetch ─────────────────────────────────────────────────────────
// TODO: Replace mock with real backend call:
//   GET /api/streams?address={address}&network={network}
// Each stream should include claimable_amount from the contract view function.

const MOCK_STREAMS: VestingStream[] = [
  {
    id: "1",
    recipient: "GABC…XYZ",
    sponsor: "GSPON…",
    token: "USDC",
    rate: 10,
    claimableAmount: 1500,
    status: "active",
    startLedger: BASE_LEDGER - 172_800,
    cliffLedger: BASE_LEDGER - 86_400,
    endLedger: BASE_LEDGER + 6_048_000,
    totalDeposit: 63_072_000,
    totalVested: 1500,
  },
  {
    id: "2",
    recipient: "GABC…XYZ",
    sponsor: "GSPNR…",
    token: "USDC",
    rate: 5,
    claimableAmount: 0,
    status: "pre-cliff",
    startLedger: BASE_LEDGER - 17_280,
    cliffLedger: BASE_LEDGER + 259_200,
    endLedger: BASE_LEDGER + 2_592_000,
    totalDeposit: 12_960_000,
    totalVested: 0,
  },
  {
    id: "3",
    recipient: "GABC…XYZ",
    sponsor: "GSPNR2…",
    token: "XLM",
    rate: 20,
    claimableAmount: 8000,
    status: "active",
    startLedger: BASE_LEDGER - 300_000,
    cliffLedger: BASE_LEDGER - 200_000,
    endLedger: BASE_LEDGER + 4_000_000,
    totalDeposit: 100_000_000,
    totalVested: 8000,
  },
];

async function fetchStreamsForAddress(
  address: string,
  _network: "testnet" | "mainnet"
): Promise<VestingStream[]> {
  // Simulate network delay
  await new Promise(r => setTimeout(r, 600));
  // Return mock data scoped to address
  void address;
  return MOCK_STREAMS;
}

// ── Progress math ─────────────────────────────────────────────────────────────

interface ProgressBars {
  /** 0–100: how far we are between start → cliff */
  cliffProgress: number;
  /** 0–100: how far we are between cliff → end */
  dripProgress: number;
  cliffReached: boolean;
  streamComplete: boolean;
  /** Real-time estimated claimable (interpolated from rate) */
  estimatedClaimable: number;
}

function computeProgress(stream: VestingStream, currentLedger: number): ProgressBars {
  const { startLedger, cliffLedger, endLedger, rate, claimableAmount } = stream;

  if (!startLedger || !cliffLedger || !endLedger) {
    return {
      cliffProgress: stream.status === "pre-cliff" ? 0 : 100,
      dripProgress: stream.status === "active" ? 50 : stream.status === "completed" ? 100 : 0,
      cliffReached: stream.status !== "pre-cliff",
      streamComplete: stream.status === "completed",
      estimatedClaimable: claimableAmount,
    };
  }

  const cliffReached  = currentLedger >= cliffLedger;
  const streamComplete = currentLedger >= endLedger;

  // Cliff progress: how far through the cliff wait period we are
  const cliffTotal  = cliffLedger - startLedger;
  const cliffElapsed = Math.min(currentLedger - startLedger, cliffTotal);
  const cliffProgress = cliffTotal > 0 ? Math.min(100, (cliffElapsed / cliffTotal) * 100) : 100;

  // Drip progress: how far through the post-cliff linear period we are
  const dripTotal  = endLedger - cliffLedger;
  const dripElapsed = cliffReached
    ? Math.min(currentLedger - cliffLedger, dripTotal)
    : 0;
  const dripProgress = dripTotal > 0 ? Math.min(100, (dripElapsed / dripTotal) * 100) : 0;

  // Real-time claimable interpolation: rate * (ledgers since last claim)
  // In production this should come from claimable_amount(recipient) contract view
  const ledgersSinceCliff = cliffReached
    ? Math.max(0, currentLedger - cliffLedger)
    : 0;
  const estimatedClaimable = cliffReached
    ? Math.min(rate * ledgersSinceCliff, (endLedger - startLedger) * rate)
    : 0;

  return {
    cliffProgress,
    dripProgress,
    cliffReached,
    streamComplete,
    estimatedClaimable: Math.max(claimableAmount, estimatedClaimable),
  };
}

// ── Progress bar subcomponent ─────────────────────────────────────────────────

function TwoStageProgressBar({
  cliffProgress,
  dripProgress,
  cliffReached,
  streamComplete,
}: {
  cliffProgress: number;
  dripProgress: number;
  cliffReached: boolean;
  streamComplete: boolean;
}) {
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: "0.25rem", height: "0.625rem" }}>
        {/* Cliff segment */}
        <div
          style={{
            flex: 1,
            borderRadius: "9999px 0 0 9999px",
            background: "var(--color-border)",
            overflow: "hidden",
            position: "relative",
          }}
          aria-label={`Cliff progress: ${Math.round(cliffProgress)}%`}
          title={`Cliff: ${Math.round(cliffProgress)}% complete`}
        >
          <div
            data-testid="cliff-progress-bar"
            style={{
              height: "100%",
              width: `${cliffProgress}%`,
              background: cliffReached
                ? "var(--color-pre-cliff)"
                : "linear-gradient(90deg, var(--color-pre-cliff), #fbbf24)",
              transition: "width 0.5s ease",
              borderRadius: "inherit",
            }}
          />
        </div>

        {/* Drip segment */}
        <div
          style={{
            flex: 2,
            borderRadius: "0 9999px 9999px 0",
            background: "var(--color-border)",
            overflow: "hidden",
            position: "relative",
          }}
          aria-label={`Drip progress: ${Math.round(dripProgress)}%`}
          title={`Drip: ${Math.round(dripProgress)}% complete`}
        >
          <div
            data-testid="drip-progress-bar"
            style={{
              height: "100%",
              width: `${dripProgress}%`,
              background: streamComplete
                ? "var(--color-completed)"
                : "linear-gradient(90deg, var(--color-completed), #34d399)",
              transition: "width 0.5s ease",
              borderRadius: "inherit",
            }}
          />
        </div>
      </div>

      {/* Labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.3rem", fontSize: "0.72rem", color: "#6b7280" }}>
        <span>Start</span>
        <span style={{ color: cliffReached ? "var(--color-pre-cliff)" : "#9ca3af" }}>
          Cliff {cliffReached ? "✓" : `${Math.round(cliffProgress)}%`}
        </span>
        <span>End</span>
      </div>
    </div>
  );
}

// ── Stream card ───────────────────────────────────────────────────────────────

function StreamCard({
  stream,
  currentLedger,
  onClaim,
}: {
  stream: VestingStream;
  currentLedger: number;
  onClaim: (s: VestingStream) => void;
}) {
  const progress = computeProgress(stream, currentLedger);

  return (
    <li
      className="stream-card"
      data-testid={`dashboard-stream-${stream.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "#6b7280", margin: 0 }}>
            Sponsor
          </p>
          <p style={{ fontFamily: "monospace", fontSize: "0.85rem", margin: "0.1rem 0 0.3rem" }}>
            {stream.sponsor}
          </p>
          <StatusBadge status={stream.status as StreamStatus} />
        </div>

        {/* Claimable amount + action */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: 0 }}>Claimable</p>
          <p
            data-testid={`claimable-amount-${stream.id}`}
            style={{ fontSize: "1.4rem", fontWeight: 800, margin: "0.1rem 0" }}
            title={formatAmount(progress.estimatedClaimable)}
          >
            {abbreviateAmount(progress.estimatedClaimable)}{" "}
            <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "#6b7280" }}>
              {stream.token}
            </span>
          </p>
          {stream.status === "active" && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "0.35rem 1rem", fontSize: "0.875rem" }}
              onClick={() => onClaim(stream)}
              data-testid={`claim-btn-${stream.id}`}
              aria-label={`Claim ${abbreviateAmount(progress.estimatedClaimable)} ${stream.token}`}
            >
              Claim
            </button>
          )}
        </div>
      </div>

      {/* Progress bars */}
      <div>
        <TwoStageProgressBar
          cliffProgress={progress.cliffProgress}
          dripProgress={progress.dripProgress}
          cliffReached={progress.cliffReached}
          streamComplete={progress.streamComplete}
        />
      </div>

      {/* Details row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "0.5rem 1rem",
          fontSize: "0.8rem",
          color: "#6b7280",
        }}
      >
        <Stat label="Rate" value={`${stream.rate.toLocaleString()} / ledger`} />
        <Stat label="Cliff ledger" value={stream.cliffLedger?.toLocaleString() ?? "—"} />
        <Stat label="End ledger"   value={stream.endLedger?.toLocaleString() ?? "—"} />
        <Stat label="Total deposit" value={stream.totalDeposit ? abbreviateAmount(stream.totalDeposit) : "—"} />
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontWeight: 600, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </p>
      <p style={{ margin: "0.1rem 0 0" }}>{value}</p>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyDashboard({ address }: { address: string | null }) {
  return (
    <div
      data-testid="dashboard-empty"
      style={{
        textAlign: "center",
        padding: "3rem 1.5rem",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        marginTop: "1.5rem",
      }}
    >
      <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>📭</p>
      {address ? (
        <>
          <p style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>No streams found</p>
          <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            No vesting streams are associated with{" "}
            <span style={{ fontFamily: "monospace" }}>
              {address.slice(0, 8)}…{address.slice(-4)}
            </span>
          </p>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>Connect your wallet</p>
          <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Connect a wallet to view your vesting streams.
          </p>
        </>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function VestingDashboard() {
  const { address, network } = useWallet();
  const [streams, setStreams] = useState<VestingStream[]>([]);
  const [currentLedger, setCurrentLedger] = useState(BASE_LEDGER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimTarget, setClaimTarget] = useState<VestingStream | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load streams for connected wallet
  const loadStreams = useCallback(async () => {
    if (!address) { setStreams([]); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStreamsForAddress(address, network);
      setStreams(data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load streams");
    } finally {
      setLoading(false);
    }
  }, [address, network]);

  // Poll current ledger from Horizon
  const pollLedger = useCallback(async () => {
    const ledger = await fetchCurrentLedger(network);
    setCurrentLedger(ledger);
  }, [network]);

  // Refresh everything
  const refresh = useCallback(async () => {
    await Promise.all([loadStreams(), pollLedger()]);
  }, [loadStreams, pollLedger]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  async function handleClaim() {
    setClaimTarget(null);
    // TODO: call claim_vested(recipient) via Freighter
    await new Promise(r => setTimeout(r, 1200));
    // Re-fetch after claim to update amounts
    await loadStreams();
  }

  return (
    <section aria-label="Vesting Dashboard" style={{ marginTop: "1.5rem" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
          My Streams
          {streams.length > 0 && (
            <span
              style={{
                marginLeft: "0.5rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                padding: "0.2rem 0.5rem",
                background: "#eff6ff",
                color: "var(--color-active)",
                borderRadius: "9999px",
              }}
            >
              {streams.length}
            </span>
          )}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {lastRefreshed && (
            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem", fontSize: "0.8rem" }}
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh streams"
            data-testid="dashboard-refresh-btn"
          >
            {loading ? "⟳" : "↻"} Refresh
          </button>
        </div>
      </div>

      {/* Auto-refresh indicator */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {loading ? "Refreshing streams…" : `Streams updated. ${streams.length} stream${streams.length !== 1 ? "s" : ""} found.`}
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          data-testid="dashboard-error"
          style={{
            padding: "0.75rem 1rem",
            background: "#fef2f2",
            border: "1px solid var(--color-cancelled)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
            color: "var(--color-cancelled)",
            marginBottom: "1rem",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && streams.length === 0 ? (
        <StreamListSkeleton count={3} />
      ) : streams.length === 0 ? (
        <EmptyDashboard address={address} />
      ) : (
        <ul
          className="stream-list"
          aria-label="Vesting streams"
          data-testid="dashboard-stream-list"
        >
          {streams.map(stream => (
            <StreamCard
              key={stream.id}
              stream={stream}
              currentLedger={currentLedger}
              onClaim={setClaimTarget}
            />
          ))}
        </ul>
      )}

      {claimTarget && (
        <ClaimBottomSheet
          stream={claimTarget}
          currentLedger={currentLedger}
          onClaim={handleClaim}
          onClose={() => setClaimTarget(null)}
        />
      )}
    </section>
  );
}
