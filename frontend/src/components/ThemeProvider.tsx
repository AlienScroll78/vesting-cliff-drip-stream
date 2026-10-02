"use client";

/**
 * ThemeProvider — issue #766
 *
 * Wraps page content and ensures the correct theme is applied to the <html>
 * element after React hydration. The anti-FOUC inline script in layout.tsx
 * sets the initial .dark class and data-theme attribute synchronously before
 * paint, but React's hydration pass resets server-rendered attributes.
 * This component re-applies both the .dark class and the data-theme attribute
 * on the client after mount, keeping the DOM consistent with the stored
 * preference or system default.
 *
 * Usage (in layout.tsx or a page root):
 *   <ThemeProvider>{children}</ThemeProvider>
 */

import { useEffect } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";

const STORAGE_KEY = "vesting-dark-mode";

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [dark] = useDarkMode();

  // Sync theme attributes on every dark-state change. useDarkMode already
  // does this inside the hook, but ThemeProvider makes the intent explicit
  // at the app-root level and provides a single integration point for any
  // future theme logic (e.g. multiple themes beyond light/dark).
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", dark);
    html.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  return <>{children}</>;
}

/**
 * getServerThemeProps — helper for server components / generateMetadata.
 *
 * Returns the initial theme string to embed in server-rendered HTML before
 * the client-side hook runs. Since we cannot access localStorage on the
 * server, this always returns "light" — the anti-FOUC script overrides it
 * synchronously on the client before the first paint if needed.
 */
export function getServerThemeProps(): { "data-theme": "light" | "dark" } {
  return { "data-theme": "light" };
}
