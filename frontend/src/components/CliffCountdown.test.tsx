import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import {
  CliffCountdown,
  countdownIntervalMs,
  formatCountdown,
  formatLedger,
  useLiveLedger,
} from "@/components/CliffCountdown";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ledgersForSeconds(seconds: number): number {
  return seconds / 5;
}

/**
 * Returns a fetch mock that resolves with the given ledger sequence.
 * Pass `null` to simulate a network failure (ok: false).
 */
function makeFetchMock(sequence: number | null) {
  return vi.fn().mockResolvedValue(
    sequence === null
      ? { ok: false }
      : {
          ok: true,
          json: vi.fn().mockResolvedValue({
            jsonrpc: "2.0",
            id: 1,
            result: { sequence },
          }),
        }
  );
}

// ── formatCountdown ───────────────────────────────────────────────────────────

describe("formatCountdown", () => {
  it("formats > 7 days", () => {
    expect(formatCountdown(142 * 86400 + 6 * 3600)).toBe(
      "142 days 06 hours remaining"
    );
  });

  it("formats 1–7 days", () => {
    expect(formatCountdown(6 * 86400 + 14 * 3600 + 32 * 60)).toBe(
      "6 days 14 hours 32 minutes remaining"
    );
  });

  it("formats < 1 hour as HH:MM:SS", () => {
    expect(formatCountdown(47 * 60 + 23)).toBe("00:47:23 until cliff");
  });

  it("returns 00:00:00 for zero remaining seconds", () => {
    expect(formatCountdown(0)).toBe("00:00:00 until cliff");
  });
});

// ── formatLedger ─────────────────────────────────────────────────────────────

describe("formatLedger", () => {
  it("formats large numbers with commas", () => {
    expect(formatLedger(1_234_567)).toBe("1,234,567");
  });

  it("formats small numbers without commas", () => {
    expect(formatLedger(100)).toBe("100");
  });
});

// ── countdownIntervalMs ───────────────────────────────────────────────────────

describe("countdownIntervalMs", () => {
  it("returns 3 600 000 ms for > 7 days", () => {
    expect(countdownIntervalMs(8 * 86400)).toBe(3_600_000);
  });

  it("returns 60 000 ms for 1–7 days", () => {
    expect(countdownIntervalMs(6 * 86400)).toBe(60_000);
  });

  it("returns 1 000 ms for ≤ 1 hour", () => {
    expect(countdownIntervalMs(60 * 60)).toBe(1_000);
  });
});

// ── useLiveLedger ─────────────────────────────────────────────────────────────

describe("useLiveLedger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialises with the prop value before the first fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {}))); // never resolves
    const { result } = renderHook(() =>
      useLiveLedger(42, { rpcUrl: "https://rpc.example" })
    );
    expect(result.current.currentLedger).toBe(42);
    expect(result.current.loading).toBe(true);
  });

  it("updates to the fetched ledger after the first poll", async () => {
    vi.stubGlobal("fetch", makeFetchMock(12345));
    const { result } = renderHook(() =>
      useLiveLedger(0, { rpcUrl: "https://rpc.example" })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentLedger).toBe(12345);
    expect(result.current.error).toBeNull();
  });

  it("sets an error and keeps the last known ledger when RPC fails", async () => {
    vi.stubGlobal("fetch", makeFetchMock(null));
    const { result } = renderHook(() =>
      useLiveLedger(500, { rpcUrl: "https://rpc.example" })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/unable to reach soroban rpc/i);
    expect(result.current.currentLedger).toBe(500); // prop value preserved
  });

  it("does not fetch when disabled", async () => {
    const fetchMock = makeFetchMock(9999);
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() =>
      useLiveLedger(0, { rpcUrl: "https://rpc.example", disabled: true })
    );

    // Give a tick for any accidental async work to run
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── CliffCountdown component ──────────────────────────────────────────────────

describe("CliffCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    // Default stub: RPC returns the same ledger as the prop so tests are deterministic
    vi.stubGlobal("fetch", makeFetchMock(0));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Countdown state ───────────────────────────────────────────────────────

  it("renders the countdown value before the cliff", () => {
    const seconds = 59 * 60;
    render(<CliffCountdown cliffLedger={ledgersForSeconds(seconds)} currentLedger={0} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent(
      "00:59:00 until cliff"
    );
  });

  it("updates every second during the last hour", () => {
    const seconds = 59 * 60;
    render(<CliffCountdown cliffLedger={ledgersForSeconds(seconds)} currentLedger={0} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:59:00 until cliff");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:58:59 until cliff");
  });

  it("shows ledger numbers immediately (before async poll) using prop values", () => {
    // Provide a fetch that never resolves so loading stays true — ledger display
    // should still show prop values, not a loading spinner
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<CliffCountdown cliffLedger={1000} currentLedger={500} />);
    const display = screen.getByTestId("cliff-ledger-display");
    // loading=true shows "Syncing ledger…" — prop values come through aria-label
    // and also via the timer aria-label; once poll settles ledger numbers appear.
    // Verify the outer wrapper has the correct aria-label with the prop values.
    const timer = screen.getByTestId("cliff-countdown");
    expect(timer.getAttribute("aria-label")).toContain("500");
    expect(timer.getAttribute("aria-label")).toContain("1,000");
    expect(display).toBeInTheDocument();
  });

  it("shows ledger numbers in the display after the first poll resolves", async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", makeFetchMock(500));
    render(<CliffCountdown cliffLedger={1000} currentLedger={500} rpcUrl="https://rpc.test" />);

    await waitFor(() => {
      const display = screen.getByTestId("cliff-ledger-display");
      expect(display).toHaveTextContent("500");    // current ledger
    });
    expect(screen.getByTestId("cliff-ledger-display")).toHaveTextContent("1,000"); // cliff ledger
  });

  it("displays current and cliff ledger numbers in separate elements after poll", async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", makeFetchMock(1_234_567));
    render(
      <CliffCountdown
        cliffLedger={2_000_000}
        currentLedger={1_234_567}
        rpcUrl="https://rpc.test"
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("current-ledger-number")).toHaveTextContent("1,234,567")
    );
    expect(screen.getByTestId("cliff-ledger-number")).toHaveTextContent("2,000,000");
  });

  it("exposes an accessible aria-label on the timer element", () => {
    render(<CliffCountdown cliffLedger={1000} currentLedger={500} />);
    const timer = screen.getByTestId("cliff-countdown");
    expect(timer).toHaveAttribute("aria-live", "polite");
    expect(timer).toHaveAttribute("aria-atomic", "true");
    expect(timer.getAttribute("aria-label")).toMatch(/time remaining until cliff/i);
  });

  it("resets the anchor when the current ledger prop changes", () => {
    const { rerender } = render(<CliffCountdown cliffLedger={100} currentLedger={0} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:08:20 until cliff");
    rerender(<CliffCountdown cliffLedger={100} currentLedger={99} />);
    expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent("00:00:05 until cliff");
  });

  // ── Edge case: cliff already passed on first load ─────────────────────────

  it("immediately shows the cliff-reached state when cliff is already passed", () => {
    render(<CliffCountdown cliffLedger={50} currentLedger={100} />);
    expect(screen.getByTestId("cliff-countdown")).toHaveTextContent(
      /cliff reached! claim your tokens/i
    );
  });

  // ── Cliff reached state ───────────────────────────────────────────────────

  it("shows the cliff-reached message and calls onReached once", () => {
    const onReached = vi.fn();
    render(<CliffCountdown cliffLedger={100} currentLedger={100} onReached={onReached} />);
    expect(screen.getByTestId("cliff-countdown")).toHaveTextContent(
      /cliff reached! claim your tokens/i
    );
    expect(onReached).toHaveBeenCalledOnce();
  });

  it("announces the cliff-reached state via role=status", () => {
    render(<CliffCountdown cliffLedger={100} currentLedger={100} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("shows the cliff ledger number in the cliff-reached state", () => {
    render(<CliffCountdown cliffLedger={1_000_000} currentLedger={1_000_000} />);
    expect(screen.getByTestId("cliff-ledger-number")).toHaveTextContent("1,000,000");
  });

  it("shows the claimable amount and symbol in the cliff-reached state", () => {
    render(
      <CliffCountdown
        cliffLedger={100}
        currentLedger={100}
        claimableAmount={1_250}
        tokenSymbol="XLM"
      />
    );
    expect(screen.getByTestId("cliff-countdown")).toHaveTextContent("1,250 XLM");
  });

  it("renders the claim button and invokes onClaim when clicked", async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(
      <CliffCountdown
        cliffLedger={100}
        currentLedger={100}
        onClaim={onClaim}
        claimableAmount={25}
        tokenSymbol="USDC"
      />
    );
    expect(screen.getByTestId("cliff-claim-button")).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("cliff-claim-button"));
    });
    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("disables the claim button when claimableAmount is 0", () => {
    const onClaim = vi.fn();
    render(
      <CliffCountdown
        cliffLedger={100}
        currentLedger={100}
        onClaim={onClaim}
        claimableAmount={0}
      />
    );
    expect(screen.getByTestId("cliff-claim-button")).toBeDisabled();
  });

  it("shows a claim error when onClaim rejects", async () => {
    const onClaim = vi.fn().mockRejectedValue(new Error("tx failed"));
    render(
      <CliffCountdown
        cliffLedger={100}
        currentLedger={100}
        onClaim={onClaim}
        claimableAmount={10}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("cliff-claim-button"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("tx failed");
  });

  // ── Live ledger polling ───────────────────────────────────────────────────

  it("updates the countdown when the live poll returns a later ledger", async () => {
    vi.useRealTimers();
    // cliff at 100, start at 0 (= 500 s) — poll says we're at ledger 90
    vi.stubGlobal("fetch", makeFetchMock(90));
    render(<CliffCountdown cliffLedger={100} currentLedger={0} rpcUrl="https://rpc.test" />);

    // cliff - 90 = 10 ledgers = 50 s → "00:00:50 until cliff"
    await waitFor(() =>
      expect(screen.getByTestId("cliff-countdown-value")).toHaveTextContent(
        "00:00:50 until cliff"
      )
    );
  });

  it("shows an RPC-error notice while keeping the countdown running", async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", makeFetchMock(null));
    render(<CliffCountdown cliffLedger={100} currentLedger={50} rpcUrl="https://rpc.test" />);

    await waitFor(() =>
      expect(screen.getByTestId("ledger-poll-error")).toHaveTextContent(
        /unable to reach soroban rpc/i
      )
    );
    // Countdown still visible
    expect(screen.getByTestId("cliff-countdown-value")).toBeInTheDocument();
  });

  // ── Reduced-motion ────────────────────────────────────────────────────────

  it("does not render animation elements when reduced motion is preferred", () => {
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
});
