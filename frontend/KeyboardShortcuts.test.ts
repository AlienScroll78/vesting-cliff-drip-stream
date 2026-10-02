/**
 * Tests for KeyboardShortcuts modal
 * Run with: npx vitest frontend/KeyboardShortcuts.test.ts
 *
 * @closes #270
 */
import { describe, test, expect, afterEach, vi } from "vitest";
import { initKeyboardShortcuts } from "./KeyboardShortcuts";

function press(key: string, options: { shiftKey?: boolean; target?: EventTarget } = {}) {
  const { shiftKey = false, target = document } = options;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
}

describe("KeyboardShortcuts", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = "";
  });

  // ── Legacy ? open ───────────────────────────────────────────────────────────

  test("? key opens modal", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
  });

  test("modal shows all shortcuts", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    const rows = document.querySelectorAll(".ks-table tbody tr");
    expect(rows.length).toBe(11); // full shortcut table
  });

  // ── Shift+? toggle overlay ──────────────────────────────────────────────────

  test("Shift+? opens overlay", () => {
    cleanup = initKeyboardShortcuts();
    press("?", { shiftKey: true });
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
  });

  test("Shift+? toggles overlay closed when already open", () => {
    cleanup = initKeyboardShortcuts();
    press("?", { shiftKey: true });
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
    press("?", { shiftKey: true });
    expect(document.querySelector(".ks-dialog")).toBeNull();
  });

  // ── Escape ──────────────────────────────────────────────────────────────────

  test("Escape closes modal when open", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
    press("Escape");
    expect(document.querySelector(".ks-dialog")).toBeNull();
  });

  test("Escape calls onCloseModal when modal is not open", () => {
    const onCloseModal = vi.fn();
    cleanup = initKeyboardShortcuts({ onCloseModal });
    press("Escape");
    expect(onCloseModal).toHaveBeenCalledTimes(1);
  });

  test("Escape does NOT call onCloseModal when overlay is open", () => {
    const onCloseModal = vi.fn();
    cleanup = initKeyboardShortcuts({ onCloseModal });
    press("?");
    press("Escape");
    // Should close the overlay, not call onCloseModal
    expect(onCloseModal).not.toHaveBeenCalled();
    expect(document.querySelector(".ks-dialog")).toBeNull();
  });

  // ── Close button ────────────────────────────────────────────────────────────

  test("close button closes modal", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    const closeBtn = document.querySelector<HTMLButtonElement>(".ks-close")!;
    closeBtn.click();
    expect(document.querySelector(".ks-dialog")).toBeNull();
  });

  // ── Existing shortcuts ──────────────────────────────────────────────────────

  test("n triggers onNewStream when no input focused", () => {
    const onNewStream = vi.fn();
    cleanup = initKeyboardShortcuts({ onNewStream });
    press("n");
    expect(onNewStream).toHaveBeenCalledTimes(1);
  });

  test("c triggers onClaim when no input focused", () => {
    const onClaim = vi.fn();
    cleanup = initKeyboardShortcuts({ onClaim });
    press("c");
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  test("g then s triggers onGoSchedule", () => {
    vi.useFakeTimers();
    const onGoSchedule = vi.fn();
    cleanup = initKeyboardShortcuts({ onGoSchedule });
    press("g");
    press("s");
    expect(onGoSchedule).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("g then h triggers onGoHistory", () => {
    vi.useFakeTimers();
    const onGoHistory = vi.fn();
    cleanup = initKeyboardShortcuts({ onGoHistory });
    press("g");
    press("h");
    expect(onGoHistory).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // ── New shortcuts ───────────────────────────────────────────────────────────

  test("C triggers onCreateStream when no input focused", () => {
    const onCreateStream = vi.fn();
    cleanup = initKeyboardShortcuts({ onCreateStream });
    press("C");
    expect(onCreateStream).toHaveBeenCalledTimes(1);
  });

  test("R triggers onRefresh when no input focused", () => {
    const onRefresh = vi.fn();
    cleanup = initKeyboardShortcuts({ onRefresh });
    press("R");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("ArrowUp triggers onNavigatePrev when no input focused", () => {
    const onNavigatePrev = vi.fn();
    cleanup = initKeyboardShortcuts({ onNavigatePrev });
    press("ArrowUp");
    expect(onNavigatePrev).toHaveBeenCalledTimes(1);
  });

  test("ArrowDown triggers onNavigateNext when no input focused", () => {
    const onNavigateNext = vi.fn();
    cleanup = initKeyboardShortcuts({ onNavigateNext });
    press("ArrowDown");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);
  });

  test("Enter triggers onOpenDetail when no input focused", () => {
    const onOpenDetail = vi.fn();
    cleanup = initKeyboardShortcuts({ onOpenDetail });
    press("Enter");
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  // ── Shortcuts disabled in inputs ────────────────────────────────────────────

  test("shortcuts disabled inside <input>", () => {
    const onNewStream = vi.fn();
    cleanup = initKeyboardShortcuts({ onNewStream });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("n", { target: input });
    expect(onNewStream).not.toHaveBeenCalled();
  });

  test("shortcuts disabled inside <textarea>", () => {
    const onClaim = vi.fn();
    cleanup = initKeyboardShortcuts({ onClaim });
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    press("c", { target: ta });
    expect(onClaim).not.toHaveBeenCalled();
  });

  test("C disabled inside <input>", () => {
    const onCreateStream = vi.fn();
    cleanup = initKeyboardShortcuts({ onCreateStream });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("C", { target: input });
    expect(onCreateStream).not.toHaveBeenCalled();
  });

  test("R disabled inside <input>", () => {
    const onRefresh = vi.fn();
    cleanup = initKeyboardShortcuts({ onRefresh });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("R", { target: input });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("ArrowUp disabled inside <input>", () => {
    const onNavigatePrev = vi.fn();
    cleanup = initKeyboardShortcuts({ onNavigatePrev });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("ArrowUp", { target: input });
    expect(onNavigatePrev).not.toHaveBeenCalled();
  });

  // ── Overlay open suppresses other shortcuts ─────────────────────────────────

  test("shortcuts NOT fired when overlay is open", () => {
    const onNewStream = vi.fn();
    const onCreateStream = vi.fn();
    const onRefresh = vi.fn();
    cleanup = initKeyboardShortcuts({ onNewStream, onCreateStream, onRefresh });
    press("?");
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
    press("n");
    press("C");
    press("R");
    expect(onNewStream).not.toHaveBeenCalled();
    expect(onCreateStream).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  // ── ARIA ────────────────────────────────────────────────────────────────────

  test("modal has correct ARIA attributes", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    const dialog = document.querySelector(".ks-dialog")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("ks-title");
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  test("cleanup removes event listeners", () => {
    const onNewStream = vi.fn();
    const stop = initKeyboardShortcuts({ onNewStream });
    stop();
    press("n");
    expect(onNewStream).not.toHaveBeenCalled();
  });

  test("cleanup closes modal if open", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
    cleanup();
    expect(document.querySelector(".ks-dialog")).toBeNull();
    // Prevent afterEach from calling cleanup a second time
    cleanup = () => {};
  });
});
