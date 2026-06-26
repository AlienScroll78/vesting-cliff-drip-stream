"use client";
import { useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import { VestingStream } from "@/types";

// Stub data – replace with contract reads
const MOCK_STREAMS: VestingStream[] = [
  { id: "1", recipient: "GABC…", sponsor: "GXYZ…", token: "USDC", rate: 10, claimableAmount: 1500, status: "active" },
  { id: "2", recipient: "GDEF…", sponsor: "GXYZ…", token: "USDC", rate: 5,  claimableAmount: 0,    status: "pre-cliff" },
  { id: "3", recipient: "GHIJ…", sponsor: "GXYZ…", token: "USDC", rate: 20, claimableAmount: 0,    status: "completed" },
  { id: "4", recipient: "GKLM…", sponsor: "GXYZ…", token: "USDC", rate: 8,  claimableAmount: 0,    status: "cancelled" },
];

export default function Home() {
  const [claimTarget, setClaimTarget] = useState<VestingStream | null>(null);

  async function handleClaim() {
    // TODO: invoke claim_vested on-chain
    await new Promise((r) => setTimeout(r, 1000));
    setClaimTarget(null);
  }

  return (
    <main className="page">
      <header className="header">
        <h1>Vesting Streams</h1>
        <WalletButton />
      </header>

      <StatusLegend />

      <ul className="stream-list" style={{ marginTop: "1rem" }} aria-label="Your streams">
        {MOCK_STREAMS.map((s) => (
          <li key={s.id} className="stream-card">
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{s.recipient}</div>
              <div style={{ marginTop: "0.25rem" }}>
                <StatusBadge status={s.status} />
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>
                {s.claimableAmount.toLocaleString()} {s.token}
              </div>
              {s.status === "active" && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: "0.4rem", padding: "0.35rem 1rem" }}
                  onClick={() => setClaimTarget(s)}
                  data-testid={`claim-btn-${s.id}`}
                >
                  Claim
                </button>
              )}
            </div>
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
    </main>
  );
}
