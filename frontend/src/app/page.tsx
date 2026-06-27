"use client";
import { useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import { CancelConfirmModal } from "@/components/CancelConfirmModal";
import { SegmentedProgressBar } from "@/components/SegmentedProgressBar";
import { TxProvider, useTx } from "@/components/TxDrawer";
import { SponsorStreamListEmpty } from "@/components/EmptyStates";
import { VestingStream } from "@/types";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";

// Stub data – replace with contract reads. Use [] to see empty state.
const MOCK_STREAMS: VestingStream[] = [
  { id: "1", recipient: "GABC…", sponsor: "GXYZ…", token: "USDC", rate: 10, claimableAmount: 1500, status: "active" },
  { id: "2", recipient: "GDEF…", sponsor: "GXYZ…", token: "USDC", rate: 5,  claimableAmount: 0,    status: "pre-cliff" },
  { id: "3", recipient: "GHIJ…", sponsor: "GXYZ…", token: "USDC", rate: 20, claimableAmount: 0,    status: "completed" },
  { id: "4", recipient: "GKLM…", sponsor: "GXYZ…", token: "USDC", rate: 8,  claimableAmount: 0,    status: "cancelled" },
];

/** Compute cancel split before the modal opens. */
function computeCancelAmounts(s: VestingStream) {
  const cliffReached = s.status === "active";
  const recipientAmount = cliffReached ? s.claimableAmount : 0;
  // Stub total = rate * 300 ledgers; replace with real schedule data.
  const total = s.rate * 300;
  const sponsorRefund = Math.max(0, total - recipientAmount);
  return { recipientAmount, sponsorRefund, cliffReached };
}

function StreamList() {
  const { setPending, setConfirmed, setFailed } = useTx();
  const [claimTarget, setClaimTarget] = useState<VestingStream | null>(null);
  const [cancelTarget, setCancelTarget] = useState<VestingStream | null>(null);
  const [streams, setStreams] = useState(MOCK_STREAMS);

  async function handleClaim() {
    setClaimTarget(null);
    setPending();
    try {
      // TODO: invoke claim_vested on-chain; replace stub below
      await new Promise((r) => setTimeout(r, 1200));
      setConfirmed("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Unknown error — please retry.");
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    const target = cancelTarget;
    setCancelTarget(null);
    setPending();
    try {
      // TODO: invoke cancel_stream via Freighter; replace stub below
      await new Promise((r) => setTimeout(r, 1200));
      setConfirmed("c1d2e3f4a5b6c1d2e3f4a5b6c1d2e3f4a5b6c1d2e3f4a5b6c1d2e3f4a5b6c1d2");
      // Refresh list: mark stream as cancelled
      setStreams((prev) =>
        prev.map((s) => s.id === target.id ? { ...s, status: "cancelled", claimableAmount: 0 } : s)
      );
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Unknown error — please retry.");
    }
  }

  if (streams.length === 0) {
    return <SponsorStreamListEmpty onCreateStream={() => alert("TODO: open create stream form")} />;
  }

  return (
    <>
      <ul className="stream-list" style={{ marginTop: "1rem" }} aria-label="Your streams">
        {streams.map((s) => (
          <li key={s.id} className="stream-card" style={{ flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{s.recipient}</div>
                <div style={{ marginTop: "0.25rem" }}>
                  <StatusBadge status={s.status} />
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem" }}>
                <div style={{ fontWeight: 700 }}>
                  {s.claimableAmount.toLocaleString()} {s.token}
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {s.status === "active" && (
                    <button
                      className="btn btn-primary"
                      style={{ padding: "0.35rem 1rem" }}
                      onClick={() => setClaimTarget(s)}
                      data-testid={`claim-btn-${s.id}`}
                    >
                      Claim
                    </button>
                  )}
                  {(s.status === "active" || s.status === "pre-cliff") && (
                    <button
                      className="btn btn-outline"
                      style={{ padding: "0.35rem 1rem", borderColor: "var(--color-cancelled)", color: "var(--color-cancelled)" }}
                      onClick={() => setCancelTarget(s)}
                      data-testid={`cancel-btn-${s.id}`}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Segmented progress bar — amounts are illustrative stubs */}
            <SegmentedProgressBar
              total={3000}
              dripped={s.status === "active" ? s.claimableAmount : s.status === "completed" ? 3000 : 0}
              cliffCatchUp={s.status === "active" ? 500 : 0}
              locked={s.status === "pre-cliff" ? 3000 : s.status === "cancelled" ? 1500 : 0}
              tokenSymbol={s.token}
            />
          </li>
        ))}
      </ul>

      {claimTarget && (
        <ClaimBottomSheet
          claimableAmount={claimTarget.claimableAmount}
          tokenSymbol={claimTarget.token}
          onClaim={handleClaim}
          onClose={() => setClaimTarget(null)}
        />
      )}

      {cancelTarget && (
        <CancelConfirmModal
          stream={cancelTarget}
          amounts={computeCancelAmounts(cancelTarget)}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </>
  );
}

export default function Home() {
  return (
    <TxProvider>
      <main className="page">
        <header className="header">
          <h1>Vesting Streams</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <a href="/history" className="btn btn-ghost" style={{ fontSize: "0.875rem" }}>
              History
            </a>
            <WalletButton />
          </div>
        </header>
        <StatusLegend />
        <StreamList />
      </main>
    </TxProvider>
  );
}
