"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export type Network = "testnet" | "mainnet";

const STORAGE_KEY = "stellar_network";

interface NetworkCtx {
  network: Network;
  setNetwork: (n: Network) => void;
}

const NetworkContext = createContext<NetworkCtx>({
  network: "testnet",
  setNetwork: () => {},
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<Network>("testnet");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Network | null;
    if (stored === "mainnet" || stored === "testnet") setNetworkState(stored);
  }, []);

  const setNetwork = useCallback((n: Network) => {
    localStorage.setItem(STORAGE_KEY, n);
    setNetworkState(n);
    // Reload so all API calls use the new network config
    window.location.reload();
  }, []);

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>
      {network === "mainnet" && (
        <div role="alert" className="mainnet-banner" aria-live="assertive">
          ⚠️ You are on <strong>Mainnet</strong> — real assets are at risk.
        </div>
      )}
      {children}
    </NetworkContext.Provider>
  );
}

export const useNetwork = () => useContext(NetworkContext);

export function NetworkSelector() {
  const { network, setNetwork } = useNetwork();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Network;
    if (next === "mainnet") {
      const ok = window.confirm(
        "You are switching to Mainnet. Real assets will be used. Continue?"
      );
      if (!ok) return;
    }
    setNetwork(next);
  }

  return (
    <label className="network-selector" aria-label="Select network">
      <select value={network} onChange={handleChange}>
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
      </select>
    </label>
  );
}
