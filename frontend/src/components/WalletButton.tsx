"use client";
import { useWallet } from "@/contexts/WalletContext";

export function WalletButton() {
  const { address, connect, disconnect } = useWallet();

  if (address) {
    return (
      <div className="wallet-connected">
        <span data-testid="wallet-address" className="wallet-address">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button onClick={disconnect} className="btn btn-outline">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button onClick={connect} className="btn btn-primary" data-testid="connect-wallet">
      Connect Wallet
    </button>
  );
}
