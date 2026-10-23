"use client";
import { Suspense, useEffect } from "react";
import i18n from "@/i18n";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const updateDocumentLanguage = (language: string) => {
      document.documentElement.lang = language || "en";
      document.documentElement.dir = ["ar", "he"].includes(language) ? "rtl" : "ltr";
    };
    updateDocumentLanguage(i18n.language);
    i18n.on("languageChanged", updateDocumentLanguage);
    return () => i18n.off("languageChanged", updateDocumentLanguage);
  }, []);
  return <Suspense fallback={<p role="status" aria-busy="true">Loading…</p>}>{children}</Suspense>;
}
