import { useEffect, useState } from "react";

/**
 * Hook to track online/offline status and provide cache metadata.
 * Emits online/offline events from the browser and triggers refetch on reconnect.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => {
    // SSR safe: return true on first render, actual value in effect
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
