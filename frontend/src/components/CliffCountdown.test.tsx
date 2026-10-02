import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CliffCountdown, countdownIntervalMs, formatCountdown } from "@/components/CliffCountdown";

function ledgersForSeconds(seconds: number): number {
  return seconds / 5;
}

describe("CliffCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("formats the long-range display", () => {
    expect(formatCountdown(142 * 86400 + 6 * 3600)).toBe("142 days 06 hours remaining");
  });

  it("formats the one-to-seven-day display", () => {
    expect(formatCountdown(6 * 86400 + 14 * 3600 + 32 * 60)).toBe("6 days 14 hours 32 minutes remaining");
  });

  it("formats the last-hour display", () => {
    expect(formatCountdown(47 * 60 + 23)).toBe("00:47:23 until cliff");
  });

  it("updates every second during the last hour", () => {
    const seconds = 59 * 60;
    render(<CliffCountdown cliffLedger={ledgersForSeconds(seconds)} currentLedger={0} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:59:00 until cliff");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:58:59 until cliff");
  });

  it("selects interval tiers for long, weekly, and hourly ranges", () => {
    expect(countdownIntervalMs(8 * 86400)).toBe(3600000);
    expect(countdownIntervalMs(6 * 86400)).toBe(60000);
    expect(countdownIntervalMs(60 * 60)).toBe(1000);
  });

  it("reaches the cliff and announces the unlocked state", () => {
    const onReached = vi.fn();
    render(<CliffCountdown cliffLedger={100} currentLedger={100} onReached={onReached} />);
    expect(screen.getByTestId("cliff-countdown")).toHaveTextContent(/tokens are now unlocked/i);
    expect(onReached).toHaveBeenCalledOnce();
  });

  it("renders a claim action after the cliff", async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(
      <CliffCountdown
        cliffLedger={100}
        currentLedger={100}
        onClaim={onClaim}
        claimableAmount={25}
        tokenSymbol="USDC"
      />,
    );
    expect(screen.getByTestId("cliff-claim-button")).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("cliff-claim-button"));
    });
    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("does not render animation for reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { container } = render(<CliffCountdown cliffLedger={100} currentLedger={100} />);
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
    window.matchMedia = originalMatchMedia;
  });

  it("resets the anchor when the current ledger changes", () => {
    const { rerender } = render(<CliffCountdown cliffLedger={100} currentLedger={0} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:08:20 until cliff");
    rerender(<CliffCountdown cliffLedger={100} currentLedger={99} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:00:05 until cliff");
  });
});
