"use client";
/**
 * WalletModal — unified wallet connection modal
 * Supports: Freighter (browser extension), WalletConnect v2 (mobile), Albedo (web)
 *
 * Accessibility:
 *  - role="dialog" aria-modal + focus trap
 *  - keyboard navigation (Tab, Shift+Tab, Escape to close)
 *  - aria-live region for status messages
 */
import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from "react";
import { isConnected, getAddress, requestAccess } from "@stellar/freighter-api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletProvider = "freighter" | "walletconnect" | "albedo";

export interface WalletModalProps {
  isOpen: boolean;
  /** Currently connected public key (if any) */
  connectedAddress?: string | null;
  network?: "testnet" | "mainnet";
  onConnected: (address: string, provider: WalletProvider) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

type ProviderState = "idle" | "connecting" | "error";

// ── Provider definitions ──────────────────────────────────────────────────────

const PROVIDERS: {
  id: WalletProvider;
  name: string;
  description: string;
  icon: string;
  installUrl?: string;
}[] = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension wallet for Stellar",
    icon: "🪐",
    installUrl: "https://www.freighter.app/",
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    description: "Connect any mobile wallet via QR code",
    icon: "📱",
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "Web-based Stellar wallet & signer",
    icon: "🔑",
  },
];

// ── Provider connection implementations ───────────────────────────────────────

async function connectFreighter(): Promise<string> {
  const status = await isConnected();
  if (!status.isConnected) {
    throw new Error("FREIGHTER_NOT_INSTALLED");
  }
  await requestAccess();
  const result = await getAddress();
  if (result.error) throw new Error(result.error);
  return result.address;
}

async function connectWalletConnect(): Promise<string> {
  // TODO: integrate @walletconnect/sign-client
  // 1. new SignClient({ projectId: VITE_WC_PROJECT_ID })
  // 2. client.connect({ requiredNamespaces: { stellar: { methods: [...], chains: [...], events: [] } } })
  // 3. Display URI as QR code (e.g. via qrcode.js)
  // 4. Await session approval and extract stellar address
  throw new Error(
    "WalletConnect integration requires @walletconnect/sign-client. " +
    "Install it and set VITE_WC_PROJECT_ID to enable mobile wallet support."
  );
}

async function connectAlbedo(): Promise<string> {
  // TODO: integrate albedo-link
  // import albedo from '@albedo-link/intent'
  // const { pubkey } = await albedo.publicKey({ token: 'vesting-stream' })
  // return pubkey
  throw new Error(
    "Albedo integration requires @albedo-link/intent. " +
    "Install it to enable web-based wallet signing."
  );
}

// ── Focus trap utility ────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(container: HTMLElement, e: globalThis.KeyboardEvent) {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.key === "Tab") {
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function WalletModal({
  isOpen,
  connectedAddress,
  network = "testnet",
  onConnected,
  onDisconnect,
  onClose,
}: WalletModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [providerState, setProviderState] = useState<Record<WalletProvider, ProviderState>>({
    freighter: "idle",
    walletconnect: "idle",
    albedo: "idle",
  });
  const [errorMessages, setErrorMessages] = useState<Record<WalletProvider, string>>({
    freighter: "",
    walletconnect: "",
    albedo: "",
  });
  const [statusMsg, setStatusMsg] = useState("");
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);

  // Focus first focusable element when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: globalThis.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (dialogRef.current) trapFocus(dialogRef.current, e);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) { document.body.style.overflow = "hidden"; }
    else { document.body.style.overflow = ""; }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConnect(providerId: WalletProvider) {
    setProviderState(s => ({ ...s, [providerId]: "connecting" }));
    setErrorMessages(s => ({ ...s, [providerId]: "" }));
    setStatusMsg(`Connecting to ${PROVIDERS.find(p => p.id === providerId)?.name}…`);
    try {
      let address = "";
      if (providerId === "freighter") address = await connectFreighter();
      else if (providerId === "walletconnect") address = await connectWalletConnect();
      else if (providerId === "albedo") address = await connectAlbedo();

      // Persist connection
      localStorage.setItem("vesting_wallet_address", address);
      localStorage.setItem("vesting_wallet_provider", providerId);

      setStatusMsg(`Connected: ${address.slice(0, 6)}…${address.slice(-4)}`);
      setProviderState(s => ({ ...s, [providerId]: "idle" }));
      onConnected(address, providerId);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      const displayMsg = msg === "FREIGHTER_NOT_INSTALLED"
        ? "Freighter is not installed. Click 'Install Freighter' below."
        : msg;
      setErrorMessages(s => ({ ...s, [providerId]: displayMsg }));
      setProviderState(s => ({ ...s, [providerId]: "error" }));
      setStatusMsg("");
    }
  }

  function handleDisconnectConfirm() {
    localStorage.removeItem("vesting_wallet_address");
    localStorage.removeItem("vesting_wallet_provider");
    setDisconnectConfirm(false);
    onDisconnect();
    onClose();
  }

  const isConnecting = Object.values(providerState).some(s => s === "connecting");
  const truncated = connectedAddress
    ? `${connectedAddress.slice(0, 6)}…${connectedAddress.slice(-4)}`
    : null;

  return (
    <div
      style={styles.backdrop}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        data-testid="wallet-modal"
        style={styles.modal}
        aria-hidden="false"
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 id="wallet-modal-title" style={styles.title}>
            {connectedAddress ? "Wallet" : "Connect Wallet"}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {/* Network badge */}
            <span
              style={{
                ...styles.networkBadge,
                background: network === "mainnet" ? "#fef2f2" : "#eff6ff",
                color: network === "mainnet" ? "#b91c1c" : "#1d6ae5",
                border: `1px solid ${network === "mainnet" ? "#fecaca" : "#bfdbfe"}`,
              }}
              data-testid="network-badge"
            >
              {network}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close wallet modal"
              style={styles.closeBtn}
              data-testid="wallet-modal-close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Status live region */}
        <div role="status" aria-live="polite" className="sr-only">
          {statusMsg}
        </div>

        {/* Connected state */}
        {connectedAddress && !disconnectConfirm && (
          <div style={styles.connectedBox} data-testid="wallet-connected-box">
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={styles.avatar} aria-hidden="true">
                {connectedAddress.slice(0, 2)}
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: "0.95rem" }}>{truncated}</p>
                <p style={{ fontSize: "0.8rem", color: "#6b7280", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {connectedAddress}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: "0.875rem" }}
                onClick={() => navigator.clipboard.writeText(connectedAddress)}
                aria-label="Copy wallet address"
              >
                📋 Copy address
              </button>
              <a
                href={`https://stellar.expert/explorer/${network}/account/${connectedAddress}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline"
                style={{ fontSize: "0.875rem" }}
                aria-label="View account on Stellar Expert"
              >
                🔍 View on Explorer
              </a>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: "0.875rem", borderColor: "var(--color-cancelled)", color: "var(--color-cancelled)" }}
                onClick={() => setDisconnectConfirm(true)}
                data-testid="disconnect-prompt-btn"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* Disconnect confirmation prompt */}
        {disconnectConfirm && (
          <div style={styles.confirmBox} data-testid="disconnect-confirm">
            <p style={{ fontWeight: 600 }}>Disconnect wallet?</p>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "0.25rem" }}>
              You will need to reconnect to perform any transactions.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setDisconnectConfirm(false)}
                data-testid="disconnect-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: "var(--color-cancelled)" }}
                onClick={handleDisconnectConfirm}
                data-testid="disconnect-confirm-btn"
              >
                Yes, disconnect
              </button>
            </div>
          </div>
        )}

        {/* Provider selection — always shown if not connected */}
        {!connectedAddress && (
          <div style={styles.providers}>
            {PROVIDERS.map(provider => {
              const state = providerState[provider.id];
              const errMsg = errorMessages[provider.id];
              const freighterNotInstalled = provider.id === "freighter" && errMsg.includes("not installed");

              return (
                <div key={provider.id}>
                  <button
                    type="button"
                    className="btn"
                    style={styles.providerBtn}
                    onClick={() => handleConnect(provider.id)}
                    disabled={isConnecting}
                    aria-busy={state === "connecting"}
                    aria-describedby={errMsg ? `${provider.id}-error` : undefined}
                    data-testid={`connect-${provider.id}`}
                  >
                    <span style={styles.providerIcon} aria-hidden="true">{provider.icon}</span>
                    <span style={{ flex: 1, textAlign: "left" }}>
                      <span style={styles.providerName}>{provider.name}</span>
                      <span style={styles.providerDesc}>{provider.description}</span>
                    </span>
                    {state === "connecting" && (
                      <span style={styles.spinner} aria-hidden="true" />
                    )}
                    {state !== "connecting" && (
                      <span style={{ color: "#9ca3af", fontSize: "1.1rem" }} aria-hidden="true">›</span>
                    )}
                  </button>

                  {/* Per-provider error + install link */}
                  {errMsg && (
                    <div
                      id={`${provider.id}-error`}
                      role="alert"
                      data-testid={`${provider.id}-error`}
                      style={styles.providerError}
                    >
                      {errMsg}
                      {freighterNotInstalled && (
                        <>
                          {" "}
                          <a
                            href="https://www.freighter.app/"
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--color-active)", fontWeight: 600 }}
                          >
                            Install Freighter ↗
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <p style={styles.footer}>
          Transactions are signed locally. Your private key never leaves your device.
        </p>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 300,
    padding: "1rem",
  },
  modal: {
    background: "var(--color-surface)",
    borderRadius: "0.875rem",
    boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
    width: "100%",
    maxWidth: "420px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1.25rem 1.5rem",
    borderBottom: "1px solid var(--color-border)",
  },
  title: { fontSize: "1.1rem", fontWeight: 700 },
  networkBadge: {
    padding: "0.2rem 0.6rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "capitalize",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "1rem",
    color: "#6b7280",
    padding: "0.25rem",
    minWidth: "44px",
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
  },
  connectedBox: {
    padding: "1.25rem 1.5rem",
    borderBottom: "1px solid var(--color-border)",
  },
  avatar: {
    width: "2.5rem",
    height: "2.5rem",
    borderRadius: "50%",
    background: "var(--color-active)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.875rem",
    fontWeight: 700,
    fontFamily: "monospace",
    flexShrink: 0,
  },
  confirmBox: {
    padding: "1.25rem 1.5rem",
    borderBottom: "1px solid var(--color-border)",
    background: "#fef2f2",
  },
  providers: {
    display: "flex",
    flexDirection: "column",
    padding: "1rem 1.5rem",
    gap: "0.5rem",
  },
  providerBtn: {
    display: "flex",
    alignItems: "center",
    gap: "0.875rem",
    padding: "0.875rem 1rem",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-border)",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    transition: "border-color 0.15s, background 0.15s",
  },
  providerIcon: { fontSize: "1.5rem", flexShrink: 0 },
  providerName: {
    display: "block",
    fontWeight: 700,
    fontSize: "0.95rem",
    color: "var(--color-text)",
  },
  providerDesc: {
    display: "block",
    fontSize: "0.8rem",
    color: "#6b7280",
    fontWeight: 400,
    marginTop: "0.1rem",
  },
  providerError: {
    marginTop: "0.375rem",
    padding: "0.5rem 0.75rem",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "var(--radius)",
    fontSize: "0.8rem",
    color: "var(--color-cancelled)",
  },
  spinner: {
    display: "inline-block",
    width: "1.1rem",
    height: "1.1rem",
    border: "2px solid #e5e7eb",
    borderTopColor: "var(--color-active)",
    borderRadius: "50%",
    animation: "wcb-spin 0.7s linear infinite",
    flexShrink: 0,
  },
  footer: {
    padding: "1rem 1.5rem",
    borderTop: "1px solid var(--color-border)",
    fontSize: "0.75rem",
    color: "#9ca3af",
    textAlign: "center",
  },
};
