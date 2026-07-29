import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDarkMode } from "./useDarkMode";

const STORAGE_KEY = "vesting-dark-mode";

function setSystemDark(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  setSystemDark(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDarkMode", () => {
  it("defaults to light when no preference stored and system is light", () => {
    const { result } = renderHook(() => useDarkMode());
    expect(result.current[0]).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("defaults to dark when system prefers dark and nothing stored", () => {
    setSystemDark(true);
    const { result } = renderHook(() => useDarkMode());
    expect(result.current[0]).toBe(true);
  });

  it("reads stored preference over system preference", () => {
    setSystemDark(true);
    localStorage.setItem(STORAGE_KEY, "false");
    const { result } = renderHook(() => useDarkMode());
    expect(result.current[0]).toBe(false);
  });

  it("toggle switches from light to dark", () => {
    const { result } = renderHook(() => useDarkMode());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggle switches from dark to light", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useDarkMode());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists preference to localStorage on toggle", () => {
    const { result } = renderHook(() => useDarkMode());
    act(() => result.current[1]());
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    act(() => result.current[1]());
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });
});
