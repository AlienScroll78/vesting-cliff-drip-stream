/**
 * Ledger-to-human-time converter (issue #1023).
 *
 * Stellar network average ledger close time is ~5 seconds.  All conversions
 * use this constant so the math is easy to follow and easy to test.
 *
 * Exported functions:
 *   ledgerToDate    – convert an absolute ledger number to an estimated Date
 *   dateToLedger    – convert a Date to the nearest estimated ledger number
 *   ledgerDuration  – format a ledger count as a human-friendly duration string
 *   humanInputToLedgers – convert days / hours / minutes to a ledger count
 *   formatLedgerWithTime – display a ledger number alongside its estimated time
 */

/** Average Stellar ledger close time in seconds. */
export const SECONDS_PER_LEDGER = 5;

// ── Core math helpers ────────────────────────────────────────────────────────

/**
 * Estimate the wall-clock Date for a given `targetLedger`, based on a known
 * reference point (`currentLedger`, `currentTimestamp`).
 *
 * @param targetLedger    - The ledger number to convert.
 * @param currentLedger   - A known ledger number (anchor point).
 * @param currentTimestamp - The Date corresponding to `currentLedger`.
 * @returns Estimated Date for `targetLedger`.
 */
export function ledgerToDate(
  targetLedger: number,
  currentLedger: number,
  currentTimestamp: Date,
): Date {
  const deltaLedgers = targetLedger - currentLedger;
  const deltaMs = deltaLedgers * SECONDS_PER_LEDGER * 1_000;
  return new Date(currentTimestamp.getTime() + deltaMs);
}

/**
 * Estimate the ledger number nearest to a given `targetDate`, based on a known
 * reference point (`currentLedger`, `currentTimestamp`).
 *
 * Returns the result rounded to the nearest integer ledger.
 *
 * @param targetDate       - The Date to convert.
 * @param currentLedger    - A known ledger number (anchor point).
 * @param currentTimestamp - The Date corresponding to `currentLedger`.
 * @returns Nearest estimated ledger number (integer).
 */
export function dateToLedger(
  targetDate: Date,
  currentLedger: number,
  currentTimestamp: Date,
): number {
  const deltaMs = targetDate.getTime() - currentTimestamp.getTime();
  const deltaLedgers = deltaMs / (SECONDS_PER_LEDGER * 1_000);
  return Math.round(currentLedger + deltaLedgers);
}

// ── Duration formatting ──────────────────────────────────────────────────────

interface DurationPart {
  unit: "year" | "month" | "week" | "day" | "hour" | "minute" | "second";
  singular: string;
  plural: string;
  seconds: number;
}

const DURATION_PARTS: DurationPart[] = [
  { unit: "year",   singular: "1 year",    plural: "${n} years",   seconds: 365 * 24 * 3600 },
  { unit: "month",  singular: "1 month",   plural: "${n} months",  seconds: 30  * 24 * 3600 },
  { unit: "week",   singular: "1 week",    plural: "${n} weeks",   seconds: 7   * 24 * 3600 },
  { unit: "day",    singular: "1 day",     plural: "${n} days",    seconds: 24  * 3600       },
  { unit: "hour",   singular: "1 hour",    plural: "${n} hours",   seconds: 3600             },
  { unit: "minute", singular: "1 minute",  plural: "${n} minutes", seconds: 60               },
  { unit: "second", singular: "1 second",  plural: "${n} seconds", seconds: 1                },
];

function formatPart(part: DurationPart, count: number): string {
  if (count === 1) return part.singular;
  return part.plural.replace("${n}", String(count));
}

/**
 * Convert a ledger count to a human-friendly duration string.
 *
 * The result includes the two most significant non-zero units, e.g.:
 *   - 17_280 ledgers (1 day at 5 s/ledger) → "1 day"
 *   - 102_240 ledgers (~6 days + 3 h)      → "6 days 3 hours"
 *   - 12 ledgers (1 minute)                → "1 minute"
 *   - 0 ledgers                            → "0 seconds"
 *
 * @param ledgers - Number of ledgers (must be non-negative; negative values
 *                  are treated as their absolute value).
 * @returns Human-readable duration string.
 */
export function ledgerDuration(ledgers: number): string {
  const totalSeconds = Math.abs(ledgers) * SECONDS_PER_LEDGER;

  if (totalSeconds === 0) return "0 seconds";

  const parts: string[] = [];
  let remaining = totalSeconds;

  for (const dp of DURATION_PARTS) {
    if (remaining < dp.seconds) continue;
    const count = Math.floor(remaining / dp.seconds);
    remaining -= count * dp.seconds;
    parts.push(formatPart(dp, count));
    if (parts.length === 2) break; // two most significant units is enough
  }

  return parts.join(" ");
}

// ── Input conversion ─────────────────────────────────────────────────────────

/**
 * Input shape for {@link humanInputToLedgers}.
 * All fields are optional and default to 0.
 */
export interface HumanDurationInput {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/**
 * Convert a human-friendly duration (days / hours / minutes / seconds) into
 * the equivalent number of ledgers at {@link SECONDS_PER_LEDGER} per ledger.
 *
 * The result is rounded to the nearest integer and is always ≥ 0.
 *
 * @example
 *   humanInputToLedgers({ days: 1 })           // → 17_280
 *   humanInputToLedgers({ hours: 6 })           // → 4_320
 *   humanInputToLedgers({ days: 7, hours: 12 }) // → 126_720
 */
export function humanInputToLedgers(input: HumanDurationInput): number {
  const { days = 0, hours = 0, minutes = 0, seconds = 0 } = input;
  const totalSeconds =
    days    * 24 * 3600 +
    hours        * 3600 +
    minutes      *   60 +
    seconds;
  return Math.max(0, Math.round(totalSeconds / SECONDS_PER_LEDGER));
}

// ── Combined display ─────────────────────────────────────────────────────────

/**
 * Format a ledger number together with its estimated human-readable date/time.
 *
 * Returns an object with both the raw ledger number and a localized date string
 * so callers can render them consistently.
 *
 * @example
 *   formatLedgerWithTime(1_234_567, 1_200_000, new Date("2025-01-01T00:00:00Z"))
 *   // → { ledger: 1_234_567, estimatedDate: Date, label: "ledger 1,234,567 (~Jan 3, 2025)" }
 */
export interface LedgerTimeLabel {
  /** The raw ledger number. */
  ledger: number;
  /** Estimated wall-clock Date for this ledger. */
  estimatedDate: Date;
  /** Human-friendly label combining ledger number and date. */
  label: string;
}

export function formatLedgerWithTime(
  targetLedger: number,
  currentLedger: number,
  currentTimestamp: Date,
  locale?: string,
): LedgerTimeLabel {
  const estimatedDate = ledgerToDate(targetLedger, currentLedger, currentTimestamp);

  const formattedLedger = new Intl.NumberFormat(locale ?? undefined).format(targetLedger);

  const formattedDate = estimatedDate.toLocaleDateString(locale ?? undefined, {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });

  return {
    ledger: targetLedger,
    estimatedDate,
    label: `ledger ${formattedLedger} (~${formattedDate})`,
  };
}
