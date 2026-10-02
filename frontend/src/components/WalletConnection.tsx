"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
  useId,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WalletId = "freighter" | "lobstr" | "xbull" | "walletconnect";

export interface WalletOption {
  id: WalletId;
  name: string;
  icon: string; // SVG string or URL
  installUrl: string;
  /** Check if the wallet extension/app is available */
  isAvailable: () => boolean | Promise<boolean>;
  /** Request wallet access and return the public key */
  connect: () => Promise<string>;
  /** Disconnect from the wallet */
  disconnect: () => Promise<void>;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

interface WalletCtxValue {
  address: string | null;
  walletId: WalletId | null;
  status: ConnectionStatus;
  error: string | null;
  connect: (walletId: WalletId) => Promise<void>;
  disconnect: () => Promise<void>;
  openModal: () => void;
}

// ─── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "vesting:wallet";

interface PersistedWallet {
  walletId: WalletId;
  address: string;
}

// ─── Wallet definitions ───────────────────────────────────────────────────────
// Uses @stellar/freighter-api if available; falls back gracefully.

function makeFreighterWallet(): WalletOption {
  return {
    id: "freighter",
    name: "Freighter",
    installUrl: "https://www.freighter.app/",
    icon: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#5B45FF"/>
      <path d="M8 16L16 8L24 16L16 24L8 16Z" fill="white"/>
    </svg>`,
    isAvailable: async () => {
      try {
        const mod = await import(
          /* @vite-ignore */ "@stellar/freighter-api"
        );
        const result = await mod.isConnected();
        // isConnected returns an object with isConnected boolean
        return typeof result === "object"
          ? result.isConnected
          : Boolean(result);
      } catch {
        return false;
      }
    },
    connect: async () => {
      const mod = await import(/* @vite-ignore */ "@stellar/freighter-api");
      const access = await mod.requestAccess();
      if (access.error) throw new Error(access.error);
      const addr = await mod.getAddress();
      if (addr.error) throw new Error(addr.error);
      return addr.address;
    },
    disconnect: async () => {
      try {
        const mod = await import(/* @vite-ignore */ "@stellar/freighter-api");
        await mod.disconnect?.();
      } catch {
        // No-op if not available
      }
    },
  };
}

function makeLobstrWallet(): WalletOption {
  return {
    id: "lobstr",
    name: "LOBSTR",
    installUrl: "https://lobstr.co/",
    icon: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#0F1527"/>
      <circle cx="16" cy="16" r="8" stroke="#4BC8F0" stroke-width="2"/>
      <path d="M12 16L15 19L20 13" stroke="#4BC8F0" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    isAvailable: () => {
      // LOBSTR injects window.lobstr in the browser extension
      return typeof window !== "undefined" && "lobstr" in window;
    },
    connect: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lobstr = (window as any).lobstr;
      if (!lobstr) throw new Error("LOBSTR extension not found");
      const result = await lobstr.connect();
      if (!result?.publicKey) throw new Error("LOBSTR: no public key returned");
      return result.publicKey;
    },
    disconnect: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).lobstr?.disconnect?.();
    },
  };
}

function makeXBullWallet(): WalletOption {
  return {
    id: "xbull",
    name: "xBull",
    installUrl: "https://xbull.app/",
    icon: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#FF6B35"/>
      <path d="M8 8L16 16M16 16L24 24M16 16L24 8M16 16L8 24" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,
    isAvailable: () => {
      return typeof window !== "undefined" && "xBullSDK" in window;
    },
    connect: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = (window as any).xBullSDK;
      if (!sdk) throw new Error("xBull not found");
      const result = await sdk.connect({ canRequestPublicKey: true });
      if (!result?.publicKey) throw new Error("xBull: no public key returned");
      return result.publicKey;
    },
    disconnect: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).xBullSDK?.disconnect?.();
    },
  };
}

function makeWalletConnectWallet(): WalletOption {
  return {
    id: "walletconnect",
    name: "WalletConnect",
    installUrl: "https://walletconnect.com/",
    icon: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#3B99FC"/>
      <path d="M10.5 14.5C13.5 11.5 18.5 11.5 21.5 14.5L22 15L20.5 16.5L20 16C17.8 13.8 14.2 13.8 12 16L11.5 16.5L10 15L10.5 14.5Z" fill="white"/>
      <path d="M13.5 17.5L16 15L18.5 17.5L16 20L13.5 17.5Z" fill="white"/>
    </svg>`,
    isAvailable: () => true, // WalletConnect uses QR codes, always "available"
    connect: async () => {
      // In production this would integrate with @walletconnect/modal-sign-html
      // For now we surface a clear not-yet-implemented error so it doesn't silently fail
      throw new Error(
        "WalletConnect integration requires configuration (project ID). " +
          "See docs/wallet-integration.md for setup instructions."
      );
    },
    disconnect: async () => {},
  };
}

// ─── Wallet registry ──────────────────────────────────────────────────────────

export const WALLET_OPTIONS: WalletOption[] = [
  makeFreighterWallet(),
  makeLobstrWallet(),
  makeXBullWallet(),
  makeWalletConnectWallet(),
];

// ─── Context ──────────────────────────────────────────────────────────────────

const WalletCtx = createContext<WalletCtxValue>({
  address: null,
  walletId: null,
  status: "disconnected",
  error: null,
  connect: async () => {},
  disconnect: async () => {},
  openModal: () => {},
});

export function useWalletConnection(): WalletCtxValue {
  return useContext(WalletCtx);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * WalletConnectionProvider — wraps the app and exposes wallet state.
 * Auto-reconnects from localStorage on mount.
 * Dispatches a "walletAccountChanged" custom event when the address changes.
 */
export function WalletConnectionProvider({
  children,
  wallets = WALLET_OPTIONS,
  onAccountChange,
}: {
  children: ReactNode;
  wallets?: WalletOption[];
  onAccountChange?: (address: string | null) => void;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<WalletId | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // ── Account change events ─────────────────────────────────────────────────

  const prevAddressRef = useRef<string | null>(null);

  const updateAddress = useCallback(
    (addr: string | null) => {
      setAddress(addr);
      if (addr !== prevAddressRef.current) {
        prevAddressRef.current = addr;
        onAccountChange?.(addr);
        window.dispatchEvent(
          new CustomEvent("walletAccountChanged", { detail: { address: addr } })
        );
      }
    },
    [onAccountChange]
  );

  // ── Auto-reconnect on mount ───────────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const { walletId: savedId, address: savedAddr } = JSON.parse(
        saved
      ) as PersistedWallet;
      const wallet = wallets.find((w) => w.id === savedId);
      if (!wallet) return;
      // Re-verify availability before restoring
      Promise.resolve(wallet.isAvailable()).then((available) => {
        if (available) {
          setWalletId(savedId);
          updateAddress(savedAddr);
          setStatus("connected");
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Connect ───────────────────────────────────────────────────────────────

  const connect = useCallback(
    async (id: WalletId) => {
      const wallet = wallets.find((w) => w.id === id);
      if (!wallet) return;

      setStatus("connecting");
      setError(null);
      setModalOpen(false);

      try {
        const available = await Promise.resolve(wallet.isAvailable());
        if (!available) {
          throw new Error(
            `${wallet.name} is not installed. Install it from ${wallet.installUrl}`
          );
        }
        const addr = await wallet.connect();
        setWalletId(id);
        updateAddress(addr);
        setStatus("connected");
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ walletId: id, address: addr } satisfies PersistedWallet)
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Connection failed";
        setError(msg);
        setStatus("error");
      }
    },
    [wallets, updateAddress]
  );

  // ── Disconnect ────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    if (!walletId) return;
    const wallet = wallets.find((w) => w.id === walletId);
    try {
      await wallet?.disconnect();
    } catch {
      // swallow
    }
    setWalletId(null);
    updateAddress(null);
    setStatus("disconnected");
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }, [walletId, wallets, updateAddress]);

  // ── Listen for Freighter account switches ─────────────────────────────────

  useEffect(() => {
    if (walletId !== "freighter") return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const checkAddress = async () => {
      try {
        const mod = await import(/* @vite-ignore */ "@stellar/freighter-api");
        const result = await mod.getAddress();
        if (!cancelled && !result.error && result.address !== address) {
          updateAddress(result.address);
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              walletId: "freighter",
              address: result.address,
            } satisfies PersistedWallet)
          );
        }
      } catch {
        // freighter not available
      }
    };

    interval = setInterval(checkAddress, 5000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [walletId, address, updateAddress]);

  return (
    <WalletCtx.Provider
      value={{
        address,
        walletId,
        status,
        error,
        connect,
        disconnect,
        openModal: () => {
          setError(null);
          setModalOpen(true);
        },
      }}
    >
      {children}
      <AnimatePresence>
        {modalOpen && (
          <WalletSelectorModal
            wallets={wallets}
            onSelect={connect}
            onClose={() => setModalOpen(false)}
            error={error}
          />
        )}
      </AnimatePresence>
    </WalletCtx.Provider>
  );
}

// ─── Wallet selector modal ────────────────────────────────────────────────────

interface WalletSelectorModalProps {
  wallets: WalletOption[];
  onSelect: (id: WalletId) => void;
  onClose: () => void;
  error: string | null;
}

function WalletSelectorModal({
  wallets,
  onSelect,
  onClose,
  error,
}: WalletSelectorModalProps) {
  const titleId = useId();
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<WalletId, boolean | null>
  >({
    freighter: null,
    lobstr: null,
    xbull: null,
    walletconnect: true,
  });

  // Check availability for each wallet
  useEffect(() => {
    wallets.forEach((w) => {
      Promise.resolve(w.isAvailable()).then((avail) => {
        setAvailabilityMap((prev) => ({ ...prev, [w.id]: avail }));
      });
    });
  }, [wallets]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const firstBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstBtnRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
        style={{
          background: "var(--color-bg-surface, #1E293B)",
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "400px",
          width: "100%",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          color: "var(--color-text-primary, #f8fafc)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}
          >
            Connect Wallet
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet selector"
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-secondary, #94a3b8)",
              cursor: "pointer",
              fontSize: "20px",
              lineHeight: 1,
              padding: "4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            style={{
              background: "rgba(185,28,28,0.15)",
              border: "1px solid #b91c1c",
              borderRadius: "8px",
              padding: "10px 14px",
              fontSize: "13px",
              color: "#fca5a5",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        {/* Wallet options */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {wallets.map((wallet, i) => {
            const available = availabilityMap[wallet.id];
            const isFirst = i === 0;

            return (
              <WalletOptionButton
                key={wallet.id}
                wallet={wallet}
                available={available}
                ref={isFirst ? firstBtnRef : undefined}
                onSelect={onSelect}
              />
            );
          })}
        </div>

        <p
          style={{
            marginTop: "20px",
            fontSize: "12px",
            color: "var(--color-text-disabled, #475569)",
            textAlign: "center",
          }}
        >
          By connecting, you agree to the{" "}
          <a
            href="/terms"
            style={{ color: "var(--color-brand-primary, #7C3AED)" }}
          >
            terms of service
          </a>
        </p>
      </motion.div>
    </div>
  );
}

// ─── Wallet option button ─────────────────────────────────────────────────────

import { forwardRef } from "react";

const WalletOptionButton = forwardRef<
  HTMLButtonElement,
  {
    wallet: WalletOption;
    available: boolean | null;
    onSelect: (id: WalletId) => void;
  }
>(function WalletOptionButton({ wallet, available, onSelect }, ref) {
  const notInstalled = available === false;

  return (
    <div>
      <button
        ref={ref}
        type="button"
        disabled={available === null}
        onClick={() => {
          if (notInstalled) {
            window.open(wallet.installUrl, "_blank", "noopener");
          } else {
            onSelect(wallet.id);
          }
        }}
        aria-label={
          notInstalled
            ? `Install ${wallet.name} (opens in new tab)`
            : available === null
            ? `Checking ${wallet.name}…`
            : `Connect with ${wallet.name}`
        }
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "12px 14px",
          background: notInstalled
            ? "var(--color-bg-base, #0F172A)"
            : "var(--color-bg-elevated, #334155)",
          border: "1.5px solid var(--color-border, #334155)",
          borderRadius: "10px",
          color: notInstalled
            ? "var(--color-text-disabled, #475569)"
            : "var(--color-text-primary, #f8fafc)",
          cursor: available === null ? "wait" : "pointer",
          textAlign: "left",
          transition: "border-color 0.15s, background 0.15s",
          opacity: available === null ? 0.6 : 1,
        }}
      >
        {/* Icon */}
        <span
          aria-hidden="true"
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            overflow: "hidden",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          dangerouslySetInnerHTML={{ __html: wallet.icon }}
        />

        {/* Name + status */}
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>
            {wallet.name}
          </span>
          {notInstalled && (
            <span
              style={{
                display: "block",
                fontSize: "11px",
                color: "#ca8a04",
                marginTop: "2px",
              }}
            >
              Not installed — click to install ↗
            </span>
          )}
          {available === null && (
            <span
              style={{
                display: "block",
                fontSize: "11px",
                color: "var(--color-text-disabled, #475569)",
                marginTop: "2px",
              }}
            >
              Checking…
            </span>
          )}
        </span>

        {/* Available indicator */}
        {available === true && (
          <span
            aria-label="Available"
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#10b981",
              flexShrink: 0,
            }}
          />
        )}
        {notInstalled && (
          <span
            aria-label="Not installed"
            style={{
              fontSize: "16px",
              color: "#94a3b8",
            }}
          >
            ↗
          </span>
        )}
      </button>
    </div>
  );
});

// ─── WalletConnectButton ──────────────────────────────────────────────────────

/**
 * Drop-in header button that shows the connection state.
 * Uses WalletConnectionProvider context.
 */
export function WalletConnectButton() {
  const { address, status, disconnect, openModal } = useWalletConnection();

  if (status === "connecting") {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        aria-label="Connecting to wallet"
        style={connectedBtnStyle}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            border: "2px solid #fff",
            borderTopColor: "transparent",
            animation: "spin 0.7s linear infinite",
            flexShrink: 0,
          }}
        />
        Connecting…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </button>
    );
  }

  if (address) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          data-testid="wallet-address"
          style={{
            fontFamily: "monospace",
            fontSize: "13px",
            color: "var(--color-text-secondary, #94a3b8)",
            background: "var(--color-bg-elevated, #334155)",
            padding: "5px 10px",
            borderRadius: "6px",
          }}
        >
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          type="button"
          onClick={disconnect}
          aria-label="Disconnect wallet"
          style={{
            padding: "6px 12px",
            borderRadius: "8px",
            border: "1.5px solid var(--color-border, #334155)",
            background: "transparent",
            color: "var(--color-text-secondary, #94a3b8)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={openModal}
      data-testid="connect-wallet"
      aria-label="Connect your Stellar wallet"
      style={connectedBtnStyle}
    >
      Connect Wallet
    </button>
  );
}

const connectedBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 16px",
  borderRadius: "8px",
  border: "none",
  background: "var(--color-brand-primary, #7C3AED)",
  color: "#fff",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
};
