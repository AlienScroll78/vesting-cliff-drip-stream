export type ErrorCategory = "network" | "auth" | "contract" | "unexpected";

export interface ErrorInfo {
  title: string;
  explanation: string;
  action: string;
  category: ErrorCategory;
  retryable?: boolean;
  faqUrl?: string;
}

/**
 * Maps every VestingError code (1–11) to a user-friendly message.
 *
 * Rules:
 *  - No raw error codes shown to end users.
 *  - Each entry states *what happened* and *what to do next*.
 *  - Tone: calm and helpful, never alarming.
 */
export const errorMessages: Record<number, ErrorInfo> = {
  // ── Auth / schedule ───────────────────────────────────────────────────────

  1: {
    title: "No vesting stream found",
    explanation:
      "We couldn't find an active vesting stream for your wallet address.",
    action:
      "Make sure you're connected with the right wallet. If you're expecting a stream, ask your sponsor to create one for your address.",
    category: "auth",
    retryable: false,
    faqUrl: "#faq-schedule-not-found",
  },

  2: {
    title: "Tokens are still locked",
    explanation:
      "Your vesting cliff hasn't been reached yet. Tokens can't be claimed until the cliff date passes.",
    action:
      "Check the cliff date on your stream and come back then. No action is needed right now.",
    category: "auth",
    retryable: true,
    faqUrl: "#faq-cliff",
  },

  11: {
    title: "Invalid recipient address",
    explanation:
      "The sponsor and recipient can't be the same wallet address.",
    action:
      "Enter a different recipient address that is not your own wallet.",
    category: "auth",
    retryable: false,
  },

  // ── Contract validation ───────────────────────────────────────────────────

  3: {
    title: "Invalid stream duration",
    explanation:
      "The total vesting duration must be longer than the cliff duration.",
    action:
      "Increase the total duration or shorten the cliff so there's time left after the cliff to drip tokens.",
    category: "contract",
    retryable: false,
  },

  4: {
    title: "Invalid token rate",
    explanation:
      "The token rate per ledger must be a positive number greater than zero.",
    action: "Enter a rate of at least 1 token per ledger.",
    category: "contract",
    retryable: false,
  },

  5: {
    title: "Deposit amount too large",
    explanation:
      "The combination of rate and duration would result in a deposit that's too large to process.",
    action:
      "Reduce the rate, shorten the duration, or both, so the total deposit stays within the allowed limit.",
    category: "contract",
    retryable: false,
    faqUrl: "#faq-overflow",
  },

  6: {
    title: "Stream already exists",
    explanation:
      "A vesting stream is already active for this recipient address.",
    action:
      "Cancel the existing stream before creating a new one for the same recipient.",
    category: "contract",
    retryable: false,
  },

  7: {
    title: "Nothing to claim right now",
    explanation:
      "There are no tokens available to claim at this moment. Tokens accrue every ledger.",
    action:
      "Wait a moment and try again. Your balance grows automatically with each new ledger.",
    category: "contract",
    retryable: true,
  },

  8: {
    title: "Stream hasn't ended yet",
    explanation:
      "This action requires the stream to have fully completed, but the end date hasn't passed yet.",
    action:
      "Wait until the stream's end date has passed before trying this again.",
    category: "contract",
    retryable: true,
  },

  10: {
    title: "Too early to drain",
    explanation:
      "There's a mandatory waiting period after a stream ends before unclaimed tokens can be recovered.",
    action:
      "Wait for the full delay period to pass after the stream's end date, then try again.",
    category: "contract",
    retryable: true,
    faqUrl: "#faq-drain-delay",
  },

  // ── Network / token transfer ──────────────────────────────────────────────

  9: {
    title: "Token transfer failed",
    explanation:
      "The token transfer couldn't be completed. This can happen if the account is frozen, has insufficient balance, or the token contract rejected the transfer.",
    action:
      "Check your account status and token balance, then try again. If the problem persists, contact your token issuer.",
    category: "network",
    retryable: true,
  },
};

/** Returns the ErrorInfo for a given code, falling back to an unexpected-error entry. */
export function getErrorInfo(code: number): ErrorInfo {
  return (
    errorMessages[code] ?? {
      title: "Something unexpected happened",
      explanation: "An unrecognised error occurred while processing your request.",
      action:
        "Try again in a moment. If this keeps happening, contact support or check the documentation.",
      category: "unexpected" as ErrorCategory,
      retryable: true,
    }
  );
}
