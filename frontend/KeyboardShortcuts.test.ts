/**
 * Tests for KeyboardShortcuts modal
 * Run with: npx jest frontend/KeyboardShortcuts.test.ts
 */
import { initKeyboardShortcuts } from "./KeyboardShortcuts";

function press(key: string, target: EventTarget = document) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("KeyboardShortcuts", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = "";
  });

  test("? key opens modal", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
  });

  test("modal shows all shortcuts", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    const rows = document.querySelectorAll(".ks-table tbody tr");
    expect(rows.length).toBe(5); // ?, n, c, g s, g h
  });

  test("Escape closes modal", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    expect(document.querySelector(".ks-dialog")).not.toBeNull();
    press("Escape");
    expect(document.querySelector(".ks-dialog")).toBeNull();
  });

  test("close button closes modal", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    const closeBtn = document.querySelector<HTMLButtonElement>(".ks-close")!;
    closeBtn.click();
    expect(document.querySelector(".ks-dialog")).toBeNull();
  });

  test("n triggers onNewStream when no input focused", () => {
    const onNewStream = jest.fn();
    cleanup = initKeyboardShortcuts({ onNewStream });
    press("n");
    expect(onNewStream).toHaveBeenCalledTimes(1);
  });

  test("c triggers onClaim when no input focused", () => {
    const onClaim = jest.fn();
    cleanup = initKeyboardShortcuts({ onClaim });
    press("c");
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  test("g then s triggers onGoSchedule", () => {
    jest.useFakeTimers();
    const onGoSchedule = jest.fn();
    cleanup = initKeyboardShortcuts({ onGoSchedule });
    press("g");
    press("s");
    expect(onGoSchedule).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("g then h triggers onGoHistory", () => {
    jest.useFakeTimers();
    const onGoHistory = jest.fn();
    cleanup = initKeyboardShortcuts({ onGoHistory });
    press("g");
    press("h");
    expect(onGoHistory).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("shortcuts disabled inside <input>", () => {
    const onNewStream = jest.fn();
    cleanup = initKeyboardShortcuts({ onNewStream });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("n", input);
    expect(onNewStream).not.toHaveBeenCalled();
  });

  test("shortcuts disabled inside <textarea>", () => {
    const onClaim = jest.fn();
    cleanup = initKeyboardShortcuts({ onClaim });
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    press("c", ta);
    expect(onClaim).not.toHaveBeenCalled();
  });

  test("modal has correct ARIA attributes", () => {
    cleanup = initKeyboardShortcuts();
    press("?");
    const dialog = document.querySelector(".ks-dialog")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("ks-title");
  });

  test("cleanup removes event listeners", () => {
    const onNewStream = jest.fn();
    const stop = initKeyboardShortcuts({ onNewStream });
    stop();
    press("n");
    expect(onNewStream).not.toHaveBeenCalled();
  });
});
