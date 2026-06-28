"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { WalletButton } from "@/components/WalletButton";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import { SegmentedProgressBar } from "@/components/SegmentedProgressBar";
import { TxProvider, useTx } from "@/components/TxDrawer";
import { SponsorStreamListEmpty } from "@/components/EmptyStates";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AnalyticsOptOut } from "@/components/AnalyticsOptOut";
import { analytics } from "@/analytics";
import { VestingStream } from "@/types";
import { abbreviateAmount, formatAmount } from "@/utils/formatAmount";

// Stub data – replace with contract reads. Use [] to see empty state.
const MOCK_STREAMS: VestingStream[] = [
  { id: "1", recipient: "GABC…", sponsor: "GXYZ…", token: "USDC", rate: 10, claimableAmount: 1500, status: "active" },
  { id: "2", recipient: "GDEF…", sponsor: "GXYZ…", token: "USDC", rate: 5,  claimableAmount: 0,    status: "pre-cliff" },
  { id: "3", recipient: "GHIJ…", sponsor: "GXYZ…", token: "USDC", rate: 20, claimableAmount: 0,    status: "completed" },
  { id: "4", recipient: "GKLM…", sponsor: "GXYZ…", token: "USDC", rate: 8,  claimableAmount: 0,    status: "cancelled" },
];

function StreamList() {
  const { t } = useTranslation();
  const { setPending, setConfirmed, setFailed } = useTx();
  const [claimTarget, setClaimTarget] = useState<VestingStream | null>(null);

  async function handleClaim() {
    if (claimTarget) analytics.claimSubmitted(claimTarget.token, claimTarget.claimableAmount);
    setClaimTarget(null);
    setPending();
    try {
      await new Promise((r) => setTimeout(r, 1200));
      setConfirmed("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Unknown error — please retry.");
    }
  }

  if (MOCK_STREAMS.length === 0) {
    return (
      <SponsorStreamListEmpty
        onCreateStream={() => {
          analytics.streamCreated("USDC");
          alert("TODO: open create stream form");
        }}
      />
    );
  }

  return (
    <>
      <ul className="stream-list" style={{ marginTop: "1rem" }} aria-label={t("streams")}>
        {MOCK_STREAMS.map((s) => (
          <li key={s.id} className="stream-card" style={{ flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
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
                    {t("claim")}
                  </button>
                )}
              </div>
            </div>

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
    </>
  );
}

export default function Home() {
  const { t } = useTranslation();
  return (
    <TxProvider>
      {/* #69 — main-content target for skip-nav */}
      <main id="main-content" className="page">
        <header className="header">
          <h1>{t("appTitle")}</h1>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <LanguageSwitcher />
            <WalletButton />
          </div>
        </header>
        <StatusLegend />
        <StreamList />
        <footer style={{ marginTop: "2rem", fontSize: "0.75rem", color: "#6b7280", textAlign: "center" }}>
          <AnalyticsOptOut />
        </footer>
      </main>
    </TxProvider>
  );
}
