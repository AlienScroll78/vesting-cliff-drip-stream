"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Network = "testnet" | "mainnet";

// ── Network configuration from env vars ──────────────────────────────────────

export interface NetworkConfig {
  rpcUrl: string;
  horizonUrl: string;
  contractAddress: string;
  networkPassphrase: string;
}

/**
 * Reads network config from Vite environment variables.
 * Each network has its own prefixed set of env vars so the correct
 * base URL is used for all API calls automatically.
 *
 * Expected env vars (set per environment in .env.local / CI secrets):
 *   VITE_TESTNET_RPC_URL            VITE_MAINNET_RPC_URL
 *   VITE_TESTNET_HORIZON_URL        VITE_MAINNET_HORIZON_URL
 *   VITE_TESTNET_CONTRACT_ADDRESS   VITE_MAINNET_CONTRACT_ADDRESS
 *   VITE_TESTNET_PASSPHRASE         VITE_MAINNET_PASSPHRASE
 */
export function getNetworkConfig(network: Network): NetworkConfig {
  if (network === "mainnet") {
    return {
      rpcUrl:
        import.meta.env.VITE_MAINNET_RPC_URL ||
        "https://soroban-rpc.mainnet.stellar.gateway.fm",
      horizonUrl:
        import.meta.env.VITE_MAINNET_HORIZON_URL ||
        "https://horizon.stellar.org",
      contractAddress: import.meta.env.VITE_MAINNET_CONTRACT_ADDRESS || "",
      networkPassphrase:
        import.meta.env.VITE_MAINNET_PASSPHRASE ||
        "Public Global Stellar Network ; September 2015",
    };
  }
  return {
    rpcUrl:
      import.meta.env.VITE_TESTNET_RPC_URL ||
      "https://soroban-testnet.stellar.org",
    horizonUrl:
      import.meta.env.VITE_TESTNET_HORIZON_URL ||
      "https://horizon-testnet.stellar.org",
    contractAddress:
      import.meta.env.VITE_TESTNET_CONTRACT_ADDRESS || "",
    networkPassphrase:
      import.meta.env.VITE_TESTNET_PASSPHRASE ||
      "Test SDF Network ; September 2015",
  };
}

// ── localStorage persistence ──────────────────────────────────────────────────

const STORAGE_KEY = "stellar_network_preference";

function loadPersistedNetwork(): Network {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "mainnet" ? "mainnet" : "testnet";
  } catch {
    return "testnet";
  }
}

function persistNetwork(network: Network): void {
  try {
    localStorage.setItem(STORAGE_KEY, network);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function clearNetworkCache(): void {
  // Remove all cached data that is network-specific
  const networkKeys = [
    "stellar_network_preference",
    "vesting_wallet_address",
    "vesting_wallet_provider",
    "vesting_wallet_network",
    "horizon_streams_cache",
  ];
  try {
    networkKeys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

export interface NetworkCtx {
  network: Network;
  networkConfig: NetworkConfig;
  switchNetwork: (target: Network) => void;
}

export const NetworkContext = createContext<NetworkCtx>({
  network: "testnet",
  networkConfig: getNetworkConfig("testnet"),
  switchNetwork: () => {},
});

export const useNetwork = () => useContext(NetworkContext);

// ── NetworkProvider ───────────────────────────────────────────────────────────

interface NetworkProviderProps {
  children: ReactNode;
  /** Inject a disconnect callback from WalletContext to clear wallet state on network switch. */
  onDisconnectWallet?: () => void;
}

export function NetworkProvider({
  children,
  onDisconnectWallet,
}: NetworkProviderProps) {
  const [network, setNetwork] = useState<Network>(loadPersistedNetwork);
  const networkConfig = getNetworkConfig(network);
  const disconnectRef = useRef(onDisconnectWallet);

  // Keep ref in sync so we don't need onDisconnectWallet in the deps array
  useEffect(() => {
    disconnectRef.current = onDisconnectWallet;
  }, [onDisconnectWallet]);

  const switchNetwork = useCallback((target: Network) => {
    // Disconnect wallet and clear all cached data before switching
    disconnectRef.current?.();
    clearNetworkCache();
    persistNetwork(target);
    setNetwork(target);
  }, []);

  return (
    <NetworkContext.Provider value={{ network, networkConfig, switchNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}

// ── NetworkBadge (header indicator) ──────────────────────────────────────────

/**
 * Shows a sticky banner at the top of the page:
 *   – TESTNET: yellow background, informational
 *   – MAINNET: red background, assertive warning
 *
 * Renders nothing when on mainnet without the banner (to avoid clutter
 * for power users who know they're on mainnet). Per AC: "MAINNET" badge
 * is always visible; "TESTNET" yellow banner is shown prominently.
 */
export function NetworkBadge() {
  const { network } = useNetwork();

  if (network === "mainnet") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        aria-label="You are on Mainnet — real tokens"
        data-testid="network-badge"
        data-network="mainnet"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1000,
          background: "#dc2626",
          color: "#fff",
          textAlign: "center",
          padding: "6px 16px",
          fontSize: "0.8125rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
        }}
      >
        ⚠️ MAINNET — real tokens are at risk
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="You are on Testnet"
      data-testid="network-badge"
      data-network="testnet"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        background: "#d97706",
        color: "#fff",
        textAlign: "center",
        padding: "6px 16px",
        fontSize: "0.8125rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}
    >
      TESTNET
    </div>
  );
}

// ── MainnetWarningModal ───────────────────────────────────────────────────────

interface MainnetWarningModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function MainnetWarningModal({ onConfirm, onCancel }: MainnetWarningModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Trap focus: focus the confirm button on open
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mainnet-modal-title"
      aria-describedby="mainnet-modal-desc"
      data-testid="mainnet-warning-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
      }}
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: "var(--radius, 0.5rem)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          maxWidth: 420,
          width: "calc(100% - 32px)",
          padding: "1.5rem",
        }}
      >
        <h2
          id="mainnet-modal-title"
          style={{ margin: "0 0 0.5rem", color: "#dc2626", fontSize: "1.1rem" }}
        >
          ⚠️ Switch to Mainnet?
        </h2>
        <p
          id="mainnet-modal-desc"
          style={{ margin: "0 0 1.25rem", fontSize: "0.9rem", lineHeight: 1.5 }}
        >
          You are switching to Mainnet. Transactions use real tokens. Your
          wallet will be disconnected and you will need to reconnect on
          Mainnet.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            data-testid="mainnet-modal-cancel"
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "var(--radius, 0.375rem)",
              border: "1px solid var(--border, #d1d5db)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            data-testid="mainnet-modal-confirm"
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "var(--radius, 0.375rem)",
              border: "none",
              background: "#dc2626",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Switch to Mainnet
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NetworkSwitcher ───────────────────────────────────────────────────────────

/**
 * Drop-in network toggle for the app header.
 *
 * Renders a select that lets the user switch between Testnet and Mainnet.
 * Switching to Mainnet shows a confirmation modal. On confirmation:
 *   1. Wallet is disconnected
 *   2. Network-specific cache is cleared
 *   3. localStorage preference is updated
 *   4. All subsequent API calls use the new network's base URL
 */
export function NetworkSwitcher() {
  const { network, switchNetwork } = useNetwork();
  const [pendingNetwork, setPendingNetwork] = useState<Network | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value as Network;
    if (target === network) return;

    if (target === "mainnet") {
      // Show the confirmation modal before switching
      setPendingNetwork("mainnet");
    } else {
      // Testnet needs no extra confirmation
      switchNetwork("testnet");
    }
  }

  function handleConfirm() {
    if (pendingNetwork) switchNetwork(pendingNetwork);
    setPendingNetwork(null);
  }

  function handleCancel() {
    setPendingNetwork(null);
  }

  return (
    <>
      <label
        className="network-switcher"
        aria-label="Select network"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
      >
        <span
          data-testid="network-indicator"
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: network === "mainnet" ? "#dc2626" : "#d97706",
            flexShrink: 0,
          }}
        />
        <select
          value={network}
          onChange={handleChange}
          data-testid="network-select"
          style={{
            border: "1px solid var(--border, #d1d5db)",
            borderRadius: "var(--radius, 0.375rem)",
            padding: "4px 8px",
            fontSize: "0.875rem",
            cursor: "pointer",
            background: "var(--surface, #fff)",
            color: "var(--text, #111)",
          }}
        >
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </select>
      </label>

      {pendingNetwork === "mainnet" && (
        <MainnetWarningModal onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </>
  );
}
