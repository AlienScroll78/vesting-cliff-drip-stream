"use client";
import { useState, useCallback, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type NotificationEventType =
  | "cliff_reached"
  | "expiring_soon"
  | "claim_available"
  | "stream_cancelled";

export interface AppNotification {
  id: string;
  type: NotificationEventType;
  title: string;
  message: string;
  timestamp: string; // ISO-8601
  read: boolean;
  /** Optional recipient address this notification relates to */
  recipient?: string;
}

export interface NotificationPreferences {
  cliff_reached: boolean;
  expiring_soon: boolean;
  claim_available: boolean;
  stream_cancelled: boolean;
}

const MAX_NOTIFICATIONS = 50;
const STORAGE_KEY = "vesting_notifications";
const PREFS_KEY = "vesting_notification_prefs";

const DEFAULT_PREFS: NotificationPreferences = {
  cliff_reached: true,
  expiring_soon: true,
  claim_available: true,
  stream_cancelled: true,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    loadFromStorage<AppNotification[]>(STORAGE_KEY, [])
  );
  const [preferences, setPreferences] = useState<NotificationPreferences>(() =>
    loadFromStorage<NotificationPreferences>(PREFS_KEY, DEFAULT_PREFS)
  );

  // Persist notifications whenever they change
  useEffect(() => {
    saveToStorage(STORAGE_KEY, notifications);
  }, [notifications]);

  // Persist preferences whenever they change
  useEffect(() => {
    saveToStorage(PREFS_KEY, preferences);
  }, [preferences]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  /** Add a notification (respects preferences, prunes to MAX_NOTIFICATIONS). */
  const addNotification = useCallback(
    (
      type: NotificationEventType,
      title: string,
      message: string,
      recipient?: string
    ) => {
      if (!preferences[type]) return; // disabled by user

      const notification: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        title,
        message,
        timestamp: new Date().toISOString(),
        read: false,
        recipient,
      };

      setNotifications((prev) => {
        // Prepend new, keep newest MAX_NOTIFICATIONS
        const next = [notification, ...prev];
        return next.slice(0, MAX_NOTIFICATIONS);
      });
    },
    [preferences]
  );

  /** Mark a single notification as read. */
  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  /** Mark all notifications as read. */
  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  /** Update a single preference. */
  const setPreference = useCallback(
    (type: NotificationEventType, enabled: boolean) => {
      setPreferences((prev) => ({ ...prev, [type]: enabled }));
    },
    []
  );

  return {
    notifications,
    unreadCount,
    preferences,
    addNotification,
    markRead,
    markAllRead,
    setPreference,
  };
}
