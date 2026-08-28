"use client";
import { useEffect, useState } from "react";
import styles from "./LastUpdatedBadge.module.css";

interface LastUpdatedBadgeProps {
  timestamp: number | null;
}

/**
 * Badge showing when cached data was last updated.
 * Displays "Last updated X ago" format.
 */
export function LastUpdatedBadge({ timestamp }: LastUpdatedBadgeProps) {
  const [relativeTime, setRelativeTime] = useState<string>("");

  useEffect(() => {
    if (!timestamp) {
      setRelativeTime("");
      return;
    }

    function updateRelativeTime() {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) {
        setRelativeTime("just now");
      } else if (minutes < 60) {
        setRelativeTime(`${minutes} min${minutes !== 1 ? "s" : ""} ago`);
      } else if (hours < 24) {
        setRelativeTime(`${hours} hour${hours !== 1 ? "s" : ""} ago`);
      } else {
        setRelativeTime(`${days} day${days !== 1 ? "s" : ""} ago`);
      }
    }

    updateRelativeTime();
    const interval = setInterval(updateRelativeTime, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [timestamp]);

  if (!relativeTime) {
    return null;
  }

  return (
    <span
      className={styles.badge}
      aria-label={`Last updated ${relativeTime}`}
    >
      📦 Last updated {relativeTime}
    </span>
  );
}
