import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useOnlineStatus } from "./useOnlineStatus";

describe("useOnlineStatus", () => {
  beforeEach(() => {
    // Reset navigator.onLine to true by default
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });
  });

  it("should return true on initial render (SSR safe)", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("should track online/offline events", () => {
    const { result } = renderHook(() => useOnlineStatus());

    // Start online
    expect(result.current).toBe(true);

    // Simulate going offline
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current).toBe(false);

    // Simulate going back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current).toBe(true);
  });

  it("should cleanup event listeners on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});
