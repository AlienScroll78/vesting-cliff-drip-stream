/**
 * Tests for useModalFocus hook (#389)
 */
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useModalFocus } from "./useModalFocus";

// jsdom doesn't support requestAnimationFrame by default in all test runners;
// provide a synchronous shim so focus calls happen immediately in tests.
beforeEach(() => {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useModalFocus", () => {
  it("returns a modalRef", () => {
    const triggerRef = { current: null };
    const { result } = renderHook(() => useModalFocus(false, triggerRef));
    expect(result.current.modalRef).toBeDefined();
    expect(typeof result.current.modalRef).toBe("object");
  });

  it("restores focus to triggerRef when modal closes", () => {
    // Create a real DOM button to act as the trigger
    const button = document.createElement("button");
    button.textContent = "Open modal";
    document.body.appendChild(button);
    button.focus();

    const triggerRef = { current: button };

    const { rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useModalFocus(isOpen, triggerRef),
      { initialProps: { isOpen: true } },
    );

    // Close the modal
    act(() => {
      rerender({ isOpen: false });
    });

    expect(document.activeElement).toBe(button);

    document.body.removeChild(button);
  });

  it("focuses the first focusable element inside modal when opened", () => {
    // Build a minimal modal container with a focusable button
    const modal = document.createElement("div");
    const btn = document.createElement("button");
    btn.textContent = "Close";
    modal.appendChild(btn);
    document.body.appendChild(modal);

    const triggerRef = { current: null };

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useModalFocus(isOpen, triggerRef),
      { initialProps: { isOpen: false } },
    );

    // Attach the modalRef to the real DOM element
    (result.current.modalRef as React.MutableRefObject<HTMLDivElement>).current = modal;

    act(() => {
      rerender({ isOpen: true });
    });

    expect(document.activeElement).toBe(btn);

    document.body.removeChild(modal);
  });
});
