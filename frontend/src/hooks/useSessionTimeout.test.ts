import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useSessionTimeout } from "./useSessionTimeout";

describe("useSessionTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with warning closed", () => {
    const { result } = renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
      })
    );

    expect(result.current.isWarning).toBe(false);
    expect(result.current.timeRemaining).toBe(30000);
  });

  it("should show warning after inactivity timeout", () => {
    const onWarning = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
        onWarning,
      })
    );

    expect(result.current.isWarning).toBe(false);

    // Advance time to inactivity threshold
    act(() => {
      vi.advanceTimersByTime(60001);
    });

    expect(result.current.isWarning).toBe(true);
    expect(onWarning).toHaveBeenCalled();
  });

  it("should auto-disconnect after warning duration", () => {
    const onExpire = vi.fn();
    renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
        onExpire,
      })
    );

    // Advance to warning
    act(() => {
      vi.advanceTimersByTime(60001);
    });

    // Advance through warning duration
    act(() => {
      vi.advanceTimersByTime(30001);
    });

    expect(onExpire).toHaveBeenCalled();
  });

  it("should dismiss warning and reset timer", () => {
    const { result } = renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
      })
    );

    // Advance to warning
    act(() => {
      vi.advanceTimersByTime(60001);
    });
    expect(result.current.isWarning).toBe(true);

    // Dismiss
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.isWarning).toBe(false);
    expect(result.current.timeRemaining).toBe(30000);
  });

  it("should countdown time remaining", () => {
    const { result } = renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
      })
    );

    // Advance to warning
    act(() => {
      vi.advanceTimersByTime(60001);
    });

    expect(result.current.isWarning).toBe(true);
    expect(result.current.timeRemaining).toBe(30000);

    // Advance 10 seconds
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(result.current.timeRemaining).toBe(20000);
  });

  it("should detect activity events", () => {
    const onWarning = vi.fn();
    const { result } = renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
        onWarning,
        activityEvents: ["mousemove", "keydown"],
      })
    );

    // Advance to near warning
    act(() => {
      vi.advanceTimersByTime(50000);
    });

    // Simulate activity
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    // Timer should reset, so warning should not trigger at 60s
    act(() => {
      vi.advanceTimersByTime(11000);
    });

    expect(result.current.isWarning).toBe(false);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("should allow disabling via enabled prop", () => {
    const onWarning = vi.fn();
    renderHook(() =>
      useSessionTimeout({
        inactivityMs: 60000,
        warningDurationMs: 30000,
        onWarning,
        enabled: false,
      })
    );

    act(() => {
      vi.advanceTimersByTime(60001);
    });

    expect(onWarning).not.toHaveBeenCalled();
  });
});
