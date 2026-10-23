"use client";
import { useEffect, useRef } from "react";
import { WebSocketManager } from "@/utils/websocket";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { NotificationEventType } from "@/hooks/useNotifications";

// ── Incoming WS event shape ────────────────────────────────────────────────────

interface StreamEvent {
  type: NotificationEventType;
  recipient: string;
  title: string;
  message: string;
}

// ── Event type → human-readable defaults (fallback if server omits title/msg) ─

const EVENT_DEFAULTS: Record<
  NotificationEventType,
  { title: string; message: string }
> = {
  cliff_reached: {
    title: "Cliff Reached",
    message: "Your vesting cliff has been reached. Tokens are now available to claim.",
  },
  claim_available: {
    title: "Claim Available",
    message: "New tokens are available for you to claim.",
  },
  expiring_soon: {
    title: "Stream Expiring Soon",
    message: "Your vesting stream will expire within 7 days.",
  },
  stream_cancelled: {
    title: "Stream Cancelled",
    message: "Your vesting stream has been cancelled.",
  },
};

// ── WS server URL ──────────────────────────────────────────────────────────────

function buildWsUrl(recipientAddress: string): string {
  const base =
    process.env.NEXT_PUBLIC_WS_URL ??
    (typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
      : "ws://localhost:3001");
  return `${base}/ws/notifications?recipient=${encodeURIComponent(recipientAddress)}`;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Connects to the WebSocket notification server for the given recipient
 * address and feeds incoming events into the NotificationContext.
 *
 * Pass `null` (or omit recipientAddress) to keep the connection closed —
 * useful when the user's wallet is not yet connected.
 *
 * Reconnection uses exponential backoff via WebSocketManager:
 *   1 s → 2 s → 4 s → … capped at 30 s.
 */
export function useNotificationWebSocket(
  recipientAddress: string | null
): void {
  const { addNotification } = useNotificationContext();
  // Keep addNotification in a ref so the WS callbacks don't close over a stale copy
  const addNotificationRef = useRef(addNotification);
  useEffect(() => {
    addNotificationRef.current = addNotification;
  }, [addNotification]);

  useEffect(() => {
    if (!recipientAddress) return;

    const manager = new WebSocketManager({
      url: buildWsUrl(recipientAddress),

      onOpen: () => {
        // Subscribe to all supported stream event types
        const subscribeMsg = JSON.stringify({
          action: "subscribe",
          events: [
            "cliff_reached",
            "claim_available",
            "expiring_soon",
            "stream_cancelled",
          ],
          recipient: recipientAddress,
        });
        manager.send(subscribeMsg);
      },

      onMessage: (event: MessageEvent) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          // Ignore non-JSON frames (e.g. ping/pong text)
          return;
        }

        const data = parsed as Partial<StreamEvent>;

        // Validate that this is a recognised stream event
        if (!data.type || !(data.type in EVENT_DEFAULTS)) return;

        // Only process events that belong to our recipient (server-side filter
        // should already guarantee this, but guard client-side too)
        if (data.recipient && data.recipient !== recipientAddress) return;

        const defaults = EVENT_DEFAULTS[data.type as NotificationEventType];
        addNotificationRef.current(
          data.type as NotificationEventType,
          data.title ?? defaults.title,
          data.message ?? defaults.message,
          data.recipient ?? recipientAddress
        );
      },

      // onError is intentionally minimal — WebSocketManager's onclose handler
      // drives reconnection; double-reconnecting from onError causes issues in Firefox.
      onError: () => {
        // Errors are surfaced via onclose; nothing extra to do here.
      },

      initialDelay: 1_000,
      maxDelay: 30_000,
      backoffFactor: 2,
      maxAttempts: 0, // unlimited reconnection
    });

    manager.connect();

    return () => {
      manager.destroy();
    };
  }, [recipientAddress]);
}
