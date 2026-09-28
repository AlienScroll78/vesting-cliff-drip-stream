"use client";
/**
 * LanguageSwitcher (#280)
 *
 * Compact language picker displayed in the header/settings.
 * Persists the user's choice to localStorage via the i18next
 * LanguageDetector (LANG_STORAGE_KEY).
 *
 * Scaffolds RTL support: sets dir="rtl" on <html> for AR/HE.
 */

import { useTranslation } from "react-i18next";

const LANGS = [
  { code: "en", label: "EN", fullName: "English" },
  { code: "es", label: "ES", fullName: "Español" },
  { code: "zh", label: "中文", fullName: "中文" },
];

/** Languages that require right-to-left layout. */
const RTL_LANGS = new Set(["ar", "he"]);

interface Props {
  /** When true, shows the full language name instead of the short code. */
  showFullName?: boolean;
}

export function LanguageSwitcher({ showFullName = false }: Props) {
  const { i18n, t } = useTranslation();

  function handleChange(lng: string) {
    // changeLanguage also triggers the LanguageDetector to persist to localStorage
    void i18n.changeLanguage(lng);
    // RTL scaffold — set dir attribute for future AR/HE support
    document.documentElement.dir = RTL_LANGS.has(lng) ? "rtl" : "ltr";
    document.documentElement.lang = lng;
  }

  return (
    <div
      role="group"
      aria-label={t("settings.language", { defaultValue: t("language") })}
      style={{ display: "flex", gap: "0.25rem" }}
    >
      {LANGS.map(({ code, label, fullName }) => {
        const isActive = i18n.language.startsWith(code);
        return (
          <button
            key={code}
            type="button"
            onClick={() => handleChange(code)}
            aria-pressed={isActive}
            aria-label={`${fullName} — switch language`}
            title={fullName}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid var(--color-border)",
              borderRadius: "0.25rem",
              background: isActive ? "var(--color-active)" : "transparent",
              color: isActive ? "#fff" : "inherit",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 600,
              minWidth: "2rem",
              minHeight: "2rem",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {showFullName ? fullName : label}
          </button>
        );
      })}
    </div>
  );
}
