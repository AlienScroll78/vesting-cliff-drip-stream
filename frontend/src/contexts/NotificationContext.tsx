"use client";
import { createContext, useContext, ReactNode } from "react";
import {
  useNotifications,
  AppNotification,
  NotificationPreferences,
  NotificationEventType,
} from "@/hooks/useNotifications";

interface NotificationCtx {
  notifications: AppNotification[];
  unreadCount: number;
  preferences: NotificationPreferences;
  addNotification: (
    type: NotificationEventType,
    title: string,
    message: string,
    recipient?: string
  ) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setPreference: (type: NotificationEventType, enabled: boolean) => void;
}

const NotificationContext = createContext<NotificationCtx | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const value = useNotifications();
  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext(): NotificationCtx {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotificationContext must be used inside NotificationProvider");
  return ctx;
}
