import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useNotifications } from "./useNotifications";

describe("useNotifications", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores notifications and marks them as read", () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification("claim_available", "Claim ready", "Tokens are ready to claim");
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notifications[0]!.type).toBe("claim_available");

    act(() => {
      result.current.markRead(result.current.notifications[0]!.id);
    });

    expect(result.current.notifications[0]!.read).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it("respects preferences and persists them to localStorage", () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.setPreference("stream_cancelled", false);
    });

    act(() => {
      result.current.addNotification("stream_cancelled", "Stream cancelled", "The stream has been cancelled");
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(localStorage.getItem("vesting_notification_prefs")).toContain('"stream_cancelled":false');
  });

  it("prunes notifications to the maximum supported count", () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      for (let i = 0; i < 60; i += 1) {
        result.current.addNotification("expiring_soon", `Reminder ${i}`, `Message ${i}`);
      }
    });

    expect(result.current.notifications).toHaveLength(50);
    expect(result.current.notifications[0]!.title).toBe("Reminder 59");
  });
});
