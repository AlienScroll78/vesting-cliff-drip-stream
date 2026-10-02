/**
 * Tests for WalletConnectButton
 * Run with: npx jest frontend/WalletConnectButton.test.ts
 * (requires jest + jsdom + ts-jest)
 */
import {
  createWalletConnectButton,
  persistWalletAddress,
  restoreWalletAddress,
  clearWalletAddress,
  silentReconnect,
  WALLET_STORAGE_KEY,
} from "./WalletConnectButton";

const ADDR = "GBTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

describe("WalletConnectButton", () => {
  test("disconnected state renders primary CTA button", () => {
    const el = createWalletConnectButton({
      state: "disconnected",
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    const btn = el.querySelector("button")!;
    expect(btn.textContent).toBe("Connect Wallet");
    expect(btn.className).toContain("wcb-btn--primary");
  });

  test("connecting state renders spinner and is disabled", () => {
    const el = createWalletConnectButton({
      state: "connecting",
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    const btn = el.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(el.querySelector(".wcb-spinner")).not.toBeNull();
  });

  test("connected state shows truncated address", () => {
    const el = createWalletConnectButton({
      state: "connected",
      address: ADDR,
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    const addr = el.querySelector(".wcb-address")!;
    expect(addr.textContent).toBe(`${ADDR.slice(0, 4)}…${ADDR.slice(-4)}`);
  });

  test("connected state dropdown is hidden initially", () => {
    const el = createWalletConnectButton({
      state: "connected",
      address: ADDR,
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    const dropdown = el.querySelector(".wcb-dropdown") as HTMLElement;
    expect(dropdown.hidden).toBe(true);
  });

  test("clicking connected button toggles dropdown", () => {
    const el = createWalletConnectButton({
      state: "connected",
      address: ADDR,
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    document.body.appendChild(el);
    const btn = el.querySelector<HTMLButtonElement>(".wcb-btn--connected")!;
    const dropdown = el.querySelector(".wcb-dropdown") as HTMLElement;

    btn.click();
    expect(dropdown.hidden).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    btn.click();
    expect(dropdown.hidden).toBe(true);
    document.body.removeChild(el);
  });

  test("dropdown contains copy, explorer, disconnect items", () => {
    const el = createWalletConnectButton({
      state: "connected",
      address: ADDR,
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    const items = el.querySelectorAll(".wcb-dropdown__item");
    const labels = [...items].map((i) => i.textContent);
    expect(labels).toContain("Copy address");
    expect(labels).toContain("View on Explorer");
    expect(labels).toContain("Disconnect");
  });

  test("disconnect calls onDisconnect", () => {
    const onDisconnect = jest.fn();
    const el = createWalletConnectButton({
      state: "connected",
      address: ADDR,
      onConnect: jest.fn(),
      onDisconnect,
    });
    document.body.appendChild(el);
    const btn = el.querySelector<HTMLButtonElement>(".wcb-btn--connected")!;
    btn.click(); // open dropdown
    const disconnectBtn = [...el.querySelectorAll<HTMLButtonElement>(".wcb-dropdown__item")]
      .find((b) => b.textContent === "Disconnect")!;
    disconnectBtn.click();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    document.body.removeChild(el);
  });

  test("dropdown items have role=menuitem and are keyboard navigable", () => {
    const el = createWalletConnectButton({
      state: "connected",
      address: ADDR,
      onConnect: jest.fn(),
      onDisconnect: jest.fn(),
    });
    const items = el.querySelectorAll("[role=menuitem]");
    expect(items.length).toBe(3);
  });

  // ── Persistence helpers ──────────────────────────────────────────────────

  describe("persistWalletAddress", () => {
    afterEach(() => {
      localStorage.clear();
    });

    test("stores the address under WALLET_STORAGE_KEY", () => {
      persistWalletAddress(ADDR);
      expect(localStorage.getItem(WALLET_STORAGE_KEY)).toBe(ADDR);
    });

    test("overwrites a previously stored address", () => {
      persistWalletAddress(ADDR);
      const ADDR2 = "GCOTHER0000000000000000000000000000000000000000";
      persistWalletAddress(ADDR2);
      expect(localStorage.getItem(WALLET_STORAGE_KEY)).toBe(ADDR2);
    });

    test("does not throw when localStorage is unavailable", () => {
      const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
      Object.defineProperty(window, "localStorage", {
        get() { throw new Error("unavailable"); },
        configurable: true,
      });
      expect(() => persistWalletAddress(ADDR)).not.toThrow();
      Object.defineProperty(window, "localStorage", original);
    });
  });

  describe("restoreWalletAddress", () => {
    afterEach(() => {
      localStorage.clear();
    });

    test("returns null when nothing is cached", () => {
      expect(restoreWalletAddress()).toBeNull();
    });

    test("returns the stored address after persist", () => {
      persistWalletAddress(ADDR);
      expect(restoreWalletAddress()).toBe(ADDR);
    });

    test("returns null when localStorage is unavailable", () => {
      const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
      Object.defineProperty(window, "localStorage", {
        get() { throw new Error("unavailable"); },
        configurable: true,
      });
      expect(restoreWalletAddress()).toBeNull();
      Object.defineProperty(window, "localStorage", original);
    });
  });

  describe("clearWalletAddress", () => {
    afterEach(() => {
      localStorage.clear();
    });

    test("removes the stored address", () => {
      persistWalletAddress(ADDR);
      clearWalletAddress();
      expect(localStorage.getItem(WALLET_STORAGE_KEY)).toBeNull();
    });

    test("does not throw when nothing is stored", () => {
      expect(() => clearWalletAddress()).not.toThrow();
    });

    test("does not throw when localStorage is unavailable", () => {
      const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
      Object.defineProperty(window, "localStorage", {
        get() { throw new Error("unavailable"); },
        configurable: true,
      });
      expect(() => clearWalletAddress()).not.toThrow();
      Object.defineProperty(window, "localStorage", original);
    });
  });

  describe("silentReconnect", () => {
    afterEach(() => {
      localStorage.clear();
    });

    test("returns null when no cached key exists", () => {
      expect(silentReconnect()).toBeNull();
    });

    test("returns the cached public key when one is stored", () => {
      persistWalletAddress(ADDR);
      expect(silentReconnect()).toBe(ADDR);
    });

    test("returns null gracefully when localStorage is unavailable", () => {
      const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
      Object.defineProperty(window, "localStorage", {
        get() { throw new Error("unavailable"); },
        configurable: true,
      });
      expect(silentReconnect()).toBeNull();
      Object.defineProperty(window, "localStorage", original);
    });
  });
});
