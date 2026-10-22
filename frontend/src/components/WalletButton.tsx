"use client";
import { useWallet } from "@/contexts/WalletContext";
import { useTranslation } from "react-i18next";

export function WalletButton() {
  const { t } = useTranslation();
  const { address, connect, disconnect } = useWallet();

  if (address) {
    return (
      <div className="wallet-connected">
        <span data-testid="wallet-address" className="wallet-address">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button onClick={disconnect} className="btn btn-outline">
          {t("disconnectWallet")}
        </button>
      </div>
    );
  }

  return (
    <button onClick={connect} className="btn btn-primary" data-testid="connect-wallet">
      {t("connectWallet")}
    </button>
  );
}
