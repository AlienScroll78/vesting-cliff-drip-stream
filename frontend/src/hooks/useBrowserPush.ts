"use client";
import { useState, useCallback, useEffect } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "vesting-push-permission";

/** Values we persist to localStorage. */
type PersistedDecision = "granted" | "denied" | "dismissed";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isBrowserPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    typeof Notification !== "undefined"
  );
}

function loadPersistedDecision(): PersistedDecision | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "granted" || raw === "denied" || raw === "dismissed") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveDecision(decision: PersistedDecision): void {
  try {
    localStorage.setItem(STORAGE_KEY, decision);
  } catch {
    /* ignore */
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface UseBrowserPushReturn {
  /** Current browser notification permission: 'default' | 'granted' | 'denied' */
  permission: NotificationPermission;
  /**
   * True when a `cliff_reached` event has fired for the first time and the
   * user has not yet granted (or explicitly dismissed) the push permission
   * prompt. Use this to conditionally render a permission prompt banner.
   */
  showCliffReachedPrompt: boolean;
  /**
   * Request the browser notification permission. Resolves to the resulting
   * permission state. Also persists the decision to localStorage.
   */
  requestPermission: () => Promise<NotificationPermission>;
  /**
   * Show a browser push notification if permission is currently granted.
   * No-op if permission is not granted or the API is not available.
   */
  sendBrowserNotification: (
    title: string,
    body: string,
    icon?: string
  ) => void;
  /**
   * Call this to trigger the permission prompt UI when the first
   * `cliff_reached` event fires and permission is not yet granted.
   * Typically called from `useNotificationWebSocket` or a notification
   * list effect.
   */
  triggerCliffReachedPrompt: () => void;
  /** Dismiss the permission prompt without granting permission. */
  dismissPrompt: () => void;
}

/**
 * Manages Web Push API permission and browser notification delivery.
 *
 * Permission decisions are persisted to `localStorage` under the key
 * `'vesting-push-permission'` so the prompt is not shown again after the
 * user has explicitly acted on it.
 */
export function useBrowserPush(): UseBrowserPushReturn {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (!isBrowserPushSupported()) return "denied";
    return Notification.permission;
  });

  const [showCliffReachedPrompt, setShowCliffReachedPrompt] = useState(false);

  // On mount: sync permission state and check persisted decision
  useEffect(() => {
    if (!isBrowserPushSupported()) return;

    // Reflect any permission change that happened outside this session
    setPermission(Notification.permission);

    // If the browser-level permission was already granted (e.g. from a
    // previous session), update localStorage to match so the prompt is
    // not shown unnecessarily.
    if (Notification.permission === "granted") {
      saveDecision("granted");
    }
  }, []);

  const requestPermission =
    useCallback(async (): Promise<NotificationPermission> => {
      if (!isBrowserPushSupported()) return "denied";

      // Modern API returns a promise; old Safari used a callback but we only
      // support the Promise-based API (all modern browsers).
      const result = await Notification.requestPermission();
      setPermission(result);
      setShowCliffReachedPrompt(false);

      if (result === "granted") {
        saveDecision("granted");
      } else {
        saveDecision("denied");
      }

      return result;
    }, []);

  const sendBrowserNotification = useCallback(
    (title: string, body: string, icon?: string): void => {
      if (!isBrowserPushSupported()) return;
      if (Notification.permission !== "granted") return;

      try {
        // eslint-disable-next-line no-new -- Notification constructor is effectful
        new Notification(title, {
          body,
          icon: icon ?? "/favicon.ico",
          tag: "vesting-notification", // replace previous notification of same tag
        });
      } catch {
        // Ignore errors (e.g. in environments where Notification is restricted)
      }
    },
    []
  );

  const triggerCliffReachedPrompt = useCallback((): void => {
    if (!isBrowserPushSupported()) return;
    if (Notification.permission === "granted") return; // already have permission

    // Don't re-show if the user already made a decision this session or in a
    // prior session
    const persisted = loadPersistedDecision();
    if (persisted === "granted" || persisted === "denied" || persisted === "dismissed") {
      return;
    }

    setShowCliffReachedPrompt(true);
  }, []);

  const dismissPrompt = useCallback((): void => {
    setShowCliffReachedPrompt(false);
    saveDecision("dismissed");
  }, []);

  return {
    permission,
    showCliffReachedPrompt,
    requestPermission,
    sendBrowserNotification,
    triggerCliffReachedPrompt,
    dismissPrompt,
  };
}
