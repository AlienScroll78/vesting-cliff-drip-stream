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

  // Apply class and persist preference whenever dark state changes
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(STORAGE_KEY, String(dark));
    } catch {
      // ignore
    }
  }, [dark]);

  // Listen for OS-level preference changes.
  // Only takes effect when the user has NOT explicitly set a preference via
  // the toggle (i.e. no localStorage entry exists), so manual choices are
  // always respected.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      try {
        // If a manual preference exists, honour it — don't override.
        if (localStorage.getItem(STORAGE_KEY) !== null) return;
      } catch {
        // localStorage unavailable — fall through and follow OS
      }
      setDark(e.matches);
    };

    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const toggle = () =>
    setDark((d) => {
      const next = !d;
      // Writing here is redundant with the first effect, but makes the intent
      // explicit: a manual toggle always creates a stored preference so that
      // the OS-change listener above knows to stand down.
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });

  return [dark, toggle];
}
