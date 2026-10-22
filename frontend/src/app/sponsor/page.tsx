"use client";

import { useTranslation } from "react-i18next";
import { SponsorDashboard } from "@/components/SponsorDashboard";
import { useWallet } from "@/contexts/WalletContext";
import { WalletButton } from "@/components/WalletButton";

export default function SponsorDashboardPage() {
  const { t } = useTranslation();
  const { address } = useWallet();

  return (
    <main className="page sponsor-dashboard-page">
      <header className="header">
        <div>
          <h1>{t("sponsorDashboard.title", { defaultValue: "Sponsor Dashboard" })}</h1>
          <p className="sponsor-dashboard-address">{address ?? t("sponsorDashboard.connectWallet", { defaultValue: "Connect your wallet to view your streams." })}</p>
        </div>
        <div className="sponsor-dashboard-header-actions">
          <a href="/" className="btn btn-outline">{t("history.back", { defaultValue: "Back" })}</a>
          <WalletButton />
        </div>
      </header>
      <SponsorDashboard address={address} />
    </main>
  );
}