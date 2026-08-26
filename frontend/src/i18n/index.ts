/**
 * i18n configuration (#280)
 *
 * - Language auto-detected from browser, with localStorage persistence
 * - Fallback to English for any missing keys
 * - English (default) and Spanish translations; Chinese stub retained
 * - RTL layout scaffold: LanguageSwitcher sets dir="rtl" for AR/HE
 * - Number & date formatting utilities exported for locale-aware display
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";
import zh from "./locales/zh.json";

/** localStorage key used to persist the user's language choice. */
export const LANG_STORAGE_KEY = "vesting-language";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: ["en", "es", "zh"],

    /**
     * Detection order:
     * 1. localStorage  — user explicitly chose a language
     * 2. navigator     — browser / OS language setting
     * 3. htmlTag       — <html lang="…"> attribute
     */
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ["localStorage"],
    },

    resources: {
      en: { translation: en },
      es: { translation: es },
      zh: { translation: zh },
    },

    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

// ── Locale-aware formatting helpers ──────────────────────────────────────────

/**
 * Format a number according to the currently active locale.
 * Falls back to plain `toLocaleString()` when i18n language isn't set yet.
 *
 * @example formatNumber(1234567.89) → "1,234,567.89" (en) / "1.234.567,89" (es)
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const lng = i18n.language ?? "en";
  try {
    return new Intl.NumberFormat(lng, options).format(value);
  } catch {
    return value.toLocaleString(undefined, options);
  }
}

/**
 * Format a Date (or ISO string) according to the currently active locale.
 *
 * @example formatDate(new Date()) → "8/26/2026" (en-US) / "26/8/2026" (es)
 */
export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short" }
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const lng = i18n.language ?? "en";
  try {
    return new Intl.DateTimeFormat(lng, options).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Format a currency amount using the locale.
 *
 * @example formatCurrency(12.5, "USD") → "$12.50" (en) / "12,50 $" (es)
 */
export function formatCurrency(amount: number, currencyCode = "USD"): string {
  const lng = i18n.language ?? "en";
  try {
    return new Intl.NumberFormat(lng, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}
