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

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEY_ADDRESS  = "vesting_wallet_address";
const KEY_PROVIDER = "vesting_wallet_provider";
const KEY_NETWORK  = "vesting_wallet_network";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletProvider = "freighter" | "walletconnect" | "albedo";
export type NetworkId = "testnet" | "mainnet";

interface WalletCtx {
  address: string | null;
  provider: WalletProvider | null;
  network: NetworkId;
  freighterInstalled: boolean | null;
  balances: WalletBalance[];
  balancesLoading: boolean;
  /** True when a modal-driven connection is needed */
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  connect: () => Promise<void>;
  connectWithProvider: (provider: WalletProvider, address: string) => void;
  disconnect: () => void;
  switchNetwork: (n: NetworkId) => void;
}

export const WalletContext = createContext<WalletCtx>({
  address: null,
  provider: null,
  network: "testnet",
  freighterInstalled: null,
  balances: [],
  balancesLoading: false,
  modalOpen: false,
  openModal: () => {},
  closeModal: () => {},
  connect: async () => {},
  connectWithProvider: () => {},
  disconnect: () => {},
  switchNetwork: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY_ADDRESS) ?? null; } catch { return null; }
  });
  const [provider, setProvider] = useState<WalletProvider | null>(() => {
    try { return (localStorage.getItem(KEY_PROVIDER) as WalletProvider) ?? null; } catch { return null; }
  });
  const [network, setNetwork] = useState<NetworkId>(() => {
    try { return (localStorage.getItem(KEY_NETWORK) as NetworkId) ?? "testnet"; } catch { return "testnet"; }
  });
  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

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
    if (typeof setAllowed === "function") {
      await (setAllowed as () => Promise<unknown>)();
    }
    const addr = await getAddress();
    if (addr.error) throw new Error(addr.error);
    setAddress(addr.address);
    setProvider("freighter");
    try {
      localStorage.setItem(KEY_ADDRESS, addr.address);
      localStorage.setItem(KEY_PROVIDER, "freighter");
    } catch { /* storage may be unavailable */ }
  }, []);

  // Called by WalletModal after successful provider connection
  const connectWithProvider = useCallback((prov: WalletProvider, addr: string) => {
    setAddress(addr);
    setProvider(prov);
    try {
      localStorage.setItem(KEY_ADDRESS, addr);
      localStorage.setItem(KEY_PROVIDER, prov);
    } catch { /* ignore */ }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
    try {
      localStorage.removeItem(KEY_ADDRESS);
      localStorage.removeItem(KEY_PROVIDER);
    } catch { /* ignore */ }
  }, []);

  const switchNetwork = useCallback((n: NetworkId) => {
    setNetwork(n);
    try { localStorage.setItem(KEY_NETWORK, n); } catch { /* ignore */ }
  }, []);

  const openModal  = useCallback(() => setModalOpen(true),  []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <WalletContext.Provider
      value={{
        address,
        provider,
        network,
        freighterInstalled,
        balances,
        balancesLoading,
        modalOpen,
        openModal,
        closeModal,
        connect,
        connectWithProvider,
        disconnect,
        switchNetwork,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
