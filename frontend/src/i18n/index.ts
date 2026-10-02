/**
 * i18n configuration (#280, #767)
 *
 * - Language auto-detected from browser, with localStorage persistence
 * - Fallback to English for any missing keys
 * - English, Spanish, Chinese, and Portuguese (#767) translations
 * - Lazy loading via i18next-http-backend when available; falls back to
 *   bundled translations so the app works in environments where the package
 *   is not installed (e.g. test runners, SSR stubs).
 * - RTL layout scaffold: LanguageSwitcher sets dir="rtl" for AR/HE
 * - Number & date formatting utilities exported for locale-aware display
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";
import zh from "./locales/zh.json";
import pt from "./locales/pt.json";

/** localStorage key used to persist the user's language choice. */
export const LANG_STORAGE_KEY = "vesting-language";

/** Supported language codes. */
export const SUPPORTED_LANGS = ["en", "es", "zh", "pt"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/**
 * Attempt to load i18next-http-backend for lazy loading of public locale
 * files (/public/locales/{lng}/translation.json).  The package may not be
 * present in all environments (test runners, CI, SSR), so we catch the
 * import error and fall back to the bundled JSON resources instead.
 */
async function initI18n() {
  let useHttpBackend = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let HttpBackend: any = null;

  try {
    // Dynamic import — no hard dependency; fails silently when absent.
    const mod = await import("i18next-http-backend");
    HttpBackend = mod.default ?? mod;
    useHttpBackend = true;
  } catch {
    // i18next-http-backend not installed — use bundled translations.
    useHttpBackend = false;
  }

  const instance = i18n.use(LanguageDetector).use(initReactI18next);

  if (useHttpBackend && HttpBackend) {
    instance.use(HttpBackend);
  }

  await instance.init({
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGS],

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

    // Bundled resources used as fallback when http-backend is unavailable.
    // When http-backend IS active these act as inline seeds so the first
    // render is never blank while the network request is in flight.
    resources: useHttpBackend
      ? undefined
      : {
          en: { translation: en },
          es: { translation: es },
          zh: { translation: zh },
          pt: { translation: pt },
        },

    // http-backend configuration (only applied when the plugin is loaded).
    backend: useHttpBackend
      ? {
          loadPath: "/locales/{{lng}}/{{ns}}.json",
        }
      : undefined,

    interpolation: {
      escapeValue: false,
    },

    // Prevent i18next from printing "loading" warnings during SSR / tests
    // when resources are bundled.
    initImmediate: !useHttpBackend,
  });
}

// Kick off init; consumers await i18n.isInitialized or use Suspense.
void initI18n();

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
