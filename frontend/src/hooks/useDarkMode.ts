import { useEffect, useState } from "react";

const STORAGE_KEY = "vesting-dark-mode";

function getInitialDark(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(getInitialDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(STORAGE_KEY, String(dark));
    } catch {
      // ignore
    }
  }, [dark]);

  const toggle = () => setDark((d) => !d);

  return [dark, toggle];
}
