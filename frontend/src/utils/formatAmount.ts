/**
 * Locale-aware token amount formatting (issue #127).
 *
 * - formatAmount(1000000)        → "1,000,000"   (locale separator)
 * - abbreviateAmount(1000000)    → "1M"
 * - abbreviateAmount(1500)       → "1.5K"
 * - abbreviateAmount(1000000000)→ "1B"
 *
 * The full value is always available for tooltip/title usage via `formatAmount`.
 */

/**
 * Format a token amount with locale-aware thousands separators.
 * Safe for all locales — falls back to `en` if the runtime locale is unavailable.
 */
export function formatAmount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale ?? undefined, {
    maximumFractionDigits: 7,
  }).format(value);
}

interface AbbreviationThreshold {
  divisor: number;
  suffix: string;
}

const THRESHOLDS: AbbreviationThreshold[] = [
  { divisor: 1_000_000_000, suffix: "B" },
  { divisor: 1_000_000, suffix: "M" },
  { divisor: 1_000, suffix: "K" },
];

/**
 * Abbreviate large amounts to K / M / B with up to one decimal place.
 * Amounts below 1,000 are returned as-is (locale formatted).
 *
 * @param value  - The raw token amount.
 * @param locale - Optional BCP-47 locale string (e.g. "de-DE"). Defaults to runtime locale.
 */
export function abbreviateAmount(value: number, locale?: string): string {
  for (const { divisor, suffix } of THRESHOLDS) {
    if (Math.abs(value) >= divisor) {
      const abbreviated = value / divisor;
      const formatted = new Intl.NumberFormat(locale ?? undefined, {
        maximumFractionDigits: abbreviated % 1 === 0 ? 0 : 1,
      }).format(abbreviated);
      return `${formatted}${suffix}`;
    }
  }
  return formatAmount(value, locale);
}
