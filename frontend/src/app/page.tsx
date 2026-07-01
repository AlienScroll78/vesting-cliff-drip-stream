"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { WalletButton } from "@/components/WalletButton";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import { CancelConfirmModal } from "@/components/CancelConfirmModal";
import { SegmentedProgressBar } from "@/components/SegmentedProgressBar";
import { TxProvider, useTx } from "@/components/TxDrawer";
import { SponsorStreamListEmpty } from "@/components/EmptyStates";
import { StreamListSkeleton } from "@/components/Skeletons";
import { CopyButton } from "@/components/CopyButton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AnalyticsOptOut } from "@/components/AnalyticsOptOut";
import { StreamCreateForm } from "@/components/StreamCreateForm";
import { VestingTimeline } from "@/components/VestingTimeline";
import { analytics } from "@/analytics";
import { VestingStream } from "@/types";
import { formatAmount, abbreviateAmount } from "@/utils/formatAmount";

// Ledger numbers assume stream started ~10 days ago, cliff at 30 days, ends at 365 days
const BASE_LEDGER = 51_200_000;
const MOCK_STREAMS: VestingStream[] = [
  {
    id: "1",
    recipient: "GABC…",
    sponsor: "GXYZ…",
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
    recipient: "GDEF…",
    sponsor: "GXYZ…",
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
    recipient: "GHIJ…",
    sponsor: "GXYZ…",
    token: "USDC",
    rate: 20,
    claimableAmount: 0,
    status: "completed",
  },
  {
    id: "4",
    recipient: "GKLM…",
    sponsor: "GXYZ…",
    token: "USDC",
    rate: 8,
    claimableAmount: 0,
    status: "cancelled",
  },
];

function computeCancelAmounts(s: VestingStream) {
  const cliffReached = s.status === "active";
  const recipientAmount = cliffReached ? s.claimableAmount : 0;
  const total = s.totalDeposit ?? s.rate * 300;
  const sponsorRefund = Math.max(0, total - recipientAmount);
  return { recipientAmount, sponsorRefund, cliffReached };
}

// Stub: replace with real Horizon fetch
function useSponsorDashboard() {
  const [showCreate, setShowCreate] = useState(false);
  return { showCreate, setShowCreate };
}

function StreamList() {
  const { t } = useTranslation();
  const { setPending, setConfirmed, setFailed } = useTx();
  const [claimTarget, setClaimTarget] = useState<VestingStream | null>(null);
  const [cancelTarget, setCancelTarget] = useState<VestingStream | null>(null);
  const [timelineTarget, setTimelineTarget] = useState<VestingStream | null>(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  });

  async function handleClaim() {
    if (claimTarget) analytics.claimSubmitted(claimTarget.token, claimTarget.claimableAmount);
    const target = claimTarget;
    setClaimTarget(null);
    setPending();
    try {
      await new Promise((r) => setTimeout(r, 1200));
      setConfirmed("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Unknown error");
      if (target) setClaimTarget(target); // reopen on failure
    }
  }

  async function handleCancel() {
    setCancelTarget(null);
    setPending();
    try {
      await new Promise((r) => setTimeout(r, 1200));
      setConfirmed("b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Unknown error");
    }
  }

  if (loading) return <StreamListSkeleton count={4} />;

  if (MOCK_STREAMS.length === 0) {
    return (
      <SponsorStreamListEmpty
        onCreateStream={() => { analytics.streamCreated("USDC"); }}
      />
    );
  }

  return (
    <>
      <ul className="stream-list" style={{ marginTop: "1rem" }} aria-label={t("streams")}>
        {MOCK_STREAMS.map((s) => (
          <li key={s.id} className="stream-card">
            <div className="stream-card-row">
              <div>
                <div style={{ fontFamily: "monospace", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  {s.recipient}
                  <CopyButton text={s.recipient} label="Copy recipient address" />
                </div>
                <div style={{ marginTop: "0.25rem" }}>
                  <StatusBadge status={s.status} />
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem" }}>
                <div style={{ fontWeight: 700 }}>
                  {abbreviateAmount(s.claimableAmount)} {s.token}
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {s.startLedger && s.cliffLedger && s.endLedger && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                      onClick={() => setTimelineTarget(timelineTarget?.id === s.id ? null : s)}
                      aria-expanded={timelineTarget?.id === s.id}
                      aria-label="Toggle vesting timeline chart"
                    >
                      📈 Timeline
                    </button>
                  )}
                  {s.status === "active" && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "0.35rem 1rem" }}
                      onClick={() => setClaimTarget(s)}
                      data-testid={`claim-btn-${s.id}`}
                    >
                      {t("claim")}
                    </button>
                  )}
                </div>
                {s.status === "active" && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: "0.4rem" }}
                    onClick={() => setClaimTarget(s)}
                    data-testid={`claim-btn-${s.id}`}
                  >
                    {t("claim")}
                  </button>
                )}
              </div>
            </div>

            <SegmentedProgressBar
              total={s.totalDeposit ?? 3000}
              dripped={s.status === "active" ? s.claimableAmount : s.status === "completed" ? (s.totalDeposit ?? 3000) : 0}
              cliffCatchUp={s.status === "active" ? 500 : 0}
              locked={s.status === "pre-cliff" ? (s.totalDeposit ?? 3000) : s.status === "cancelled" ? 1500 : 0}
              tokenSymbol={s.token}
            />

            {timelineTarget?.id === s.id && s.startLedger && s.cliffLedger && s.endLedger && (
              <div style={{ marginTop: "0.5rem" }}>
                <VestingTimeline
                  schedule={{
                    startLedger: s.startLedger,
                    cliffLedger: s.cliffLedger,
                    endLedger: s.endLedger,
                    rate: s.rate,
                    tokenSymbol: s.token,
                    currentLedger: BASE_LEDGER,
                  }}
                  description={`Vesting schedule for recipient ${s.recipient}`}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {claimTarget && (
        <ClaimBottomSheet
          stream={claimTarget}
          currentLedger={BASE_LEDGER}
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
  const { t } = useTranslation();
  const { showCreate, setShowCreate } = useSponsorDashboard();

  return (
    <TxProvider>
      <main id="main-content" className="page">
        <header className="header">
          <h1>{t("appTitle")}</h1>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <a href="/streams" className="btn btn-outline" style={{ fontSize: "0.875rem" }}>
              My Streams
            </a>
            <LanguageSwitcher />
            <WalletButton />
          </div>
        </header>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
          <StatusLegend />
          <button
            type="button"
            className="btn btn-primary"
            style={{ whiteSpace: "nowrap" }}
            onClick={() => setShowCreate((v) => !v)}
            aria-expanded={showCreate}
            data-testid="toggle-create-form"
          >
            {showCreate ? "✕ Cancel" : "+ New Stream"}
          </button>
        </div>

        {showCreate && (
          <section
            style={{
              marginTop: "1rem",
              padding: "1.25rem",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
            }}
          >
            <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create Vesting Stream</h2>
            <StreamCreateForm onSuccess={() => setShowCreate(false)} />
          </section>
        )}

        <StreamList />

        <footer style={{ marginTop: "2rem", fontSize: "0.75rem", color: "#6b7280", textAlign: "center" }}>
          <AnalyticsOptOut />
        </footer>
      </main>
    </TxProvider>
  );
}
