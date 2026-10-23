import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "./useReducedMotion";

function mockMatchMedia(reduced: boolean) {
  let listener: (() => void) | undefined;
  const mql = {
    matches: reduced,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_event: string, cb: () => void) => {
      listener = cb;
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => mql),
  });
  return {
    mql,
    trigger(next: boolean) {
      mql.matches = next;
      listener?.();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReducedMotion", () => {
  it("defaults to false when the system has no reduced-motion preference", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("defaults to true when the system prefers reduced motion", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates live when the media query change fires", () => {
    const { trigger } = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => trigger(true));
    expect(result.current).toBe(true);
  });
});
