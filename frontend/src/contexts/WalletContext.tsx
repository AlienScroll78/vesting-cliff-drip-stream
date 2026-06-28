"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
} from "@stellar/freighter-api";

interface WalletCtx {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletCtx>({
  address: null,
  connect: async () => {},
  disconnect: async () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const connected = await isConnected();
    if (!connected.isConnected) throw new Error("Freighter not installed");
    const access = await requestAccess();
    if (access.error) throw new Error(access.error);
    const addr = await getAddress();
    if (addr.error) throw new Error(addr.error);
    setAddress(addr.address);
  }, []);

  const disconnect = useCallback(async () => {
    setAddress(null);
  }, []);

  return (
    <WalletContext.Provider value={{ address, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
