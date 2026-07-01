"use client";
import { useEffect, useState, useCallback } from "react";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import { VestingTimeline } from "@/components/VestingTimeline";
import { VestingStream } from "@/types";
import { useWallet } from "@/contexts/WalletContext";

// Stub lookup — replace with real contract read
async function fetchSchedule(recipient: string): Promise<VestingStream | null> {
  if (!recipient.startsWith("G") || recipient.length < 10) return null;
  const BASE = 51_200_000;
  return {
    id: "demo",
    recipient,
    sponsor: "GXYZ…",
    token: "USDC",
    rate: 10,
    claimableAmount: 1500,
    status: "active",
    startLedger: BASE - 172_800,
    cliffLedger: BASE - 86_400,
    endLedger: BASE + 6_048_000,
    totalDeposit: 62_208_000,
    totalVested: 1728000,
  };
}

// Stub claim — replace with real Freighter/Soroban tx
async function claimVested(_recipient: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 1200));
}

export default function ViewPageClient({ recipient }: { recipient: string }) {
  const { address } = useWallet();
  const [stream, setStream] = useState<VestingStream | null | undefined>(undefined);
  const [showClaim, setShowClaim] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [currentLedger] = useState(51_200_000);

  useEffect(() => {
    fetchSchedule(recipient).then(setStream);
  }, [recipient]);

  const copyShareUrl = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  }, []);

  if (stream === undefined) {
    return <main className="page"><p>Loading…</p></main>;
  }

  if (stream === null) {
    return (
      <main className="page">
        <h1 style={{ marginBottom: "0.5rem" }}>Schedule not found</h1>
        <p style={{ color: "#6b7280" }}>
          No vesting schedule was found for <code>{recipient}</code>.
        </p>
      </main>
    );
  }

  const isRecipient = address === recipient;

  return (
    <main className="page">
      <header className="header">
        <h1>Vesting Schedule</h1>
        <button
          type="button"
          className="btn btn-outline"
          onClick={copyShareUrl}
          aria-label={urlCopied ? "Link copied!" : "Copy share link"}
        >
          {urlCopied ? "✓ Copied!" : "Share"}
        </button>
      </header>

      <section className="stream-card" style={{ flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
              {stream.recipient}
              <CopyButton text={stream.recipient} label="Copy recipient address" />
            </div>
            <div style={{ marginTop: "0.25rem" }}>
              <StatusBadge status={stream.status} />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>
              {stream.claimableAmount.toLocaleString()} {stream.token}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>claimable</div>
            {isRecipient && stream.status !== "completed" && stream.status !== "cancelled" && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: "0.5rem" }}
                onClick={() => setShowClaim(true)}
                data-testid="claim-btn"
              >
                Claim
              </button>
            )}
          </div>
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
          <dt style={{ color: "#6b7280" }}>Drip rate</dt>
          <dd>{stream.rate} tokens / ledger</dd>
          <dt style={{ color: "#6b7280" }}>Sponsor</dt>
          <dd style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontFamily: "monospace" }}>
            {stream.sponsor}
            <CopyButton text={stream.sponsor} label="Copy sponsor address" />
          </dd>
          {stream.totalDeposit && (
            <>
              <dt style={{ color: "#6b7280" }}>Total deposit</dt>
              <dd>{stream.totalDeposit.toLocaleString()} {stream.token}</dd>
            </>
          )}
        </dl>

        {/* Timeline chart */}
        {stream.startLedger && stream.cliffLedger && stream.endLedger && (
          <div style={{ marginTop: "0.5rem" }}>
            <VestingTimeline
              schedule={{
                startLedger: stream.startLedger,
                cliffLedger: stream.cliffLedger,
                endLedger: stream.endLedger,
                rate: stream.rate,
                tokenSymbol: stream.token,
                currentLedger,
              }}
              description="Cumulative claimable tokens over time. The cliff line marks when tokens first unlock."
            />
          </div>
        )}
      </section>

      {showClaim && (
        <ClaimBottomSheet
          stream={stream}
          currentLedger={currentLedger}
          onClaim={() => claimVested(recipient)}
          onClose={() => setShowClaim(false)}
        />
      )}
    </main>
  );
}
