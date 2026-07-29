/**
 * i18n date/time utilities using browser-native Intl APIs.
 * No external dependencies.
 */

export type DateInput = Date | number;

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year",   ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month",  ms: 30  * 24 * 60 * 60 * 1000 },
  { unit: "day",    ms:       24 * 60 * 60 * 1000 },
  { unit: "hour",   ms:            60 * 60 * 1000 },
  { unit: "minute", ms:                 60 * 1000 },
  { unit: "second", ms:                      1000 },
];

/** Format an absolute date using the user's locale and an optional timezone. */
export function formatDate(
  date: DateInput,
  locale: string = navigator.language,
  timeZone?: string
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(date));
}

/** Format a relative time string, e.g. "in 3 days" or "2 hours ago". */
export function formatRelative(
  date: DateInput,
  locale: string = navigator.language
): string {
  const diffMs = new Date(date).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const { unit, ms } of UNITS) {
    if (Math.abs(diffMs) >= ms || unit === "second") {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return rtf.format(0, "second");
}

/** Returns absolute string, relative string, and the resolved timezone name. */
export function formatWithTimezone(
  date: DateInput,
  locale: string = navigator.language,
  timeZone?: string
): { absolute: string; relative: string; timezone: string } {
  const resolved = new Intl.DateTimeFormat(locale, {
    timeZoneName: "long",
    ...(timeZone ? { timeZone } : {}),
  }).resolvedOptions();

  return {
    absolute: formatDate(date, locale, timeZone),
    relative: formatRelative(date, locale),
    timezone: resolved.timeZone,
  };
}

/**
 * Mounts a live relative-time clock on an element.
 * Updates every `interval` ms without a page refresh.
 * Returns a cleanup function to stop updates.
 */
export function startRelativeClock(
  date: DateInput,
  element: HTMLElement,
  locale: string = navigator.language,
  interval = 60_000
): () => void {
  const update = () => { element.textContent = formatRelative(date, locale); };
  update();
  const id = setInterval(update, interval);
  return () => clearInterval(id);
}
