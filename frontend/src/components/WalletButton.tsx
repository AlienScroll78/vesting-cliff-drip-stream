"use client";
import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { CopyButton } from "@/components/CopyButton";

export function WalletButton() {
  const { address, freighterInstalled, connect, disconnect } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    setLoading(true);
    try {
      await connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  // Freighter not installed
  if (freighterInstalled === false) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline"
          aria-label="Install Freighter wallet (opens in new tab)"
        >
          Install Freighter
        </a>
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Freighter extension required</span>
      </div>
    );
  }

  if (address) {
    const truncated = `${address.slice(0, 6)}…${address.slice(-4)}`;
    return (
      <div className="wallet-connected" role="group" aria-label="Wallet account">
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span
            data-testid="wallet-address"
            className="wallet-address"
            title={address}
            aria-label={`Connected wallet: ${address}`}
          >
            {truncated}
          </span>
          <CopyButton text={address} label="Copy wallet address" />
        </div>
        <button
          type="button"
          onClick={disconnect}
          className="btn btn-outline"
          data-testid="disconnect-wallet"
          aria-label="Disconnect wallet"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
      <button
        type="button"
        onClick={handleConnect}
        className="btn btn-primary"
        disabled={loading}
        data-testid="connect-wallet"
        aria-busy={loading}
      >
        {loading ? "Connecting…" : "Connect Wallet"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: "0.75rem", color: "var(--color-cancelled)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
