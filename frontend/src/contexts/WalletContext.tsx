"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
  setAllowed,
} from "@stellar/freighter-api";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { WalletBalance } from "@/types";

const STORAGE_KEY = "vesting_wallet_address";

interface WalletCtx {
  address: string | null;
  freighterInstalled: boolean | null;
  balances: WalletBalance[];
  balancesLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletCtx>({
  address: null,
  freighterInstalled: null,
  balances: [],
  balancesLoading: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(null);
  const { balances, loading: balancesLoading } = useWalletBalances(address);

  // Silent reconnect on mount: if a cached address exists, attempt to
  // verify Freighter is still connected before restoring state.
  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return;
    isConnected().then((result) => {
      if (result.isConnected) {
        setAddress(cached);
      } else {
        // Wallet locked or extension removed – clear stale cache
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      }
    }).catch(() => {
      // On any error fall back gracefully to disconnected state
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    });
  }, []);

  const connect = useCallback(async () => {
    const connected = await isConnected();
    if (!connected.isConnected) {
      setFreighterInstalled(false);
      throw new Error("Freighter not installed");
    }
    setFreighterInstalled(true);
    await requestAccess();
    // setAllowed may not exist in all versions; guard it
    if (typeof setAllowed === "function") {
      await (setAllowed as () => Promise<unknown>)();
    }
    const addr = await getAddress();
    if (addr.error) throw new Error(addr.error);
    setAddress(addr.address);
    localStorage.setItem(STORAGE_KEY, addr.address);
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  return (
    <WalletContext.Provider value={{ address, freighterInstalled, balances, balancesLoading, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
