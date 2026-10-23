/**
 * NavLoadingBar — global top-of-page navigation transition indicator.
 *
 * A thin 3 px bar pinned to the very top of the viewport that animates from
 * left to right whenever a navigation or data-fetch is in progress.
 *
 * Design spec
 * ───────────
 * • Height       : 3 px (unobtrusive but clearly visible)
 * • Position     : fixed, top: 0, full width
 * • Colour       : --color-brand-primary (#7c3aed) on a pale track (#ddd6fe)
 * • Animation    : CSS keyframe `navBarSlide` (see Skeletons.module.css)
 *                  0 % → 85 % over 1.8 s, then snaps to 100 % and fades out
 * • z-index      : 9999 — always above all other content
 * • Reduced-motion: animation disabled; bar rendered static at full width,
 *                  opacity 0.6, so something is still visible
 *
 * Usage
 * ─────
 * Render once at the app root, pass `visible={isNavigating}`:
 *
 *   <NavLoadingBar visible={navigation.state === "loading"} />
 *
 * Works with React Router v6 `useNavigation()`, Next.js router events, or any
 * boolean flag you control.
 *
 * Accessibility
 * ─────────────
 * • `role="progressbar"` with `aria-valuemin/max/now` communicates the loading
 *   state to screen readers.
 * • `aria-label="Page loading"` provides a human-readable description.
 * • `aria-valuenow` is omitted (indeterminate) so screen readers announce it as
 *   an indeterminate progress bar.
 * • The bar is removed from the DOM when `visible` is false, avoiding a
 *   permanent but invisible element.
 */

"use client";

import styles from "./Skeletons.module.css";

// ─── NavLoadingBar ────────────────────────────────────────────────────────────

export interface NavLoadingBarProps {
  /** Whether the loading bar is currently visible. */
  visible: boolean;
  /** Override the accessible label (default: "Page loading"). */
  label?: string;
}

export function NavLoadingBar({
  visible,
  label = "Page loading",
}: NavLoadingBarProps) {
  if (!visible) return null;

  return (
    <div
      className={styles.navLoadingBar}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      /* aria-valuenow intentionally omitted — indeterminate */
      data-testid="nav-loading-bar"
    >
      <div className={styles.navLoadingBarFill} aria-hidden="true" />
    </div>
  );
}

// ─── useNavLoading — convenience hook ─────────────────────────────────────────

/**
 * Manages a `visible` boolean that auto-clears after a configurable timeout.
 * Useful when you know navigation will finish but can't hook into a router
 * event directly.
 *
 * Example:
 *   const { visible, start } = useNavLoading();
 *   <NavLoadingBar visible={visible} />
 *   <button onClick={() => { start(); router.push("/streams"); }}>Go</button>
 */
import { useState, useCallback, useRef, useEffect } from "react";

export interface UseNavLoadingReturn {
  visible: boolean;
  /** Call when navigation begins. */
  start: () => void;
  /** Call when navigation finishes (or call this from a router event). */
  done: () => void;
}

export function useNavLoading(timeoutMs = 5000): UseNavLoadingReturn {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const done = useCallback(() => {
    clear();
    setVisible(false);
  }, [clear]);

  const start = useCallback(() => {
    clear();
    setVisible(true);
    // Safety fallback: hide the bar after timeoutMs even if `done` is never
    // called (e.g. the router event never fires).
    timerRef.current = setTimeout(done, timeoutMs);
  }, [clear, done, timeoutMs]);

  // Clean up on unmount
  useEffect(() => () => { clear(); }, [clear]);

  return { visible, start, done };
}
