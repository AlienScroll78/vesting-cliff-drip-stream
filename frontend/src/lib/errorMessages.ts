/**
 * Error message mapping — issue #821.
 *
 * Every `VestingError` code returned by the contract is mapped to copy that
 * explains *what happened* and *what the user should do next*. Raw error codes
 * and contract function names are never rendered in the UI.
 *
 * Each entry also carries the i18n key used to look up its localized copy, so
 * messages can be translated without touching this file.
 *
 * Code list mirrors `src/error.rs` and the table in `README.md`.
 */

export type ErrorCategory = "network" | "auth" | "contract" | "unexpected";

export interface ErrorInfo {
  /** Short headline, e.g. "Your cliff date hasn't arrived yet". */
  title: string;
  /** What the contract rejected, in plain language. */
  explanation: string;
  /** The concrete next step the user should take. */
  action: string;
  category: ErrorCategory;
  /** True when simply retrying the same action could succeed. */
  retryable?: boolean;
  /** Anchor into docs/faq.md for errors that need a longer explanation. */
  faqUrl?: string;
  /** i18n key prefix, e.g. `errors.codes.CliffNotReached`. */
  i18nKey: string;
}

/**
 * The 26 `VestingError` codes. Kept as an explicit enum-like map so the UI can
 * reference a code by name and so a missing entry is easy to spot.
 */
export const VESTING_ERROR_CODES = {
  ScheduleNotFound: 1,
  CliffNotReached: 2,
  InvalidDuration: 3,
  InvalidRate: 4,
  DepositOverflow: 5,
  ScheduleAlreadyExists: 6,
  NothingToClaim: 7,
  StreamNotExpired: 8,
  TransferFailed: 9,
  DrainDelayNotExpired: 10,
  InvalidRecipient: 11,
  InvalidCliffDuration: 12,
  AlreadyInitialized: 13,
  RecipientNotAllowed: 14,
  StreamPaused: 15,
  BatchTooLarge: 16,
  RateTooLow: 17,
  NotInitialized: 18,
  InvalidSegments: 19,
  MetadataTooLong: 20,
  Unauthorized: 21,
  DepositBelowMinimum: 22,
  StreamAlreadyPaused: 23,
  StreamNotPaused: 24,
  VersionOverflow: 25,
  ClawbackNotSupported: 26,
} as const;

export type VestingErrorName = keyof typeof VESTING_ERROR_CODES;

/** Builds the i18n key prefix for a given error name. */
function key(name: VestingErrorName): string {
  return `errors.codes.${name}`;
}

/**
 * Maps every `VestingError` code (1–26) to user-friendly copy.
 *
 * Rules:
 *  - No raw error codes shown to end users.
 *  - Each entry states *what happened* and *what to do next*.
 *  - Tone: calm and helpful, never alarming.
 */
export const errorMessages: Record<number, ErrorInfo> = {
  // ── Schedule lookup ─────────────────────────────────────────────────────────

  1: {
    title: "No vesting stream found",
    explanation:
      "We couldn't find a vesting stream for this address.",
    action:
      "Double-check the address, and confirm you're connected with the wallet the stream was created for. If you expect a stream here, ask your sponsor to create one.",
    category: "auth",
    retryable: false,
    faqUrl: "#error-codes",
    i18nKey: key("ScheduleNotFound"),
  },

  2: {
    title: "Your cliff date hasn't arrived yet",
    explanation: "Tokens unlock in a single release once the cliff date passes.",
    action:
      "Nothing to do right now — check the cliff date on your stream and come back then. Tokens drip linearly from that point onwards.",
    category: "auth",
    retryable: true,
    faqUrl: "#claiming",
    i18nKey: key("CliffNotReached"),
  },

  // ── Creation validation ────────────────────────────────────────────────────

  3: {
    title: "The durations don't line up",
    explanation: "The total duration must be longer than the cliff duration.",
    action:
      "Increase the total duration or shorten the cliff, so there's time left after the cliff for tokens to drip.",
    category: "contract",
    retryable: false,
    i18nKey: key("InvalidDuration"),
  },

  4: {
    title: "That rate won't work",
    explanation: "The token rate must be a whole number greater than zero.",
    action: "Enter a rate of at least 1 token per ledger.",
    category: "contract",
    retryable: false,
    i18nKey: key("InvalidRate"),
  },

  5: {
    title: "That deposit is too large",
    explanation:
      "Rate multiplied by duration would exceed the maximum amount the contract can track.",
    action:
      "Reduce the rate, shorten the duration, or both, so the total deposit stays within the allowed limit.",
    category: "contract",
    retryable: false,
    faqUrl: "#error-codes",
    i18nKey: key("DepositOverflow"),
  },

  6: {
    title: "A stream already exists for this recipient",
    explanation:
      "Each recipient address can only have one active vesting stream at a time.",
    action:
      "Cancel the existing stream first, or use a different recipient address.",
    category: "contract",
    retryable: false,
    i18nKey: key("ScheduleAlreadyExists"),
  },

  7: {
    title: "You've already claimed all available tokens",
    explanation:
      "Your claimable balance is 0 for this ledger. Tokens accrue as the network produces new ledgers.",
    action: "Check back soon for more — there's nothing to do right now.",
    category: "contract",
    retryable: true,
    i18nKey: key("NothingToClaim"),
  },

  8: {
    title: "This stream hasn't finished yet",
    explanation:
      "This action is only available once the stream has reached its end date.",
    action: "Wait until the stream's end date has passed, then try again.",
    category: "contract",
    retryable: true,
    i18nKey: key("StreamNotExpired"),
  },

  9: {
    title: "The transfer failed",
    explanation:
      "The token transfer couldn't be completed. Your tokens are safe — nothing was moved.",
    action:
      "Please try again in a moment. If it keeps failing, check that your account isn't frozen and has enough balance.",
    category: "network",
    retryable: true,
    faqUrl: "#token-support",
    i18nKey: key("TransferFailed"),
  },

  10: {
    title: "It's too early to recover unclaimed tokens",
    explanation:
      "There's a mandatory waiting period after a stream ends before unclaimed tokens can be recovered by the sponsor.",
    action: "Wait for the full delay period after the end date, then try again.",
    category: "contract",
    retryable: true,
    i18nKey: key("DrainDelayNotExpired"),
  },

  11: {
    title: "That recipient address won't work",
    explanation: "The sponsor and the recipient must be different addresses.",
    action: "Enter a recipient address that isn't your own wallet.",
    category: "auth",
    retryable: false,
    i18nKey: key("InvalidRecipient"),
  },

  12: {
    title: "The cliff duration isn't valid",
    explanation:
      "The cliff duration must be greater than zero — a stream needs a lock-up period before anything unlocks.",
    action: "Enter a cliff duration of at least 1 ledger.",
    category: "contract",
    retryable: false,
    i18nKey: key("InvalidCliffDuration"),
  },

  13: {
    title: "This contract is already set up",
    explanation: "Initialisation can only happen once, right after deployment.",
    action: "No action needed — the contract is ready to use.",
    category: "contract",
    retryable: false,
    i18nKey: key("AlreadyInitialized"),
  },

  // ── Configuration & permissions ────────────────────────────────────────────

  14: {
    title: "That recipient isn't allowed",
    explanation:
      "This deployment only streams to a configured list of approved recipient addresses.",
    action:
      "Ask the stream owner to add this address to the allowlist, or use a different recipient.",
    category: "auth",
    retryable: false,
    i18nKey: key("RecipientNotAllowed"),
  },

  21: {
    title: "You're not allowed to do that",
    explanation:
      "Only the contract administrator or the original sponsor can perform this action.",
    action:
      "If you started this stream, check that you're connected with the same wallet. Otherwise, ask the sponsor to make the change.",
    category: "auth",
    retryable: false,
    i18nKey: key("Unauthorized"),
  },

  18: {
    title: "This contract isn't ready yet",
    explanation:
      "The contract hasn't been initialised yet, so it can't accept streams or claims.",
    action: "This is an operator issue — please contact support if it persists.",
    category: "contract",
    retryable: false,
    i18nKey: key("NotInitialized"),
  },

  // ── Pausing ────────────────────────────────────────────────────────────────

  15: {
    title: "This stream is paused",
    explanation:
      "The sponsor has temporarily paused this stream, so claims are disabled.",
    action: "Nothing to do — ask the sponsor to resume the stream when you're ready to claim again.",
    category: "contract",
    retryable: true,
    i18nKey: key("StreamPaused"),
  },

  23: {
    title: "This stream is already paused",
    explanation: "You can only pause a stream that isn't already paused.",
    action: "No action needed — the stream is already paused.",
    category: "contract",
    retryable: false,
    i18nKey: key("StreamAlreadyPaused"),
  },

  24: {
    title: "This stream isn't paused",
    explanation: "You can only resume a stream that's currently paused.",
    action: "No action needed — the stream is already running.",
    category: "contract",
    retryable: false,
    i18nKey: key("StreamNotPaused"),
  },

  // ── Rate & amount limits ───────────────────────────────────────────────────

  16: {
    title: "Too many streams in one go",
    explanation:
      "Batch creation is limited to 20 streams per transaction to keep it affordable and reliable.",
    action: "Split your list into smaller batches of 20 or fewer and submit again.",
    category: "contract",
    retryable: false,
    i18nKey: key("BatchTooLarge"),
  },

  17: {
    title: "That rate is below the minimum",
    explanation:
      "Rate multiplied by total duration falls under the minimum deposit this contract accepts.",
    action:
      "Increase the rate, lengthen the duration, or both, so the total deposit meets the minimum.",
    category: "contract",
    retryable: false,
    i18nKey: key("RateTooLow"),
  },

  22: {
    title: "The deposit is below the minimum",
    explanation:
      "The total deposit doesn't reach the minimum amount this contract accepts.",
    action:
      "Increase the rate, lengthen the duration, or both, so the total deposit meets the minimum.",
    category: "contract",
    retryable: false,
    i18nKey: key("DepositBelowMinimum"),
  },

  19: {
    title: "The rate segments aren't valid",
    explanation:
      "Variable-rate streams need at least one segment, in order, each with a rate greater than zero.",
    action:
      "Check that your segments are listed in chronological order and that every rate is greater than zero.",
    category: "contract",
    retryable: false,
    i18nKey: key("InvalidSegments"),
  },

  // ── Metadata & clawback ────────────────────────────────────────────────────

  20: {
    title: "That description is too long",
    explanation: "Stream metadata is limited to 256 bytes.",
    action: "Shorten the description and try again.",
    category: "contract",
    retryable: false,
    i18nKey: key("MetadataTooLong"),
  },

  25: {
    title: "The stream has reached its version limit",
    explanation:
      "This stream has been updated more times than the contract can track.",
    action:
      "Please contact support — the stream needs manual attention before it can be changed again.",
    category: "unexpected",
    retryable: false,
    i18nKey: key("VersionOverflow"),
  },

  26: {
    title: "This token doesn't support clawback",
    explanation:
      "Clawback requires the token issuer to have enabled it. Most tokens don't support it.",
    action:
      "Cancel the stream instead to recover the unspent deposit — that works with any standard token.",
    category: "contract",
    retryable: false,
    faqUrl: "#token-support",
    i18nKey: key("ClawbackNotSupported"),
  },
};

/** Fallback copy for a code we don't recognise (or code 0 / non-contract errors). */
const UNEXPECTED_ERROR: ErrorInfo = {
  title: "Something unexpected happened",
  explanation: "We hit an error we don't recognise while processing your request.",
  action:
    "Try again in a moment. If this keeps happening, refresh the page or contact support.",
  category: "unexpected",
  retryable: true,
  i18nKey: "errors.codes.Unexpected",
};

/**
 * Returns the `ErrorInfo` for a given code.
 * Unknown codes fall back to a generic, still-actionable entry so the UI never
 * renders a bare number.
 */
export function getErrorInfo(code: number): ErrorInfo {
  return errorMessages[code] ?? UNEXPECTED_ERROR;
}

/**
 * Builds the full user-facing message for a code, interpolating dynamic values
 * such as the cliff date. Falls back to the static copy when no values are given.
 *
 * @example
 * getErrorMessage(2, { date: "12 Mar 2026" })
 * // → "Your cliff date hasn't arrived yet. Tokens will unlock on 12 Mar 2026."
 */
export function getErrorMessage(
  code: number,
  values: Record<string, string | number> = {},
): string {
  const info = getErrorInfo(code);

  // Errors where a dynamic value genuinely improves the guidance.
  if (code === VESTING_ERROR_CODES.CliffNotReached && values.date) {
    return `Your cliff date hasn't arrived yet. Tokens will unlock on ${values.date}. ${info.action}`;
  }

  if (code === VESTING_ERROR_CODES.ScheduleNotFound && values.address) {
    return `No vesting stream found for ${values.address}. Double-check the address.`;
  }

  return `${info.title}. ${info.explanation} ${info.action}`;
}

/** Returns the error name for a code, or `"Unexpected"` when unknown. */
export function getErrorName(code: number): string {
  const entry = Object.entries(VESTING_ERROR_CODES).find(([, value]) => value === code);
  return entry ? entry[0] : "Unexpected";
}

/** True when the code maps to a user-facing message (rather than the fallback). */
export function isKnownErrorCode(code: number): boolean {
  return errorMessages[code] !== undefined;
}
