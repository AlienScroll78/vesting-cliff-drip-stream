"use client";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import styles from "./OfflineBanner.module.css";

/**
 * Banner displayed when the app is offline.
 * Shows a persistent notification with offline indicator.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      className={styles.banner}
      role="status"
      aria-live="polite"
      aria-label="Application is currently offline"
    >
      <div className={styles.content}>
        <span className={styles.indicator}>●</span>
        <span>You're offline. Some features are limited.</span>
      </div>
    </div>
  );
}
