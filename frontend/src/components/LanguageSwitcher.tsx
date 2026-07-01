"use client";
import { useTranslation } from "react-i18next";

const LANGS = [
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "zh", label: "中文" },
];

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  // RTL stub: set dir attribute for future AR/HE support
  const handleChange = (lng: string) => {
    i18n.changeLanguage(lng);
    const rtlLangs = ["ar", "he"];
    document.documentElement.dir = rtlLangs.includes(lng) ? "rtl" : "ltr";
    document.documentElement.lang = lng;
  };

  return (
    <div role="group" aria-label={t("language")} style={{ display: "flex", gap: "0.25rem" }}>
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => handleChange(code)}
          aria-pressed={i18n.language.startsWith(code)}
          style={{
            padding: "0.25rem 0.5rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.25rem",
            background: i18n.language.startsWith(code) ? "var(--color-active)" : "transparent",
            color: i18n.language.startsWith(code) ? "#fff" : "inherit",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
