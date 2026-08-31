import { useCallback, useReducer } from "react";
import { getErrorInfo } from "@/errorMessages";

// ── State machine ────────────────────────────────────────────────────────────

/** Every distinct phase of submitting a claim transaction. */
export type ClaimPhase =
  | "idle"      // Nothing in progress
  | "signing"   // Awaiting wallet signature
  | "pending"   // Tx submitted, waiting for Horizon confirmation
  | "success"   // Tx confirmed; amountClaimed is set
  | "error";    // Tx failed; errorMessage is set

export interface ClaimState {
  phase: ClaimPhase;
  /** Amount of tokens successfully claimed (set on success). */
  amountClaimed: number | null;
  /** Human-readable error message (set on error). */
  errorMessage: string | null;
  /** Raw error code from the contract, if available. */
  errorCode: number | null;
}

const INITIAL_STATE: ClaimState = {
  phase: "idle",
  amountClaimed: null,
  errorMessage: null,
  errorCode: null,
};

type ClaimAction =
  | { type: "SIGNING" }
  | { type: "PENDING" }
  | { type: "SUCCESS"; amount: number }
  | { type: "ERROR"; message: string; code: number | null }
  | { type: "RESET" };

function reducer(state: ClaimState, action: ClaimAction): ClaimState {
  switch (action.type) {
    case "SIGNING":  return { phase: "signing",  amountClaimed: null, errorMessage: null, errorCode: null };
    case "PENDING":  return { ...state, phase: "pending" };
    case "SUCCESS":  return { phase: "success",  amountClaimed: action.amount, errorMessage: null, errorCode: null };
    case "ERROR":    return { phase: "error",    amountClaimed: null, errorMessage: action.message, errorCode: action.code };
    case "RESET":    return INITIAL_STATE;
    default:         return state;
  }
}

// ── Error parsing ─────────────────────────────────────────────────────────────

/**
 * Extract a VestingError contract code from an error thrown by Horizon /
 * freighter. Soroban result XDR embeds the u32 code in the error string as
 * "Error(Contract, #N)" or as a plain numeric suffix.
 */
export function parseContractErrorCode(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);

  // Pattern: "Error(Contract, #7)" or "Error(Contract, #2)" — Soroban SDK format
  const sorobanMatch = msg.match(/Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/i);
  if (sorobanMatch) return parseInt(sorobanMatch[1]!, 10);

  // Pattern emitted by some RPC proxies: "contract error: 7"
  const contractMatch = msg.match(/contract\s+error[:\s]+(\d+)/i);
  if (contractMatch) return parseInt(contractMatch[1]!, 10);

  // Pattern: plain trailing number on known prefixes "VestingError(7)"
  const enumMatch = msg.match(/VestingError\s*\(?\s*(\d+)/i);
  if (enumMatch) return parseInt(enumMatch[1]!, 10);

  return null;
}

/**
 * Derive a user-facing error message from a thrown value.
 * Maps known VestingError codes to friendly copy; falls back to raw message.
 */
export function buildErrorMessage(err: unknown): { message: string; code: number | null } {
  const code = parseContractErrorCode(err);

  if (code !== null) {
    const info = getErrorInfo(code);
    return { message: `${info.title}: ${info.explanation} ${info.action}`, code };
  }

  const raw = err instanceof Error ? err.message : String(err);

  // Common wallet / network messages
  if (raw.toLowerCase().includes("user rejected") || raw.toLowerCase().includes("user denied")) {
    return { message: "Wallet signing was cancelled.", code: null };
  }
  if (raw.toLowerCase().includes("network") || raw.toLowerCase().includes("fetch")) {
    return { message: "Network error — please check your connection and try again.", code: null };
  }

  return { message: raw || "An unexpected error occurred. Please try again.", code: null };
}

// ── Horizon submit with 504 retry ─────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit a signed XDR envelope to Horizon with automatic retry on HTTP 504.
 *
 * In practice the real submission goes through the wallet (Freighter) which
 * internally calls Horizon. This helper is exposed so callers can wrap their
 * own Horizon `submitTransaction` calls for resilience.
 */
export async function submitWithRetry(
  submitFn: () => Promise<{ hash: string }>,
  retries = MAX_RETRIES,
): Promise<{ hash: string }> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await submitFn();
    } catch (err: unknown) {
      lastErr = err;
      const isTimeout =
        (err instanceof Error && /504|timed?\s*out|gateway/i.test(err.message)) ||
        (typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 504);

      if (!isTimeout || attempt === retries) break;

      await sleep(RETRY_DELAY_MS * (attempt + 1)); // exponential back-off: 2s, 4s, 6s
    }
  }

  throw lastErr;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseClaimVestedOptions {
  /**
   * The actual claim function to call. Receives the recipient address and
   * should resolve with the amount claimed (a positive number), or throw on
   * failure. The hook handles signing/pending/success/error transitions.
   *
   * Pass a stub during development / testing.
   */
  claimFn: (recipient: string) => Promise<number>;
  /** Recipient Stellar address — passed straight to claimFn. */
  recipient: string;
  /** Optional callback invoked after a successful claim. Use to refetch data. */
  onSuccess?: (amountClaimed: number) => void;
}

export interface UseClaimVestedResult {
  state: ClaimState;
  /** Invoke the full claim flow. Safe to call multiple times after reset. */
  claim: () => Promise<void>;
  /** Reset back to idle so the button can be used again. */
  reset: () => void;
}

/**
 * `useClaimVested` — full transaction state machine for the `claim_vested`
 * contract call.
 *
 * State transitions:
 *   idle → signing → pending → success
 *                            ↘ error
 *
 * Usage:
 * ```tsx
 * const { state, claim, reset } = useClaimVested({
 *   claimFn: async (recipient) => {
 *     // call your Soroban SDK helper here
 *     const amount = await sorobanClaim(recipient);
 *     return amount;
 *   },
 *   recipient: walletAddress,
 *   onSuccess: () => refetchStreams(),
 * });
 * ```
 */
export function useClaimVested({
  claimFn,
  recipient,
  onSuccess,
}: UseClaimVestedOptions): UseClaimVestedResult {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const claim = useCallback(async () => {
    if (state.phase !== "idle" && state.phase !== "error") return;

    dispatch({ type: "SIGNING" });

    try {
      // The wallet is asked to sign — this is the "signing" phase.
      // Once the promise resolves with an amount we know the tx landed.
      // We transition to "pending" just before awaiting so the UI can show
      // the in-flight state if claimFn internally has a separate submission step.
      dispatch({ type: "PENDING" });

      const amount = await submitWithRetry(() => claimFn(recipient).then((a) => ({ hash: String(a), _amount: a })))
        .then((r) => (r as unknown as { _amount: number })._amount);

      dispatch({ type: "SUCCESS", amount });
      onSuccess?.(amount);
    } catch (err: unknown) {
      const { message, code } = buildErrorMessage(err);
      dispatch({ type: "ERROR", message, code });
    }
  }, [state.phase, claimFn, recipient, onSuccess]);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return { state, claim, reset };
}
