/**
 * useTxStatus — transaction status tracking with live feedback (#763)
 *
 * Tracks a Stellar transaction through all phases:
 *   submitting → pending → confirmed | failed
 *
 * Features:
 * - Polls getTransaction RPC every 2 seconds for up to 60 seconds
 * - Persists pending transactions to localStorage so page reloads survive
 * - Translates Soroban diagnostic / VestingError codes to user-friendly messages
 * - Duplicate submission prevention: button is disabled while pending
 * - Exposes a success callback for post-confirm data refresh
 *
 * Usage:
 * ```tsx
 * const { status, begin, reset } = useTxStatus({
 *   onSuccess: () => refetchStreams(),
 * });
 * ```
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { getErrorInfo } from "@/errorMessages";

// ── Phase types ───────────────────────────────────────────────────────────────

/** Every distinct phase a Stellar transaction goes through. */
export type TxPhase =
  | "idle"        // Nothing in progress
  | "submitting"  // Signing + submitting to RPC
  | "pending"     // Waiting for ledger inclusion (polling)
  | "confirmed"   // Included in a ledger
  | "failed";     // Rejected or timed out

export interface TxStatus {
  phase: TxPhase;
  /** Stellar transaction hash, set once submitted. */
  hash: string | null;
  /** Confirmed ledger sequence number, set on success. */
  ledger: number | null;
  /** Human-readable error message, set on failure. */
  errorMessage: string | null;
  /** Amount claimed (for claim transactions), set on success. */
  amountClaimed: number | null;
}

// ── localStorage persistence ──────────────────────────────────────────────────

const STORAGE_KEY = "vesting-pending-tx";

interface PersistedTx {
  hash: string;
  submittedAt: number; // unix ms
}

function savePendingTx(hash: string): void {
  try {
    const payload: PersistedTx = { hash, submittedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* ignore storage errors */ }
}

function loadPendingTx(): PersistedTx | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTx;
    // Discard if older than 2 minutes (beyond polling window)
    if (Date.now() - parsed.submittedAt > 120_000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingTx(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// ── Error parsing ─────────────────────────────────────────────────────────────

/** Extract a VestingError contract code from an RPC error string. */
function parseContractErrorCode(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);

  const soroban = msg.match(/Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/i);
  if (soroban) return parseInt(soroban[1]!, 10);

  const contract = msg.match(/contract\s+error[:\s]+(\d+)/i);
  if (contract) return parseInt(contract[1]!, 10);

  const vesting = msg.match(/VestingError\s*\(?\s*(\d+)/i);
  if (vesting) return parseInt(vesting[1]!, 10);

  return null;
}

function buildErrorMessage(err: unknown): string {
  const code = parseContractErrorCode(err);
  if (code !== null) {
    const info = getErrorInfo(code);
    return `${info.title}: ${info.explanation} ${info.action}`;
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/user rejected|user denied/i.test(raw)) return "Wallet signing was cancelled.";
  if (/network|fetch/i.test(raw)) return "Network error — please check your connection and try again.";
  return raw || "An unexpected error occurred. Please try again.";
}

// ── State machine ─────────────────────────────────────────────────────────────

const INITIAL: TxStatus = {
  phase: "idle",
  hash: null,
  ledger: null,
  errorMessage: null,
  amountClaimed: null,
};

type TxAction =
  | { type: "SUBMITTING" }
  | { type: "PENDING"; hash: string }
  | { type: "CONFIRMED"; ledger: number; amount?: number }
  | { type: "FAILED"; message: string }
  | { type: "RESET" }
  | { type: "RECOVER"; hash: string };

function reducer(state: TxStatus, action: TxAction): TxStatus {
  switch (action.type) {
    case "SUBMITTING":
      return { ...INITIAL, phase: "submitting" };
    case "PENDING":
      return { ...state, phase: "pending", hash: action.hash };
    case "CONFIRMED":
      return {
        ...state,
        phase: "confirmed",
        ledger: action.ledger,
        amountClaimed: action.amount ?? null,
        errorMessage: null,
      };
    case "FAILED":
      return { ...state, phase: "failed", errorMessage: action.message };
    case "RECOVER":
      return { ...INITIAL, phase: "pending", hash: action.hash };
    case "RESET":
      return INITIAL;
    default:
      return state;
  }
}

// ── RPC polling ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

interface RpcGetTransactionResult {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  ledger?: number;
  resultXdr?: string;
  envelopeXdr?: string;
}

/**
 * Poll a Soroban RPC endpoint for transaction status.
 * Resolves with the result when the tx is no longer pending.
 * Rejects after POLL_TIMEOUT_MS if still not included.
 */
async function pollTransaction(
  hash: string,
  rpcUrl: string,
  signal: AbortSignal,
): Promise<RpcGetTransactionResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Polling cancelled");

    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    if (signal.aborted) throw new Error("Polling cancelled");

    let result: RpcGetTransactionResult;
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: { hash },
        }),
        signal,
      });
      const json = (await res.json()) as { result?: RpcGetTransactionResult; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      result = json.result ?? { status: "NOT_FOUND" };
    } catch (err) {
      if (signal.aborted) throw new Error("Polling cancelled");
      // Transient network error — keep polling
      continue;
    }

    if (result.status === "NOT_FOUND") continue; // still pending
    return result;
  }

  throw new Error("Transaction timed out after 60 seconds. It may still confirm — check Stellar Expert.");
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseTxStatusOptions {
  /** Soroban RPC URL. Defaults to the Stellar testnet public RPC. */
  rpcUrl?: string;
  /** Called after the transaction is confirmed. Use to refresh stream data. */
  onSuccess?: (ledger: number, amount?: number) => void;
  /** Called when a transaction fails. */
  onError?: (message: string) => void;
}

export interface UseTxStatusResult {
  status: TxStatus;
  /**
   * Begin tracking a new transaction.
   * Pass the `submitFn` that returns the tx hash (or throws).
   * The hook handles all phase transitions, polling, and persistence.
   */
  begin: (submitFn: () => Promise<{ hash: string; amount?: number }>) => Promise<void>;
  /** Reset back to idle. */
  reset: () => void;
  /** True while the tx is in a non-terminal phase (prevents duplicate submission). */
  isPending: boolean;
}

const DEFAULT_RPC = "https://soroban-testnet.stellar.org";

export function useTxStatus({
  rpcUrl = DEFAULT_RPC,
  onSuccess,
  onError,
}: UseTxStatusOptions = {}): UseTxStatusResult {
  const [status, dispatch] = useReducer(reducer, INITIAL, () => {
    // On mount: recover any pending tx from a previous page load
    const persisted = loadPendingTx();
    if (persisted) {
      return { ...INITIAL, phase: "pending" as TxPhase, hash: persisted.hash };
    }
    return INITIAL;
  });

  const abortRef = useRef<AbortController | null>(null);

  // Resume polling for a recovered pending tx on mount
  useEffect(() => {
    if (status.phase === "pending" && status.hash) {
      const persisted = loadPendingTx();
      if (persisted?.hash === status.hash) {
        void resumePoll(status.hash);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  const resumePoll = useCallback(
    async (hash: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await pollTransaction(hash, rpcUrl, controller.signal);

        if (result.status === "SUCCESS") {
          clearPendingTx();
          dispatch({ type: "CONFIRMED", ledger: result.ledger ?? 0 });
          onSuccess?.(result.ledger ?? 0, undefined);
        } else {
          clearPendingTx();
          const msg = "Transaction was rejected by the network.";
          dispatch({ type: "FAILED", message: msg });
          onError?.(msg);
        }
      } catch (err: unknown) {
        if ((err as Error).message === "Polling cancelled") return;
        clearPendingTx();
        const msg = buildErrorMessage(err);
        dispatch({ type: "FAILED", message: msg });
        onError?.(msg);
      }
    },
    [rpcUrl, onSuccess, onError],
  );

  const begin = useCallback(
    async (submitFn: () => Promise<{ hash: string; amount?: number }>) => {
      if (status.phase !== "idle" && status.phase !== "failed") return;

      dispatch({ type: "SUBMITTING" });

      try {
        const { hash, amount } = await submitFn();

        // Persist so page reload can recover
        savePendingTx(hash);
        dispatch({ type: "PENDING", hash });

        // Start polling
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const result = await pollTransaction(hash, rpcUrl, controller.signal);

          if (result.status === "SUCCESS") {
            clearPendingTx();
            dispatch({ type: "CONFIRMED", ledger: result.ledger ?? 0, amount });
            onSuccess?.(result.ledger ?? 0, amount);
          } else {
            clearPendingTx();
            const msg = "Transaction was rejected by the network.";
            dispatch({ type: "FAILED", message: msg });
            onError?.(msg);
          }
        } catch (pollErr: unknown) {
          if ((pollErr as Error).message === "Polling cancelled") return;
          clearPendingTx();
          const msg = buildErrorMessage(pollErr);
          dispatch({ type: "FAILED", message: msg });
          onError?.(msg);
        }
      } catch (submitErr: unknown) {
        const msg = buildErrorMessage(submitErr);
        dispatch({ type: "FAILED", message: msg });
        onError?.(msg);
      }
    },
    [status.phase, rpcUrl, onSuccess, onError],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    clearPendingTx();
    dispatch({ type: "RESET" });
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const isPending = status.phase === "submitting" || status.phase === "pending";

  return { status, begin, reset, isPending };
}
