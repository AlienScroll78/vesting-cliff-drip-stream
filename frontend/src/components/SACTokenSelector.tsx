/**
 * SACTokenSelector — issue #1022
 *
 * A token selector dropdown for the stream-creation form that:
 *  - Lists wallet balances (symbol, truncated contract address, balance)
 *  - Fetches balances from Horizon on wallet connect with 30-second auto-refresh
 *  - Allows copying a token's contract address from the dropdown
 *  - Provides an "Add custom token" option that validates the address as a valid SAC
 *  - Persists the selected token contract address across sessions via localStorage
 */
"use client";
import {
  useState,
  useId,
  useCallback,
  useEffect,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useWallet } from "@/contexts/WalletContext";
import { WalletBalance } from "@/types";
import { CopyButton } from "@/components/CopyButton";

// ── Constants & helpers ───────────────────────────────────────────────────────

const CUSTOM_VALUE     = "__custom__";
const STORAGE_KEY      = "sac_token_selector_last_token";
const MAX_ADDR_DISPLAY = 16; // characters shown on each side of the ellipsis

/**
 * Truncate a Stellar contract/issuer address for display.
 * e.g. "CABC...WXYZ" from a 56-char address.
 */
export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/**
 * Probe whether a contract address is a valid SAC by calling the backend's
 * /validate-sac endpoint (backed by the contract's InvalidToken probe).
 *
 * Returns `true` if valid, `false` otherwise.
 * The `apiBase` param exists purely to allow test overrides.
 */
export async function validateSACAddress(
  contractAddress: string,
  apiBase = "/api",
): Promise<boolean> {
  if (!contractAddress.trim()) return false;
  try {
    const resp = await fetch(
      `${apiBase}/validate-sac?address=${encodeURIComponent(contractAddress.trim())}`,
    );
    if (!resp.ok) return false;
    const data = (await resp.json()) as { valid?: boolean };
    return data.valid === true;
  } catch {
    return false;
  }
}

/**
 * Read the persisted token selection from localStorage.
 * Returns null if nothing is stored or storage is unavailable.
 */
export function readPersistedToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the selected token to localStorage.
 * Silently ignores errors (e.g. private browsing, storage full).
 */
export function persistToken(contractAddress: string): void {
  try {
    if (contractAddress && contractAddress !== CUSTOM_VALUE) {
      localStorage.setItem(STORAGE_KEY, contractAddress);
    }
  } catch {
    /* ignore */
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SACTokenSelectorProps {
  /** Currently selected SAC contract address (empty string = none selected). */
  value: string;
  /** Total deposit amount to display the over-allocation warning (0 = hidden). */
  depositAmount?: number;
  /** Called when the selected token contract address changes. */
  onChange: (contractAddress: string) => void;
  /** Override the API base URL (useful in tests). */
  apiBase?: string;
}

export function SACTokenSelector({
  value,
  depositAmount = 0,
  onChange,
  apiBase = "/api",
}: SACTokenSelectorProps) {
  const { balances, balancesLoading } = useWallet();

  // ── Custom token state ─────────────────────────────────────────────────────
  const [showCustom,      setShowCustom]      = useState(false);
  const [customAddress,   setCustomAddress]   = useState("");
  const [validating,      setValidating]      = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationOk,    setValidationOk]    = useState(false);

  // ── IDs for accessibility ─────────────────────────────────────────────────
  const selectId   = useId();
  const customId   = useId();
  const warningId  = useId();
  const statusId   = useId();

  // ── Restore persisted token on mount ─────────────────────────────────────
  useEffect(() => {
    const persisted = readPersistedToken();
    if (persisted && !value) {
      onChange(persisted);
    }
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist whenever value changes ───────────────────────────────────────
  useEffect(() => {
    persistToken(value);
  }, [value]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const selectedBalance: WalletBalance | undefined =
    balances.find((b) => b.contractAddress === value);

  const isOver =
    selectedBalance !== undefined &&
    depositAmount > 0 &&
    parseFloat(selectedBalance.balance) < depositAmount;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSelectChange(e: ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === CUSTOM_VALUE) {
      setShowCustom(true);
      setValidationError(null);
      setValidationOk(false);
    } else {
      setShowCustom(false);
      setCustomAddress("");
      setValidationError(null);
      setValidationOk(false);
      onChange(e.target.value);
    }
  }

  const handleValidate = useCallback(
    async (address: string) => {
      const trimmed = address.trim();
      if (!trimmed) {
        setValidationError("Please enter a contract address.");
        setValidationOk(false);
        return;
      }
      setValidating(true);
      setValidationError(null);
      setValidationOk(false);
      const valid = await validateSACAddress(trimmed, apiBase);
      setValidating(false);
      if (valid) {
        setValidationOk(true);
        onChange(trimmed);
      } else {
        setValidationError("Address does not appear to be a valid SAC token.");
      }
    },
    [apiBase, onChange],
  );

  function handleCustomChange(e: ChangeEvent<HTMLInputElement>) {
    setCustomAddress(e.target.value);
    setValidationError(null);
    setValidationOk(false);
    // Don't call onChange here — wait for blur / Enter
  }

  function handleCustomBlur() {
    if (customAddress.trim()) {
      void handleValidate(customAddress);
    }
  }

  function handleCustomKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleValidate(customAddress);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="sac-token-selector">
      <label htmlFor={selectId} className="field-label">
        Token
      </label>

      {/* Loading skeleton */}
      {balancesLoading && !balances.length ? (
        <p
          className="sac-token-selector__loading"
          aria-live="polite"
          role="status"
        >
          Loading wallet balances…
        </p>
      ) : (
        <div className="sac-token-selector__row">
          <select
            id={selectId}
            value={showCustom ? CUSTOM_VALUE : value}
            onChange={handleSelectChange}
            className="sac-token-selector__select"
            aria-describedby={
              [isOver ? warningId : null].filter(Boolean).join(" ") || undefined
            }
          >
            <option value="" disabled>
              Select a token…
            </option>

            {balances.map((b) => (
              <option key={b.contractAddress} value={b.contractAddress}>
                {b.assetCode}
                {" — "}
                {truncateAddress(b.contractAddress, 6)}
                {" — "}
                {parseFloat(b.balance).toLocaleString(undefined, {
                  maximumFractionDigits: 7,
                })}{" "}
                available
              </option>
            ))}

            <option value={CUSTOM_VALUE}>＋ Add custom token…</option>
          </select>

          {/* Copy button for the currently selected non-custom token */}
          {value && !showCustom && value !== "native" && (
            <CopyButton
              text={value}
              label="Copy contract address"
            />
          )}
        </div>
      )}

      {/* Over-allocation warning */}
      {isOver && (
        <p
          id={warningId}
          role="alert"
          className="sac-token-selector__warning"
        >
          ⚠ Deposit ({depositAmount.toLocaleString()}) exceeds your{" "}
          {selectedBalance!.assetCode} balance (
          {parseFloat(selectedBalance!.balance).toLocaleString()}).
        </p>
      )}

      {/* Custom token input panel */}
      {showCustom && (
        <div
          className="sac-token-selector__custom"
          role="region"
          aria-label="Custom token"
        >
          <label
            htmlFor={customId}
            className="sac-token-selector__custom-label"
          >
            Custom SAC contract address
          </label>
          <div className="sac-token-selector__custom-row">
            <input
              id={customId}
              type="text"
              value={customAddress}
              onChange={handleCustomChange}
              onBlur={handleCustomBlur}
              onKeyDown={handleCustomKeyDown}
              placeholder="C… Stellar contract address"
              className="sac-token-selector__custom-input"
              aria-describedby={statusId}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_ADDR_DISPLAY * 10} // generous upper bound
            />
            <button
              type="button"
              className="sac-token-selector__validate-btn"
              onClick={() => void handleValidate(customAddress)}
              disabled={validating || !customAddress.trim()}
              aria-label="Validate custom SAC address"
            >
              {validating ? "Validating…" : "Validate"}
            </button>
          </div>

          {/* Inline status feedback */}
          <p
            id={statusId}
            role="status"
            aria-live="polite"
            className={
              validationError
                ? "sac-token-selector__status sac-token-selector__status--error"
                : validationOk
                  ? "sac-token-selector__status sac-token-selector__status--ok"
                  : "sac-token-selector__status"
            }
          >
            {validationError
              ? `❌ ${validationError}`
              : validationOk
                ? "✓ Valid SAC token"
                : null}
          </p>
        </div>
      )}
    </div>
  );
}
